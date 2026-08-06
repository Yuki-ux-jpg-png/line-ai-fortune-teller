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
      await pushMessage(
        job.line_user_id,
        [
          textMessage("お待たせしました。AI鑑定結果をお届けします。"),
          textMessage(job.answer),
          textMessage(
            "今回の相談はこれで完了です。次の相談は新しい無料枠または相談チケットを使用します。",
          ),
        ],
        job.line_retry_key,
      );
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
