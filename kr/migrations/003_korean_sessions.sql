ALTER TABLE users ADD COLUMN IF NOT EXISTS intake_expires_at timestamptz;
CREATE INDEX IF NOT EXISTS consultations_teller_lookup ON consultations(teller_id);
CREATE INDEX IF NOT EXISTS users_teller_lookup ON users(selected_teller_id);
CREATE INDEX IF NOT EXISTS payments_user_lookup ON payments(line_user_id);
CREATE INDEX IF NOT EXISTS payments_consultation_lookup ON payments(consultation_id);
CREATE INDEX IF NOT EXISTS credits_payment_lookup ON consultation_credits(payment_id);
