# 日本版workerのビルド・配備互換性の修正

## 変更する挙動

- 会話テーマの組を固定長で推論させ、厳密な型チェックのビルドエラーを解消する。
- workerの先頭でmigration 009と必要な列の存在・型を確認する。不整合なら相談の削除、ジョブ取得、生成、送信の前に非ゼロ終了する。
- LINEのpush再試行で409と`x-line-accepted-request-id`が返った場合、受理済みとして扱う。それ以外の409やReplyの409は成功扱いしない。
- lockfileと`npm ci`を使い、同じ依存関係でビルドする。CIは本番の秘密情報を使わない。

## 検証

```bash
npm ci --include=dev
npm run check
npm run build
npm test
```

テストはPGliteの実際のPostgreSQLエンジンと模擬HTTPを使用する。migration 001と009を適用し、既存下書き・無料枠の保持、確認の二重実行、他人の相談ID、古い確認ボタン、受付期限切れ、LINE受理済み再試行を確認する。

過去の007/008は特定の相談の救済を含むため、試験DBの初期化には使わない。このテストは全migrationの新規DBへの一括適用や、本番ネットワーク・TLS・複数workerの同時実行を検証したものではない。

## 読み取り専用の配備前確認

ビルド後、対象環境の`DATABASE_URL`と`DATABASE_SSL`で次を実行する。OpenAI・LINE・Stripeの認証情報は不要。

```bash
npm run check:schema
```

このコマンドは`BEGIN READ ONLY`内でメタデータとmigration記録だけを読み、必ず`ROLLBACK`する。接続先や秘密情報、相談本文は出力しない。SSL検証は有効で、必要なCAは`NODE_EXTRA_CA_CERTS`等で提供する。ローカルの隔離DBのみ`DATABASE_SSL=false`を使用できる。

成功は必要schemaの互換性だけを示す。LINE・Stripe・AI・エンドツーエンド動作の成功を意味しない。エラー時も、この確認コマンドがmigrationを適用することはない。

## 本番反映前に必要なこと

2026-11-05の読み取り時点では、日本本番はmigration 001〜008適用済み、009未適用で、生成待ちが1件あった。この修正だけで本番が復旧したとは扱わない。

1. 直前のWeb・workerのソース版とmigration履歴を再確認する。
2. 既存の生成待ち・失敗相談について、支払・無料枠・結果・送信の状態を照合し、再処理の方針を決める。
3. 既存のデータ救済migrationを無条件に再実行せず、009の追加と旧新コードの互換性を隔離環境で確認する。
4. DB変更、Web配備、定期worker切り替えを一つの変更計画にまとめる。
5. 本番反映が別途指示された範囲でのみ実行する。mainへ反映すると定期処理がそのコードを使用し、Renderの自動配備も起動し得る。
6. workerを正常化すると、既存の待機相談を生成・送信し得る。自動再処理に入る前に対象と方針を確認する。

追跡対象の`render.yaml`は`npm ci`へ変更しているが、Dashboardに手動で設定されたbuild commandを自動更新するものではない。実際の設定は本番反映計画で確認する。

Stripeの旧通知先の再有効化、アカウント移行、料金変更、返金、LINE設定、既存相談の再送はこの修正の対象外。

## 後続工程

次は共通Web会員ID・メール認証・市場/規約同意履歴の実装。その後、Stripeアカウントの役割を確定して資格同期へ進む。台湾・韓国の稼働ブランチは、この日本版修正で更新しない。

参考: [LINEの受理済み再試行の仕様](https://developers.line.biz/en/docs/messaging-api/retrying-api-request/)

## Rollout fence (migration 010)

Migration 010 adds `consultation_processing_holds` and `first_send_attempt_at`.
Every consultation already in queued_generation/generating/scheduled/sending at
migration time receives a `pre_rollout_review` hold. The consultation state,
question, answer, free allowance and paid credit are preserved. Both claim paths
exclude held rows. The previous failed consultation remains failed.

After a first delivery attempt, jobs older than 23 hours are held for individual
review before retrying; LINE's retry-key acceptance window is 24 hours. This does
not infer delivery, refund automatically, or mint a fresh retry key.

Preflight now requires both 009 and 010 plus their columns. Deploy the paired
Web/worker revision; the existing JP Render start command runs migrations before
serving. The verified production migration ledger already contains 001–008, so
007/008 must not be replayed. Do not apply the complete historical set to a fresh
production database without reviewing those customer-specific repair scripts.

For each hold, inspect payment/free entitlement and the LINE acceptance/delivery
record privately, then record a disposition. Removing a hold can cause a real
message on the next worker run and requires a specific decision. No hold-release
endpoint or automatic release is shipped. Monitoring must track held counts in
addition to a green workflow. Source rollback does not remove the additive tables
or release the holds; never run an older worker which ignores holds.

## Scheduler health follow-up

Migration 011 stores only aggregate run timestamps in `worker_health`. The worker
holds a session advisory lock for its full run across scheduler providers. A
separate `/health/worker` endpoint returns 503 after 15 minutes without a successful
run, on a newer failed run, or for unheld overdue queued work. Web readiness
`/health` remains separate so a late scheduler cannot cause web restart loops.
A GitHub health workflow reports failure through the existing Actions mechanism;
its schedule has the same delivery limitations as other GitHub schedules.

`ops/render-worker.yaml` is an opt-in standalone Cron definition. It is NOT added
to the root Blueprint and has not provisioned a service. Approval of Render's
minimum $1/month plus runtime charges is required before provisioning. Populate
only JP service secrets, verify the target database and 011, then observe several
five-minute runs before disabling the GitHub processing schedule. The DB lock
protects overlap during cutover. Keep migration 010 holds in place. Run success
is not proof that every consultation was delivered; review queue health and holds.
