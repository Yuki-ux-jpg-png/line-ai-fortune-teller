# 韓国版LINE相談・日替わり運勢

専用ディレクトリ `kr/`、ブランチ `korean-line-bot`。日本版と台湾版は変更しない。
Supabase の既存プロジェクト内で、相談は `line_kr`、日替わりは `public.fortunes_kr` に保存。
日付判定は `Asia/Seoul`。同一LINEユーザー・同一日付の一意制約で再抽選を防ぐ。
日替わりも専用DBロールを使い、Supabaseの全権APIキーを追加共有しない。

## 現在の有効化条件

Render Web は free / Singapore。build `cd kr && npm ci --include=dev && npm run build`、start `cd kr && npm start`。
管理者が `setup.sql` を一度適用する。通常のWeb起動ではDBマイグレーションを実行しない。
`line_kr_app` は NOLOGIN で作成する。DBのパスワードをソース・マイグレーションに記録しない。
Supabase接続画面で正しいホスト・ポートを確認し、専用ロールの認証を安全に設定してRenderへ登録する。

必要なRender環境変数（値をチャットやGitHubへ貼らない）:

- `KR_DATABASE_URL`: `line_kr_app` の接続URL。接続プールを使う場合は session モードを使用。
- `KR_DATABASE_SSL=true`
- `LINE_KR_CHANNEL_SECRET`: 韓国用Messaging APIチャネルのシークレット
- `LINE_KR_CHANNEL_ACCESS_TOKEN`: 同チャネルのアクセストークン
- `TZ=Asia/Seoul`
- `KR_APP_BASE_URL`: Render自身のURL。未設定なら `RENDER_EXTERNAL_URL` を使用
- `KR_LINE_FRIEND_URL=https://lin.ee/vuCRmaL`: Webサイトと共通の友だち追加リンク

以上が設定されるまで `/health` と両Webhookは503。LINEからの署名検証は韓国専用シークレットを使用。
`今日の占い` を既存Vercelへ転送せず、韓国用の `오늘의 운세`、`오늘 운세`、`운세` または `fortune=today` を同サービスで処理する。

## 占術家相談の有効化

`KR_OPENAI_API_KEY`、そのキーで使用可能な `KR_OPENAI_MODEL` が必要。
生成・配信には同じDB/LINE/OpenAI設定を持つ定期実行環境で `cd kr && npm run worker` を5分ごとに実行する。
Render cronを新設する場合は追加費用を確認してから作成する。定期実行が動作確認できるまでは `KR_CONSULTATIONS_ENABLED=false` を維持。
受付を有効化する際は `KR_CONSULTATIONS_ENABLED=true`。
最初の2回は無料。確認ボタンを押して初めて回数を使い、結果は通常90〜120分後を目安に送る。
点術家選択で相談準備を開始し、30分間未操作なら入力待ちを解除。`종료` / `취소` で準備終了。
下書きの差し替えではIDを新しくし、古い確認・再入力ボタンを無効にする。
AI対話による相談整理・音声文字起こしは、この版では追加していない。

## 有料相談

既定では `KR_PAYMENTS_ENABLED=false`、金額0で決済を無効にする。
Web会員登録の `price_1UR3ArI5Ynb6jjsxN7A8vwjL` はここでは使用しない。
運営者が韓国ウォンの単発相談料金を決め、Stripe側の操作を自分で完了した後に、
`KR_CONSULTATION_PRICE_KRW`、`KR_STRIPE_SECRET_KEY`、`KR_STRIPE_WEBHOOK_SECRET` を設定する。
Webhook URLはこのRenderの `/webhooks/stripe`。`checkout.session.completed` と `checkout.session.expired` が必要。
`KR_PAYMENTS_ENABLED=true` の明示設定が必要。韓国用 metadata とKRW金額が一致する決済だけ処理する。
開発・接続確認時にStripe APIは呼ばない。

## 検証

`npm ci --include=dev && npm test`。DB隔離、匿名アクセス拒否、日付境界、同日再利用・競合、LINE署名、未設定決済拒否、セッション失効を検証。
