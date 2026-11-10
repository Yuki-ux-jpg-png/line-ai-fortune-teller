import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestDatabase,attachTestPool,useTestEnvironment} from './helpers/database.mjs';
useTestEnvironment();process.env.WEB_MEMBER_APP_ORIGIN='https://ibasho-kokoro.vercel.app';
const {pool}=await import('../dist/db.js');
const {webCheckout}=await import('../dist/web-checkout.js');
const {startWebIdentity,webIdentity}=await import('../dist/web-identity.js');
const {saveWebDraft}=await import('../dist/web-consultations.js');
const {confirmConsultation}=await import('../dist/consultations.js');
const uid='11111111-1111-4111-8111-111111111111';
async function fixture(t){const db=await createTestDatabase();t.after(()=>db.close());attachTestPool(t,pool,db);await startWebIdentity(uid);const owner=await webIdentity(uid);await db.query('UPDATE users SET free_consultations_used=2 WHERE line_user_id=$1',[owner]);const draft=await saveWebDraft(owner,'tsukino','テストの相談',crypto.randomUUID());await confirmConsultation(owner,draft.id);return {db,owner,id:draft.id};}
test('a lost Checkout response reuses a previously committed attempt key and never creates a second session',async t=>{
 const {db,owner,id}=await fixture(t);let attempts=[],sessions=new Map(),lost=true;
 const provider={checkout:{sessions:{create:async(p,o)=>{attempts.push(o.idempotencyKey);let s=sessions.get(o.idempotencyKey);if(!s){s={id:'cs_test_web',status:'open',url:'https://checkout.stripe.com/test',mode:'payment',metadata:p.metadata,currency:'jpy',amount_total:500};sessions.set(o.idempotencyKey,s);}if(lost){lost=false;throw new Error('lost response');}return s;},retrieve:async()=>[...sessions.values()][0]}}};
 await assert.rejects(webCheckout(id,owner,provider),/lost response/);assert.equal((await db.query('SELECT count(*)::int n FROM web_checkout_attempts')).rows[0].n,1);
 assert.equal((await webCheckout(id,owner,provider)).url,'https://checkout.stripe.com/test');assert.equal(attempts[0],attempts[1]);assert.equal(sessions.size,1);
 await webCheckout(id,owner,provider);assert.equal(attempts.length,2);
});
test('an old unknown Checkout refuses any provider creation rather than risking duplicate payment',async t=>{
 const {db,owner,id}=await fixture(t);await db.query("INSERT INTO web_checkout_attempts(consultation_id,created_at) VALUES($1,now()-interval '21 hours')",[id]);let creates=0;
 await assert.rejects(webCheckout(id,owner,{checkout:{sessions:{create:async()=>{creates++;throw new Error('must not run');}}}}),e=>e.status===409);assert.equal(creates,0);
});
test('another owner cannot open the payment session or reserve a Checkout attempt',async t=>{
 const {db,id}=await fixture(t);await assert.rejects(webCheckout(id,'not-owner'),e=>e.status===404);assert.equal((await db.query('SELECT count(*)::int n FROM web_checkout_attempts')).rows[0].n,0);
});
