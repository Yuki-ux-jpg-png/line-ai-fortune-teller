-- Additive Web support only; existing consultations, free counts and payment records are preserved.
ALTER TABLE consultations ADD COLUMN first_send_attempt_at timestamptz;
CREATE TABLE consultation_processing_holds (consultation_id uuid PRIMARY KEY REFERENCES consultations(id),reason text NOT NULL,held_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE worker_health (name text PRIMARY KEY,last_started_at timestamptz,last_succeeded_at timestamptz,last_failed_at timestamptz);
-- Additive only: never release holds, requeue consultations, or change credits.
ALTER TABLE consultations ADD COLUMN delivery_channel text NOT NULL DEFAULT 'line'
  CHECK (delivery_channel IN ('line','web'));
CREATE TABLE web_identities (
  web_user_id uuid PRIMARY KEY,
  canonical_user_id text UNIQUE REFERENCES users(line_user_id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE web_link_requests (
  token_hash text PRIMARY KEY,
  web_user_id uuid NOT NULL UNIQUE REFERENCES web_identities(web_user_id),
  candidate_line_id text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE web_request_limits (
  web_user_id uuid NOT NULL,
  bucket text NOT NULL,
  period timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  PRIMARY KEY(web_user_id,bucket,period)
);
CREATE TABLE web_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id uuid NOT NULL REFERENCES consultations(id),
  kind text NOT NULL CHECK(kind IN ('ready','failed')),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(consultation_id,kind)
);
CREATE INDEX web_notices_consultation ON web_notices(consultation_id,created_at);
ALTER TABLE web_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE web_link_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE web_request_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE web_notices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON web_identities,web_link_requests,web_request_limits,web_notices FROM PUBLIC;
CREATE TABLE web_checkout_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultation_id uuid NOT NULL REFERENCES consultations(id),
  session_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
CREATE UNIQUE INDEX web_checkout_open ON web_checkout_attempts(consultation_id) WHERE closed_at IS NULL;
ALTER TABLE web_checkout_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON web_checkout_attempts FROM PUBLIC;

CREATE TABLE web_notification_preferences (
  web_user_id uuid PRIMARY KEY REFERENCES web_identities(web_user_id),
  email text NOT NULL,
  verification_token text NOT NULL,
  email_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE web_push_subscriptions (
  endpoint_hash text PRIMARY KEY,
  web_user_id uuid NOT NULL REFERENCES web_identities(web_user_id),
  subscription jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX web_push_owner ON web_push_subscriptions(web_user_id);
CREATE TABLE web_notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notice_id uuid NOT NULL REFERENCES web_notices(id) ON DELETE CASCADE,
  web_user_id uuid NOT NULL REFERENCES web_identities(web_user_id),
  target text NOT NULL,
  channel text NOT NULL CHECK(channel IN ('push','email')),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','cancelled','failed')),
  attempts integer NOT NULL DEFAULT 0,
  next_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(notice_id,target)
);
CREATE INDEX web_notification_due ON web_notification_outbox(next_at) WHERE status IN ('pending','sending');
ALTER TABLE web_notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE web_push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE web_notification_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON web_notification_preferences,web_push_subscriptions,web_notification_outbox FROM PUBLIC;

ALTER TABLE consultation_processing_holds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON consultation_processing_holds FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON consultation_processing_holds TO line_kr_app;
CREATE POLICY korean_server_access ON consultation_processing_holds TO line_kr_app USING(true) WITH CHECK(true);

ALTER TABLE worker_health ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON worker_health FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON worker_health TO line_kr_app;
CREATE POLICY korean_server_access ON worker_health TO line_kr_app USING(true) WITH CHECK(true);

ALTER TABLE web_identities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON web_identities FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON web_identities TO line_kr_app;
CREATE POLICY korean_server_access ON web_identities TO line_kr_app USING(true) WITH CHECK(true);

ALTER TABLE web_link_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON web_link_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON web_link_requests TO line_kr_app;
CREATE POLICY korean_server_access ON web_link_requests TO line_kr_app USING(true) WITH CHECK(true);

ALTER TABLE web_request_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON web_request_limits FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON web_request_limits TO line_kr_app;
CREATE POLICY korean_server_access ON web_request_limits TO line_kr_app USING(true) WITH CHECK(true);

ALTER TABLE web_notices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON web_notices FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON web_notices TO line_kr_app;
CREATE POLICY korean_server_access ON web_notices TO line_kr_app USING(true) WITH CHECK(true);

ALTER TABLE web_checkout_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON web_checkout_attempts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON web_checkout_attempts TO line_kr_app;
CREATE POLICY korean_server_access ON web_checkout_attempts TO line_kr_app USING(true) WITH CHECK(true);

ALTER TABLE web_notification_preferences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON web_notification_preferences FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON web_notification_preferences TO line_kr_app;
CREATE POLICY korean_server_access ON web_notification_preferences TO line_kr_app USING(true) WITH CHECK(true);

ALTER TABLE web_push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON web_push_subscriptions FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON web_push_subscriptions TO line_kr_app;
CREATE POLICY korean_server_access ON web_push_subscriptions TO line_kr_app USING(true) WITH CHECK(true);

ALTER TABLE web_notification_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON web_notification_outbox FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON web_notification_outbox TO line_kr_app;
CREATE POLICY korean_server_access ON web_notification_outbox TO line_kr_app USING(true) WITH CHECK(true);
