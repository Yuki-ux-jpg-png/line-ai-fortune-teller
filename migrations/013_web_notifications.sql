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
