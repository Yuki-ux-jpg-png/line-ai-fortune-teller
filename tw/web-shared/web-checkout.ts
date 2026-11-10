import {webText} from "./web-locale.js";
import {webAmount,webCurrency,webPaymentsAvailable,webLocale} from "./web-market.js";
import {query,withTransaction} from './db.js';
import {stripe} from './payments.js';
import {config} from './config.js';
import {completeStripeCheckout} from './consultations.js';
import {WebError} from './web-auth.js';
export async function webCheckout(consultationId:string,canonical:string,provider=stripe) {
  if (!webPaymentsAvailable) throw new WebError(503,"有料相談は準備中です。課金は発生していません。");
  // Commit the attempt BEFORE contacting Stripe. A lost response keeps the same key.
  const attempt=await withTransaction(async c=>{
    const owned=await c.query(`SELECT id,status FROM consultations WHERE id=$1 AND line_user_id=$2 AND delivery_channel='web'
      AND NOT EXISTS(SELECT 1 FROM consultation_processing_holds h WHERE h.consultation_id=consultations.id) FOR UPDATE`,[consultationId,canonical]);
    if(!owned.rowCount)throw new WebError(404,'相談を確認してください。');
    if(owned.rows[0].status!=='awaiting_payment')return null;
    const pending=await c.query('SELECT * FROM web_checkout_attempts WHERE consultation_id=$1 AND closed_at IS NULL FOR UPDATE',[consultationId]);
    if(pending.rowCount)return pending.rows[0];
    return (await c.query('INSERT INTO web_checkout_attempts(consultation_id) VALUES($1) RETURNING *',[consultationId])).rows[0];
  });
  if(!attempt)return {paid:true};
  let session;
  if(attempt.session_id)session=await provider.checkout.sessions.retrieve(attempt.session_id);
  else {
    if(Date.now()-new Date(attempt.created_at).getTime()>20*3600*1000)
      throw new WebError(409,'以前のお支払い手続きの確認が必要です。重ねて支払わず運営へご相談ください。');
    const origin=process.env.WEB_MEMBER_APP_ORIGIN;
    if(origin!=='https://ibasho-kokoro.vercel.app')throw new WebError(503,'支払い先の接続を確認中です。');
    session=await provider.checkout.sessions.create({mode:'payment',locale: webLocale === 'ja-JP' ? 'ja' : webLocale === 'ko-KR' ? 'ko' : 'zh-TW',payment_method_types:['card'],
      line_items:[{price_data:{currency:webCurrency,unit_amount:webAmount,product_data:{name:webText('AI占い相談 1件'),description:webText('相談文1通とAI鑑定結果1通')}},quantity:1}],
      client_reference_id:canonical,metadata:{consultation_id:consultationId,line_user_id:canonical,product_type:'fortune_consultation_credit',web_attempt_id:attempt.id},
      success_url:`${origin}/member?consultation=${consultationId}`,cancel_url:`${origin}/member?consultation=${consultationId}`,expires_at:Math.floor(new Date(attempt.created_at).getTime()/1000)+30*60,
    },{idempotencyKey:`web-consultation:${consultationId}:${attempt.id}`});
  }
  if(session.mode!=='payment'||session.metadata?.web_attempt_id!==attempt.id||session.metadata?.consultation_id!==consultationId||session.metadata?.line_user_id!==canonical||session.currency!==webCurrency||session.amount_total!==webAmount)
    throw new WebError(409,'決済情報の照合が必要です。重ねて支払わず運営へご相談ください。');
  await withTransaction(async c=>{
    await c.query('SELECT id FROM consultations WHERE id=$1 FOR UPDATE',[consultationId]);
    await c.query('UPDATE web_checkout_attempts SET session_id=$2 WHERE id=$1 AND (session_id IS NULL OR session_id=$2)',[attempt.id,session.id]);
    await c.query("UPDATE consultations SET stripe_session_id=$2,updated_at=now() WHERE id=$1 AND status='awaiting_payment'",[consultationId,session.id]);
  });
  if(session.status==='complete') {
    if(session.payment_status==='paid')await completeStripeCheckout(`web_sync:${session.id}`,session);
    return {paid:true};
  }
  if(session.status==='expired') {
    await query('UPDATE web_checkout_attempts SET closed_at=now() WHERE id=$1',[attempt.id]);
    throw new WebError(409,'支払い画面の期限が切れました。もう一度支払い画面を開いてください。');
  }
  if(session.status!=='open'||!session.url)throw new WebError(409,'支払い状況を確認してください。');
  return {url:session.url};
}
