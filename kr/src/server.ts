import express from "express";
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
  } catch { console.error("Korean LINE webhook processing failed"); res.sendStatus(500); }
});
app.post("/webhooks/stripe", express.raw({ type: "application/json", limit: "1mb" }), async (req, res) => {
  if (!config.paymentsEnabled) { res.sendStatus(503); return; }
  const signature = req.header("stripe-signature");
  if (!signature || !Buffer.isBuffer(req.body)) { res.sendStatus(400); return; }
  try {
    const event = stripe.webhooks.constructEvent(req.body, signature, config.stripeWebhookSecret);
    await handleStripeEvent(event); res.sendStatus(200);
  } catch { console.error("Korean Stripe webhook processing failed"); res.sendStatus(400); }
});
app.get("/health", async (_req, res) => {
  try {
    const result = await pool.query<{ schema: string }>("SELECT current_schema() AS schema");
    if (result.rows[0]?.schema !== "line_kr") throw new Error("Wrong schema");
    res.json({ ok: true, locale: "ko-KR", timezone: "Asia/Seoul", consultationsReady: config.consultationsEnabled, paymentsReady: config.paymentsEnabled });
  } catch { res.status(503).json({ ok: false }); }
});
app.get("/payment/success", (_req, res) => res.type("html").send(`<!doctype html><html lang="ko-KR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>결제 완료</title><body style="font-family:sans-serif;padding:32px;line-height:1.8"><h1>결제를 접수했습니다</h1><p>결제가 확인되면 LINE으로 접수 안내를 보내 드립니다. LINE으로 돌아가 잠시 기다려 주세요.</p></body></html>`));
app.get("/payment/cancel", (_req, res) => res.type("html").send(`<!doctype html><html lang="ko-KR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>결제 취소</title><body style="font-family:sans-serif;padding:32px;line-height:1.8"><h1>결제가 완료되지 않았습니다</h1><p>LINE으로 돌아가 결제 버튼을 다시 열 수 있습니다.</p></body></html>`));
export function startServer() {
  const server = app.listen(config.port, () => console.log(`Korean service listening on port ${config.port}`));
  const shutdown = () => server.close(async () => { await pool.end(); process.exit(0); });
  process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
  return server;
}
