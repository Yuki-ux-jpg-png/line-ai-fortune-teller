import OpenAI from "openai";
import { config } from "./config.js";

const openai = new OpenAI({ apiKey: config.openAiApiKey });

const MAX_READING_CHARS = 10_000;
const MIN_NATURAL_CLIP_CHARS = 8_500;

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

  const clippedChars = chars.slice(0, MAX_READING_CHARS);

  // できるだけ文の途中では切らず、8,500〜10,000文字の範囲にある
  // 最後の文末で終了する。
  for (let i = clippedChars.length - 1; i >= MIN_NATURAL_CLIP_CHARS; i -= 1) {
    const char = clippedChars[i];
    if (char !== undefined && ["。", "！", "？"].includes(char)) {
      return clippedChars.slice(0, i + 1).join("").trim();
    }
  }

  // 文末が見つからない場合も、絶対に10,000文字を超えない。
  return `${clippedChars.slice(0, MAX_READING_CHARS - 1).join("").trimEnd()}…`;
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
    max_output_tokens: 32_000,
    reasoning: {
      effort: "low",
    },
    instructions: [
      tellerPrompt,
      "本サービスはAIによるエンターテインメント占いです。",
      "未来を断定せず、不安を煽らず、課金を促すために恐怖を利用しないでください。",
      "回答は必ず日本語で書いてください。",
      "自然な成人女性の占い師が相談者へ直接語りかけるような、落ち着いた、やわらかく親身な口調で回答してください。",
      "『〜だわ』『〜かしら』などの作為的な女性語を多用せず、実際の会話として自然な女性口調にしてください。",
      "相談者の気持ちを受け止めつつ、鑑定、状況の整理、今後の流れ、具体的な助言まで丁寧に掘り下げてください。",
      "同じ内容の言い換えや水増しは避け、相談内容に具体的に答えてください。",
      "絵文字は使わないでください。",
      "回答本文は8,000〜9,500文字程度を目安にし、絶対に10,000文字を超えないでください。",
    ].join("\n"),
    input: question,
  });

  const answer = response.output_text.trim();
  if (!answer) throw new Error("OpenAIから空の回答が返されました");

  return limitReadingLength(answer);
}
