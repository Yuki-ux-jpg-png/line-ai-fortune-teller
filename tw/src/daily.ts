import { config } from "./config.js";
import { generateFortune } from "../lib/fortune.js";
import { claimLineEvent, releaseLineEvent } from "./consultations.js";
import { replyMessage, textMessage } from "./line.js";
import type { LineEvent, LineTextMessageEvent, LinePostbackEvent } from "./types.js";

export function isDailyFortuneEvent(event: LineEvent): boolean {
  if (event.type === "message" && (event as LineTextMessageEvent).message?.type === "text") {
    return ["占卜", "今日運勢", "今日占卜", "運勢", "抽籤", "占い", "今日の占い"].includes((event as LineTextMessageEvent).message.text.trim());
  }
  return event.type === "postback" && (event as LinePostbackEvent).postback?.data === "fortune=today";
}

export function taipeiDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const values = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function fortuneUrl(userId: string, date: string): URL {
  const url = new URL(`${config.supabaseUrl}/rest/v1/fortunes_tw`);
  url.search = new URLSearchParams({ select: "fortune_result", line_user_id: `eq.${userId}`, fortune_date: `eq.${date}`, limit: "1" }).toString();
  return url;
}

// Secret API keys are not JWTs; sending one as Bearer causes Invalid JWT.
export function supabaseHeaders(key = config.supabaseSecretKey): Record<string, string> {
  return {
    apikey: key,
    ...(key.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${key}` }),
    "Content-Type": "application/json",
  };
}

async function readFortune(userId: string, date: string): Promise<string | null> {
  const response = await fetch(fortuneUrl(userId, date), { headers: supabaseHeaders(), signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Taiwan fortune lookup failed (${response.status})`);
  const rows = await response.json() as { fortune_result: string }[];
  return rows[0]?.fortune_result ?? null;
}

export async function getDailyFortune(userId: string, date: string): Promise<string> {
  const repeat = (text: string) => `${text}\n\n――――――――――\n※你今天已經占卜過囉。\n明天再來看看新的運勢吧🔮`;
  const existing = await readFortune(userId, date);
  if (existing) return repeat(existing);
  const text = generateFortune(date);
  const response = await fetch(`${config.supabaseUrl}/rest/v1/fortunes_tw`, {
    method: "POST", headers: { ...supabaseHeaders(), Prefer: "return=minimal" }, signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({ line_user_id: userId, fortune_date: date, fortune_result: text }),
  });
  if (response.ok) return text;
  if (response.status === 409) {
    const error = await response.json() as { code?: string };
    if (error.code === "23505") {
      const saved = await readFortune(userId, date);
      if (saved) return repeat(saved);
    }
  }
  throw new Error(`Taiwan fortune insert failed (${response.status})`);
}

export async function handleDailyFortuneEvent(event: LineEvent): Promise<void> {
  const userId = event.source?.userId;
  const replyToken = event.replyToken;
  const eventId = event.webhookEventId;
  if (!userId || !replyToken || !eventId || !isDailyFortuneEvent(event)) return;
  if (!(await claimLineEvent(eventId))) return;
  try {
    const text = await getDailyFortune(userId, taipeiDate());
    await replyMessage(replyToken, [textMessage(text)]);
  } catch (error) {
    await releaseLineEvent(eventId);
    throw error;
  }
}
