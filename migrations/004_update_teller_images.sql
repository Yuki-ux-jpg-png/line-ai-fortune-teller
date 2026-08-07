-- 004_update_teller_images.sql
-- 占い師3名のプロフィール画像URLを更新する。

UPDATE fortune_tellers
SET
  image_url = 'https://cdn.jsdelivr.net/gh/Yuki-ux-jpg-png/line-ai-fortune-teller@main/assets/tellers/yuri.png',
  updated_at = now()
WHERE id = 'yuri';

UPDATE fortune_tellers
SET
  image_url = 'https://cdn.jsdelivr.net/gh/Yuki-ux-jpg-png/line-ai-fortune-teller@main/assets/tellers/mao.png',
  updated_at = now()
WHERE id = 'mao';

UPDATE fortune_tellers
SET
  image_url = 'https://cdn.jsdelivr.net/gh/Yuki-ux-jpg-png/line-ai-fortune-teller@main/assets/tellers/kei.png',
  updated_at = now()
WHERE id = 'kei';
