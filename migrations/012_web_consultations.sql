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
