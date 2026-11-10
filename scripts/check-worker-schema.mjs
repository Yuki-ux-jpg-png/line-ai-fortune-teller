import "dotenv/config";
import pg from "pg";
import {
  assertWorkerSchema,
  REQUIRED_WORKER_MIGRATION,
  WorkerSchemaError,
} from "../dist/worker-schema.js";

async function main() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is required");

  const sslValue = process.env.DATABASE_SSL?.trim().toLowerCase() ?? "true";
  if (!["true", "false"].includes(sslValue)) {
    throw new Error("DATABASE_SSL must be true or false");
  }
  const pool = new pg.Pool({
    connectionString,
    ssl: sslValue === "true" ? { rejectUnauthorized: true } : false,
    max: 1,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000,
  });
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN READ ONLY");
    try {
      await assertWorkerSchema(client);
    } finally {
      await client.query("ROLLBACK");
    }
    console.log(JSON.stringify({
      ok: true,
      schema: "public",
      requiredMigration: REQUIRED_WORKER_MIGRATION,
    }));
  } finally {
    client?.release();
    await pool.end();
  }
}

main().catch((error) => {
  // Do not print driver errors, connection strings, or SQL parameters.
  const safeMessage = error instanceof WorkerSchemaError
    ? error.message
    : ["DATABASE_URL is required", "DATABASE_SSL must be true or false"].includes(error?.message)
      ? error.message
      : "Database schema check failed; inspect connectivity, permissions, and trusted CA configuration.";
  console.error(safeMessage);
  process.exitCode = 1;
});
