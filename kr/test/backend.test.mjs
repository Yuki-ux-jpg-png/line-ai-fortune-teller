import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

Object.assign(process.env,{KR_DATABASE_URL:'postgres://test:test@localhost/test',KR_DATABASE_SSL:'false',LINE_KR_CHANNEL_SECRET:'test-korean-secret',LINE_KR_CHANNEL_ACCESS_TOKEN:'test-korean-token',KR_APP_BASE_URL:'https://korean.example'});
const {pool}=await import('../dist/src/db.js');
const {config}=await import('../dist/src/config.js');
const consultations=await import('../dist/src/consultations.js');
const {getDailyFortune,seoulDate}=await import('../dist/src/daily.js');
const {app}=await import('../dist/src/server.js');
const {verifyLineSignature}=await import('../dist/src/line.js');
const {getOrCreateCheckoutUrl}=await import('../dist/src/payments.js');
const db=new PGlite();
const realFetch=globalThis.fetch, replies=[];
let server,base;
async function run(sql,args=[]){const r=await db.query(sql,args);return {rows:r.rows,rowCount:r.rows.length || r.affectedRows || 0};}
test.before(async()=>{
 await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE TABLE public.users(id text); INSERT INTO public.users VALUES ('jp-sentinel'); CREATE TABLE public.fortunes(id text); INSERT INTO public.fortunes VALUES ('jp-fortune'); CREATE SCHEMA line_tw; CREATE TABLE line_tw.users(id text); INSERT INTO line_tw.users VALUES ('tw-sentinel');");
 await db.exec('BEGIN;'+await fs.readFile(new URL('../setup.sql',import.meta.url),'utf8')+'COMMIT;');
 await db.exec("SET ROLE line_kr_app; SET search_path TO line_kr; SET timezone TO 'Asia/Seoul';");
 pool.query=run;pool.connect=async()=>({query:run,release(){}});
 globalThis.fetch=async(input,options={})=>{
  const url=new URL(input);
  if(url.hostname==='127.0.0.1')return realFetch(input,options);
  assert.equal(url.hostname,'api.line.me','Unexpected external call');
  assert.equal(options.headers.Authorization,'Bearer test-korean-token');
  replies.push(JSON.parse(options.body));return Response.json({});
 };
 server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base='http://127.0.0.1:'+server.address().port;
});
test.after(async()=>{globalThis.fetch=realFetch;if(server)await new Promise(r=>server.close(r));await pool.end();await db.close();});
function sign(body,secret=process.env.LINE_KR_CHANNEL_SECRET){return crypto.createHmac('sha256',secret).update(body).digest('base64');}
function event(id,text){return {type:'message',webhookEventId:id,replyToken:'r-'+id,source:{type:'user',userId:'line-test-user'},message:{type:'text',id:'m-'+id,text}};}
async function send(events,secret){const body=JSON.stringify({events});return fetch(base+'/webhooks/line',{method:'POST',headers:{'Content-Type':'application/json','x-line-signature':sign(body,secret)},body});}

test('Korean-only role cannot access Japanese or Taiwanese data',async()=>{
 await assert.rejects(()=>run('SELECT * FROM public.users'));
 await assert.rejects(()=>run('SELECT * FROM public.fortunes'));
 await assert.rejects(()=>run('SELECT * FROM line_tw.users'));
 assert.equal((await run('SELECT count(*)::int n FROM fortune_tellers')).rows[0].n,3);
 await db.exec('RESET ROLE;');
 assert.deepEqual((await run('SELECT * FROM public.users')).rows,[{id:'jp-sentinel'}]);
 assert.deepEqual((await run('SELECT * FROM line_tw.users')).rows,[{id:'tw-sentinel'}]);
 await db.exec('SET ROLE anon;');
 await assert.rejects(()=>run('SELECT * FROM public.fortunes_kr'));
 await assert.rejects(()=>run('SELECT * FROM line_kr.users'));
 await db.exec('RESET ROLE; SET ROLE line_kr_app;');
});
test('Seoul day changes at 15:00 UTC',()=>{
 assert.equal(seoulDate(new Date('2026-10-16T14:59:59Z')),'2026-10-16');
 assert.equal(seoulDate(new Date('2026-10-16T15:00:00Z')),'2026-10-17');
});
test('daily race saves one Korean result and repeats that result',async()=>{
 const values=await Promise.all([getDailyFortune('race','2026-10-16'),getDailyFortune('race','2026-10-16')]);
 assert.equal(values[0].split('\n\n――――――――――\n※')[0],values[1].split('\n\n――――――――――\n※')[0]);
 assert.equal((await run('SELECT count(*)::int n FROM public.fortunes_kr')).rows[0].n,1);
 assert.match(await getDailyFortune('race','2026-10-16'),/이미 운세/);
 assert.match(values[0],/한국 시간/);assert(!/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(values[0]));
 await getDailyFortune('race','2026-10-17');assert.equal((await run('SELECT count(*)::int n FROM public.fortunes_kr')).rows[0].n,2);
});
test('LINE rejects other channel signatures, routes Korean daily events, deduplicates redelivery',async()=>{
 const raw=Buffer.from('{"events":[]}');assert(verifyLineSignature(raw,sign(raw)));assert(!verifyLineSignature(raw,sign(raw,'japanese-secret')));
 assert.equal((await send([],'japanese-secret')).status,401);assert.equal((await send([])).status,200);
 const before=replies.length;const events=[event('daily-1','오늘의 운세')];
 assert.equal((await send(events)).status,200);assert.equal(replies.length,before+1);
 assert.equal((await send(events)).status,200);assert.equal(replies.length,before+1);
});
test('consultations and Stripe are disabled until configured, with no free uses',async()=>{
 assert.equal(config.consultationsEnabled,false);assert.equal(config.paymentsEnabled,false);assert.equal(config.consultationPriceKrw,0);
 assert.equal((await send([event('disabled-1','상담하기')])).status,200);
 assert.equal((await run('SELECT count(*)::int n FROM users')).rows[0].n,0);
 assert.equal((await fetch(base+'/webhooks/stripe',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,503);
 await assert.rejects(()=>getOrCreateCheckoutUrl('none','none'),/아직 준비 중/);
});
test('draft replacement invalidates old buttons and confirmation consumes one free use',async()=>{
 await consultations.ensureUser('draft-user');await consultations.selectTeller('draft-user','yuri');
 const a=await consultations.saveDraft('draft-user','관계가 고민이에요');const b=await consultations.saveDraft('draft-user','대화를 어떻게 시작할까요');
 assert.notEqual(a.consultationId,b.consultationId);
 assert.equal((await consultations.confirmConsultation('draft-user',a.consultationId)).type,'already_processing');
 assert.equal(await consultations.resetDraft('draft-user',a.consultationId),false);
 assert.equal((await consultations.getUser('draft-user')).free_consultations_used,0);
 const result=await consultations.confirmConsultation('draft-user',b.consultationId);
 assert.equal(result.type,'accepted');assert.equal(result.entitlement,'free');assert.equal(result.freeRemaining,1);
 await consultations.confirmConsultation('draft-user',b.consultationId);
 assert.equal((await consultations.getUser('draft-user')).free_consultations_used,1);
 const row=(await run('SELECT deliver_at,confirmed_at FROM consultations WHERE id=$1',[b.consultationId])).rows[0];
 const minutes=(new Date(row.deliver_at)-new Date(row.confirmed_at))/60000;assert(minutes>=89.9&&minutes<=120.1);
});
test('expired preparation and cancellation consume no credits',async()=>{
 await consultations.ensureUser('expired');await consultations.selectTeller('expired','mao');
 const d=await consultations.saveDraft('expired','직장 고민');
 await run("UPDATE users SET intake_expires_at=now()-interval '1 second' WHERE line_user_id='expired'");
 assert.equal((await consultations.confirmConsultation('expired',d.consultationId)).type,'invalid');
 await consultations.endIntake('expired');
 assert.equal((await consultations.getUser('expired')).free_consultations_used,0);
 assert.equal((await run('SELECT status FROM consultations WHERE id=$1',[d.consultationId])).rows[0].status,'cancelled');
});
test('ordinary messages do not become drafts outside an active preparation session',async()=>{
 config.consultationsEnabled=true;
 await consultations.ensureUser('line-test-user');
 await run("UPDATE users SET selected_teller_id='kei',intake_expires_at=NULL WHERE line_user_id='line-test-user'");
 assert.equal((await send([event('ordinary-1','안녕하세요')])).status,200);
 assert.equal((await run("SELECT count(*)::int n FROM consultations WHERE line_user_id='line-test-user'")).rows[0].n,0);
 config.consultationsEnabled=false;
});
test('free limit does not lead to a payment session when Korean price is unset',async()=>{
 await consultations.ensureUser('paid-disabled');await consultations.selectTeller('paid-disabled','kei');
 await run("UPDATE users SET free_consultations_used=2 WHERE line_user_id='paid-disabled'");
 const d=await consultations.saveDraft('paid-disabled','마음 정리');
 assert.equal((await consultations.confirmConsultation('paid-disabled',d.consultationId)).type,'payments_unavailable');
 assert.equal((await run('SELECT status FROM consultations WHERE id=$1',[d.consultationId])).rows[0].status,'draft');
});
test('health checks schema; Korean pages contain no Japanese/Taiwanese customer text',async()=>{
 const health=await(await fetch(base+'/health')).json();assert.equal(health.ok,true);assert.equal(health.locale,'ko-KR');assert.equal(health.paymentsReady,false);
 for(const path of ['/payment/success','/payment/cancel']){
  const html=await(await fetch(base+path)).text();assert.match(html,/lang="ko-KR"/);assert(!/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(html));
 }
});
