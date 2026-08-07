-- 占い師の表示名を正式名称へ変更する

UPDATE fortune_tellers
SET
  name = '伊藤　由利',
  system_prompt = REPLACE(
    system_prompt,
    '「ゆりさん」',
    '「伊藤　由利」'
  ),
  updated_at = now()
WHERE id = 'yuri';


UPDATE fortune_tellers
SET
  name = '吉村　真央',
  system_prompt = REPLACE(
    system_prompt,
    '「まおさん」',
    '「吉村　真央」'
  ),
  updated_at = now()
WHERE id = 'mao';


UPDATE fortune_tellers
SET
  name = '笠原　ケイ',
  system_prompt = REPLACE(
    system_prompt,
    '「keiさん」',
    '「笠原　ケイ」'
  ),
  updated_at = now()
WHERE id = 'kei';
