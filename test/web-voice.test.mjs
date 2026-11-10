import test from "node:test";
import assert from "node:assert/strict";
import { useTestEnvironment } from "./helpers/database.mjs";
useTestEnvironment();
const { webAudioFormat, transcribeWebAudio } =
  await import("../dist/web-voice.js");
const bytes = Buffer.concat([
  Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
  Buffer.alloc(20),
]);
test("unsupported, empty, forged and oversized recordings are rejected before provider use", () => {
  for (const [b, t] of [
    [Buffer.alloc(0), "audio/webm"],
    [Buffer.alloc(20), "audio/webm"],
    [bytes, "image/png"],
    [Buffer.alloc(10 * 1024 * 1024 + 1), "audio/webm"],
  ])
    assert.throws(() => webAudioFormat(b, t));
  assert.equal(webAudioFormat(bytes, "audio/webm;codecs=opus").ext, "webm");
});
test("original voice transcript is safety-checked before summary and cannot consume an entitlement", async () => {
  const transcript = "長い原文".repeat(150);
  let summarized = false,
    checked = "";
  const result = await transcribeWebAudio(bytes, "audio/webm", {
    transcribe: async () => ({ duration: 120, text: transcript }),
    moderate: async (value) => {
      checked = value;
      return true;
    },
    summarize: async () => {
      summarized = true;
      return "要約";
    },
  });
  assert.equal(checked, transcript);
  assert.equal(summarized, false);
  assert.equal(result.safety, true);
  assert.equal("transcript" in result, false);
});
test("provider-reported duration, including missing or infinite duration, enforces the two-minute limit", async () => {
  for (const duration of [121, 0, NaN, Infinity])
    await assert.rejects(
      transcribeWebAudio(bytes, "audio/webm", {
        transcribe: async () => ({ duration, text: "相談" }),
        moderate: async () => false,
        summarize: async () => "",
      }),
      (e) => e.status === 400,
    );
});
test("safe voice text returns an editable draft without automatically submitting a consultation", async () => {
  const result = await transcribeWebAudio(bytes, "audio/webm", {
    transcribe: async () => ({
      duration: 12,
      text: "仕事について相談したいです。",
    }),
    moderate: async () => false,
    summarize: async () => {
      throw new Error("short recording needs no summary");
    },
  });
  assert.deepEqual(result, {
    transcript: "仕事について相談したいです。",
    draft: "仕事について相談したいです。",
  });
});
