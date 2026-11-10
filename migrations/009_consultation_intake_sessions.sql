-- Temporary, opt-in consultation preparation. This is separate from confirmed consultations.
CREATE TABLE IF NOT EXISTS consultation_intake_sessions (
  line_user_id TEXT PRIMARY KEY REFERENCES users(line_user_id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('mode', 'text', 'voice', 'guided', 'review')),
  turns JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(turns) = 'array'),
  step INTEGER NOT NULL DEFAULT 0 CHECK (step BETWEEN 0 AND 3),
  draft_consultation_id UUID REFERENCES consultations(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '30 minutes',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS consultation_intake_expiry ON consultation_intake_sessions(expires_at);
-- Expired sessions and their unconfirmed drafts are purged by the worker.
-- The ordinary text-message handler must never infer an active consultation from users.selected_teller_id.
