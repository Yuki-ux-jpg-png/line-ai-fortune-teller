import OpenAI, { toFile } from "openai";
import { config } from "./config.js";
import { urgentSafetyConcern, summarizeIntake } from "./intake.js";
import { WebError } from "./web-auth.js";
import { safetyMessage } from "./web-safety.js";
export function webAudioFormat(
  b: Buffer,
  mime: string,
): { ext: string; mime: string } {
  if (!Buffer.isBuffer(b) || b.length < 12 || b.length > 10 * 1024 * 1024)
    throw new WebError(413, "音声は10MB以内で送信してください。");
  const type = mime.split(";")[0]?.trim();
  if (
    type === "audio/webm" &&
    b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
  )
    return { ext: "webm", mime: type };
  if (
    ["audio/mp4", "audio/x-m4a"].includes(type ?? "") &&
    b.toString("ascii", 4, 8) === "ftyp"
  )
    return { ext: "m4a", mime: "audio/mp4" };
  if (
    type === "audio/wav" &&
    b.toString("ascii", 0, 4) === "RIFF" &&
    b.toString("ascii", 8, 12) === "WAVE"
  )
    return { ext: "wav", mime: type };
  throw new WebError(
    415,
    "この音声形式は利用できません。文字入力をお試しください。",
  );
}
async function transcribe(bytes: Buffer, f: { ext: string; mime: string }) {
  const ai = new OpenAI({
    apiKey: config.openAiApiKey,
    timeout: 45000,
    maxRetries: 0,
  });
  return ai.audio.transcriptions.create({
    model: "whisper-1",
    file: await toFile(bytes, `consultation.${f.ext}`, { type: f.mime }),
    response_format: "verbose_json",
    language: "ja",
  });
}
export async function transcribeWebAudio(
  bytes: Buffer,
  mime: string,
  services = {
    transcribe,
    moderate: urgentSafetyConcern,
    summarize: summarizeIntake,
  },
) {
  const f = webAudioFormat(bytes, mime);
  const response = await services.transcribe(bytes, f);
  // Neither audio nor intermediate transcript is written to disk or Storage.
  if (
    !Number.isFinite(response.duration) ||
    response.duration <= 0 ||
    response.duration > 120
  )
    throw new WebError(400, "音声は2分以内で録音してください。");
  const transcript = response.text.trim();
  if (!transcript || transcript.length > 12000)
    throw new WebError(
      400,
      "音声を聞き取れませんでした。文字入力もお試しください。",
    );
  // Always check the original transcript BEFORE reducing it to a consultation draft.
  if (await services.moderate(transcript))
    return { safety: true, message: safetyMessage };
  const draft =
    Array.from(transcript).length <= config.maxQuestionChars
      ? transcript
      : await services.summarize([transcript]);
  return { transcript, draft };
}
