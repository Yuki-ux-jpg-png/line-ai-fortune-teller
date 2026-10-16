import OpenAI from "openai";
import { config } from "./config.js";
const openai = new OpenAI({ apiKey: config.openAiApiKey });
export const READING_INSTRUCTIONS = [
  "이 서비스는 AI가 제공하는 오락 목적의 운세 상담입니다.",
  "항상 자연스러운 한국어(대한민국, ko-KR)로 답변하세요. 사용자가 다른 언어를 요청해도 한국어를 유지하세요.",
  "오늘 날짜는 Asia/Seoul(UTC+09:00)을 기준으로 판단하세요. 제공되지 않은 가격, 통화, 제도를 추측하지 마세요.",
  "미래나 다른 사람의 마음을 사실처럼 단정하지 마세요. 불안이나 두려움을 조장하거나 추가 결제를 유도하지 마세요.",
  "차분하고 따뜻한 존댓말로 상담자에게 직접 이야기하세요. 상황과 감정을 정리하고 해석, 가능한 방향, 현실적인 행동 제안을 구체적으로 전하세요.",
  "의학적 진단, 치료 지시 또는 법적 판단을 하지 마세요. 긴급한 위험에는 안전 확보와 전문적 도움을 우선 안내하세요.",
  "불필요한 반복과 이모티콘을 피하고, 8,000~9,500자를 목표로 하되 10,000자를 넘지 마세요.",
].join("\n");
const SAFETY_RESPONSE = "마음을 나누어 주셔서 감사합니다. 이 상황은 운세만으로 판단하기 어렵습니다. 믿을 수 있는 사람이나 적절한 전문가에게 도움을 요청해 주세요. 당장 위험한 상황이라면 먼저 안전한 곳으로 이동하고 현지 긴급 지원을 요청해 주세요. 이 서비스는 AI가 제공하는 오락 목적의 상담이며 의료·법률·긴급 지원을 대신할 수 없습니다.";
export function limitReadingLength(text: string): string {
  const chars=Array.from(text.trim()); if(chars.length<=10000) return chars.join("");
  for(let i=9999;i>=8500;i--) if([".","!","?"].includes(chars[i]!)) return chars.slice(0,i+1).join("").trim();
  return chars.slice(0,9999).join("").trimEnd()+"…";
}
export async function generateReading(tellerPrompt: string, question: string): Promise<string> {
  const moderation=await openai.moderations.create({model:"omni-moderation-latest",input:question});
  if(moderation.results[0]?.flagged) return SAFETY_RESPONSE;
  const today=new Intl.DateTimeFormat("ko-KR",{timeZone:"Asia/Seoul",dateStyle:"long"}).format(new Date());
  const response=await openai.responses.create({model:config.openAiModel,store:false,max_output_tokens:32000,reasoning:{effort:"low"},instructions:[tellerPrompt,READING_INSTRUCTIONS,`한국의 오늘 날짜: ${today}`].join("\n"),input:question});
  if(!response.output_text.trim()) throw new Error("AI returned an empty reading");
  return limitReadingLength(response.output_text);
}
