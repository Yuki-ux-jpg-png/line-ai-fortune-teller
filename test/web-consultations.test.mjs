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
const { webAction, webSnapshot } = await import("../dist/web-consultations.js");
const {
  startWebIdentity,
  webIdentity,
  createWebLink,
  prepareWebLink,
  approveWebLink,
  webRateLimit,
} = await import("../dist/web-identity.js");
const {
  confirmConsultation,
  claimGenerationJob,
  saveGeneratedAnswer,
  claimDeliveryJob,
  markDelivered,
  selectTeller,
  saveDraft,
} = await import("../dist/consultations.js");
const { cancelIntake } = await import("../dist/intake.js");
const { enqueueWebNotifications, validatedSubscription } =
  await import("../dist/web-notifications.js");
const id = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
const member = { id, email: "member@example.test", access: true, staff: false };
const safe = {
  urgentSafetyConcern: async () => false,
  followUpQuestion: async () => "どのようなことが気になっていますか？",
  summarizeIntake: async () => "整理した相談文",
};
async function fixture(t) {
  const db = await createTestDatabase();
  t.after(() => db.close());
  attachTestPool(t, pool, db);
  await db.exec(
    await readFile(
      new URL("../migrations/013_web_notifications.sql", import.meta.url),
      "utf8",
    ),
  );
  return db;
}
async function draft() {
  return webAction(
    member,
    "draft",
    {
      question: "人間関係のことで少し迷っています。",
      tellerId: "tsukino",
      requestId: crypto.randomUUID(),
    },
    safe,
  );
}
test("Web confirmation, generation and publishing share one allowance and create one private notice", async (t) => {
  const db = await fixture(t);
  await startWebIdentity(id);
  const d = await draft();
  assert.equal((await webSnapshot(id)).freeRemaining, 2);
  assert.equal(
    (await webAction(member, "confirm", { id: d.id })).type,
    "accepted",
  );
  assert.equal(
    (await webAction(member, "confirm", { id: d.id })).type,
    "already_processing",
  );
  assert.equal((await webSnapshot(id)).freeRemaining, 1);
  const job = await claimGenerationJob();
  assert.equal(job.id, d.id);
  await saveGeneratedAnswer(d.id, "本人専用のテスト鑑定");
  assert.equal((await webSnapshot(id)).consultations[0].answer, null);
  await db.query(
    "UPDATE consultations SET deliver_at=now()-interval '1 second' WHERE id=$1",
    [d.id],
  );
  const delivery = await claimDeliveryJob();
  assert.equal(delivery.delivery_channel, "web");
  await markDelivered(delivery);
  await markDelivered(delivery);
  const snapshot = await webSnapshot(id);
  assert.equal(snapshot.consultations[0].answer, "本人専用のテスト鑑定");
  assert.equal(snapshot.notices.length, 1);
  assert.equal((await webSnapshot(other)).consultations.length, 0);
  await assert.rejects(
    webAction({ ...member, id: other }, "confirm", { id: d.id }),
    (e) => e.status === 409,
  );
});
test("an urgent original draft or guided conversation never reserves a free or paid entitlement", async (t) => {
  const db = await fixture(t);
  await startWebIdentity(id);
  const r = await webAction(
    member,
    "draft",
    {
      question: "安全確認のテスト文",
      tellerId: "tsukino",
      requestId: crypto.randomUUID(),
    },
    { ...safe, urgentSafetyConcern: async () => true },
  );
  assert.equal(r.safety, true);
  const g = await webAction(
    member,
    "guided",
    { turns: ["原文"] },
    {
      ...safe,
      urgentSafetyConcern: async () => true,
      summarizeIntake: async () => {
        throw new Error("must not summarize unsafe input");
      },
    },
  );
  assert.equal(g.safety, true);
  assert.equal(
    (await db.query("SELECT count(*)::int AS n FROM consultations")).rows[0].n,
    0,
  );
  assert.equal((await webSnapshot(id)).freeRemaining, 2);
});
test("a request retry preserves its draft and a LINE operation cannot overwrite or discard it", async (t) => {
  await fixture(t);
  await startWebIdentity(id);
  const requestId = crypto.randomUUID();
  const p = { question: "原文", tellerId: "tsukino", requestId };
  assert.deepEqual(
    await webAction(member, "draft", p, safe),
    await webAction(member, "draft", p, safe),
  );
  const owner = await webIdentity(id);
  assert.equal(await selectTeller(owner, "akari"), "active");
  await cancelIntake(owner);
  assert.equal((await webSnapshot(id)).consultations[0].question, "原文");
  const saved = await saveDraft(owner, "LINEからの別の文");
  assert.equal(saved.type, "no_teller");
});
test("LINE history and used allowance are linked only after explicit LINE approval; holds are preserved", async (t) => {
  const db = await fixture(t);
  const line = "U" + "a".repeat(32);
  await db.query(
    "INSERT INTO users(line_user_id,free_consultations_used) VALUES($1,2)",
    [line],
  );
  const old = (
    await db.query(
      "INSERT INTO consultations(line_user_id,teller_id,question,status,entitlement_type) VALUES($1,'tsukino','旧相談','queued_generation','free') RETURNING id",
      [line],
    )
  ).rows[0].id;
  await db.query(
    "INSERT INTO consultation_processing_holds(consultation_id,reason) VALUES($1,'pre_rollout_review')",
    [old],
  );
  const code = await createWebLink(id);
  assert.equal(await prepareWebLink(code, line), true);
  assert.equal(await webIdentity(id), null);
  assert.equal(await approveWebLink(code, "U" + "b".repeat(32)), false);
  assert.equal(await approveWebLink(code, line), true);
  assert.equal(await approveWebLink(code, line), false);
  const snapshot = await webSnapshot(id);
  assert.equal(snapshot.freeRemaining, 0);
  assert.equal(snapshot.consultations[0].held, true);
  assert.equal(await claimGenerationJob(), null);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int n FROM consultation_processing_holds",
      )
    ).rows[0].n,
    1,
  );
  await startWebIdentity(id);
  assert.equal(await webIdentity(id), line);
});
test("Web-only accounts cannot be rebound later to reset or merge free allowance", async (t) => {
  await fixture(t);
  await startWebIdentity(id);
  await assert.rejects(createWebLink(id), (e) => e.status === 409);
});
test("expired codes and replayed codes do not link another member", async (t) => {
  const db = await fixture(t);
  const code = await createWebLink(id);
  await db.query(
    "UPDATE web_link_requests SET expires_at=now()-interval '1 second'",
  );
  assert.equal(await prepareWebLink(code, "U" + "a".repeat(32)), false);
  assert.equal(await approveWebLink(code, "U" + "a".repeat(32)), false);
});
test("the third consultation requires payment without creating a charge or another free allowance", async (t) => {
  const db = await fixture(t);
  await startWebIdentity(id);
  const canonical = await webIdentity(id);
  await db.query(
    "UPDATE users SET free_consultations_used=2 WHERE line_user_id=$1",
    [canonical],
  );
  const d = await draft();
  assert.equal(
    (await confirmConsultation(canonical, d.id)).type,
    "needs_payment",
  );
  assert.equal((await webSnapshot(id)).freeRemaining, 0);
  assert.equal(
    (await db.query("SELECT count(*)::int AS n FROM payments")).rows[0].n,
    0,
  );
});
test("subscription expiry permits private history but denies new drafts and confirmations", async (t) => {
  await fixture(t);
  await startWebIdentity(id);
  await draft();
  assert.equal(
    (await webAction({ ...member, access: false }, "status", {})).consultations
      .length,
    1,
  );
  await assert.rejects(
    webAction({ ...member, access: false }, "draft", {}),
    (e) => e.status === 403,
  );
  await assert.rejects(
    webAction({ ...member, staff: false }, "operations", {}),
    (e) => e.status === 403,
  );
});
test("rate limits persist in the database instead of resetting for another request process", async (t) => {
  await fixture(t);
  await webRateLimit(id, "audio", 1);
  await assert.rejects(webRateLimit(id, "audio", 1), (e) => e.status === 429);
  await webRateLimit(other, "audio", 1);
});
test("push recipients reject arbitrary HTTP services, IPs and oversized keys", () => {
  const keys = { p256dh: "a".repeat(87), auth: "b".repeat(22) };
  for (const endpoint of [
    "http://fcm.googleapis.com/a",
    "https://127.0.0.1/a",
    "https://example.test/a",
    "https://fcm.googleapis.com:444/a",
    "https://fcm.googleapis.com@127.0.0.1/a",
  ])
    assert.throws(() => validatedSubscription({ endpoint, keys }));
  assert.ok(
    validatedSubscription({
      endpoint: "https://fcm.googleapis.com/fcm/send/test",
      keys,
    }),
  );
});
test("notice outbox is opt-in, idempotent and never stores consultation text", async (t) => {
  const db = await fixture(t);
  await startWebIdentity(id);
  const d = await draft();
  await db.query(
    "INSERT INTO web_notices(consultation_id,kind) VALUES($1,'ready')",
    [d.id],
  );
  await enqueueWebNotifications();
  assert.equal(
    (await db.query("SELECT count(*)::int n FROM web_notification_outbox"))
      .rows[0].n,
    0,
  );
  await db.query(
    "INSERT INTO web_notification_preferences(web_user_id,email,verification_token,email_enabled,updated_at) VALUES($1,'member@example.test',$2,true,now()-interval '1 minute')",
    [id, "a".repeat(64)],
  );
  await enqueueWebNotifications();
  await enqueueWebNotifications();
  const outbox = (await db.query("SELECT * FROM web_notification_outbox")).rows;
  assert.equal(outbox.length, 1);
  assert.equal("question" in outbox[0], false);
});
