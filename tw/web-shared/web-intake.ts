import OpenAI from "openai";
import {config} from "./config.js";
import {webMarket} from "./web-market.js";
const ai=new OpenAI({apiKey:config.openAiApiKey,timeout:12000,maxRetries:0});
const language={jp:"Japanese",tw:"Traditional Chinese as used in Taiwan (never simplified Chinese)",kr:"Korean"}[webMarket];
const model=process.env.INTAKE_OPENAI_MODEL?.trim() || (webMarket === "jp" ? "gpt-4.1-mini" : config.openAiModel);
const fallback={jp:"そのことで、今いちばん困っていることは何でしょうか？",tw:"關於這件事，現在最困擾你的是什麼呢？",kr:"이 일과 관련해 지금 가장 힘든 점은 무엇인가요?"}[webMarket];
export async function urgentSafetyConcern(text:string):Promise<boolean>{
 const r=await ai.moderations.create({model:"omni-moderation-latest",input:text});
 const f=r.results[0]?.categories;return Boolean(f?.["self-harm/intent"]||f?.["self-harm/instructions"]);
}
export async function followUpQuestion(turns:string[]):Promise<string>{
 try{const r=await ai.responses.create({model,store:false,max_output_tokens:220,instructions:`Help the user prepare a consultation. Ask exactly one gentle follow-up question in ${language}, within 70 characters. Do not diagnose, give a fortune reading, make claims about another person's feelings or the future, or ask for identifying information or traumatic details. Return only the question.`,input:turns.map((x,i)=>`${i+1}. ${x}`).join("\n")});return r.output_text.trim().slice(0,100)||fallback;}catch{return fallback;}
}
export async function summarizeIntake(turns:string[]):Promise<string>{
 if(!turns.length)throw new Error("EMPTY_CONSULTATION");
 const plain=turns.join("。 ").slice(0,config.maxQuestionChars);
 try{const r=await ai.responses.create({model,store:false,max_output_tokens:1100,instructions:`Rewrite the user's statements as a first-person consultation in ${language}, at most ${config.maxQuestionChars} characters. Preserve only facts supplied by the user. Do not invent feelings, relationships, medical conditions or events. Do not diagnose, advise or give a reading. Return only the draft, without quotation marks.`,input:turns.map((x,i)=>`${i+1}. ${x}`).join("\n")});return r.output_text.trim().slice(0,config.maxQuestionChars)||plain;}catch{return plain;}
}
