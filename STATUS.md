# 韓国版バックエンド準備状況（2026-10-16）

## 実施済み

- 韓国向けLINEバックエンドを `kr/` に作成。既存台湾版の稼働コードを元に韓国語・韓国時間へ対応。
- TypeScriptビルドと10件の自動検証に成功。Stripe/OpenAI/LINEの実APIでの送信・決済テストは行っていない。
- Supabase `fffliyqwsbbbqgibezgw` に `create_isolated_korean_line_service` マイグレーションを適用済み。
- `line_kr` スキーマの8テーブル、韓国用点術家3件、日替わり用 `public.fortunes_kr` を追加。
- 全9テーブルでRLS有効。日替わりにはLINEユーザー・日付の一意制約を設定。
- 専用ロール `line_kr_app` はNOLOGIN・管理権限なし。日本・台湾の日替わりと台湾の相談テーブルへのSELECT権限なしを確認。
- 元からある日本・台湾のコード、Renderサービス、設定、利用者データは変更していない。

## 接続上の障害と未完了

GitHubリポジトリ `Yuki-ux-jpg-png/line-ai-fortune-teller` への書き込みは403（Resource not accessible by integration）。
ブラウザで韓国用ブランチ `korean-line-bot` と `kr/.gitignore` を作成済み（コミット b4899e019178d410204869e5478e6374c9aff980）。その後、認証後のブラウザ接続が再開不能になり、再初期化・既存タブへの再接続も拒否された。コード本体のアップロードとRender新サービスの作成は未完了。ZIPには追加予定の `kr/` とこの状況説明を含める。
接続の書き込み権限またはブラウザ接続が回復したら、作成済みの `korean-line-bot` ブランチへコード本体を追加する。このブランチは `taiwan-line-bot` の5e5a7954346bb49ad4487c344020ae18eaacf2edを元にしている。
日本版・台湾版のブランチを更新して韓国版を配備しない。

韓国LINE用の `LINE_KR_CHANNEL_SECRET` と `LINE_KR_CHANNEL_ACCESS_TOKEN` は未提供。
友だち追加URL `https://lin.ee/vuCRmaL` だけではWebhookの署名検証・返信はできない。
専用DBロールのログイン・パスワードと正しいSupabaseセッションプール接続URLの設定も必要。
これらの秘密値はチャットやZIPに入れず、Renderの環境変数へ安全に設定する。

AI用キー・使用可能なモデルと、5分間隔の生成／配信Workerは未設定。
Render Cronを新設する場合は追加課金の確認が必要。無料Webサービスだけでは定時配信は完結しない。
`KR_CONSULTATIONS_ENABLED=false` を既定とし、Worker確認後に有効化する。
韓国版の有料相談単価は未確定なので `KR_PAYMENTS_ENABLED=false`。Stripe上の操作は利用者本人が行う。

## DBの再実行について

`kr/setup.sql` は適用済みの初期化SQLの記録。既存環境へ再実行しない。
今後の追加変更は別マイグレーションとして適用する。
