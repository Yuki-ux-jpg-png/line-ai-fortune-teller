# 最短セットアップ

1. このフォルダの中身を、GitHubリポジトリの直下へ全部アップロードします。
2. Renderで「New → Blueprint」を開き、そのGitHubリポジトリを選択します。
3. Renderから要求される環境変数へ、LINE・OpenAI・Stripeのキーを入力します。
4. LINE DevelopersのWebhook URLを次に設定します。

   `https://あなたのRender URL/webhooks/line`

5. StripeのWebhook URLを次に設定し、`checkout.session.completed`を購読します。

   `https://あなたのRender URL/webhooks/stripe`

6. LINE公式アカウントへ「占い師を選ぶ」と送ってテストします。

詳しい手順は `README.md` を参照してください。
