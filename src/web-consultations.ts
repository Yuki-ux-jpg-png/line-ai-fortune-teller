import {webText} from "./web-locale.js";
import { webAmount, webCurrency, webPaymentsAvailable } from "./web-market.js";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import { query, withTransaction } from "./db.js";
import { config } from "./config.js";
import { authenticateWebMember, WebError, type WebMember } from "./web-auth.js";
import {
  webIdentity,
  startWebIdentity,
  createWebLink,
  webRateLimit,
} from "./web-identity.js";
import {
  listTellers,
  confirmConsultation,
  completeStripeCheckout,
  expireStripeCheckout,
} from "./consultations.js";
import {
  urgentSafetyConcern,
  followUpQuestion,
  summarizeIntake,
} from "./web-intake.js";
import { stripe } from "./payments.js";
import { transcribeWebAudio } from "./web-voice.js";
import { safetyMessage } from "./web-safety.js";
import { notificationAction } from "./web-notifications.js";
import { operationsOverview } from "./web-operations.js";
import { webCheckout } from "./web-checkout.js";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function text(value: unknown, max = config.maxQuestionChars): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    Array.from(value).length > max
  )
    throw new WebError(400, `${max}文字以内で入力してください。`);
  return value.trim();
}
async function owner(id: string): Promise<string> {
  const canonical = await webIdentity(id);
  if (!canonical)
    throw new WebError(
      409,
      "先に相談の利用開始またはLINE連携を完了してください。",
    );
  return canonical;
}
export async function webSnapshot(userId: string, before?: string) {
  const canonical = await webIdentity(userId);
  if (!canonical)
    return {
      initialized: false,
      freeRemaining: null,
      consultations: [],
      notices: [],
    };
  if (before && !uuid.test(before))
    throw new WebError(400, "履歴の続きを確認してください。");
  const user = await query<{ free_consultations_used: number }>(
    "SELECT free_consultations_used FROM users WHERE line_user_id=$1",
    [canonical],
  );
  const items = await query(
    `SELECT c.id,c.status,c.question,c.delivery_channel AS channel,c.created_at AS "createdAt",
    c.deliver_at AS "deliverAt",f.name AS teller,
    CASE WHEN c.status='sent' AND h.consultation_id IS NULL THEN c.answer ELSE NULL END AS answer,
    (h.consultation_id IS NOT NULL) AS held
    FROM consultations c JOIN fortune_tellers f ON f.id=c.teller_id
    LEFT JOIN consultation_processing_holds h ON h.consultation_id=c.id
    WHERE c.line_user_id=$1 AND ($2::uuid IS NULL OR (c.created_at,c.id)<
      (SELECT created_at,id FROM consultations WHERE id=$2 AND line_user_id=$1))
    ORDER BY c.created_at DESC,c.id DESC LIMIT 21`,
    [canonical, before ?? null],
  );
  const notices = await query(
    `SELECT n.id,n.kind,n.consultation_id AS "consultationId",n.read_at AS "readAt",n.created_at AS "createdAt"
    FROM web_notices n JOIN consultations c ON c.id=n.consultation_id
    WHERE c.line_user_id=$1 ORDER BY n.created_at DESC LIMIT 50`,
    [canonical],
  );
  return {
    initialized: true,
    linkedLine: !canonical.startsWith("web:"),
    freeRemaining: Math.max(
      0,
      config.freeConsultationLimit -
        (user.rows[0]?.free_consultations_used ?? config.freeConsultationLimit),
    ),
    consultations: items.rows.slice(0, 20),
    next: items.rows.length > 20 ? items.rows[19]?.id : null,
    notices: notices.rows,
  };
}
export async function saveWebDraft(
  canonical: string,
  tellerId: string,
  question: string,
  requestId: string,
) {
  return withTransaction(async (c) => {
    await c.query(
      "SELECT line_user_id FROM users WHERE line_user_id=$1 FOR UPDATE",
      [canonical],
    );
    const existing = await c.query(
      "SELECT id,status,delivery_channel FROM consultations WHERE line_user_id=$1 AND status IN ('draft','awaiting_payment','queued_generation','generating','scheduled','sending') FOR UPDATE",
      [canonical],
    );
    const old = existing.rows[0];
    if (old) {
      if (old.id === requestId && old.delivery_channel === "web")
        return { id: old.id };
      throw new WebError(
        409,
        "準備中・処理中の相談があります。履歴から確認してください。",
      );
    }
    // Reusing a submitted request ID never creates another consultation.
    const duplicate = await c.query(
      "SELECT id FROM consultations WHERE id=$1",
      [requestId],
    );
    if (duplicate.rowCount)
      throw new WebError(
        409,
        "この受付はすでに使用済みです。履歴をご確認ください。",
      );
    const teller = await c.query(
      "SELECT id FROM fortune_tellers WHERE id=$1 AND enabled=true",
      [tellerId],
    );
    if (!teller.rowCount)
      throw new WebError(400, "占い師を選び直してください。");
    await c.query(
      `INSERT INTO consultations(id,line_user_id,teller_id,question,status,delivery_channel)
      VALUES($1,$2,$3,$4,'draft','web')`,
      [requestId, canonical, tellerId, question],
    );
    return { id: requestId };
  });
}
export async function syncWebPayment(canonical: string, id: string) {
  const r = await query<{ stripe_session_id: string }>(
    `SELECT stripe_session_id FROM consultations
    WHERE id=$1 AND line_user_id=$2 AND delivery_channel='web' AND status='awaiting_payment'
      AND NOT EXISTS(SELECT 1 FROM consultation_processing_holds h WHERE h.consultation_id=consultations.id)`,
    [id, canonical],
  );
  const sid = r.rows[0]?.stripe_session_id;
  if (!sid) return;
  const session = await stripe.checkout.sessions.retrieve(sid);
  if (
    session.metadata?.consultation_id !== id ||
    session.metadata?.line_user_id !== canonical ||
    session.mode !== "payment"
  )
    throw new WebError(
      409,
      "決済情報の照合が必要です。重ねて支払わず運営へご相談ください。",
    );
  if (session.status === "complete" && session.payment_status === "paid")
    await completeStripeCheckout(`web_sync:${sid}`, session);
  if (session.status === "expired")
    await expireStripeCheckout(`web_expired:${sid}`, session);
}
export async function webAction(
  member: WebMember,
  action: string,
  p: Record<string, unknown>,
  ai = { urgentSafetyConcern, followUpQuestion, summarizeIntake },
) {
  if (action === "operations") {
    if (!member.staff) throw new WebError(403, "運営者の追加認証が必要です。");
    return operationsOverview();
  }
  if (["preferences", "subscribe", "unsubscribe"].includes(action)) {
    await webRateLimit(member.id, "notifications", 30);
    return notificationAction(member, action, p);
  }
  if (action === "status")
    return {
      ...(await webSnapshot(
        member.id,
        typeof p.before === "string" ? p.before : undefined,
      )),
      price: webAmount,
      currency: webCurrency,
      paymentsAvailable: webPaymentsAvailable,
      freeLimit: config.freeConsultationLimit,
      maxChars: config.maxQuestionChars,
      tellers: (await listTellers()).map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
      })),
      access: member.access,
    };
  if (action === "read") {
    const canonical = await owner(member.id);
    if (typeof p.id !== "string" || !uuid.test(p.id))
      throw new WebError(400, "通知を確認してください。");
    await query(
      `UPDATE web_notices n SET read_at=COALESCE(read_at,now()) FROM consultations c
      WHERE n.id=$1 AND n.consultation_id=c.id AND c.line_user_id=$2`,
      [p.id, canonical],
    );
    return { ok: true };
  }
  if (!member.access) throw new WebError(403, "有効な会員資格が必要です。");
  await webRateLimit(member.id, "operations", 60);
  if (action === "start") {
    await startWebIdentity(member.id);
    return { ok: true };
  }
  if (action === "link")
    return { code: await createWebLink(member.id), expiresIn: 600 };
  const canonical = await owner(member.id);
  if (action === "guided") {
    await webRateLimit(member.id, "ai", 10);
    if (!Array.isArray(p.turns) || p.turns.length < 1 || p.turns.length > 3)
      throw new WebError(400, "相談内容を確認してください。");
    const turns = p.turns.map((t) => text(t));
    if (await ai.urgentSafetyConcern(turns.join("\n")))
      return { safety: true, message: safetyMessage };
    if (p.finish === true || turns.length === 3)
      return { draft: await ai.summarizeIntake(turns) };
    return { question: await ai.followUpQuestion(turns) };
  }
  if (action === "draft") {
    await webRateLimit(member.id, "draft", 10);
    const question = text(p.question);
    const teller = text(p.tellerId, 100);
    if (typeof p.requestId !== "string" || !uuid.test(p.requestId))
      throw new WebError(400, "受付番号を確認してください。");
    if (await ai.urgentSafetyConcern(question))
      return { safety: true, message: safetyMessage };
    return saveWebDraft(canonical, teller, question, p.requestId);
  }
  if (typeof p.id !== "string" || !uuid.test(p.id))
    throw new WebError(400, "相談を選んでください。");
  const own = await query(
    `SELECT id,status FROM consultations WHERE id=$1 AND line_user_id=$2 AND delivery_channel='web'
    AND NOT EXISTS(SELECT 1 FROM consultation_processing_holds h WHERE h.consultation_id=consultations.id)`,
    [p.id, canonical],
  );
  if (!own.rowCount) throw new WebError(404, "この相談は操作できません。");
  if (action === "confirm") return confirmConsultation(canonical, p.id);
  if (action === "payment") {
    if (!webPaymentsAvailable) throw new WebError(503, "有料相談は準備中です。課金は発生していません。");
    await syncWebPayment(canonical, p.id);
    const row = await query(
      "SELECT status FROM consultations WHERE id=$1 AND line_user_id=$2",
      [p.id, canonical],
    );
    if (row.rows[0]?.status !== "awaiting_payment") return { paid: true };
    return webCheckout(p.id, canonical);
  }
  if (action === "sync") {
    await syncWebPayment(canonical, p.id);
    return { ok: true };
  }
  if (action === "cancel") {
    await query(
      "UPDATE consultations SET status='cancelled',updated_at=now() WHERE id=$1 AND line_user_id=$2 AND delivery_channel='web' AND status='draft'",
      [p.id, canonical],
    );
    return { ok: true };
  }
  throw new WebError(404, "この操作は利用できません。");
}
const router = express.Router();
router.use(async (req, res, next) => {
  res.set({
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  try {
    res.locals.member = await authenticateWebMember(
      req.header("authorization"),
    );
    next();
  } catch (e) {
    webError(res, e);
  }
});
function webError(res: Response, e: unknown) {
  if (e instanceof WebError) res.status(e.status).json({ error: e.message });
  else {
    console.error("web_consultation_failed");
    res.status(503).json({
      error: webText("処理を完了できませんでした。時間をおいて確認してください。"),
    });
  }
}
router.post(
  "/audio",
  express.raw({ type: () => true, limit: "10mb" }),
  async (req, res) => {
    try {
      const member = res.locals.member as WebMember;
      if (!member.access) throw new WebError(403, "有効な会員資格が必要です。");
      await owner(member.id);
      await webRateLimit(member.id, "audio", 5);
      if (req.header("x-audio-consent") !== "true")
        throw new WebError(400, "音声の文字起こしへの同意が必要です。");
      res.json(
        await transcribeWebAudio(
          req.body as Buffer,
          req.header("content-type") ?? "",
        ),
      );
    } catch (e) {
      webError(res, e);
    }
  },
);
router.post(
  "/:action",
  express.json({ limit: "8kb" }),
  async (req: Request, res: Response) => {
    try {
      if (
        !req.is("application/json") ||
        !req.body ||
        Array.isArray(req.body) ||
        typeof req.body !== "object"
      )
        throw new WebError(400, "入力形式を確認してください。");
      res.json(
        await webAction(
          res.locals.member as WebMember,
          String(req.params.action),
          req.body,
        ),
      );
    } catch (e) {
      webError(res, e);
    }
  },
);
router.use(
  (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = (error as { status?: number })?.status === 413 ? 413 : 400;
    res
      .status(status)
      .json({
        error:
          status === 413
            ? webText("入力が大きすぎます。")
            : webText("入力形式を確認してください。"),
      });
  },
);
export { router as webConsultationRouter };
