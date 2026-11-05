import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

export async function createTestDatabase({ intake = true, recorded = true } = {}) {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(await readFile(new URL("../../migrations/001_init.sql", import.meta.url), "utf8"));
  await db.exec(`CREATE TABLE schema_migrations (
    filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  await db.query("INSERT INTO schema_migrations(filename) VALUES ($1)", ["001_init.sql"]);
  if (intake) {
    await db.exec(await readFile(new URL("../../migrations/009_consultation_intake_sessions.sql", import.meta.url), "utf8"));
    if (recorded) {
      await db.query("INSERT INTO schema_migrations(filename) VALUES ($1)", ["009_consultation_intake_sessions.sql"]);
    }
  }
  if (intake) {
    await db.exec(await readFile(new URL("../../migrations/010_consultation_processing_holds.sql", import.meta.url), "utf8"));
    if (recorded) await db.query("INSERT INTO schema_migrations(filename) VALUES ($1)", ["010_consultation_processing_holds.sql"]);
  }
  return db;
}

export function useTestEnvironment() {
  Object.assign(process.env, {
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test:test@127.0.0.1:1/test_never_connect",
    DATABASE_SSL: "false",
    APP_BASE_URL: "https://example.invalid",
    LINE_CHANNEL_SECRET: "test-channel-secret",
    LINE_CHANNEL_ACCESS_TOKEN: "test-channel-token",
    OPENAI_API_KEY: "test-openai-key",
    STRIPE_SECRET_KEY: "sk_test_placeholder",
    STRIPE_WEBHOOK_SECRET: "test-webhook-secret",
    FREE_CONSULTATION_LIMIT: "2",
    DAILY_AI_GENERATION_LIMIT: "200",
    MAX_DAILY_CONSULTATIONS_PER_USER: "5",
  });
  // Any unmocked API call is a test failure, never a real message or AI call.
  globalThis.fetch = async () => { throw new Error("External HTTP is disabled in tests"); };
}

/** Adapt the actual in-memory PostgreSQL result to node-postgres's contract. */
export function attachTestPool(t, pool, db) {
  const query = async (sql, parameters) => {
    const result = await db.query(sql, parameters);
    // PGlite reports affectedRows=0 for SELECT, whereas pg reports rowCount.
    return { ...result, rowCount: result.rows.length || result.affectedRows || 0 };
  };
  t.mock.method(pool, "query", query);
  t.mock.method(pool, "connect", async () => ({ query, release() {} }));
}
