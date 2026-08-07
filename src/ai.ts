import OpenAI from "openai";
import { config } from "./config.js";

const openai = new OpenAI({ apiKey: config.openAiApiKey });

const MAX_READING_CHARS = 5_000;

const SAFETY_RESPONSE = [
  "ご相談ありがとうございます。",
  "この内容は占いだけで判断せず、信頼できる身近な方や適切な専門機関へ相談してください。",
  "今すぐ危険がある場合は、安全な場所へ移動し、地域の緊急窓口へ連絡してください。",
  "本サービスはAIによるエンターテインメント占いであり、医療・法律・緊急対応の代わりにはなりません。",
].join("\n\n");

function limitReadingLength(text: string): string {
  const trimmed = text.trim();
  const chars = Array.from(trimmed);

  if (chars.length <= MAX_READING_CHARS) {
    return trimmed;
  }

  const clipped = chars.slice(0, MAX_READING_CHARS).join("");

  // できるだけ文の途中で切らない。
  const sentenceEnd = Math.max(
    clipped.lastIndexOf("。"),
    clipped.lastIndexOf("！"),
    clipped.lastIndexOf("？"),
  );

  // 十分な長さが残る場合は、最後の文末で終了する。
  if (sentenceEnd >= 4_000) {
    return clipped.slice(0, sentenceEnd + 1).trim();
  }

  // 念のため、LINEの5,000文字上限を絶対に超えないようにする。
  return `${Array.from(clipped).slice(0, MAX_READING_CHARS - 1).join("").trimEnd()}…`;
}

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
    max_output_tokens: 12_000,
    reasoning: {
      effort: "low",
    },
    instructions: [
      tellerPrompt,
      "本サービスはAIによるエンターテインメント占いです。",
      "未来を断定せず、不安を煽らず、課金を促すために恐怖を利用しないでください。",
      "回答は必ず日本語で書いてください。",
      "自然な成人女性の占い師が相談者へ直接語りかけるような、落ち着いた、やわらかく親身な口調で回答してください。",
      "「〜だわ」「〜かしら」などの作為的な女性語を多用せず、実際の会話として自然な女性口調にしてください。",
      "相談者の気持ちを受け止めつつ、鑑定、状況の整理、今後の流れ、具体的な助言まで丁寧に掘り下げてください。",
      "同じ内容の言い換えや水増しは避け、相談内容に具体的に答えてください。",
      "絵文字は使わないでください。",
      "回答本文は3,500〜4,500文字程度を目安にし、絶対に5,000文字を超えないでください。",
    ].join("\n"),
    input: question,
  });

  const answer = response.output_text.trim();
  if (!answer) throw new Error("OpenAIから空の回答が返されました");

  return limitReadingLength(answer);
}
