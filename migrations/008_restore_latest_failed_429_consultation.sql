-- 008_restore_latest_failed_429_consultation.sql
-- 429でfailedになった旧相談のうち、新しい1件だけを復活させる。
-- 同一ユーザーに処理中相談がないことを確認してから queued_generation に戻す。
--
-- 対象:
-- 967b733b-5103-416f-a16b-e8dae5092e51
--
-- migrate.ts 側でトランザクション管理されるため、
-- このSQL内では BEGIN / COMMIT は行わない。

DO $$
DECLARE
  target_id uuid := '967b733b-5103-416f-a16b-e8dae5092e51';
  target_user_id text;
  target_entitlement text;
  original_credit_id uuid;
BEGIN
  SELECT line_user_id, entitlement_type
    INTO target_user_id, target_entitlement
  FROM consultations
  WHERE id = target_id
    AND status = 'failed'
    AND last_error LIKE '429%'
  FOR UPDATE;

  IF target_user_id IS NULL THEN
    RAISE EXCEPTION '008: 対象相談が failed/429 状態で見つかりません';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM consultations
    WHERE line_user_id = target_user_id
      AND id <> target_id
      AND status IN (
        'draft',
        'awaiting_payment',
        'queued_generation',
        'generating',
        'scheduled',
        'sending'
      )
  ) THEN
    RAISE EXCEPTION '008: 同じユーザーに別の処理中相談が存在します';
  END IF;

  IF target_entitlement = 'free' THEN
    -- 最終失敗時に返却された無料枠を再度使用中として戻す。
    UPDATE users
    SET
      free_consultations_used = free_consultations_used + 1,
      state = 'waiting_result',
      updated_at = now()
    WHERE line_user_id = target_user_id;

  ELSIF target_entitlement = 'paid' THEN
    -- 元の相談に紐づいていた決済のクレジットを再予約する。
    SELECT cc.id
      INTO original_credit_id
    FROM consultation_credits cc
    JOIN payments p ON p.id = cc.payment_id
    WHERE p.consultation_id = target_id
      AND cc.line_user_id = target_user_id
      AND cc.status = 'available'
      AND cc.consultation_id IS NULL
      AND (cc.expires_at IS NULL OR cc.expires_at > now())
    ORDER BY cc.created_at
    LIMIT 1
    FOR UPDATE OF cc;

    IF original_credit_id IS NULL THEN
      RAISE EXCEPTION '008: 元の有料相談に対応するavailableクレジットが見つかりません';
    END IF;

    UPDATE consultation_credits
    SET
      status = 'reserved',
      consultation_id = target_id
    WHERE id = original_credit_id;

    UPDATE users
    SET
      state = 'waiting_result',
      updated_at = now()
    WHERE line_user_id = target_user_id;

  ELSE
    RAISE EXCEPTION '008: entitlement_type が free/paid ではありません';
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
  WHERE id = target_id;

  RAISE NOTICE '008: 相談 % を queued_generation に復活しました', target_id;
END
$$;
