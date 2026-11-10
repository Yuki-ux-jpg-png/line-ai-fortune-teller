# 台灣LINE官方帳號：讓人生更自在的聚會所

日本語の運用メモです。対象LINE公式アカウントは `@774xqpeh`。現行の日本版Renderサービス `line-fortune-bot` と分離して配備します。

## 実装

- `tw/` だけを専用のRender Web Serviceとして配備。日本版ルート、mainブランチ、既存Render Blueprintは変更しない。
- `/webhooks/line` が台湾LINE署名だけを検証する。日本版の認証情報へフォールバックしない。
- 「占卜」「今日運勢」「今日占卜」「運勢」「抽籤」または `fortune=today` で日替わり占い。Supabase `public.fortunes_tw` のユーザー・日付一意制約で同じ日の再抽選を防止。
- 日替わり判定・相談システムの日次上限は `Asia/Taipei`。日本時間の23時から台湾時間の24時までを別の日として扱わない。
- 「選擇占卜師」で元と同じ3人の選択カード。確認・書き直し・無料相談・有料相談・結果配信の構成を保ち、文章とAI指示を台湾繁體字へ翻訳。
- 相談DBは専用の `line_tw` スキーマ。検索先に `public` を含めない。日本版の修復マイグレーションやデータをコピーしない。
- Stripe商品種別・locale・冪等キーは台湾専用。日本版の決済イベントをDB書き込み前に無視する。
- 元の価格は500 **日圓（JPY）**。新台幣へ換算したり値上げしたりしない。台湾の価格・通貨を変更したい場合は別途指定する。
- 占い師の名前・紹介の経歴数値・画像は既存ソースに基づく。元の3人の構成を保つ。

## 接続前に必要な設定

```text
LINE_TW_CHANNEL_SECRET=<台湾LINEチャネルのシークレット>
LINE_TW_CHANNEL_ACCESS_TOKEN=<台湾LINEチャネルのトークン>
SUPABASE_URL=https://fffliyqwsbbbqgibezgw.supabase.co
SUPABASE_SECRET_KEY=<Supabaseサーバー用キー>
TW_DATABASE_URL=<line_twだけを操作できる専用DBユーザーの接続URL>
TW_DATABASE_SSL=true
TW_OPENAI_API_KEY=<台湾サービス用のOpenAIキー>
TW_OPENAI_MODEL=<アカウントで使用可能なResponses対応モデル>
TW_STRIPE_SECRET_KEY=<台湾サービス用のStripeキー>
TW_STRIPE_WEBHOOK_SECRET=<台湾専用Stripeエンドポイントの署名シークレット>
TW_APP_BASE_URL=<新しい台湾RenderサービスのURL>
TZ=Asia/Taipei
```

キーはGitHubへコミットせず、Renderの環境変数に設定する。日本版LINEシークレット・トークンはコピーしない。既存のSupabaseやOpenAIのキーを新サービスに設定するには、その利用範囲を確認する。DBの専用ユーザーとStripeの台湾専用Webhookエンドポイントも必要。

最初のWeb Service配備では、`TW_APP_BASE_URL` を省略するとRenderの `RENDER_EXTERNAL_URL` を利用する。`TW_STRIPE_WEBHOOK_SECRET` が未設定でも日替わり・無料相談の起動確認は可能だが、Stripe Webhookは503を返し、Checkoutの作成も拒否する。台湾専用のStripeエンドポイント作成後に署名シークレットを設定して有料決済を有効にする。Workerには確定した `TW_APP_BASE_URL` を明示する。

相談DBはSupabaseの専用 `line_tw` スキーマと `line_tw_app` ロールを使用する。DB管理者が先にスキーマ・USAGE/CREATE権限を準備する。`provision.sql` はその例で、アプリのマイグレーションはデータベース全体のCREATE権限を必要としない。パスワードは手動で安全に設定し、通常の公開URLやチャットへ貼らない。

## Render設定

| 項目 | 値 |
|---|---|
| Repository | Yuki-ux-jpg-png/line-ai-fortune-teller |
| Branch | taiwan-line-bot |
| Service | line-fortune-bot-tw |
| Root Directory | tw |
| Region | Singapore |
| Plan | Free |
| Build | npm ci --include=dev && npm run build |
| Start | npm run migrate && npm start |
| Health Check | /health |
| LINE Webhook | 台湾サービスURL + /webhooks/line |
| Stripe Webhook | 台湾サービスURL + /webhooks/stripe |

`tw/render.yaml` を独立したBlueprintとして使う。既存ルートのrender.yamlへ置き換えたり追記したりしない。

## 結果配信Worker

受付から90〜120分後の結果配信は `npm run worker` を5分間隔で実行する。Webサービスを配備しただけではWorkerは自動実行されない。無料Webサービスのスリープに依存してタイマーを動かす方式は採らない。

`render-worker.example.yaml` はRender Cronの候補。Cronは最低月額1米ドルに加え、実行時間に応じた従量料金があるため、作成前に料金を確認する。あるいは独立したGitHub Actions定時実行基盤へ台湾専用Secretsを設定する。既存日本版のWorkflow・Secretsは変更しない。

## 検証

```sh
npm ci --include=dev
npm test
```

署名分離、台湾の日付境界、日替わりの同日再利用・競合、メニューと日替わりの混在イベント、再送、Stripeイベント分離、環境変数分離、zh-TW表示、実PostgreSQLエンジンでのスキーマ分離・一意制約を検証。テストはダミーキーのみで、外部LINE・Stripe・OpenAIへ送信しない。

現在はコード準備段階。本番の環境変数、DB権限、Worker、Stripe Webhook、LINEのWebhook設定と実機返信を完了するまで、配備・接続済みとは扱わない。

## 2026-10-04 検証結果と配備状態

`npm test` は11件すべて成功。実SQLによる台湾専用ロールの日本版テーブルへのアクセス拒否も確認しました。本番DBへのSQL実行は行っていません。

台湾版の本番サービス、認証情報、DB権限、Worker、Stripe Webhook、LINE Webhookの接続は未完了です。既存日本版のコード・認証情報・稼働中Renderサービスを変更せず、台湾版ブランチのtwフォルダだけを配備してください。

## 2026-10-05 起動準備

台湾LINE・Supabaseキーと、ユーザーが共用を明示承認したOpenAI・Stripeキーを台湾版Render環境変数グループへ保存済み。相談用Supabaseスキーマ・専用ロールと接続URLはユーザーが設定し、管理者権限なし・台湾領域のUSAGE/CREATE権限ありを確認した。`npm test` は13件成功し、専用ロールでのマイグレーションと、署名シークレット未設定時の決済拒否を検証した。実サービスの配備・Webhook接続は、設定値を保存しただけでは完了と扱わない。
