import "dotenv/config";
import express from "express";

const required = ["KR_DATABASE_URL", "LINE_KR_CHANNEL_SECRET", "LINE_KR_CHANNEL_ACCESS_TOKEN"];
export const missing = required.filter(name => !process.env[name]?.trim());
if (!missing.length) {
  const { startServer } = await import("./server.js");
  startServer();
} else {
  const app = express();
  app.get("/health", (_req,res) => res.status(503).json({ok:false,locale:"ko-KR",status:"configuration_required",missing}));
  app.post(["/webhooks/line","/webhooks/stripe"], (_req,res) => res.sendStatus(503));
  const server = app.listen(Number(process.env.PORT ?? 3000), () => console.log("Korean service awaiting configuration: " + missing.join(", ")));
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
}
