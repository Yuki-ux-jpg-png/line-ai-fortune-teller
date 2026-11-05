import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createTestDatabase,useTestEnvironment,attachTestPool} from './helpers/database.mjs';
useTestEnvironment();
const {pool}=await import('../dist/db.js');
const {claimGenerationJob,claimDeliveryJob,holdAmbiguousDeliveries}=await import('../dist/consultations.js');
async function fixture(db,status='queued_generation',user='hold-test'){
 await db.query("insert into users(line_user_id,free_consultations_used) values($1,1) on conflict do nothing",[user]);
 const teller=(await db.query('select id from fortune_tellers limit 1')).rows[0];
 const r=await db.query("insert into consultations(line_user_id,teller_id,question,status,entitlement_type,deliver_at) values($3,$1,'test-only',$2,'free',now()-interval '1 hour') returning id",[teller.id,status,user]);return r.rows[0].id;
}
test('rollout hold preserves old job and entitlement but new jobs can be claimed',async(t)=>{
 const db=await createTestDatabase();t.after(()=>db.close());attachTestPool(t,pool,db);
 await db.exec('drop table consultation_processing_holds; alter table consultations drop column first_send_attempt_at');
 const oldId=await fixture(db);await db.exec(await readFile(new URL('../migrations/010_consultation_processing_holds.sql',import.meta.url),'utf8'));
 assert.equal(await claimGenerationJob(),null);
 assert.equal((await db.query('select status from consultations where id=$1',[oldId])).rows[0].status,'queued_generation');
 assert.equal((await db.query("select free_consultations_used from users where line_user_id='hold-test'")).rows[0].free_consultations_used,1);
 const nextId=await fixture(db,'queued_generation','new-user');assert.equal((await claimGenerationJob()).id,nextId);
});
test('LINE retry keys are not reused after their safe window; no automatic credit return',async(t)=>{
 const db=await createTestDatabase();t.after(()=>db.close());attachTestPool(t,pool,db);
 const id=await fixture(db,'scheduled');await db.query("update consultations set send_attempts=1,first_send_attempt_at=now()-interval '24 hours' where id=$1",[id]);
 assert.equal(await holdAmbiguousDeliveries(),1);assert.equal(await claimDeliveryJob(),null);
 assert.equal((await db.query('select reason from consultation_processing_holds where consultation_id=$1',[id])).rows[0].reason,'line_retry_window_expired');
});
