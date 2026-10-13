import { toFile } from "openai";
import OpenAI from "openai";
import { config } from "./config.js";
import { query, withTransaction } from "./db.js";

export type IntakeStage = "mode" | "text" | "voice" | "guided" | "review";
export type IntakeSession = {
  line_user_id: string;
  stage: IntakeStage;
  turns: string[];
  step: number;
  draft_consultation_id: string | null;
};

const ai = new OpenAI({ apiKey: config.openAiApiKey, timeout: 12_000, maxRetries: 0 });
const INTAKE_MODEL = process.env.INTAKE_OPENAI_MODEL?.trim() || "gpt-4.1-mini";
const AUDIO_MODEL = process.env.INTAKE_AUDIO_MODEL?.trim() || "gpt-4o-mini-transcribe";
const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

const SESSION_MINUTES = 30;

/** An old draft cannot be reused by a new preparation session. */
export async function startIntake(lineUserId: string): Promise<void> {
  await withTransaction(async (client) => {
    // When restarting an unconfirmed consultation, discard the previous draft.
    await client.query(
      `DELETE FROM consultations WHERE line_user_id = $1 AND status = 'draft'`,
      [lineUserId],
    );
    await client.query(
      `INSERT INTO consultation_intake_sessions
         (line_user_id, stage, turns, step, draft_consultation_id, expires_at)
       VALUES ($1, 'mode', '[]'::jsonb, 0, NULL, now() + ($2::int * interval '1 minute'))
       ON CONFLICT (line_user_id) DO UPDATE
       SET stage = 'mode', turns = '[]'::jsonb, step = 0,
           draft_consultation_id = NULL, expires_at = EXCLUDED.expires_at,
           updated_at = now()`,
      [lineUserId, SESSION_MINUTES],
    );
  });
}

/** Cleanup also discards the underlying draft and resets the teller selection. */
export async function cleanupExpiredIntakes(lineUserId?: string): Promise<void> {
  await withTransaction(async (client) => {
    const result = await client.query<{ line_user_id: string }>(
      `DELETE FROM consultation_intake_sessions
        WHERE expires_at <= now() AND ($1::text IS NULL OR line_user_id = $1)
        RETURNING line_user_id`,
      [lineUserId ?? null],
    );
    const ids = result.rows.map((row) => row.line_user_id);
    if (!ids.length) return;
    await client.query(
      `DELETE FROM consultations
        WHERE line_user_id = ANY($1::text[]) AND status = 'draft'`, [ids],
    );
    await client.query(
      `UPDATE users SET selected_teller_id = NULL, state = 'selecting_teller', updated_at = now()
        WHERE line_user_id = ANY($1::text[])
          AND state IN ('selecting_teller', 'awaiting_question', 'draft_ready')`, [ids],
    );
  });
}

export async function getIntake(lineUserId: string): Promise<IntakeSession | null> {
  await cleanupExpiredIntakes(lineUserId);
  const result = await query<IntakeSession>(
    `SELECT line_user_id, stage, turns, step, draft_consultation_id
       FROM consultation_intake_sessions
       WHERE line_user_id = $1 AND expires_at > now()`, [lineUserId],
  );
  return result.rows[0] ?? null;
}

export async function changeIntakeStage(
  lineUserId: string, stage: "text" | "voice" | "guided", resetTurns = true,
): Promise<boolean> {
  const result = await query(
    `UPDATE consultation_intake_sessions
       SET stage = $2,
           turns = CASE WHEN $3::boolean THEN '[]'::jsonb ELSE turns END,
           step = CASE WHEN $3::boolean THEN 0 ELSE step END,
           draft_consultation_id = NULL,
           updated_at = now(), expires_at = now() + interval '30 minutes'
       WHERE line_user_id = $1 AND expires_at > now()
         AND stage IN ('mode', 'text', 'voice', 'guided', 'review')
       RETURNING line_user_id`, [lineUserId, stage, resetTurns],
  );
  return Boolean(result.rowCount);
}

export async function setIntakeReview(lineUserId: string, consultationId: string): Promise<boolean> {
  const result = await query(
    `UPDATE consultation_intake_sessions
        SET stage = 'review', draft_consultation_id = $2,
            updated_at = now(), expires_at = now() + interval '30 minutes'
      WHERE line_user_id = $1 AND expires_at > now() AND stage IN ('text', 'voice', 'guided')
      RETURNING line_user_id`, [lineUserId, consultationId],
  );
  return Boolean(result.rowCount);
}

export async function addIntakeTurn(lineUserId: string, content: string): Promise<IntakeSession | null> {
  const result = await query<IntakeSession>(
    `UPDATE consultation_intake_sessions
        SET turns = turns || jsonb_build_array($2::text), step = step + 1,
            updated_at = now(), expires_at = now() + interval '30 minutes'
      WHERE line_user_id = $1 AND stage = 'guided'
        AND expires_at > now() AND step < 3
      RETURNING line_user_id, stage, turns, step, draft_consultation_id`,
    [lineUserId, content],
  );
  return result.rows[0] ?? null;
}

export async function finishIntake(lineUserId: string): Promise<void> {
  await query(`DELETE FROM consultation_intake_sessions WHERE line_user_id = $1`, [lineUserId]);
}

/** Only drops unconfirmed drafts. Does not cancel paid or queued consultations. */
export async function cancelIntake(lineUserId: string): Promise<boolean> {
  return withTransaction(async (client) => {
    const current = await client.query(
      `SELECT stage FROM consultation_intake_sessions WHERE line_user_id = $1 FOR UPDATE`,
      [lineUserId],
    );
    const drafts = await client.query(
      `DELETE FROM consultations WHERE line_user_id = $1 AND status = 'draft' RETURNING id`,
      [lineUserId],
    );
    await client.query(`DELETE FROM consultation_intake_sessions WHERE line_user_id = $1`, [lineUserId]);
    const cleared = await client.query(
      `UPDATE users SET selected_teller_id = NULL, state = 'selecting_teller', updated_at = now()
       WHERE line_user_id = $1 AND selected_teller_id IS NOT NULL
         AND state IN ('selecting_teller', 'awaiting_question', 'draft_ready')
       RETURNING line_user_id`, [lineUserId],
    );
    return Boolean(current.rowCount || drafts.rowCount || cleared.rowCount);
  });
}

export async function urgentSafetyConcern(text: string): Promise<boolean> {
  const response = await ai.moderations.create({ model: "omni-moderation-latest", input: text });
  const flags = response.results[0]?.categories;
  return Boolean(flags?.["self-harm/intent"] || flags?.["self-harm/instructions"]);
}

export async function followUpQuestion(turns: string[]): Promise<string> {
  try {
  const result = await ai.responses.create({
    model: INTAKE_MODEL,
    store: false,
    max_output_tokens: 220,
    instructions: [
      "あなたは占い相談の文章づくりを手伝う案内役です。鑑定や診断はまだしません。",
      "相談者が答えやすい追加質問をひとつだけ、自然でやさしい日本語で返してください（70文字以内）。",
      "個人を特定する情報や傷ついた経験の詳細を求めないでください。",
      "相手の気持ちや未来を断定しないでください。質問文以外は出力しないでください。",
    ].join("\n"),
    input: turns.map((t, i) => `${i + 1}. ${t}`).join("\n"),
  });
  return result.output_text.trim().slice(0, 100) || "一番気になっていることを、もう少しだけ教えてもらえますか？";
  } catch {
    return "そのことで、今いちばん困っていることは何でしょうか？";
  }
}

export async function summarizeIntake(turns: string[]): Promise<string> {
  if (turns.length === 0) throw new Error("相談内容がありません");
  try {
  const result = await ai.responses.create({
    model: INTAKE_MODEL,
    store: false,
    max_output_tokens: 1100,
    instructions: [
      "以下の発言を、占い師に送る一人称の相談文に整えてください。",
      `自然な日本語、${config.maxQuestionChars}文字以内。前置きや引用符は不要です。`,
      "相談者が述べていない事実、感情、人物関係、病気、過去を捏造しないでください。",
      "情報が不足していても、分かっていることだけを記述してください。診断・鑑定・助言はしません。",
    ].join("\n"),
    input: turns.map((t, i) => `${i + 1}. ${t}`).join("\n"),
  });
  const answer = result.output_text.trim();
  return answer.slice(0, config.maxQuestionChars).trim() || turns.join("。 ").slice(0, config.maxQuestionChars);
  } catch {
    return turns.join("。 ").slice(0, config.maxQuestionChars);
  }
}

export async function transcribeLineVoice(messageId: string, durationMs?: number): Promise<string> {
  if (durationMs !== undefined && durationMs > 120_000) {
    throw new Error("音声は2分以内で送ってください。");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(
      `https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`,
      { headers: { Authorization: `Bearer ${config.lineChannelAccessToken}` }, signal: controller.signal },
    );
    if (!response.ok || !response.body) throw new Error("LINEの音声データを取得できませんでした。");
    const advertisedLength = Number(response.headers.get("content-length") || 0);
    if (advertisedLength > MAX_AUDIO_BYTES) throw new Error("音声ファイルが大きすぎます（10MBまで）。");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > MAX_AUDIO_BYTES) {
        await reader.cancel();
        throw new Error("音声ファイルが大きすぎます（10MBまで）。");
      }
      chunks.push(value);
    }
    if (size === 0) throw new Error("音声が空でした。");
    const upload = await toFile(Buffer.concat(chunks), "line-voice.m4a", { type: "audio/mp4" });
    const transcript = await ai.audio.transcriptions.create({ file: upload, model: AUDIO_MODEL });
    const text = transcript.text.trim();
    if (!text) throw new Error("音声を聞き取れませんでした。文字での入力もお試しください。");
    return text;
  } finally {
    clearTimeout(timer);
  }
}
