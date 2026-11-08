import crypto from "node:crypto";
import * as webpush from "web-push";
import nodemailer from "nodemailer";
import { query, withTransaction } from "./db.js";
import { WebError, type WebMember } from "./web-auth.js";
export function pushConfiguration() {
  return {
    publicKey: process.env.WEB_PUSH_PUBLIC_KEY || "",
    enabled: !!(
      process.env.WEB_PUSH_PUBLIC_KEY && process.env.WEB_PUSH_PRIVATE_KEY
    ),
    emailEnabled: !!(
      process.env.WEB_SMTP_USER && process.env.WEB_SMTP_PASSWORD
    ),
  };
}
export function validatedSubscription(raw: unknown) {
  const s = raw as {
    endpoint?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown };
  };
  if (
    !s ||
    typeof s.endpoint !== "string" ||
    s.endpoint.length > 2048 ||
    typeof s.keys?.auth !== "string" ||
    typeof s.keys?.p256dh !== "string"
  )
    throw new WebError(400, "通知の登録情報を確認してください。");
  let u: URL;
  try {
    u = new URL(s.endpoint);
  } catch {
    throw new WebError(400, "通知先を確認してください。");
  }
  const allowed =
    [
      "fcm.googleapis.com",
      "updates.push.services.mozilla.com",
      "web.push.apple.com",
    ].includes(u.hostname) ||
    /^[a-z0-9-]+\.notify\.windows\.com$/.test(u.hostname);
  if (
    !allowed ||
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.port ||
    u.hash ||
    !u.pathname.startsWith("/") ||
    !/^[A-Za-z0-9_-]{87}$/.test(s.keys.p256dh) ||
    !/^[A-Za-z0-9_-]{22}$/.test(s.keys.auth)
  )
    throw new WebError(400, "この通知先は登録できません。");
  return {
    endpoint: s.endpoint,
    keys: { p256dh: s.keys.p256dh, auth: s.keys.auth },
  };
}
export async function notificationAction(
  member: WebMember,
  action: string,
  p: Record<string, unknown>,
) {
  if (action === "preferences" && p.emailEnabled === undefined) {
    const r = await query(
      "SELECT email_enabled FROM web_notification_preferences WHERE web_user_id=$1",
      [member.id],
    );
    return {
      ...pushConfiguration(),
      emailOptIn: r.rows[0]?.email_enabled === true,
    };
  }
  await query(
    "INSERT INTO web_identities(web_user_id) VALUES($1) ON CONFLICT DO NOTHING",
    [member.id],
  );
  if (action !== "unsubscribe") {
    if (
      typeof p.notificationToken !== "string" ||
      !(await eligiblePreferenceUser(member.id, p.notificationToken))
    )
      throw new WebError(
        403,
        "通知への同意を確認できません。画面からもう一度設定してください。",
      );
    await query(
      `INSERT INTO web_notification_preferences(web_user_id,email,verification_token) VALUES($1,$2,$3)
      ON CONFLICT(web_user_id) DO UPDATE SET email=EXCLUDED.email,verification_token=EXCLUDED.verification_token`,
      [member.id, member.email, p.notificationToken],
    );
  }
  if (action === "preferences") {
    if (
      typeof p.emailEnabled !== "boolean" ||
      (p.emailEnabled && !pushConfiguration().emailEnabled)
    )
      throw new WebError(400, "メール通知の利用状態を確認してください。");
    await query(
      `UPDATE web_notification_preferences SET email_enabled=$2,updated_at=now() WHERE web_user_id=$1`,
      [member.id, p.emailEnabled],
    );
    return { ok: true };
  }
  if (action === "subscribe") {
    if (!pushConfiguration().enabled)
      throw new WebError(503, "端末通知は準備中です。");
    const subscription = validatedSubscription(p.subscription),
      hash = crypto
        .createHash("sha256")
        .update(subscription.endpoint)
        .digest("hex");
    await withTransaction(async (c) => {
      await c.query(
        "SELECT web_user_id FROM web_identities WHERE web_user_id=$1 FOR UPDATE",
        [member.id],
      );
      const n = await c.query(
        "SELECT count(*)::int AS n FROM web_push_subscriptions WHERE web_user_id=$1",
        [member.id],
      );
      if (n.rows[0].n >= 5)
        throw new WebError(
          409,
          "端末通知は5件までです。不要な端末の通知を停止してください。",
        );
      const r = await c.query(
        `INSERT INTO web_push_subscriptions(endpoint_hash,web_user_id,subscription) VALUES($1,$2,$3::jsonb)
        ON CONFLICT(endpoint_hash) DO UPDATE SET subscription=EXCLUDED.subscription WHERE web_push_subscriptions.web_user_id=EXCLUDED.web_user_id RETURNING endpoint_hash`,
        [hash, member.id, JSON.stringify(subscription)],
      );
      if (!r.rowCount)
        throw new WebError(
          409,
          "この端末は別の会員で登録済みです。先に通知を停止してください。",
        );
    });
    return { ok: true };
  }
  if (action === "unsubscribe") {
    if (p.all === true)
      await query("DELETE FROM web_push_subscriptions WHERE web_user_id=$1", [
        member.id,
      ]);
    else {
      if (typeof p.endpoint !== "string")
        throw new WebError(400, "通知先を確認してください。");
      await query(
        "DELETE FROM web_push_subscriptions WHERE web_user_id=$1 AND endpoint_hash=$2",
        [
          member.id,
          crypto.createHash("sha256").update(p.endpoint).digest("hex"),
        ],
      );
    }
    return { ok: true };
  }
  throw new WebError(404, "この操作は利用できません。");
}
async function eligiblePreferenceUser(
  id: string,
  token: string,
): Promise<boolean> {
  // Server-only RPC returns eligibility, never trusts cached profile claims.
  // A privacy/suspension change must prevent later background delivery too.
  const origin = process.env.WEB_MEMBER_SUPABASE_URL,
    key = process.env.WEB_MEMBER_PUBLISHABLE_KEY;
  if (!origin || !key) return false;
  if (!/^[a-f0-9]{64}$/.test(token)) return false;
  const r = await fetch(`${origin}/rest/v1/rpc/kb_notification_eligible`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ subject: id, receipt: token }),
    signal: AbortSignal.timeout(10000),
    redirect: "error",
  });
  if (!r.ok) throw new Error("NOTIFICATION_ELIGIBILITY_UNAVAILABLE");
  return (await r.json()) === true;
}
export async function enqueueWebNotifications() {
  // Only notices generated AFTER explicit opt-in are eligible.
  await query(`INSERT INTO web_notification_outbox(notice_id,web_user_id,target,channel)
    SELECT n.id,i.web_user_id,s.endpoint_hash,'push' FROM web_notices n JOIN consultations c ON c.id=n.consultation_id
    JOIN web_identities i ON i.canonical_user_id=c.line_user_id JOIN web_push_subscriptions s ON s.web_user_id=i.web_user_id
    WHERE n.created_at>=s.created_at AND n.read_at IS NULL ON CONFLICT DO NOTHING`);
  await query(`INSERT INTO web_notification_outbox(notice_id,web_user_id,target,channel)
    SELECT n.id,i.web_user_id,'email','email' FROM web_notices n JOIN consultations c ON c.id=n.consultation_id
    JOIN web_identities i ON i.canonical_user_id=c.line_user_id JOIN web_notification_preferences p ON p.web_user_id=i.web_user_id
    WHERE p.email_enabled AND n.created_at>=p.updated_at AND n.read_at IS NULL ON CONFLICT DO NOTHING`);
}
export async function deliverWebNotifications() {
  await query(
    "UPDATE web_notification_outbox SET status='failed',lease_until=NULL WHERE status='sending' AND lease_until<now() AND attempts>=6",
  );
  for (let i = 0; i < 2; i++) {
    const job = await withTransaction(async (c) => {
      const r = await c.query(`SELECT id FROM web_notification_outbox WHERE
        ((status='pending' AND next_at<=now()) OR (status='sending' AND lease_until<now())) AND attempts<6
        ORDER BY next_at LIMIT 1 FOR UPDATE SKIP LOCKED`);
      const id = r.rows[0]?.id;
      if (!id) return null;
      return (
        await c.query(
          `UPDATE web_notification_outbox SET status='sending',attempts=attempts+1,lease_until=now()+interval '5 minutes' WHERE id=$1 RETURNING *`,
          [id],
        )
      ).rows[0];
    });
    if (!job) break;
    try {
      const notice = await query(
        "SELECT read_at FROM web_notices WHERE id=$1",
        [job.notice_id],
      );
      let sent = false;
      const consent = await query(
        "SELECT verification_token FROM web_notification_preferences WHERE web_user_id=$1",
        [job.web_user_id],
      );
      if (
        notice.rows[0] &&
        !notice.rows[0].read_at &&
        consent.rows[0] &&
        (await eligiblePreferenceUser(
          job.web_user_id,
          consent.rows[0].verification_token,
        ))
      ) {
        const origin = process.env.WEB_MEMBER_APP_ORIGIN;
        if (origin !== "https://ibasho-kokoro.vercel.app")
          throw new Error("NOTIFICATION_ORIGIN");
        if (job.channel === "push") {
          const s = await query(
            "SELECT subscription FROM web_push_subscriptions WHERE endpoint_hash=$1 AND web_user_id=$2",
            [job.target, job.web_user_id],
          );
          if (s.rows[0]) {
            await webpush.sendNotification(
              s.rows[0].subscription,
              JSON.stringify({
                title: "こころの居場所",
                body: "会員エリアに新しいお知らせがあります。",
                url: "/member",
                tag: "kb-consultation",
              }),
              {
                TTL: 3600,
                timeout: 10000,
                topic: job.id.replaceAll("-", ""),
                vapidDetails: {
                  subject: `mailto:${process.env.WEB_SMTP_USER || "watana98.yu.ki5@gmail.com"}`,
                  publicKey: process.env.WEB_PUSH_PUBLIC_KEY!,
                  privateKey: process.env.WEB_PUSH_PRIVATE_KEY!,
                },
              },
            );
            sent = true;
          }
        } else {
          const p = await query(
            "SELECT email,email_enabled FROM web_notification_preferences WHERE web_user_id=$1",
            [job.web_user_id],
          );
          if (p.rows[0]?.email_enabled) {
            const transport = nodemailer.createTransport({
              host: "smtp.gmail.com",
              port: 587,
              secure: false,
              requireTLS: true,
              auth: {
                user: process.env.WEB_SMTP_USER,
                pass: process.env.WEB_SMTP_PASSWORD,
              },
              connectionTimeout: 10000,
              socketTimeout: 20000,
            });
            try {
              await transport.sendMail({
                from: {
                  name: "こころの居場所",
                  address: process.env.WEB_SMTP_USER!,
                },
                to: p.rows[0].email,
                subject: "会員エリアに新しいお知らせがあります",
                text: `会員エリアに新しいお知らせがあります。\n${origin}/member\n\n通知の停止は、ログイン後のAI占い相談画面から行えます。\nこのメールには返信できません。`,
                messageId: `<${job.id}@ibasho-kokoro.vercel.app>`,
              });
              sent = true;
            } finally {
              transport.close();
            }
          }
        }
      }
      await query(
        "UPDATE web_notification_outbox SET status=$2,lease_until=NULL WHERE id=$1",
        [job.id, sent ? "sent" : "cancelled"],
      );
    } catch (e) {
      const status = (e as { statusCode?: number })?.statusCode;
      if (job.channel === "push" && [404, 410].includes(status ?? 0)) {
        await query(
          "DELETE FROM web_push_subscriptions WHERE endpoint_hash=$1 AND web_user_id=$2",
          [job.target, job.web_user_id],
        );
        await query(
          "UPDATE web_notification_outbox SET status='cancelled',lease_until=NULL WHERE id=$1",
          [job.id],
        );
      } else
        await query(
          `UPDATE web_notification_outbox SET status=CASE WHEN attempts>=6 THEN 'failed' ELSE 'pending' END,
        next_at=now()+interval '5 minutes'*power(2,attempts),lease_until=NULL WHERE id=$1`,
          [job.id],
        );
      console.error("web_notification_delivery_retry");
    }
  }
}

export async function verifyNotificationConfiguration() {
  const settings = pushConfiguration();
  if (settings.enabled) {
    const key = crypto.createECDH("prime256v1");
    key.setPrivateKey(
      Buffer.from(process.env.WEB_PUSH_PRIVATE_KEY!, "base64url"),
    );
    if (key.getPublicKey().toString("base64url") !== settings.publicKey)
      throw new Error("VAPID_KEY_MISMATCH");
  }
  if (settings.emailEnabled) {
    const transport = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      requireTLS: true,
      auth: {
        user: process.env.WEB_SMTP_USER,
        pass: process.env.WEB_SMTP_PASSWORD,
      },
      connectionTimeout: 10000,
      socketTimeout: 15000,
    });
    try {
      await transport.verify();
    } finally {
      transport.close();
    }
  }
  return {
    smtpVerified: Number(settings.emailEnabled),
    pushConfigured: Number(settings.enabled),
  };
}
