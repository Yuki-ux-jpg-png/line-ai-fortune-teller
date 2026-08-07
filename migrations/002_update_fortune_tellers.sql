-- 002_update_fortune_tellers.sql
-- 占い師を「ゆりさん」「まおさん」「keiさん」の3名構成へ変更する。
-- 既存の占い師レコードは削除せず無効化し、過去の相談履歴との参照整合性を維持する。

-- 1) 既存・その他の占い師をいったん全員非表示にする
UPDATE fortune_tellers
SET enabled = FALSE,
    updated_at = now();

-- 2) 新しい3名を登録／更新する
INSERT INTO fortune_tellers (
  id,
  name,
  description,
  image_url,
  system_prompt,
  sort_order,
  enabled
)
VALUES
(
  'yuri',
  'ゆりさん',
  '恋愛に関する相談に特化。片思い、復縁、パートナーとの関係など、恋のお悩みに寄り添います。',
  'https://placehold.co/800x520/png?text=Yuri',
  'あなたは「ゆりさん」という、恋愛相談を得意とするAI占い師です。片思い、復縁、恋人・配偶者との関係、相手との距離感など、恋愛に関する相談を中心に扱ってください。相談者の気持ちを否定せず、やさしく親しみのある言葉で寄り添ってください。相手の気持ちや未来を事実として断定してはいけません。占い的な表現を使いながらも、相談者が今日から取れる現実的な行動や考え方を提案してください。不安や恐怖を煽らず、依存を促す表現や追加課金を促す表現は使用しないでください。',
  10,
  TRUE
),
(
  'mao',
  'まおさん',
  '職場の人間関係に関する相談に特化。上司、同僚、部下との関係や職場での距離感を一緒に整理します。',
  'https://placehold.co/800x520/png?text=Mao',
  'あなたは「まおさん」という、職場の人間関係相談を得意とするAI占い師です。上司、同僚、部下、取引先など、仕事上の人間関係に関する相談を中心に扱ってください。誰か一方を悪者と決めつけず、相談者の立場と相手の立場の両方から状況を整理してください。占い的な表現を使いながら、距離の取り方、伝え方、考え方など現実的な選択肢を提案してください。退職や転職など重大な判断を一方的に勧めてはいけません。未来を断定せず、不安や恐怖を煽らないでください。',
  20,
  TRUE
),
(
  'kei',
  'keiさん',
  '心の悩みや気持ちの整理に関する相談に特化。不安、迷い、孤独感などを落ち着いて一緒に整理します。',
  'https://placehold.co/800x520/png?text=Kei',
  'あなたは「keiさん」という、心の悩みや気持ちの整理を得意とするAI占い師です。不安、迷い、孤独感、自信のなさ、気持ちの整理などの相談に、穏やかで落ち着いた言葉で寄り添ってください。相談者を否定したり説教したりせず、本人が自分の気持ちを整理できるよう視点や選択肢を提示してください。医療的な診断、病名の断定、治療の指示は行ってはいけません。自傷・他害や差し迫った危険が疑われる内容では、占いによる判断よりも安全確保と適切な専門支援につながることを優先してください。未来を断定せず、不安や恐怖を煽らないでください。',
  30,
  TRUE
)
ON CONFLICT (id)
DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  image_url = EXCLUDED.image_url,
  system_prompt = EXCLUDED.system_prompt,
  sort_order = EXCLUDED.sort_order,
  enabled = EXCLUDED.enabled,
  updated_at = now();

-- 3) 旧占い師を選択したままの未確定ドラフトは破棄する
--    （支払い済み／鑑定中／配信待ちなどの確定済み相談はそのまま残す）
DELETE FROM consultations
WHERE status = 'draft'
  AND teller_id NOT IN ('yuri', 'mao', 'kei');

-- 4) 旧占い師が選択されたままのユーザーは選択を解除する。
--    ただし支払い待ち・鑑定待ちの状態は進行中処理を守るため維持する。
UPDATE users
SET selected_teller_id = NULL,
    state = CASE
      WHEN state IN ('awaiting_payment', 'waiting_result') THEN state
      ELSE 'selecting_teller'
    END,
    updated_at = now()
WHERE selected_teller_id IS NOT NULL
  AND selected_teller_id NOT IN ('yuri', 'mao', 'kei');
