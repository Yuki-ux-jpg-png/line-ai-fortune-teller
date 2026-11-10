import express from "express";
import { pathToFileURL } from "node:url";
import { config } from "./config.js";
import { pool } from "./db.js";
import { verifyLineSignature } from "./line.js";
import { stripe } from "./payments.js";
import { handleLineEvent, handleStripeEvent } from "./webhook.js";
import { handleDailyFortuneEvent, isDailyFortuneEvent } from "./daily.js";
import type { LineWebhookBody } from "./types.js";
export const app = express();
app.post("/webhooks/line", express.raw({ type: "application/json", limit: "1mb" }), async (req, res) => {
  const raw = req.body as Buffer;
  if (!Buffer.isBuffer(raw) || !verifyLineSignature(raw, req.header("x-line-signature") ?? "")) { res.sendStatus(401); return; }
  let payload: LineWebhookBody;
  try {
    payload = JSON.parse(raw.toString("utf8")) as LineWebhookBody;
    if (!payload || !Array.isArray(payload.events) || payload.events.some(e => !e || typeof e.type !== "string")) throw new Error("Invalid events");
  } catch { res.sendStatus(400); return; }
  try {
    for (const event of payload.events) {
      if (isDailyFortuneEvent(event)) await handleDailyFortuneEvent(event);
      else await handleLineEvent(event);
    }
    res.sendStatus(200);
  } catch { console.error("Taiwan LINE webhook processing failed"); res.sendStatus(500); }
});
app.post("/webhooks/stripe", express.raw({ type: "application/json", limit: "1mb" }), async (req, res) => {
  if (!config.stripeWebhookSecret) { res.sendStatus(503); return; }
  const signature = req.header("stripe-signature");
  if (!signature || !Buffer.isBuffer(req.body)) { res.sendStatus(400); return; }
  try {
    const event = stripe.webhooks.constructEvent(req.body, signature, config.stripeWebhookSecret);
    await handleStripeEvent(event); res.sendStatus(200);
  } catch { console.error("Taiwan Stripe webhook processing failed"); res.sendStatus(400); }
});
app.get("/health", async (_req, res) => {
  try {
    const result = await pool.query<{ schema: string }>("SELECT current_schema() AS schema");
    if (result.rows[0]?.schema !== "line_tw") throw new Error("Wrong schema");
    res.json({ ok: true, locale: "zh-TW", timezone: "Asia/Taipei", paymentsReady: Boolean(config.stripeWebhookSecret) });
  } catch { res.status(503).json({ ok: false }); }
});
app.get("/payment/success", (_req, res) => res.type("html").send(`<!doctype html><html lang="zh-TW"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>付款完成</title><body style="font-family:sans-serif;padding:32px;line-height:1.8"><h1>已收到付款</h1><p>付款確認後，我們會透過LINE傳送受理訊息。請回到LINE稍候。</p></body></html>`));
app.get("/payment/cancel", (_req, res) => res.type("html").send(`<!doctype html><html lang="zh-TW"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>付款取消</title><body style="font-family:sans-serif;padding:32px;line-height:1.8"><h1>付款尚未完成</h1><p>請回到LINE，即可再次開啟付款按鈕。</p></body></html>`));
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = app.listen(config.port, () => console.log(`Taiwan service listening on port ${config.port}`));
  const shutdown = () => server.close(async () => { await pool.end(); process.exit(0); });
  process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
}
