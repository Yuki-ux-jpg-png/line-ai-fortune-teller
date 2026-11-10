import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createTestDatabase,
  attachTestPool,
  useTestEnvironment,
} from "./helpers/database.mjs";

useTestEnvironment();
const { pool } = await import("../dist/db.js");
const { ensureUser, selectTeller, saveDraft, confirmConsultation, getUser } =
  await import("../dist/consultations.js");
const {
  startIntake,
  changeIntakeStage,
  setIntakeReview,
  cancelIntake,
  cleanupExpiredIntakes,
} = await import("../dist/intake.js");
const { handleLineEvent } = await import("../dist/webhook.js");

async function fixture(t, options) {
  const db = await createTestDatabase(options);
  t.after(() => db.close());
  attachTestPool(t, pool, db);
  await db.query(`INSERT INTO fortune_tellers(id,name,description,image_url,system_prompt)
    VALUES ('test-teller','Test','Test','https://example.invalid/test.jpg','Test prompt')`);
  await ensureUser("test-user");
  assert.equal(await selectTeller("test-user", "test-teller"), "selected");
  return db;
}

async function prepareDraft() {
  await startIntake("test-user");
  await changeIntakeStage("test-user", "text");
  const draft = await saveDraft("test-user", "テスト用の相談です。");
  assert.equal(draft.type, "saved");
  assert.equal(await setIntakeReview("test-user", draft.consultationId), true);
  return draft.consultationId;
}

test("applying migration 009 to legacy data preserves consultation and free allowance", async (t) => {
  const db = await createTestDatabase({ intake: false });
  t.after(() => db.close());
  await db.query(
    "INSERT INTO fortune_tellers(id,name,description,image_url,system_prompt) VALUES('legacy','Test','Test','https://example.invalid/test.jpg','Test')",
  );
  await db.query(
    "INSERT INTO users(line_user_id,free_consultations_used) VALUES('test-user',1)",
  );
  const draft = (
    await db.query(
      "INSERT INTO consultations(line_user_id,teller_id,question,status) VALUES('test-user','legacy','既存のテスト相談です。','draft') RETURNING id",
    )
  ).rows[0];
  const before = (
    await db.query("SELECT id,status,question FROM consultations ORDER BY id")
  ).rows;
  await db.exec(
    await readFile(
      new URL(
        "../migrations/009_consultation_intake_sessions.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.deepEqual(
    (await db.query("SELECT id,status,question FROM consultations ORDER BY id"))
      .rows,
    before,
  );
  assert.equal(
    (
      await db.query(
        "SELECT free_consultations_used FROM users WHERE line_user_id='test-user'",
      )
    ).rows[0].free_consultations_used,
    1,
  );
  assert.ok(draft.id);
});

test("confirming the same consultation twice consumes one free allowance", async (t) => {
  const db = await fixture(t);
  const id = await prepareDraft();
  assert.equal((await getUser("test-user")).free_consultations_used, 0);
  const first = await confirmConsultation("test-user", id);
  assert.equal(first.type, "accepted");
  assert.equal(first.entitlement, "free");
  assert.equal(
    (await confirmConsultation("test-user", id)).type,
    "already_processing",
  );
  assert.equal((await getUser("test-user")).free_consultations_used, 1);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS count FROM consultations WHERE status='queued_generation'",
      )
    ).rows[0].count,
    1,
  );
});

test("another user cannot confirm a consultation or spend its owner's allowance", async (t) => {
  await fixture(t);
  const id = await prepareDraft();
  await ensureUser("test-other-user");
  assert.equal(
    (await confirmConsultation("test-other-user", id)).type,
    "invalid",
  );
  assert.equal((await getUser("test-user")).free_consultations_used, 0);
  assert.equal((await getUser("test-other-user")).free_consultations_used, 0);
});

test("cancelling preparation discards only the draft without spending allowance", async (t) => {
  const db = await fixture(t);
  await prepareDraft();
  assert.equal(await cancelIntake("test-user"), true);
  assert.equal(
    (await db.query("SELECT count(*)::int AS count FROM consultations")).rows[0]
      .count,
    0,
  );
  assert.equal((await getUser("test-user")).free_consultations_used, 0);
});

test("an old confirmation button cannot accept the new preparation session", async (t) => {
  const db = await fixture(t);
  const oldId = await prepareDraft();
  const newId = await prepareDraft();
  await handleLineEvent({
    type: "postback",
    webhookEventId: "test-old-confirmation",
    replyToken: "test-reply",
    source: { userId: "test-user" },
    postback: {
      data: new URLSearchParams({
        action: "confirm_consultation",
        consultation_id: oldId,
      }).toString(),
    },
  });
  assert.equal((await getUser("test-user")).free_consultations_used, 0);
  assert.deepEqual(
    (await db.query("SELECT id,status FROM consultations")).rows,
    [{ id: newId, status: "draft" }],
  );
});

test("expiry cleanup cannot remove a confirmed consultation or refund its allowance", async (t) => {
  const db = await fixture(t);
  const id = await prepareDraft();
  await confirmConsultation("test-user", id);
  await db.query(
    "UPDATE consultation_intake_sessions SET expires_at = now() - interval '1 minute'",
  );
  await cleanupExpiredIntakes();
  assert.equal(
    (await db.query("SELECT status FROM consultations WHERE id=$1", [id]))
      .rows[0].status,
    "queued_generation",
  );
  assert.equal((await getUser("test-user")).free_consultations_used, 1);
});
