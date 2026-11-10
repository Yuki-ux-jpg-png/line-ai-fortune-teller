import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {attachTestPool} from './helpers/database.mjs';

// All identities, providers and PostgreSQL data in this suite are disposable.
Object.assign(process.env,{NODE_ENV:'test',SUPABASE_URL:'https://fixture.invalid',SUPABASE_SECRET_KEY:'fixture',TW_DATABASE_URL:'postgres://fixture:fixture@127.0.0.1:1/never',TW_DATABASE_SSL:'false',TW_APP_BASE_URL:'https://fixture.invalid',LINE_TW_CHANNEL_SECRET:'fixture',LINE_TW_CHANNEL_ACCESS_TOKEN:'fixture',TW_OPENAI_API_KEY:'fixture',TW_OPENAI_MODEL:'fixture',TW_STRIPE_SECRET_KEY:'sk_test_fixture',KR_DATABASE_URL:'postgres://fixture:fixture@127.0.0.1:1/never',KR_DATABASE_SSL:'false',KR_APP_BASE_URL:'https://fixture.invalid',LINE_KR_CHANNEL_SECRET:'fixture',LINE_KR_CHANNEL_ACCESS_TOKEN:'fixture',KR_CONSULTATIONS_ENABLED:'true',KR_OPENAI_API_KEY:'fixture',KR_OPENAI_MODEL:'fixture',KR_PAYMENTS_ENABLED:'false',WEB_CONSULTATION_ENABLED:'true',WEB_MEMBER_SUPABASE_URL:'https://vlvftfkfgkvlkrnrqgeq.supabase.co',WEB_MEMBER_PUBLISHABLE_KEY:'public_fixture'});
globalThis.fetch=async()=>{throw new Error('External HTTP is forbidden');};
const id='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222';
const member={id,email:'a@example.test',access:true,staff:false};
const ai={urgentSafetyConcern:async()=>false,followUpQuestion:async()=>'',summarizeIntake:async()=>''};
for(const market of ['tw','kr']) {
 const root=new URL(`../${market}/`,import.meta.url), compiled=new URL('dist/src/',root);
 const {pool}=await import(new URL('db.js',compiled));
 const {webAction,webSnapshot}=await import(new URL('web-consultations.js',compiled));
 const identity=await import(new URL('web-identity.js',compiled));
 const core=await import(new URL('consultations.js',compiled));
 const {authenticateWebMember}=await import(new URL('web-auth.js',compiled));
 const {webCheckout}=await import(new URL('web-checkout.js',compiled));
 test(`${market}: additive migration, trusted market, free retries, Web-only result and private notices`,async t=>{
  const db=new PGlite();t.after(()=>db.close());
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE line_${market}_app;CREATE SCHEMA line_${market};GRANT USAGE ON SCHEMA line_${market} TO line_${market}_app;GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA line_${market} TO line_${market}_app;ALTER DEFAULT PRIVILEGES IN SCHEMA line_${market} GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO line_${market}_app;SET search_path TO line_${market};CREATE TABLE public.sentinel(value text);INSERT INTO public.sentinel VALUES('preserved');`);
  const files=(await readdir(new URL('migrations/',root))).filter(x=>x.endsWith('.sql')).sort();
  for(const filename of files.slice(0,-1)) await db.exec(await readFile(new URL('migrations/'+filename,root),'utf8'));
  await db.exec("INSERT INTO users(line_user_id,free_consultations_used) VALUES('legacy-line',1);INSERT INTO consultations(line_user_id,teller_id,question,status) VALUES('legacy-line','yuri','legacy draft','draft');");
  await db.exec(await readFile(new URL('migrations/'+files.at(-1),root),'utf8'));
  assert.deepEqual((await db.query("SELECT free_consultations_used FROM users WHERE line_user_id='legacy-line'")).rows,[{free_consultations_used:1}]);
  assert.equal((await db.query('SELECT count(*)::int n FROM consultation_processing_holds')).rows[0].n,0);
  assert.equal((await db.query("SELECT delivery_channel FROM consultations WHERE line_user_id='legacy-line'")).rows[0].delivery_channel,'line');
  await db.exec(`SET ROLE line_${market}_app;`);
  attachTestPool(t,pool,db);
  const fetcher=(claimedMarket)=>async url=>Response.json(url.endsWith('/user')?{id,email:member.email,email_confirmed_at:'2026-01-01'}:{profile:{market:claimedMarket},access:true});
  assert.equal((await authenticateWebMember('Bearer fixture',fetcher(market))).id,id);
  for(const wrong of ['jp','tw','kr'].filter(x=>x!==market))await assert.rejects(authenticateWebMember('Bearer fixture',fetcher(wrong)),e=>e.status===403);
  await identity.startWebIdentity(id);
  const draft=await webAction(member,'draft',{question:'A private question',tellerId:'yuri',requestId:crypto.randomUUID()},ai);
  assert.equal((await webAction(member,'confirm',{id:draft.id})).type,'accepted');
  assert.equal((await webAction(member,'confirm',{id:draft.id})).type,'already_processing');
  assert.equal((await webSnapshot(id)).freeRemaining,1);
  await assert.rejects(webAction({...member,id:other},'confirm',{id:draft.id}),e=>e.status===409);
  const job=await core.claimGenerationJob();assert.equal(job.id,draft.id);
  await core.saveGeneratedAnswer(job.id,'Private generated result');
  assert.equal((await webSnapshot(id)).consultations[0].answer,null);
  await db.query("UPDATE consultations SET deliver_at=now()-interval '1 second' WHERE id=$1",[job.id]);
  const delivery=await core.claimDeliveryJob();assert.equal(delivery.delivery_channel,'web');
  await core.markDelivered(delivery);await core.markDelivered(delivery);
  const state=await webAction(member,'status',{});
  assert.equal(state.consultations[0].answer,'Private generated result');assert.equal(state.notices.length,1);
  assert.equal(state.currency,market==='kr'?'krw':'jpy');assert.equal(state.price,market==='kr'?0:500);
  assert.equal(state.paymentsAvailable,market!=='kr');
  assert.equal((await webSnapshot(other)).consultations.length,0);
  if(market==='kr'){
   await db.query('UPDATE users SET free_consultations_used=2 WHERE line_user_id=$1',[await identity.webIdentity(id)]);
   const third=await webAction(member,'draft',{question:'Third',tellerId:'yuri',requestId:crypto.randomUUID()},ai);
   assert.equal((await webAction(member,'confirm',{id:third.id})).type,'payments_unavailable');
   await assert.rejects(webCheckout(third.id,await identity.webIdentity(id)),e=>e.status===503);
   assert.equal((await db.query('SELECT count(*)::int n FROM web_checkout_attempts')).rows[0].n,0);
  }
  await db.exec('RESET ROLE;SET ROLE anon;');await assert.rejects(db.query(`SELECT * FROM line_${market}.web_notices`));
  await db.exec('RESET ROLE;');assert.equal((await db.query('SELECT value FROM public.sentinel')).rows[0].value,'preserved');
 });
}
