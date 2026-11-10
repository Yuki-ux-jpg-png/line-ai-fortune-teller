import { query } from "./db.js";
import { generateFortune } from "../lib/fortune.js";
import { claimLineEvent, releaseLineEvent } from "./consultations.js";
import { replyMessage, textMessage } from "./line.js";
import type { LineEvent, LineTextMessageEvent, LinePostbackEvent } from "./types.js";

export function isDailyFortuneEvent(event: LineEvent): boolean {
  if (event.type === "message" && (event as LineTextMessageEvent).message?.type === "text") {
    return ["운세", "오늘의 운세", "오늘 운세", "일일 운세"].includes((event as LineTextMessageEvent).message.text.trim());
  }
  return event.type === "postback" && (event as LinePostbackEvent).postback?.data === "fortune=today";
}
export function seoulDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const values = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
export async function getDailyFortune(userId: string, date: string): Promise<string> {
  const read = () => query<{fortune_result: string}>("SELECT fortune_result FROM public.fortunes_kr WHERE line_user_id=$1 AND fortune_date=$2", [userId,date]);
  const repeat = (text: string) => `${text}\n\n――――――――――\n※오늘은 이미 운세를 확인하셨습니다. 내일 새로운 운세를 확인해 주세요.🔮`;
  const existing = await read();
  if (existing.rows[0]) return repeat(existing.rows[0].fortune_result);
  const text = generateFortune(date);
  const inserted = await query<{fortune_result: string}>("INSERT INTO public.fortunes_kr(line_user_id,fortune_date,fortune_result) VALUES ($1,$2,$3) ON CONFLICT(line_user_id,fortune_date) DO NOTHING RETURNING fortune_result", [userId,date,text]);
  if (inserted.rows[0]) return inserted.rows[0].fortune_result;
  const saved = await read();
  if (!saved.rows[0]) throw new Error("Korean daily fortune was not saved");
  return repeat(saved.rows[0].fortune_result);
}
export async function handleDailyFortuneEvent(event: LineEvent): Promise<void> {
  const userId = event.source?.userId, replyToken = event.replyToken, eventId = event.webhookEventId;
  if (!userId || !replyToken || !eventId || !isDailyFortuneEvent(event)) return;
  if (!(await claimLineEvent(eventId))) return;
  try { await replyMessage(replyToken, [textMessage(await getDailyFortune(userId,seoulDate()))]); }
  catch (error) { await releaseLineEvent(eventId); throw error; }
}
