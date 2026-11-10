import express from "express";
import {verifyOperationsToken} from "./web-operations-auth.js";
import {enqueueWebNotifications,deliverWebNotifications,verifyNotificationConfiguration} from "./web-notifications.js";
import {webOperations} from "./web-operations.js";
const router=express.Router();
router.post("/", async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    await verifyOperationsToken(
      (req.header("authorization") ?? "").replace(/^Bearer /, ""),
    );
  } catch {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    if (process.env.WEB_CONSULTATION_ENABLED !== "true") {
      res.json({ disabled: 1 });
      return;
    }
    await enqueueWebNotifications();
    const emailAuthorization =
      req.header("x-email-delivery-authorization") ?? "";
    await deliverWebNotifications(emailAuthorization);
    const preflight =
      req.query.preflight === "1"
        ? await verifyNotificationConfiguration(emailAuthorization)
        : {};
    res.json({ ...(await webOperations()), ...preflight });
  } catch {
    console.error("web_operations_failed");
    res.status(503).json({ error: "Operations require attention" });
  }
});

export {router as webOperationsRouter};
