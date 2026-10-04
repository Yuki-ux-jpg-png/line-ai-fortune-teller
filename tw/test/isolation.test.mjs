import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
Object.assign(process.env,{
  TW_DATABASE_URL:'postgres://test:test@localhost/test',TW_DATABASE_SSL:'false',
  LINE_TW_CHANNEL_SECRET:'test-taiwan-secret',LINE_TW_CHANNEL_ACCESS_TOKEN:'test-taiwan-token',
  TW_OPENAI_API_KEY:'test-openai-key',TW_OPENAI_MODEL:'test-model',
  TW_STRIPE_SECRET_KEY:'sk_test_placeholder',TW_STRIPE_WEBHOOK_SECRET:'test-stripe-webhook',
  TW_APP_BASE_URL:'https://taiwan.example',SUPABASE_URL:'https://supabase.example',SUPABASE_SECRET_KEY:'sb_secret_test_placeholder',
  LINE_CHANNEL_SECRET:'test-japanese-secret',LINE_CHANNEL_ACCESS_TOKEN:'test-japanese-token'
});
const { app }=await import('../dist/src/server.js');
const { pool }=await import('../dist/src/db.js');
const { stripe }=await import('../dist/src/payments.js');
const { taipeiDate,isDailyFortuneEvent,getDailyFortune }=await import('../dist/src/daily.js');
const { verifyLineSignature,tellerCarousel,paymentMessage }=await import('../dist/src/line.js');
const { handleStripeEvent }=await import('../dist/src/webhook.js');
const { READING_INSTRUCTIONS,limitReadingLength }=await import('../dist/src/ai.js');
const { config }=await import('../dist/src/config.js');
const realFetch=globalThis.fetch;
let saved=new Map(),replies=[],seenEvents=new Set(),queries=[];
const teller={id:'yuri',name:'伊藤 由利',description:'感情諮詢',image_url:'https://example.test/yuri.jpg',system_prompt:'台灣繁體中文'};
pool.query=async (sql,args=[])=>{
  queries.push(sql);
  if(sql.includes('INSERT INTO processed_line_events')){const isNew=!seenEvents.has(args[0]);seenEvents.add(args[0]);return {rowCount:isNew?1:0,rows:[]};}
  if(sql.includes('DELETE FROM processed_line_events')){seenEvents.delete(args[0]);return {rowCount:1,rows:[]};}
  if(sql.includes('INSERT INTO users')) return {rowCount:1,rows:[{line_user_id:args[0],selected_teller_id:null,state:'selecting_teller',free_consultations_used:0}]};
  if(sql.includes('FROM fortune_tellers')) return {rowCount:1,rows:[teller]};
  if(sql.includes('current_schema()')) return {rowCount:1,rows:[{schema:'line_tw'}]};
  throw new Error('Unexpected SQL in test: '+sql);
};
globalThis.fetch=async (input,options={})=>{
  const u=new URL(input);
  if(u.hostname==='127.0.0.1') return realFetch(input,options);
  if(u.host==='api.line.me') {assert.equal(options.headers.Authorization,'Bearer test-taiwan-token');replies.push(JSON.parse(options.body));return new Response('{}',{status:200});}
  assert.equal(u.host,'supabase.example');assert.equal(u.pathname,'/rest/v1/fortunes_tw');
  assert.equal(options.headers.apikey,'sb_secret_test_placeholder');
  assert.equal(options.headers.Authorization,undefined);
  if(options.method==='POST') {
    const row=JSON.parse(options.body),key=row.line_user_id+':'+row.fortune_date;
    if(saved.has(key)) return Response.json({code:'23505'},{status:409});
    saved.set(key,row.fortune_result);return new Response(null,{status:201});
  }
  const key=u.searchParams.get('line_user_id').slice(3)+':'+u.searchParams.get('fortune_date').slice(3);
  return Response.json(saved.has(key)?[{fortune_result:saved.get(key)}]:[]);
};
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base='http://127.0.0.1:'+server.address().port;
function signature(body,secret=process.env.LINE_TW_CHANNEL_SECRET){return crypto.createHmac('sha256',secret).update(body).digest('base64');}
async function post(body,secret){return fetch(base+'/webhooks/line',{method:'POST',headers:{'Content-Type':'application/json','x-line-signature':signature(body,secret)},body});}
const message=(id,text)=>({type:'message',webhookEventId:id,replyToken:'reply-'+id,source:{type:'user',userId:'tw-test-user'},message:{id:'msg-'+id,type:'text',text}});
test.after(async()=>{globalThis.fetch=realFetch;await new Promise(r=>server.close(r));await pool.end();});
test('Japan signatures fail and Taiwan signatures pass over exact raw bytes',()=>{
 const raw=Buffer.from('{"events":[]}');assert(verifyLineSignature(raw,signature(raw)));
 assert(!verifyLineSignature(raw,signature(raw,process.env.LINE_CHANNEL_SECRET)));
 assert(!verifyLineSignature(raw,'bad'));assert(!verifyLineSignature(Buffer.from(' '+raw),signature(raw)));
});
test('signed verification request and invalid payload have correct status',async()=>{
 assert.equal((await post('{"events":[]}')).status,200);
 assert.equal((await post('{"events":[]}',process.env.LINE_CHANNEL_SECRET)).status,401);
 assert.equal((await post('{"events":"not-an-array"}')).status,400);
 assert.equal((await post('{bad-json')).status,400);
});
test('Taipei day rolls at 16:00 UTC, not the Japanese 15:00 UTC boundary',()=>{
 assert.equal(taipeiDate(new Date('2026-10-04T15:59:59Z')),'2026-10-04');
 assert.equal(taipeiDate(new Date('2026-10-04T16:00:00Z')),'2026-10-05');
});
test('daily requests use Traditional Taiwan text and reuse one saved draw in a race',async()=>{
 for(const t of ['占卜','今日運勢','抽籤'])assert(isDailyFortuneEvent(message('keywords',t)));
 assert(isDailyFortuneEvent({type:'postback',postback:{data:'fortune=today'}}));
 assert(!isDailyFortuneEvent(message('select','選擇占卜師')));
 const results=await Promise.all([getDailyFortune('race-user','2026-10-04'),getDailyFortune('race-user','2026-10-04')]);
 assert.equal(saved.size,1);assert.match(results[0],/今日運勢（台灣時間）/);
 assert.equal(results[0].split('\n\n――――――――――\n※')[0],results[1].split('\n\n――――――――――\n※')[0]);
 const again=await getDailyFortune('race-user','2026-10-04');assert.match(again,/你今天已經占卜過囉/);assert(!/[ぁ-んァ-ヶ]/.test(again));
});
test('mixed daily + selection batch routes once each, and redelivery does not reply twice',async()=>{
 replies=[];const payload=JSON.stringify({events:[message('daily1','占卜'),message('select1','選擇占卜師')]});
 assert.equal((await post(payload)).status,200);assert.equal(replies.length,2);
 assert.match(replies[0].messages[0].text,/今日運勢/);assert.match(replies[1].messages[0].text,/請選擇/);
 assert.equal(replies[1].messages[1].type,'flex');
 assert.equal((await post(payload)).status,200);assert.equal(replies.length,2);
});
test('Japanese Stripe events are ignored before any database write',async()=>{
 const count=queries.length;
 for(const type of ['checkout.session.completed','checkout.session.expired'])await handleStripeEvent({id:'jp-event',type,data:{object:{metadata:{product_type:'fortune_consultation_credit'}}}});
 assert.equal(queries.length,count);
});
test('Japanese database keys cannot satisfy a missing Taiwan key; namespace and pricing stay explicit',()=>{
 const env={...process.env,DATABASE_URL:'postgres://japanese.example/jp'};delete env.TW_DATABASE_URL;
 const child=spawnSync(process.execPath,['--input-type=module','-e',"import('./dist/src/config.js')"],{env,encoding:'utf8'});
 assert.notEqual(child.status,0);assert.match(child.stderr,/TW_DATABASE_URL/);
 assert.equal(config.databaseSchema,'line_tw');assert.equal(pool.options.options,'-c search_path=line_tw -c timezone=Asia/Taipei');
 const card=JSON.stringify(paymentMessage('https://checkout.example'));assert.match(card,/日圓/);assert.match(card,/JPY/);assert(!card.includes('新台幣'));
 assert(!/[ぁ-んァ-ヶ]/.test(JSON.stringify(tellerCarousel([teller]))));
});
test('AI instructions lock Taiwanese Traditional Chinese and Unicode result length',()=>{
 assert.match(READING_INSTRUCTIONS,/繁體中文（台灣/);assert.match(READING_INSTRUCTIONS,/Asia\/Taipei/);
 const answer=limitReadingLength('🌙'.repeat(11000));assert.equal(Array.from(answer).length,10000);assert(!answer.includes('\uFFFD'));
});
test('health requires Taiwan schema and payment pages use zh-TW',async()=>{
 assert.equal((await (await fetch(base+'/health')).json()).locale,'zh-TW');
 for(const path of ['/payment/success','/payment/cancel'])assert.match(await (await fetch(base+path)).text(),/lang="zh-TW"/);
});
test('Taiwan migrations exclude Japanese repair jobs and seed all three localized tellers',async()=>{
 const files=await fs.readdir(new URL('../migrations/',import.meta.url));assert.deepEqual(files.sort(),['001_init.sql','002_tellers_zh_tw.sql']);
 const seed=await fs.readFile(new URL('../migrations/002_tellers_zh_tw.sql',import.meta.url),'utf8');
 for(const id of ['yuri','mao','kei'])assert(seed.includes("'"+id+"'"));assert(!/[ぁ-んァ-ヶ]/.test(seed));
});
