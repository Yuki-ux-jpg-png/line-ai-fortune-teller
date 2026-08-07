import express from "express";
import { config } from "./config.js";
import { pool } from "./db.js";
import { verifyLineSignature } from "./line.js";
import { stripe } from "./payments.js";
import type {
  LineEvent,
  LinePostbackEvent,
  LineTextMessageEvent,
  LineWebhookBody,
} from "./types.js";
import { handleLineEvent, handleStripeEvent } from "./webhook.js";

const app = express();

function isLegacyFortuneEvent(event: LineEvent): boolean {
  if (
    event.type === "message" &&
    (event as LineTextMessageEvent).message?.type === "text"
  ) {
    const text = (event as LineTextMessageEvent).message.text.trim();
    return text === "占い" || text === "今日の占い";
  }

  return (
    event.type === "postback" &&
    (event as LinePostbackEvent).postback?.data === "fortune=today"
  );
}

async function forwardToLegacyFortuneWebhook(
  rawBody: Buffer,
  lineSignature: string,
): Promise<void> {
  const url = config.legacyFortuneWebhookUrl;
  if (!url) {
    throw new Error("LEGACY_FORTUNE_WEBHOOK_URL が設定されていません");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-line-signature": lineSignature,
      },
      // Node/TypeScript の fetch 型定義では Buffer を BodyInit として
      // 受け付けないため、元のUTF-8本文を文字列としてそのまま転送する。
      body: rawBody.toString("utf8"),
      signal: controller.signal,
    });

    if (!response.ok) {
      const details = await response.text();
      throw new Error(
        `既存Vercel Webhookへの転送に失敗しました: ${response.status} ${details}`,
      );
    }
  } finally {
    clearTimeout(timeout);
  }
}

app.post(
  "/webhooks/line",
  express.raw({ type: "application/json", limit: "1mb" }),
  async (req, res) => {
    const rawBody = req.body as Buffer;
    const signature = req.header("x-line-signature") ?? "";

    if (!Buffer.isBuffer(rawBody) || !verifyLineSignature(rawBody, signature)) {
      res.sendStatus(401);
      return;
    }

    let payload: LineWebhookBody;
    try {
      payload = JSON.parse(rawBody.toString("utf8")) as LineWebhookBody;
    } catch {
      res.sendStatus(400);
      return;
    }

    const events = payload.events ?? [];
    const containsLegacyFortuneEvent = events.some(isLegacyFortuneEvent);

    try {
      // 「占い」「今日の占い」「fortune=today」は既存Vercelへ転送する。
      // 既存Vercel側のコード変更は不要。
      if (containsLegacyFortuneEvent) {
        await forwardToLegacyFortuneWebhook(rawBody, signature);
      }

      // 上記の旧機能イベントはRenderでは処理しない。
      // それ以外だけを新しい有料相談機能へ渡す。
      for (const event of events) {
        if (isLegacyFortuneEvent(event)) continue;
        await handleLineEvent(event);
      }

      res.sendStatus(200);
    } catch (error) {
      console.error("LINE webhook routing error", error);
      res.sendStatus(500);
    }
  },
);

app.post(
  "/webhooks/stripe",
  express.raw({ type: "application/json", limit: "1mb" }),
  async (req, res) => {
    const signature = req.header("stripe-signature");
    if (!signature || !Buffer.isBuffer(req.body)) {
      res.sendStatus(400);
      return;
    }

    try {
      const event = stripe.webhooks.constructEvent(
        req.body,
        signature,
        config.stripeWebhookSecret,
      );
      await handleStripeEvent(event);
      res.sendStatus(200);
    } catch (error) {
      console.error("Stripe webhook error", error);
      res.status(400).send("Webhook Error");
    }
  },
);

app.use(express.json({ limit: "100kb" }));

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch (error) {
    console.error("health check failed", error);
    res.status(503).json({ ok: false });
  }
});

app.get("/payment/success", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>お支払い完了</title><body style="font-family:sans-serif;padding:32px;line-height:1.8">
<h1>お支払いを受け付けました</h1><p>決済確認後、LINEに受付メッセージを送ります。LINEへ戻ってお待ちください。</p>
</body></html>`);
});

app.get("/payment/cancel", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>お支払いキャンセル</title><body style="font-family:sans-serif;padding:32px;line-height:1.8">
<h1>お支払いは完了していません</h1><p>LINEへ戻ると、もう一度決済ボタンを表示できます。</p>
</body></html>`);
});

const server = app.listen(config.port, () => {
  console.log(`Server listening on port ${config.port}`);
});

async function shutdown(signal: string) {
  console.log(`${signal} received; shutting down`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
