import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";
const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../migrations");
async function main() {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('line_tw_migrations'))");
    const namespace = await client.query("SELECT to_regnamespace('line_tw') AS schema");
    if (!namespace.rows[0]?.schema) throw new Error("line_tw スキーマをDB管理者で準備してください");
    await client.query("SET search_path TO line_tw");
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    const files = (await fs.readdir(migrationsDir)).filter(n => n.endsWith(".sql")).sort();
    for (const name of files) {
      const existing = await client.query("SELECT 1 FROM schema_migrations WHERE filename=$1", [name]);
      if (existing.rowCount) continue;
      await client.query("BEGIN");
      try {
        await client.query(await fs.readFile(path.join(migrationsDir, name), "utf8"));
        await client.query("INSERT INTO schema_migrations(filename) VALUES ($1)", [name]);
        await client.query("COMMIT"); console.log(`Applied Taiwan migration ${name}`);
      } catch (error) { await client.query("ROLLBACK"); throw error; }
    }
  } finally { await client.query("SELECT pg_advisory_unlock(hashtext('line_tw_migrations'))"); client.release(); }
}
main().catch(error => { console.error(error); process.exitCode=1; }).finally(() => pool.end());
