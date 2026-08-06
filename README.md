# LINE AI占いボット

LINE公式アカウント上で、占い師選択、無料相談1件、1件1,000円のStripe決済、AI鑑定、2〜3時間後のLINE配信を行うスターターです。

## 料金ルール

- 無料相談はLINEユーザー1人につき1件
- 4件目以降は、1,000円で相談チケット1枚
- チケット1枚につき、相談文1通と鑑定結果1通
- 有料会員を永久解放する仕組みではありません
- 同時に処理できる相談は1件
- 相談文は初期設定で500文字まで
- 相談確定は24時間に5件まで

## GitHubへ入れる場所

`line-fortune-bot`フォルダ内のファイルを、GitHubリポジトリの一番上へそのままアップロードします。

```text
あなたのGitHubリポジトリ/
├─ src/
├─ migrations/
├─ .github/
├─ package.json
├─ render.yaml
├─ README.md
└─ その他のファイル
```

フォルダをもう一段入れて、`あなたのリポジトリ/line-fortune-bot/package.json`にしないでください。`package.json`がリポジトリ直下に見える状態にします。

## 構成

- GitHub：コード保管
- Render Web Service：LINEとStripeのWebhook受付
- Render Cron Job：AI生成と2〜3時間後の送信
- Render PostgreSQL：無料回数、相談、決済、チケットを保存
- OpenAI API：鑑定文を生成
- Stripe Checkout：1件1,000円の決済

## Renderへのデプロイ

1. GitHubで空のリポジトリを作成します。
2. このプロジェクト一式をアップロードします。
3. Renderで `New` → `Blueprint` を選択します。
4. 作成したGitHubリポジトリを選択します。
5. `render.yaml`が読み込まれます。
6. 次の秘密情報を入力します。

```text
LINE_CHANNEL_SECRET
LINE_CHANNEL_ACCESS_TOKEN
OPENAI_API_KEY
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
APP_BASE_URL
```

`APP_BASE_URL`には、Renderで発行されたWeb ServiceのURLを指定します。

```text
https://line-fortune-bot-xxxx.onrender.com
```

初回作成時にURLがまだ分からない場合は、仮のHTTPS URLを入力してデプロイ後に正しい値へ変更してください。Web ServiceとCron Jobの両方で同じ値にします。

### Render料金について

同梱の`render.yaml`は、Web ServiceとPostgreSQLを検証用の無料プラン、Cron JobをStarterで作成します。Renderの無料PostgreSQLは期限や制限があるため、本番公開前に有料DBへ変更してください。無料Web Serviceのスリープも本番運用には不向きです。

## LINE Developersの設定

Messaging APIチャネルを作り、Webhook URLを次に設定します。

```text
https://あなたのRender URL/webhooks/line
```

設定後にWebhookを有効化します。LINE公式アカウント側の「あいさつメッセージ」と「応答メッセージ」は、ボットの返信と重複しないように必要に応じて無効化してください。

必要な値は次の場所から取得します。

- Channel secret → `LINE_CHANNEL_SECRET`
- Channel access token → `LINE_CHANNEL_ACCESS_TOKEN`

## Stripeの設定

StripeでWebhookエンドポイントを作ります。

```text
https://あなたのRender URL/webhooks/stripe
```

購読イベントは次です。

```text
checkout.session.completed
checkout.session.expired
```

- Stripe秘密鍵 → `STRIPE_SECRET_KEY`
- Webhook署名シークレット → `STRIPE_WEBHOOK_SECRET`

この実装は成功画面の表示だけでは支払い済みにしません。Stripeの署名付きWebhookを受け取った場合だけ、相談チケットを発行して相談処理を開始します。

## OpenAIの設定

OpenAI APIキーを`OPENAI_API_KEY`へ設定します。モデルは初期値で`gpt-5-mini`です。

```text
OPENAI_MODEL=gpt-5-mini
```

別の利用可能なモデルへ変更する場合は、Renderの環境変数を書き換えます。

## 占い師を変更する

初期占い師は次のSQLにあります。

```text
migrations/001_init.sql
```

初回デプロイ前なら、次を編集してください。

- `id`：内部ID。半角英数字推奨
- `name`：表示名
- `description`：一覧の説明
- `image_url`：HTTPS画像URL
- `system_prompt`：AI占い師の性格と回答方針

初回デプロイ後に`001_init.sql`だけを変更しても、同じマイグレーションは再実行されません。その場合は`migrations/002_update_tellers.sql`のような新しいSQLファイルを追加します。

画像は現在プレースホルダーです。公開前に、自分が利用権を持つ画像のHTTPS URLへ必ず変更してください。

## 動作確認

LINE公式アカウントを友だち追加し、次を送ります。

```text
占い師を選ぶ
```

動作の流れは次のとおりです。

1. 占い師を選ぶ
2. 相談文を送る
3. 「この内容で相談する」を押す
4. 最初の1件は無料枠を1件消費
5. 4件目以降はStripe決済ボタンを表示
6. AI回答を生成してDBへ保存
7. 相談確定または決済から2〜3時間後にLINEへ送信
8. 送信完了時に相談チケットを消費済みにする

## 主なファイル

```text
src/server.ts          Webサーバー、LINE・Stripe Webhook
src/webhook.ts         LINE上の会話フロー
src/consultations.ts   無料枠、相談チケット、状態管理
src/payments.ts        Stripe Checkout
src/ai.ts              OpenAIによる鑑定生成
src/worker.ts          AI生成と遅延配信
src/line.ts            LINEメッセージ送信・Flex Message
migrations/001_init.sql PostgreSQLテーブルと初期占い師
render.yaml            Render構成
```

## ローカル実行

Node.js 20以上とPostgreSQLが必要です。

```bash
cp .env.example .env
npm install
npm run build
npm run migrate
npm run dev
```

別ターミナルでワーカーを実行します。

```bash
npm run build
npm run worker
```

ローカルのWebhookをLINEやStripeから受けるには、HTTPSトンネルが必要です。

## コスト暴走対策

このスターターには次を入れています。

- 支払い1回につきチケット1枚
- チケットは相談1件だけに予約・消費
- 同一ユーザーの同時相談は1件
- LINEとStripeのWebhook重複処理防止
- 相談文の文字数制限
- ユーザーごとの24時間上限
- 1日あたりAI生成件数の全体上限
- AI生成は最大3回、LINE送信は最大5回まで再試行
- LINEでメッセージを送っただけではAIを呼ばず、確認ボタンを押した後だけ処理
- 会話履歴全体をAIへ渡さず、今回の相談だけを送信

上限は`.env.example`またはRenderの環境変数で変更できます。

## 公開前に必ず追加するもの

このコードは技術スターターです。公開前に次を整備してください。

- 特定商取引法に基づく表記
- 利用規約
- プライバシーポリシー
- キャンセル・返金条件
- AIによるエンターテインメント占いである旨の表示
- 個人情報の保存期間と削除手順
- Stripe返金・チャージバック時のチケット無効化処理
- 管理画面または緊急停止スイッチ
- 自傷、虐待、犯罪、医療、法律、投資相談への運用ルール
- 本番用画像と文言

実在の人間が個別に鑑定しているような表示は避け、AIが回答することと、通常2〜3時間以内に配信することを明記してください。
