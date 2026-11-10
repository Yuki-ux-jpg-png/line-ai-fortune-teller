// Short-lived, audience-bound GitHub identity. Never print tokens or provider responses.
import { appendFile } from "node:fs/promises";
const services = {jp:"https://line-fortune-bot-zs2z.onrender.com",tw:"https://line-fortune-bot-tw.onrender.com",kr:"https://line-fortune-bot-kr.onrender.com"};
const mailAudience =
  "https://ibasho-kokoro.vercel.app/api/member/notification-email";
async function identityFor(aud) {
  const url = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
  if (url.protocol !== "https:") throw new Error("OIDC_URL");
  url.searchParams.set("audience", aud);
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`,
    },
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  });
  if (!r.ok) throw new Error("OIDC_REQUEST");
  const { value } = await r.json();
  if (typeof value !== "string") throw new Error("OIDC_EMPTY");
  return value;
}
let failures = 0;
for (const [market, origin] of Object.entries(services)) {
try {
  if (market !== "jp") {
    const health = await fetch(origin+"/health", {signal:AbortSignal.timeout(20000),redirect:"error"});
    if (!health.ok) throw new Error("HEALTH_UNAVAILABLE");
    const state = await health.json();
    if (state.webReady !== true) {
      console.log("Web operations rollout pending", market);
      continue;
    }
  }
  const audience = origin+"/web/operations";
  const [value, mailValue] = await Promise.all([identityFor(audience),identityFor(mailAudience)]);
  const r = await fetch(audience+(process.env.GITHUB_EVENT_NAME === "workflow_dispatch" ? "?preflight=1" : ""), {
    method:"POST",
    headers:{Authorization:`Bearer ${value}`,"x-email-delivery-authorization":`Bearer ${mailValue}`},
    signal:AbortSignal.timeout(90000),redirect:"error",
  });
  if (!r.ok) {console.error("Web operations HTTP status",market,r.status);throw new Error("OPERATIONS_UNAVAILABLE");}
  const result = await r.json();
  // Only numeric operational aggregates may leave the service.
  const counts = Object.fromEntries(Object.entries(result).filter(([,v])=>typeof v === "number" && Number.isFinite(v)));
  console.log("Web operations completed",market,counts);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
    `## 相談運営レポート (${market})\n\n${Object.entries(counts).map(([k,v])=>`- ${k}: ${v}`).join("\n")}\n`);
} catch {
  console.error("Web operations failed. Check service health and notification backlog.",market);
  failures++;
}
}
if (failures) process.exitCode = 1;
