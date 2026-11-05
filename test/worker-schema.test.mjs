import test from "node:test";
import assert from "node:assert/strict";
import { assertWorkerSchema, WorkerSchemaError } from "../dist/worker-schema.js";
import { createTestDatabase } from "./helpers/database.mjs";

test("legacy schema is rejected before any consultation data is changed", async (t) => {
  const db = await createTestDatabase({ intake: false });
  t.after(() => db.close());
  await db.query("INSERT INTO users(line_user_id,free_consultations_used) VALUES ('test-user',1)");
  await assert.rejects(assertWorkerSchema(db), (error) =>
    error instanceof WorkerSchemaError && error.problems.includes("missing public.consultation_intake_sessions.expires_at"));
  assert.equal((await db.query("SELECT free_consultations_used FROM users")).rows[0].free_consultations_used, 1);
  assert.equal((await db.query("SELECT to_regclass('public.consultation_intake_sessions') AS relation")).rows[0].relation, null);
});

test("a table without the migration record does not pass preflight", async (t) => {
  const db = await createTestDatabase({ recorded: false });
  t.after(() => db.close());
  await assert.rejects(assertWorkerSchema(db), /migration 009_consultation_intake_sessions.sql is not recorded/);
});

test("migration 009 passes preflight inside a read-only transaction", async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  await db.query("BEGIN READ ONLY");
  try { await assertWorkerSchema(db); }
  finally { await db.query("ROLLBACK"); }
});

test("a migration record does not conceal a missing required column", async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  await db.query("ALTER TABLE consultation_intake_sessions DROP COLUMN expires_at");
  await assert.rejects(assertWorkerSchema(db), /missing public.consultation_intake_sessions.expires_at/);
});

test("a migration record does not conceal an incompatible column type", async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  await db.query("ALTER TABLE consultation_intake_sessions ALTER COLUMN updated_at TYPE timestamp");
  await assert.rejects(assertWorkerSchema(db), /unexpected type for public.consultation_intake_sessions.updated_at/);
});

test("migration 009 enforces the intake stage and turn limit", async (t) => {
  const db = await createTestDatabase();
  t.after(() => db.close());
  await db.query("INSERT INTO users(line_user_id) VALUES ('test-user')");
  await assert.rejects(db.query("INSERT INTO consultation_intake_sessions(line_user_id,stage) VALUES ('test-user','invalid')"), { code: "23514" });
  await assert.rejects(db.query("INSERT INTO consultation_intake_sessions(line_user_id,stage,step) VALUES ('test-user','guided',4)"), { code: "23514" });
});
