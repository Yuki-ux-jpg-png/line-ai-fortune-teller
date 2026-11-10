-- Rollout fence: existing unfinished consultations need an individual disposition.
-- Preserve status, question, answers and all free/paid entitlements unchanged.
CREATE TABLE consultation_processing_holds (
 consultation_id UUID PRIMARY KEY REFERENCES consultations(id) ON DELETE CASCADE,
 reason TEXT NOT NULL,
 held_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO consultation_processing_holds(consultation_id,reason)
SELECT id,'pre_rollout_review' FROM consultations
WHERE status IN ('queued_generation','generating','scheduled','sending');
ALTER TABLE consultations ADD COLUMN first_send_attempt_at TIMESTAMPTZ;
