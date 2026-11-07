-- Aggregate operational metadata only; no consultation or entitlement changes.
CREATE TABLE worker_health (
 name TEXT PRIMARY KEY,
 last_started_at TIMESTAMPTZ,
 last_succeeded_at TIMESTAMPTZ,
 last_failed_at TIMESTAMPTZ
);
