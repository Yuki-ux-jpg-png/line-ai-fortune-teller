-- 007_restore_failed_429_consultations.sql
-- 同一ユーザーのfailed相談を同時にopen状態へ戻すと
-- one_open_consultation_per_user 制約に違反するため、
-- 今回は最新の1件だけを再生成キューへ戻す。
--
-- 対象:
-- 967b733b-5103-416f-a16b-e8dae5092e51
--
-- migrate.ts 側ですでにトランザクション管理されるため、
-- このSQL内では BEGIN / COMMIT は行わない。

DO $$
DECLARE
  target_user_id text;
  target_entitlement text;
  credit_id uuid;
BEGIN
  SELECT line_user_id, entitlement_type
    INTO target_user_id, target_entitlement
  FROM consultations
  WHERE id = '967b733b-5103-416f-a16b-e8dae5092e51'
    AND status = 'failed'
    AND last_error LIKE '429%'
  FOR UPDATE;

  IF target_user_id IS NULL THEN
    RAISE EXCEPTION '復活対象の相談が failed/429 状態で見つかりません';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM consultations
    WHERE line_user_id = target_user_id
      AND id <> '967b733b-5103-416f-a16b-e8dae5092e51'
      AND status IN (
        'draft', 'awaiting_payment', 'queued_generation',
        'generating', 'scheduled', 'sending'
      )
  ) THEN
    RAISE EXCEPTION '同じユーザーに別の処理中相談が存在します';
  END IF;

  IF target_entitlement = 'free' THEN
    UPDATE users
    SET
      free_consultations_used = free_consultations_used + 1,
      state = 'waiting_result',
      updated_at = now()
    WHERE line_user_id = target_user_id;

  ELSIF target_entitlement = 'paid' THEN
    SELECT id
      INTO credit_id
    FROM consultation_credits
    WHERE line_user_id = target_user_id
      AND status = 'available'
      AND consultation_id IS NULL
      AND (expires_at IS NULL OR expires_at > now())
    ORDER BY created_at
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF credit_id IS NULL THEN
      RAISE EXCEPTION '復活対象の有料相談に使えるクレジットがありません';
    END IF;

    UPDATE consultation_credits
    SET
      status = 'reserved',
      consultation_id = '967b733b-5103-416f-a16b-e8dae5092e51'
    WHERE id = credit_id;

    UPDATE users
    SET
      state = 'waiting_result',
      updated_at = now()
    WHERE line_user_id = target_user_id;

  ELSE
    RAISE EXCEPTION 'entitlement_type が free/paid ではありません';
  END IF;

  UPDATE consultations
  SET
    status = 'queued_generation',
    generation_attempts = 0,
    send_attempts = 0,
    answer = NULL,
    generated_at = NULL,
    sent_at = NULL,
    locked_at = NULL,
    last_error = NULL,
    deliver_at = now(),
    updated_at = now()
  WHERE id = '967b733b-5103-416f-a16b-e8dae5092e51';
END
$$;
