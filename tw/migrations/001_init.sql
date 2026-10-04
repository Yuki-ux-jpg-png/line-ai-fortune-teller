-- PostgreSQL 18 supplies gen_random_uuid() in pg_catalog.

CREATE TABLE IF NOT EXISTS fortune_tellers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  image_url TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 100,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  line_user_id TEXT PRIMARY KEY,
  selected_teller_id TEXT REFERENCES fortune_tellers(id),
  state TEXT NOT NULL DEFAULT 'selecting_teller'
    CHECK (state IN (
      'selecting_teller', 'awaiting_question', 'draft_ready',
      'awaiting_payment', 'waiting_result'
    )),
  free_consultations_used INTEGER NOT NULL DEFAULT 0
    CHECK (free_consultations_used >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS consultations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_user_id TEXT NOT NULL REFERENCES users(line_user_id),
  teller_id TEXT NOT NULL REFERENCES fortune_tellers(id),
  question TEXT NOT NULL CHECK (char_length(question) BETWEEN 1 AND 2000),
  answer TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'draft', 'awaiting_payment', 'queued_generation', 'generating',
    'scheduled', 'sending', 'sent', 'failed', 'cancelled'
  )),
  entitlement_type TEXT CHECK (entitlement_type IN ('free', 'paid')),
  is_paid BOOLEAN NOT NULL DEFAULT FALSE,
  deliver_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  generated_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  stripe_session_id TEXT UNIQUE,
  checkout_attempts INTEGER NOT NULL DEFAULT 0,
  line_retry_key UUID NOT NULL DEFAULT gen_random_uuid(),
  generation_attempts INTEGER NOT NULL DEFAULT 0,
  send_attempts INTEGER NOT NULL DEFAULT 0,
  locked_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS one_open_consultation_per_user
  ON consultations(line_user_id)
  WHERE status IN (
    'draft', 'awaiting_payment', 'queued_generation', 'generating',
    'scheduled', 'sending'
  );

CREATE INDEX IF NOT EXISTS consultations_generation_queue
  ON consultations(status, created_at)
  WHERE status = 'queued_generation';

CREATE INDEX IF NOT EXISTS consultations_delivery_queue
  ON consultations(status, deliver_at)
  WHERE status = 'scheduled';

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_user_id TEXT NOT NULL REFERENCES users(line_user_id),
  consultation_id UUID NOT NULL REFERENCES consultations(id),
  stripe_session_id TEXT NOT NULL UNIQUE,
  stripe_payment_intent_id TEXT UNIQUE,
  amount INTEGER NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'jpy',
  status TEXT NOT NULL CHECK (status IN ('paid', 'refunded', 'disputed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS consultation_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_user_id TEXT NOT NULL REFERENCES users(line_user_id),
  payment_id UUID REFERENCES payments(id),
  status TEXT NOT NULL CHECK (status IN (
    'available', 'reserved', 'consumed', 'expired', 'refunded'
  )),
  consultation_id UUID UNIQUE REFERENCES consultations(id),
  expires_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS available_credit_lookup
  ON consultation_credits(line_user_id, created_at)
  WHERE status = 'available';

CREATE TABLE IF NOT EXISTS processed_line_events (
  webhook_event_id TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS processed_stripe_events (
  stripe_event_id TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

