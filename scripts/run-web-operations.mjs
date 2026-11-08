// Short-lived, audience-bound GitHub identity. Never print tokens or provider responses.
import { appendFile } from "node:fs/promises";
const audience = "https://line-fortune-bot-zs2z.onrender.com/web/operations";
try {
  const url = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
  if (url.protocol !== "https:") throw new Error("OIDC_URL");
  url.searchParams.set("audience", audience);
  const identity = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`,
    },
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  });
  if (!identity.ok) throw new Error("OIDC_REQUEST");
  const { value } = await identity.json();
  if (typeof value !== "string") throw new Error("OIDC_EMPTY");
  const r = await fetch(
    audience +
      (process.env.GITHUB_EVENT_NAME === "workflow_dispatch"
        ? "?preflight=1"
        : ""),
    {
      method: "POST",
      headers: { Authorization: `Bearer ${value}` },
      signal: AbortSignal.timeout(90000),
      redirect: "error",
    },
  );
  if (!r.ok) throw new Error("OPERATIONS_UNAVAILABLE");
  const result = await r.json();
  console.log("Web operations completed", result);
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `## 相談運営レポート\n\n${Object.entries(result)
        .map(([k, v]) => `- ${k}: ${Number(v)}`)
        .join("\n")}\n`,
    );
} catch {
  console.error(
    "Web operations failed. Check service health and notification backlog.",
  );
  process.exitCode = 1;
}
