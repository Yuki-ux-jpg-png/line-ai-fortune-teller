// No configuration or external API imports: safe to exercise with an isolated database.
type Database = { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> };
export async function recordWorkerRun(db: Database, phase: 'started'|'succeeded'|'failed'): Promise<void> {
  const column = {started:'last_started_at',succeeded:'last_succeeded_at',failed:'last_failed_at'}[phase];
  await db.query(`INSERT INTO worker_health(name,${column}) VALUES ('jp-consultations',now()) ON CONFLICT(name) DO UPDATE SET ${column}=now()`);
}
export async function workerHealth(db: Database): Promise<{ok:boolean;reason:string}> {
  const r=await db.query(`SELECT last_succeeded_at > now()-interval '15 minutes' AND (last_failed_at IS NULL OR last_failed_at<last_succeeded_at) AS fresh,
    NOT EXISTS(SELECT 1 FROM consultations c WHERE status IN ('queued_generation','scheduled')
      AND CASE WHEN status='queued_generation' THEN created_at ELSE deliver_at END < now()-interval '30 minutes'
      AND NOT EXISTS(SELECT 1 FROM consultation_processing_holds h WHERE h.consultation_id=c.id)) AS queue_ok
    FROM worker_health WHERE name='jp-consultations'`);
  const row=r.rows[0];
  if(!row?.fresh) return {ok:false,reason:'worker_stale'};
  if(!row.queue_ok) return {ok:false,reason:'queue_overdue'};
  return {ok:true,reason:'healthy'};
}
