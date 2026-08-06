import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(currentDir, "../migrations");

async function main(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = (await fs.readdir(migrationsDir))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const filename of files) {
    const already = await pool.query(
      `SELECT 1 FROM schema_migrations WHERE filename = $1`,
      [filename],
    );
    if (already.rowCount) continue;

    const sql = await fs.readFile(path.join(migrationsDir, filename), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        `INSERT INTO schema_migrations (filename) VALUES ($1)`,
        [filename],
      );
      await client.query("COMMIT");
      console.log(`Applied ${filename}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
