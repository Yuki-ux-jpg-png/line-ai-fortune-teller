import Stripe from "stripe";
import { config } from "./config.js";
import { withTransaction } from "./db.js";

export const stripe = new Stripe(config.stripeSecretKey);

export async function getOrCreateCheckoutUrl(
  consultationId: string,
  lineUserId: string,
): Promise<string> {
  return withTransaction(async (client) => {
    const result = await client.query<{
      stripe_session_id: string | null;
      checkout_attempts: number;
    }>(
      `SELECT stripe_session_id, checkout_attempts
         FROM consultations
        WHERE id = $1
          AND line_user_id = $2
          AND status = 'awaiting_payment'
        FOR UPDATE`,
      [consultationId, lineUserId],
    );

    const row = result.rows[0];
    if (!row) throw new Error("支払い待ちの相談が見つかりません");

    if (row.stripe_session_id) {
      const existing = await stripe.checkout.sessions.retrieve(
        row.stripe_session_id,
      );
      if (existing.status === "open" && existing.url) return existing.url;
      if (existing.status === "complete") {
        throw new Error("この相談の決済はすでに完了しています");
      }
    }

    const nextAttempt = row.checkout_attempts + 1;
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "jpy",
              unit_amount: config.consultationPriceJpy,
              product_data: {
                name: "AI占い相談 1件",
                description: "相談文1通とAI鑑定結果1通",
              },
            },
            quantity: 1,
          },
        ],
        client_reference_id: lineUserId,
        metadata: {
          consultation_id: consultationId,
          line_user_id: lineUserId,
          product_type: "fortune_consultation_credit",
        },
        success_url: `${config.appBaseUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${config.appBaseUrl}/payment/cancel`,
        expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      },
      {
        idempotencyKey: `consultation:${consultationId}:checkout:${nextAttempt}`,
      },
    );

    if (!session.url) throw new Error("Stripe Checkout URLを取得できませんでした");

    await client.query(
      `UPDATE consultations
          SET stripe_session_id = $1,
              checkout_attempts = $2,
              updated_at = now()
        WHERE id = $3
          AND line_user_id = $4
          AND status = 'awaiting_payment'`,
      [session.id, nextAttempt, consultationId, lineUserId],
    );

    return session.url;
  });
}
