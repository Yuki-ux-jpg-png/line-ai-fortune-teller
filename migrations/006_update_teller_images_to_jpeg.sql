-- 006_update_teller_images_to_jpeg.sql
-- 占い師3名のプロフィール画像を軽量JPEG版へ切り替える。

UPDATE fortune_tellers
SET
  image_url = 'https://cdn.jsdelivr.net/gh/Yuki-ux-jpg-png/line-ai-fortune-teller@main/assets/tellers/yuri.jpg',
  updated_at = now()
WHERE id = 'yuri';

UPDATE fortune_tellers
SET
  image_url = 'https://cdn.jsdelivr.net/gh/Yuki-ux-jpg-png/line-ai-fortune-teller@main/assets/tellers/mao.jpg',
  updated_at = now()
WHERE id = 'mao';

UPDATE fortune_tellers
SET
  image_url = 'https://cdn.jsdelivr.net/gh/Yuki-ux-jpg-png/line-ai-fortune-teller@main/assets/tellers/kei.jpg',
  updated_at = now()
WHERE id = 'kei';
