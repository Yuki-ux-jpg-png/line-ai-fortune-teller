-- 007_restore_failed_429_consultations.sql
-- 既に同じユーザーに処理中相談がある場合は、
-- one_open_consultation_per_user 制約を守るため復活をスキップする。
-- Renderのデプロイは止めず、既存の処理中相談をNOTICEログへ出す。
--
-- failed相談の復活は、既存の処理中相談が sent / failed / cancelled になった後、
-- 次のマイグレーションで行う。

DO $$
DECLARE
  target_user_id text;
  open_consultation_id uuid;
  open_consultation_status text;
BEGIN
  SELECT line_user_id
    INTO target_user_id
  FROM consultations
  WHERE id = '967b733b-5103-416f-a16b-e8dae5092e51';

  IF target_user_id IS NULL THEN
    RAISE NOTICE '007: 対象相談が見つからないためスキップします';
    RETURN;
  END IF;

  SELECT id, status
    INTO open_consultation_id, open_consultation_status
  FROM consultations
  WHERE line_user_id = target_user_id
    AND id <> '967b733b-5103-416f-a16b-e8dae5092e51'
    AND status IN (
      'draft',
      'awaiting_payment',
      'queued_generation',
      'generating',
      'scheduled',
      'sending'
    )
  ORDER BY created_at DESC
  LIMIT 1;

  IF open_consultation_id IS NOT NULL THEN
    RAISE NOTICE
      '007: 既存の処理中相談があるためfailed相談の復活をスキップします。id=%, status=%',
      open_consultation_id,
      open_consultation_status;
    RETURN;
  END IF;

  RAISE NOTICE
    '007: 処理中相談はありません。failed相談の復活は次のマイグレーションで行います';
END
$$;
