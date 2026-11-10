import { pool } from "./db.js";
import { webMarket } from "./web-market.js";
import { reconcileWebPayments, webOperations } from "./web-operations.js";
/** A regional worker never consumes another schema's queue. */
export async function runRegionalWorker(work: () => Promise<void>) {
  const expected = webMarket === "tw" ? "line_tw" : "line_kr";
  const schema = await pool.query("SELECT current_schema() AS name, to_regclass('web_identities') IS NOT NULL AS ready");
  if (schema.rows[0]?.name !== expected || !schema.rows[0]?.ready) throw new Error("REGIONAL_WEB_SCHEMA_REQUIRED");
  const lease=await pool.connect(), key=webMarket === "tw" ? 2 : 3;
  try {
    const lock=await lease.query("SELECT pg_try_advisory_lock(714902,$1) AS acquired",[key]);
    if (!lock.rows[0]?.acquired) return;
    try {
      await pool.query("INSERT INTO worker_health(name,last_started_at) VALUES($1,now()) ON CONFLICT(name) DO UPDATE SET last_started_at=now()",[webMarket+"-consultations"]);
      await work();
      await reconcileWebPayments();
      await webOperations();
      await pool.query("UPDATE worker_health SET last_succeeded_at=now() WHERE name=$1",[webMarket+"-consultations"]);
    } catch(e) {
      await pool.query("UPDATE worker_health SET last_failed_at=now() WHERE name=$1",[webMarket+"-consultations"]);
      throw e;
    } finally { await lease.query("SELECT pg_advisory_unlock(714902,$1)",[key]); }
  } finally { lease.release(); }
}
