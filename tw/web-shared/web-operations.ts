import { query } from "./db.js";
import { syncWebPayment } from "./web-consultations.js";
/** Existing worker is the sole queue consumer; reconciliation only reads Stripe. */
export async function reconcileWebPayments() {
  const rows = await query<{
    id: string;
    line_user_id: string;
  }>(`SELECT c.id,c.line_user_id FROM consultations c
    WHERE c.delivery_channel='web' AND c.status='awaiting_payment' AND c.stripe_session_id IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM consultation_processing_holds h WHERE h.consultation_id=c.id)
    ORDER BY c.updated_at LIMIT 10`);
  for (const row of rows.rows) {
    try {
      await syncWebPayment(row.line_user_id, row.id);
    } catch {
      console.error("web_payment_sync_failed");
    }
  }
}
export async function webOperations() {
  await query(`INSERT INTO web_notices(consultation_id,kind)
    SELECT id,'failed' FROM consultations WHERE delivery_channel='web' AND status='failed'
    ON CONFLICT DO NOTHING`);
  // Anonymous housekeeping only; never alter existing holds, consultation bodies or entitlements.
  await query(
    "DELETE FROM web_link_requests WHERE expires_at<now()-interval '1 day'",
  );
  await query(
    "DELETE FROM web_request_limits WHERE period<now()-interval '2 days'",
  );
  await query(
    "DELETE FROM web_notices WHERE created_at<now()-interval '90 days'",
  );
  const result = await operationsOverview();
  console.log("consultation_operations", result);
  if ((result.overdue ?? 0) > 0 || (result.notificationFailed ?? 0) > 0)
    throw new Error("CONSULTATION_OPERATIONS_ATTENTION");
  return result;
}
export async function operationsOverview() {
  const r = await query(`SELECT
    count(*) FILTER(WHERE c.delivery_channel='web' AND c.status='queued_generation')::int AS queued,
    count(*) FILTER(WHERE c.delivery_channel='web' AND c.status='failed')::int AS failed,
    count(*) FILTER(WHERE h.consultation_id IS NOT NULL)::int AS held,
    count(*) FILTER(WHERE h.consultation_id IS NULL AND c.status='queued_generation' AND c.confirmed_at<now()-interval '30 minutes')::int AS overdue,
    count(*) FILTER(WHERE c.delivery_channel='web' AND c.confirmed_at>=now()-interval '7 days')::int AS "acceptedLast7Days",
    count(*) FILTER(WHERE c.delivery_channel='web' AND c.sent_at>=now()-interval '7 days')::int AS "completedLast7Days",
    (SELECT count(*)::int FROM web_notification_outbox WHERE status='failed') AS "notificationFailed",
    (SELECT count(*)::int FROM web_notification_outbox WHERE status IN ('pending','sending')) AS "notificationPending"
    FROM consultations c LEFT JOIN consultation_processing_holds h ON h.consultation_id=c.id`);
  return r.rows[0] as Record<string, number>;
}
