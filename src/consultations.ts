import crypto from "node:crypto";
import type Stripe from "stripe";
import type { PoolClient } from "pg";
import { config, randomDeliveryDate } from "./config.js";
import { query, withTransaction } from "./db.js";

export type UserState =
  | "selecting_teller"
  | "awaiting_question"
  | "draft_ready"
  | "awaiting_payment"
  | "waiting_result";

export type UserRow = {
  line_user_id: string;
  selected_teller_id: string | null;
  state: UserState;
  free_consultations_used: number;
};

export type TellerRow = {
  id: string;
  name: string;
  description: string;
  image_url: string;
  system_prompt: string;
};

export type DraftResult =
  | { type: "saved"; consultationId: string }
  | { type: "no_teller" }
  | { type: "active"; status: string };

export type ConfirmResult =
  | {
      type: "accepted";
      entitlement: "free" | "paid";
      freeRemaining: number;
    }
  | { type: "needs_payment"; consultationId: string }
  | { type: "daily_limit" }
  | { type: "system_limit" }
  | { type: "invalid" }
  | { type: "already_processing" };

export async function ensureUser(lineUserId: string): Promise<UserRow> {
  const result = await query<UserRow>(
    `INSERT INTO users (line_user_id)
     VALUES ($1)
     ON CONFLICT (line_user_id)
     DO UPDATE SET updated_at = now()
     RETURNING line_user_id, selected_teller_id, state, free_consultations_used`,
    [lineUserId],
  );
  return result.rows[0]!;
}

export async function getUser(lineUserId: string): Promise<UserRow> {
  return ensureUser(lineUserId);
}

export async function listTellers(): Promise<TellerRow[]> {
  const result = await query<TellerRow>(
    `SELECT id, name, description, image_url, system_prompt
       FROM fortune_tellers
      WHERE enabled = TRUE
      ORDER BY sort_order, id`,
  );
  return result.rows;
}

export async function selectTeller(
  lineUserId: string,
  tellerId: string,
): Promise<"selected" | "not_found" | "active"> {
  return withTransaction(async (client) => {
    await client.query(
      `INSERT INTO users (line_user_id)
       VALUES ($1)
       ON CONFLICT (line_user_id) DO NOTHING`,
      [lineUserId],
    );

    const teller = await client.query(
      `SELECT id FROM fortune_tellers WHERE id = $1 AND enabled = TRUE`,
      [tellerId],
    );
    if (!teller.rowCount) return "not_found";

    const active = await client.query<{ status: string }>(
      `SELECT status
         FROM consultations
        WHERE line_user_id = $1
          AND status IN (
            'awaiting_payment', 'queued_generation', 'generating',
            'scheduled', 'sending'
          )
        LIMIT 1
        FOR UPDATE`,
      [lineUserId],
    );
    if (active.rowCount) return "active";

    await client.query(
      `UPDATE users
          SET selected_teller_id = $2,
              state = 'awaiting_question',
              updated_at = now()
        WHERE line_user_id = $1`,
      [lineUserId, tellerId],
    );

    await client.query(
      `UPDATE consultations
          SET teller_id = $2, updated_at = now()
        WHERE line_user_id = $1 AND status = 'draft'`,
      [lineUserId, tellerId],
    );

    return "selected";
  });
}

export async function saveDraft(
  lineUserId: string,
  question: string,
): Promise<DraftResult> {
  return withTransaction(async (client) => {
    const userResult = await client.query<UserRow>(
      `SELECT line_user_id, selected_teller_id, state, free_consultations_used
         FROM users
        WHERE line_user_id = $1
        FOR UPDATE`,
      [lineUserId],
    );
    const user = userResult.rows[0];
    if (!user?.selected_teller_id) return { type: "no_teller" };

    const active = await client.query<{ id: string; status: string }>(
      `SELECT id, status
         FROM consultations
        WHERE line_user_id = $1
          AND status IN (
            'draft', 'awaiting_payment', 'queued_generation', 'generating',
            'scheduled', 'sending'
          )
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE`,
      [lineUserId],
    );

    const existing = active.rows[0];
    if (existing && existing.status !== "draft") {
      return { type: "active", status: existing.status };
    }

    if (existing) {
      await client.query(
        `UPDATE consultations
            SET question = $2,
                teller_id = $3,
                updated_at = now()
          WHERE id = $1`,
        [existing.id, question, user.selected_teller_id],
      );
      await client.query(
        `UPDATE users SET state = 'draft_ready', updated_at = now()
          WHERE line_user_id = $1`,
        [lineUserId],
      );
      return { type: "saved", consultationId: existing.id };
    }

    const consultationId = crypto.randomUUID();
    await client.query(
      `INSERT INTO consultations (
         id, line_user_id, teller_id, question, status, line_retry_key
       ) VALUES ($1, $2, $3, $4, 'draft', $5)`,
      [
        consultationId,
        lineUserId,
        user.selected_teller_id,
        question,
        crypto.randomUUID(),
      ],
    );
    await client.query(
      `UPDATE users SET state = 'draft_ready', updated_at = now()
        WHERE line_user_id = $1`,
      [lineUserId],
    );

    return { type: "saved", consultationId };
  });
}

async function reserveAvailableCredit(
  client: PoolClient,
  lineUserId: string,
  consultationId: string,
): Promise<boolean> {
  const credit = await client.query<{ id: string }>(
    `SELECT id
       FROM consultation_credits
      WHERE line_user_id = $1
        AND status = 'available'
        AND (expires_at IS NULL OR expires_at > now())
      ORDER BY created_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED`,
    [lineUserId],
  );

  const row = credit.rows[0];
  if (!row) return false;

  await client.query(
    `UPDATE consultation_credits
        SET status = 'reserved', consultation_id = $2
      WHERE id = $1 AND status = 'available'`,
    [row.id, consultationId],
  );
  return true;
}

export async function confirmConsultation(
  lineUserId: string,
  consultationId: string,
): Promise<ConfirmResult> {
  return withTransaction(async (client) => {
    const userResult = await client.query<UserRow>(
      `SELECT line_user_id, selected_teller_id, state, free_consultations_used
         FROM users
        WHERE line_user_id = $1
        FOR UPDATE`,
      [lineUserId],
    );
    const user = userResult.rows[0];
    if (!user) return { type: "invalid" };

    const consultationResult = await client.query<{
      id: string;
      status: string;
    }>(
      `SELECT id, status
         FROM consultations
        WHERE id = $1 AND line_user_id = $2
        FOR UPDATE`,
      [consultationId, lineUserId],
    );
    const consultation = consultationResult.rows[0];
    if (!consultation) return { type: "invalid" };
    if (consultation.status !== "draft") {
      return consultation.status === "awaiting_payment"
        ? { type: "needs_payment", consultationId }
        : { type: "already_processing" };
    }

    const systemDaily = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM consultations
        WHERE status IN (
          'awaiting_payment', 'queued_generation', 'generating', 'scheduled', 'sending', 'sent'
        )
          AND confirmed_at >= date_trunc('day', now())`,
    );
    if (Number(systemDaily.rows[0]?.count ?? 0) >= config.dailyAiGenerationLimit) {
      return { type: "system_limit" };
    }

    const daily = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM consultations
        WHERE line_user_id = $1
          AND confirmed_at >= now() - interval '24 hours'`,
      [lineUserId],
    );
    if (Number(daily.rows[0]?.count ?? 0) >= config.maxDailyConsultationsPerUser) {
      return { type: "daily_limit" };
    }

    const deliverAt = randomDeliveryDate();

    if (user.free_consultations_used < config.freeConsultationLimit) {
      await client.query(
        `UPDATE consultations
            SET status = 'queued_generation',
                entitlement_type = 'free',
                deliver_at = $2,
                confirmed_at = now(),
                updated_at = now()
          WHERE id = $1`,
        [consultationId, deliverAt],
      );
      await client.query(
        `UPDATE users
            SET free_consultations_used = free_consultations_used + 1,
                state = 'waiting_result',
                updated_at = now()
          WHERE line_user_id = $1`,
        [lineUserId],
      );
      const freeRemaining = Math.max(
        0,
        config.freeConsultationLimit - user.free_consultations_used - 1,
      );
      return { type: "accepted", entitlement: "free", freeRemaining };
    }

    if (await reserveAvailableCredit(client, lineUserId, consultationId)) {
      await client.query(
        `UPDATE consultations
            SET status = 'queued_generation',
                entitlement_type = 'paid',
                is_paid = TRUE,
                deliver_at = $2,
                confirmed_at = now(),
                updated_at = now()
          WHERE id = $1`,
        [consultationId, deliverAt],
      );
      await client.query(
        `UPDATE users SET state = 'waiting_result', updated_at = now()
          WHERE line_user_id = $1`,
        [lineUserId],
      );
      return { type: "accepted", entitlement: "paid", freeRemaining: 0 };
    }

    await client.query(
      `UPDATE consultations
          SET status = 'awaiting_payment', confirmed_at = now(), updated_at = now()
        WHERE id = $1`,
      [consultationId],
    );
    await client.query(
      `UPDATE users SET state = 'awaiting_payment', updated_at = now()
        WHERE line_user_id = $1`,
      [lineUserId],
    );
    return { type: "needs_payment", consultationId };
  });
}

export async function resetDraft(
  lineUserId: string,
  consultationId: string,
): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      `DELETE FROM consultations
        WHERE id = $1 AND line_user_id = $2 AND status = 'draft'`,
      [consultationId, lineUserId],
    );
    await client.query(
      `UPDATE users SET state = 'awaiting_question', updated_at = now()
        WHERE line_user_id = $1`,
      [lineUserId],
    );
  });
}

export async function findAwaitingPayment(
  lineUserId: string,
): Promise<{ id: string } | null> {
  const result = await query<{ id: string }>(
    `SELECT id
       FROM consultations
      WHERE line_user_id = $1 AND status = 'awaiting_payment'
      ORDER BY created_at DESC
      LIMIT 1`,
    [lineUserId],
  );
  return result.rows[0] ?? null;
}

export async function claimLineEvent(webhookEventId: string): Promise<boolean> {
  const result = await query(
    `INSERT INTO processed_line_events (webhook_event_id)
     VALUES ($1)
     ON CONFLICT DO NOTHING
     RETURNING webhook_event_id`,
    [webhookEventId],
  );
  return Boolean(result.rowCount);
}

export async function releaseLineEvent(webhookEventId: string): Promise<void> {
  await query(`DELETE FROM processed_line_events WHERE webhook_event_id = $1`, [
    webhookEventId,
  ]);
}

export type StripeCompletionResult =
  | { type: "completed"; lineUserId: string }
  | { type: "duplicate" }
  | { type: "ignored" };

export async function completeStripeCheckout(
  eventId: string,
  session: Stripe.Checkout.Session,
): Promise<StripeCompletionResult> {
  return withTransaction(async (client) => {
    const eventInsert = await client.query(
      `INSERT INTO processed_stripe_events (stripe_event_id)
       VALUES ($1)
       ON CONFLICT DO NOTHING
       RETURNING stripe_event_id`,
      [eventId],
    );
    if (!eventInsert.rowCount) return { type: "duplicate" };
    if (session.payment_status !== "paid") return { type: "ignored" };

    const consultationId = session.metadata?.consultation_id;
    const lineUserId = session.metadata?.line_user_id;
    if (!consultationId || !lineUserId) {
      throw new Error("Stripe metadataに相談IDまたはLINEユーザーIDがありません");
    }
    if (
      session.metadata?.product_type !== "fortune_consultation_credit" ||
      session.currency?.toLowerCase() !== "jpy" ||
      session.amount_total !== config.consultationPriceJpy
    ) {
      throw new Error("Stripe決済内容が想定した商品・金額と一致しません");
    }

    const consultationResult = await client.query<{ status: string }>(
      `SELECT status
         FROM consultations
        WHERE id = $1 AND line_user_id = $2
        FOR UPDATE`,
      [consultationId, lineUserId],
    );
    const consultation = consultationResult.rows[0];
    if (!consultation) throw new Error("決済対象の相談が見つかりません");
    if (consultation.status !== "awaiting_payment") {
      return { type: "duplicate" };
    }

    const paymentIntentId =
      typeof session.payment_intent === "string" ? session.payment_intent : null;

    const paymentResult = await client.query<{ id: string }>(
      `INSERT INTO payments (
         line_user_id, consultation_id, stripe_session_id,
         stripe_payment_intent_id, amount, currency, status
       ) VALUES ($1, $2, $3, $4, $5, 'jpy', 'paid')
       ON CONFLICT (stripe_session_id)
       DO UPDATE SET status = 'paid', updated_at = now()
       RETURNING id`,
      [
        lineUserId,
        consultationId,
        session.id,
        paymentIntentId,
        session.amount_total ?? config.consultationPriceJpy,
      ],
    );
    const paymentId = paymentResult.rows[0]!.id;

    await client.query(
      `INSERT INTO consultation_credits (
         line_user_id, payment_id, status, consultation_id, expires_at
       ) VALUES ($1, $2, 'reserved', $3, now() + interval '30 days')
       ON CONFLICT (consultation_id) DO NOTHING`,
      [lineUserId, paymentId, consultationId],
    );

    await client.query(
      `UPDATE consultations
          SET status = 'queued_generation',
              entitlement_type = 'paid',
              is_paid = TRUE,
              deliver_at = $2,
              confirmed_at = COALESCE(confirmed_at, now()),
              stripe_session_id = $3,
              updated_at = now()
        WHERE id = $1`,
      [consultationId, randomDeliveryDate(), session.id],
    );
    await client.query(
      `UPDATE users SET state = 'waiting_result', updated_at = now()
        WHERE line_user_id = $1`,
      [lineUserId],
    );

    return { type: "completed", lineUserId };
  });
}

export async function expireStripeCheckout(
  eventId: string,
  session: Stripe.Checkout.Session,
): Promise<void> {
  await withTransaction(async (client) => {
    const eventInsert = await client.query(
      `INSERT INTO processed_stripe_events (stripe_event_id)
       VALUES ($1)
       ON CONFLICT DO NOTHING
       RETURNING stripe_event_id`,
      [eventId],
    );
    if (!eventInsert.rowCount) return;

    const consultationId = session.metadata?.consultation_id;
    const lineUserId = session.metadata?.line_user_id;
    if (!consultationId || !lineUserId) return;

    const updated = await client.query(
      `UPDATE consultations
          SET status = 'draft',
              stripe_session_id = NULL,
              confirmed_at = NULL,
              updated_at = now()
        WHERE id = $1
          AND line_user_id = $2
          AND status = 'awaiting_payment'
          AND stripe_session_id = $3
        RETURNING id`,
      [consultationId, lineUserId, session.id],
    );

    if (updated.rowCount) {
      await client.query(
        `UPDATE users SET state = 'draft_ready', updated_at = now()
          WHERE line_user_id = $1`,
        [lineUserId],
      );
    }
  });
}

export type GenerationJob = {
  id: string;
  line_user_id: string;
  question: string;
  system_prompt: string;
  generation_attempts: number;
};

export async function recoverStaleJobs(): Promise<void> {
  await query(
    `UPDATE consultations
        SET status = 'queued_generation', locked_at = NULL, updated_at = now()
      WHERE status = 'generating'
        AND locked_at < now() - interval '20 minutes'`,
  );
  await query(
    `UPDATE consultations
        SET status = 'scheduled', locked_at = NULL, updated_at = now()
      WHERE status = 'sending'
        AND locked_at < now() - interval '20 minutes'`,
  );
}

export async function countTodayGenerations(): Promise<number> {
  const result = await query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM consultations
      WHERE generated_at >= date_trunc('day', now())`,
  );
  return Number(result.rows[0]?.count ?? 0);
}

export async function claimGenerationJob(): Promise<GenerationJob | null> {
  return withTransaction(async (client) => {
    const candidate = await client.query<{ id: string }>(
      `SELECT id
         FROM consultations
        WHERE status = 'queued_generation'
          AND generation_attempts < 3
        ORDER BY created_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED`,
    );
    const id = candidate.rows[0]?.id;
    if (!id) return null;

    const result = await client.query<GenerationJob>(
      `UPDATE consultations c
          SET status = 'generating',
              generation_attempts = generation_attempts + 1,
              locked_at = now(),
              updated_at = now()
         FROM fortune_tellers f
        WHERE c.id = $1 AND f.id = c.teller_id
        RETURNING c.id, c.line_user_id, c.question,
                  f.system_prompt, c.generation_attempts`,
      [id],
    );
    return result.rows[0] ?? null;
  });
}

export async function saveGeneratedAnswer(
  consultationId: string,
  answer: string,
): Promise<void> {
  await query(
    `UPDATE consultations
        SET answer = $2,
            status = 'scheduled',
            generated_at = now(),
            locked_at = NULL,
            last_error = NULL,
            updated_at = now()
      WHERE id = $1 AND status = 'generating'`,
    [consultationId, answer],
  );
}

async function releaseEntitlement(
  client: PoolClient,
  consultationId: string,
  lineUserId: string,
  entitlementType: string | null,
): Promise<void> {
  if (entitlementType === "paid") {
    await client.query(
      `UPDATE consultation_credits
          SET status = 'available', consultation_id = NULL
        WHERE consultation_id = $1 AND status = 'reserved'`,
      [consultationId],
    );
  } else if (entitlementType === "free") {
    await client.query(
      `UPDATE users
          SET free_consultations_used = GREATEST(0, free_consultations_used - 1)
        WHERE line_user_id = $1`,
      [lineUserId],
    );
  }
}

export async function markGenerationFailed(
  job: GenerationJob,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await withTransaction(async (client) => {
    const rowResult = await client.query<{
      entitlement_type: string | null;
      generation_attempts: number;
    }>(
      `SELECT entitlement_type, generation_attempts
         FROM consultations
        WHERE id = $1
        FOR UPDATE`,
      [job.id],
    );
    const row = rowResult.rows[0];
    if (!row) return;

    if (row.generation_attempts < 3) {
      await client.query(
        `UPDATE consultations
            SET status = 'queued_generation',
                locked_at = NULL,
                last_error = $2,
                updated_at = now()
          WHERE id = $1`,
        [job.id, message.slice(0, 2000)],
      );
      return;
    }

    await client.query(
      `UPDATE consultations
          SET status = 'failed', locked_at = NULL,
              last_error = $2, updated_at = now()
        WHERE id = $1`,
      [job.id, message.slice(0, 2000)],
    );
    await releaseEntitlement(client, job.id, job.line_user_id, row.entitlement_type);
    await client.query(
      `UPDATE users SET state = 'awaiting_question', updated_at = now()
        WHERE line_user_id = $1`,
      [job.line_user_id],
    );
  });
}

export type DeliveryJob = {
  id: string;
  line_user_id: string;
  answer: string;
  line_retry_key: string;
  send_attempts: number;
};

export async function claimDeliveryJob(): Promise<DeliveryJob | null> {
  return withTransaction(async (client) => {
    const candidate = await client.query<{ id: string }>(
      `SELECT id
         FROM consultations
        WHERE status = 'scheduled'
          AND deliver_at <= now()
          AND send_attempts < 5
        ORDER BY deliver_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED`,
    );
    const id = candidate.rows[0]?.id;
    if (!id) return null;

    const result = await client.query<DeliveryJob>(
      `UPDATE consultations
          SET status = 'sending',
              send_attempts = send_attempts + 1,
              locked_at = now(),
              updated_at = now()
        WHERE id = $1
        RETURNING id, line_user_id, answer, line_retry_key::text,
                  send_attempts`,
      [id],
    );
    return result.rows[0] ?? null;
  });
}

export async function markDelivered(job: DeliveryJob): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE consultations
          SET status = 'sent', sent_at = now(), locked_at = NULL,
              last_error = NULL, updated_at = now()
        WHERE id = $1 AND status = 'sending'`,
      [job.id],
    );
    await client.query(
      `UPDATE consultation_credits
          SET status = 'consumed', consumed_at = now()
        WHERE consultation_id = $1 AND status = 'reserved'`,
      [job.id],
    );
    await client.query(
      `UPDATE users SET state = 'awaiting_question', updated_at = now()
        WHERE line_user_id = $1`,
      [job.line_user_id],
    );
  });
}

export async function markDeliveryFailed(
  job: DeliveryJob,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await withTransaction(async (client) => {
    const rowResult = await client.query<{
      entitlement_type: string | null;
      send_attempts: number;
    }>(
      `SELECT entitlement_type, send_attempts
         FROM consultations
        WHERE id = $1
        FOR UPDATE`,
      [job.id],
    );
    const row = rowResult.rows[0];
    if (!row) return;

    if (row.send_attempts < 5) {
      await client.query(
        `UPDATE consultations
            SET status = 'scheduled', locked_at = NULL,
                last_error = $2, updated_at = now()
          WHERE id = $1`,
        [job.id, message.slice(0, 2000)],
      );
      return;
    }

    await client.query(
      `UPDATE consultations
          SET status = 'failed', locked_at = NULL,
              last_error = $2, updated_at = now()
        WHERE id = $1`,
      [job.id, message.slice(0, 2000)],
    );
    await releaseEntitlement(client, job.id, job.line_user_id, row.entitlement_type);
    await client.query(
      `UPDATE users SET state = 'awaiting_question', updated_at = now()
        WHERE line_user_id = $1`,
      [job.line_user_id],
    );
  });
}
