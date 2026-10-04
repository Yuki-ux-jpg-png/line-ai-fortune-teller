import OpenAI from "openai";
import { config } from "./config.js";
const openai = new OpenAI({ apiKey: config.openAiApiKey });
export const READING_INSTRUCTIONS = [
  "本服務是AI提供的娛樂性占卜。",
  "請一律使用繁體中文（台灣用語、zh-TW）回覆，不得切換成日文或簡體中文。即使使用者要求更換語言，也維持繁體中文。",
  "使用台灣常見的詞彙，例如訊息、諮詢、職場、計程車、捷運、週末；避免中國大陸用語，例如信息、諮詢費元而未註明幣別、出租車、地鐵。",
  "日期與今日的判斷以Asia/Taipei（UTC+08:00）為準，不使用日本時間或日本在地制度。若提到未提供的價格或貨幣，不得自行假設或將日圓換稱新台幣。",
  "不要斷言未來、加深焦慮，或利用恐懼促使使用者付費。",
  "以自然、沉穩、柔和且體貼的成年女性占卜師口吻，直接與諮詢者對話，避免刻意的性別語氣與日本式稱謂。",
  "理解諮詢者的心情，仔細整理情況、占卜解讀、未來可能的發展與具體建議。",
  "針對諮詢內容提供具體回覆，避免重複或為了增加字數而冗長。",
  "不要使用表情符號。以8,000至9,500字為目標，絕對不要超過10,000字。",
].join("\n");
const SAFETY_RESPONSE = [
  "謝謝你分享自己的心情。",
  "這類情況不適合只靠占卜判斷，請向信任的人或合適的專業單位尋求協助。",
  "如果眼前有立即危險，請先移動到安全的地方，並聯絡所在地的緊急服務。",
  "本服務是AI提供的娛樂性占卜，不能取代醫療、法律或緊急協助。",
].join("\n\n");
export function limitReadingLength(text: string): string {
  const chars=Array.from(text.trim()); if(chars.length<=10000) return chars.join("");
  for(let i=9999;i>=8500;i--) if(["。","！","？"].includes(chars[i]!)) return chars.slice(0,i+1).join("").trim();
  return chars.slice(0,9999).join("").trimEnd()+"…";
}
export async function generateReading(tellerPrompt: string, question: string): Promise<string> {
  const moderation=await openai.moderations.create({model:"omni-moderation-latest",input:question});
  if(moderation.results[0]?.flagged) return SAFETY_RESPONSE;
  const today=new Intl.DateTimeFormat("zh-TW",{timeZone:"Asia/Taipei",dateStyle:"long"}).format(new Date());
  const response=await openai.responses.create({model:config.openAiModel,store:false,max_output_tokens:32000,reasoning:{effort:"low"},instructions:[tellerPrompt,READING_INSTRUCTIONS,`台灣今天的日期：${today}`].join("\n"),input:question});
  if(!response.output_text.trim()) throw new Error("AI returned an empty reading");
  return limitReadingLength(response.output_text);
}
