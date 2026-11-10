import {webCodePattern,prepareWebLink,approveWebLink} from "./web-identity.js";
import {replyMessage,textMessage} from "./line.js";
import {webMarket} from "./web-market.js";
import type {LineEvent} from "./types.js";
const messages={
 jp:{confirm:"この連携を承認すると、自分のWeb会員からLINEの相談履歴・鑑定結果を閲覧でき、無料回数も共有されます。自分で発行したコードですか？",yes:"自分のWeb会員と連携",no:"連携しない",done:"連携が完了しました。Web画面で最新の状態を確認してください。",invalid:"連携コードの期限や登録状態を確認してください。"},
 tw:{confirm:"同意連結後，你的網頁會員帳號可查看此LINE的諮詢紀錄及占卜結果，並共用免費次數。這是你自己申請的代碼嗎？",yes:"連結我的會員帳號",no:"不連結",done:"連結完成，請回到網頁更新狀態。",invalid:"請確認連結代碼是否過期或已使用。"},
 kr:{confirm:"연결을 승인하면 웹 회원 계정에서 이 LINE의 상담 기록과 결과를 볼 수 있으며 무료 횟수도 함께 사용합니다. 직접 발급한 코드인가요?",yes:"내 웹 계정과 연결",no:"연결하지 않기",done:"연결되었습니다. 웹 화면에서 상태를 새로고침해 주세요.",invalid:"연결 코드의 유효기간과 등록 상태를 확인해 주세요."},
}[webMarket];
export async function handleWebLineLink(input:unknown):Promise<boolean>{
 if(!input || typeof input!=="object")return false;
 const event=input as {source?:{userId?:string};replyToken?:string;type?:string;message?:{type?:string;text?:string};postback?:{data?:string}};
 if(process.env.WEB_CONSULTATION_ENABLED!=="true")return false;
 const id=event.source?.userId;
 if(!id||typeof event.replyToken!=='string')return false;
 if(event.type==='message'&&event.message?.type==='text'&&typeof event.message.text==='string'&&webCodePattern.test(event.message.text.trim())){
   const code=event.message.text.trim();
   if(await prepareWebLink(code,id))await replyMessage(event.replyToken,[{type:'template',altText:messages.confirm,template:{type:'confirm',text:messages.confirm,actions:[{type:'postback',label:messages.yes,data:new URLSearchParams({action:'confirm_web_link',code}).toString()},{type:'message',label:messages.no,text:messages.no}]}}]);
   else await replyMessage(event.replyToken,[textMessage(messages.invalid)]);
   return true;
 }
 if(event.type==='postback'&&typeof event.postback?.data==='string'){
   const p=new URLSearchParams(event.postback.data);
   if(p.get('action')==='confirm_web_link'){
     const ok=await approveWebLink(p.get('code')||'',id);
     await replyMessage(event.replyToken,[textMessage(ok?messages.done:messages.invalid)]);return true;
   }
 }
 return false;
}
