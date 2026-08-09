-- 007_restore_failed_429_consultations.sql
-- 429 Too Many Requests で failed になった2件を再生成キューへ戻す。
-- 失敗時に返却された無料枠／有料クレジットも復元する。
-- すでに待機時間を超えているため、生成後すぐ配信できるよう deliver_at は now() にする。

BEGIN;

-- 有料相談が含まれる場合、復活に必要な available クレジットが足りるか先に検証する。
DO $$
DECLARE
  missing_count integer;
BEGIN
  WITH paid_targets AS (
    SELECT
      id AS consultation_id,
      line_user_id,
      row_number() OVER (
        PARTITION BY line_user_id
        ORDER BY created_at, id
      ) AS rn
    FROM consultations
    WHERE id IN (
      '967b733b-5103-416f-a16b-e8dae5092e51',
      '52b0b3fe-682e-47fd-9f04-4a4d908d7a10'
    )
      AND status = 'failed'
      AND last_error LIKE '429%'
      AND entitlement_type = 'paid'
  ),
  available_credits AS (
    SELECT
      id AS credit_id,
      line_user_id,
      row_number() OVER (
        PARTITION BY line_user_id
        ORDER BY created_at, id
      ) AS rn
    FROM consultation_credits
    WHERE status = 'available'
      AND consultation_id IS NULL
      AND (expires_at IS NULL OR expires_at > now())
  )
  SELECT count(*)
    INTO missing_count
  FROM paid_targets pt
  LEFT JOIN available_credits ac
    ON ac.line_user_id = pt.line_user_id
   AND ac.rn = pt.rn
  WHERE ac.credit_id IS NULL;

  IF missing_count > 0 THEN
    RAISE EXCEPTION '復活対象の有料相談に必要な available クレジットが不足しています';
  END IF;
END
$$;

-- 有料相談に available クレジットを再予約する。
WITH paid_targets AS (
  SELECT
    id AS consultation_id,
    line_user_id,
    row_number() OVER (
      PARTITION BY line_user_id
      ORDER BY created_at, id
    ) AS rn
  FROM consultations
  WHERE id IN (
    '967b733b-5103-416f-a16b-e8dae5092e51',
    '52b0b3fe-682e-47fd-9f04-4a4d908d7a10'
  )
    AND status = 'failed'
    AND last_error LIKE '429%'
    AND entitlement_type = 'paid'
),
available_credits AS (
  SELECT
    id AS credit_id,
    line_user_id,
    row_number() OVER (
      PARTITION BY line_user_id
      ORDER BY created_at, id
    ) AS rn
  FROM consultation_credits
  WHERE status = 'available'
    AND consultation_id IS NULL
    AND (expires_at IS NULL OR expires_at > now())
),
pairs AS (
  SELECT pt.consultation_id, ac.credit_id
  FROM paid_targets pt
  JOIN available_credits ac
    ON ac.line_user_id = pt.line_user_id
   AND ac.rn = pt.rn
)
UPDATE consultation_credits cc
SET
  status = 'reserved',
  consultation_id = pairs.consultation_id
FROM pairs
WHERE cc.id = pairs.credit_id;

-- 無料相談は、3回失敗した時点で free_consultations_used が返却されているため再カウントする。
WITH free_counts AS (
  SELECT
    line_user_id,
    count(*)::integer AS restore_count
  FROM consultations
  WHERE id IN (
    '967b733b-5103-416f-a16b-e8dae5092e51',
    '52b0b3fe-682e-47fd-9f04-4a4d908d7a10'
  )
    AND status = 'failed'
    AND last_error LIKE '429%'
    AND entitlement_type = 'free'
  GROUP BY line_user_id
)
UPDATE users u
SET
  free_consultations_used = u.free_consultations_used + free_counts.restore_count,
  state = 'waiting_result',
  updated_at = now()
FROM free_counts
WHERE u.line_user_id = free_counts.line_user_id;

-- 対象相談を再生成キューへ戻す。
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
WHERE id IN (
  '967b733b-5103-416f-a16b-e8dae5092e51',
  '52b0b3fe-682e-47fd-9f04-4a4d908d7a10'
)
  AND status = 'failed'
  AND last_error LIKE '429%';

-- 対象ユーザーを結果待ち状態へ戻す。
UPDATE users
SET
  state = 'waiting_result',
  updated_at = now()
WHERE line_user_id IN (
  SELECT line_user_id
  FROM consultations
  WHERE id IN (
    '967b733b-5103-416f-a16b-e8dae5092e51',
    '52b0b3fe-682e-47fd-9f04-4a4d908d7a10'
  )
    AND status = 'queued_generation'
);

COMMIT;
