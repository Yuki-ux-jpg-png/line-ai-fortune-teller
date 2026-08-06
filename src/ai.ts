import OpenAI from "openai";
import { config } from "./config.js";

const openai = new OpenAI({ apiKey: config.openAiApiKey });

const SAFETY_RESPONSE = [
  "ご相談ありがとうございます。",
  "この内容は占いだけで判断せず、信頼できる身近な方や適切な専門機関へ相談してください。",
  "今すぐ危険がある場合は、安全な場所へ移動し、地域の緊急窓口へ連絡してください。",
  "本サービスはAIによるエンターテインメント占いであり、医療・法律・緊急対応の代わりにはなりません。",
].join("\n\n");

export async function generateReading(
  tellerPrompt: string,
  question: string,
): Promise<string> {
  const moderation = await openai.moderations.create({
    model: "omni-moderation-latest",
    input: question,
  });

  if (moderation.results[0]?.flagged) {
    return SAFETY_RESPONSE;
  }

  const response = await openai.responses.create({
    model: config.openAiModel,
    store: false,
    max_output_tokens: 1_200,
    instructions: [
      tellerPrompt,
      "本サービスはAIによるエンターテインメント占いです。",
      "未来を断定せず、不安を煽らず、課金を促すために恐怖を利用しないでください。",
      "回答は日本語で、おおむね600〜1,000文字に収めてください。",
    ].join("\n"),
    input: question,
  });

  const answer = response.output_text.trim();
  if (!answer) throw new Error("OpenAIから空の回答が返されました");
  return answer;
}
