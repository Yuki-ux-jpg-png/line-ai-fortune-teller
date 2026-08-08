import { generateReading } from "./ai.js";
import { config } from "./config.js";
import {
  claimDeliveryJob,
  claimGenerationJob,
  countTodayGenerations,
  markDelivered,
  markDeliveryFailed,
  markGenerationFailed,
  recoverStaleJobs,
  saveGeneratedAnswer,
} from "./consultations.js";
import { pool } from "./db.js";
import { pushMessage, textMessage } from "./line.js";

const LINE_TEXT_CHUNK_MAX_CHARS = 4_800;
const MAX_READING_CHUNKS = 3;

function splitReadingForLine(text: string): string[] {
  const chars = Array.from(text.trim());
  if (chars.length === 0) return [];

  const chunkCount = Math.ceil(chars.length / LINE_TEXT_CHUNK_MAX_CHARS);
  if (chunkCount > MAX_READING_CHUNKS) {
    throw new Error(
      `鑑定結果がLINE送信上限を超えています: ${chars.length}文字`,
    );
  }

  const chunks: string[] = [];
  let offset = 0;

  for (let part = 0; part < chunkCount; part += 1) {
    const remainingChars = chars.length - offset;
    const remainingParts = chunkCount - part;

    if (remainingParts === 1) {
      const chunk = chars.slice(offset).join("").trim();
      if (chunk) chunks.push(chunk);
      break;
    }

    const minTake = Math.max(
      1,
      remainingChars - (remainingParts - 1) * LINE_TEXT_CHUNK_MAX_CHARS,
    );
    const idealTake = Math.ceil(remainingChars / remainingParts);
    const maxTake = Math.min(LINE_TEXT_CHUNK_MAX_CHARS, remainingChars);

    let take = Math.min(Math.max(idealTake, minTake), maxTake);

    // 分割位置の前後300文字以内で、できるだけ自然な文末を探す。
    const searchHigh = Math.min(maxTake, take + 300);
    const searchLow = Math.max(minTake, take - 300);

    for (let i = searchHigh - 1; i >= searchLow - 1; i -= 1) {
      if (["。", "！", "？", "\n"].includes(chars[offset + i])) {
        take = i + 1;
        break;
      }
    }

    const chunk = chars.slice(offset, offset + take).join("").trim();
    if (chunk) chunks.push(chunk);
    offset += take;
  }

  if (chunks.length > MAX_READING_CHUNKS) {
    throw new Error(`鑑定結果の分割数が上限を超えています: ${chunks.length}`);
  }

  for (const chunk of chunks) {
    if (Array.from(chunk).length > LINE_TEXT_CHUNK_MAX_CHARS) {
      throw new Error("LINE送信用テキストが4,800文字を超えています");
    }
  }

  return chunks;
}

async function processGenerations(): Promise<void> {
  let generatedToday = await countTodayGenerations();
  if (generatedToday >= config.dailyAiGenerationLimit) {
    console.warn("Daily AI generation limit reached");
    return;
  }

  for (let i = 0; i < 10; i += 1) {
    if (generatedToday >= config.dailyAiGenerationLimit) break;
    const job = await claimGenerationJob();
    if (!job) break;

    try {
      const answer = await generateReading(job.system_prompt, job.question);
      await saveGeneratedAnswer(job.id, answer);
      generatedToday += 1;
      console.log(`Generated consultation ${job.id}`);
    } catch (error) {
      console.error(`Generation failed for ${job.id}`, error);
      await markGenerationFailed(job, error);
    }
  }
}

async function processDeliveries(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    const job = await claimDeliveryJob();
    if (!job) break;

    try {
      const readingChunks = splitReadingForLine(job.answer);
      if (readingChunks.length === 0) {
        throw new Error("送信する鑑定結果が空です");
      }

      const messages = [
        textMessage("お待たせしました。AI鑑定結果をお届けします。"),
        ...readingChunks.map((chunk) => textMessage(chunk)),
        textMessage(
          "今回の相談はこれで完了です。次の相談は新しい無料枠または相談チケットを使用します。",
        ),
      ];

      // LINEは1回のリクエストで最大5メッセージまでなので、
      // intro + 鑑定最大3分割 + completion = 最大5件に固定する。
      if (messages.length > 5) {
        throw new Error(`LINE送信メッセージ数が上限を超えています: ${messages.length}`);
      }

      await pushMessage(job.line_user_id, messages, job.line_retry_key);
      await markDelivered(job);
      console.log(`Delivered consultation ${job.id}`);
    } catch (error) {
      console.error(`Delivery failed for ${job.id}`, error);
      await markDeliveryFailed(job, error);
    }
  }
}

async function main(): Promise<void> {
  await recoverStaleJobs();
  await processGenerations();
  await processDeliveries();
}

main()
  .catch((error) => {
    console.error("Worker failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
