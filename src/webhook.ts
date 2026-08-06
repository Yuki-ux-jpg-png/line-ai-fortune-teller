import crypto from "node:crypto";
import type Stripe from "stripe";
import { config } from "./config.js";
import {
  claimLineEvent,
  completeStripeCheckout,
  confirmConsultation,
  ensureUser,
  expireStripeCheckout,
  findAwaitingPayment,
  getUser,
  listTellers,
  releaseLineEvent,
  resetDraft,
  saveDraft,
  selectTeller,
} from "./consultations.js";
import {
  confirmConsultationMessage,
  paymentMessage,
  pushMessage,
  replyMessage,
  tellerCarousel,
  textMessage,
} from "./line.js";
import { getOrCreateCheckoutUrl } from "./payments.js";
import type {
  LineEvent,
  LineFollowEvent,
  LinePostbackEvent,
  LineTextMessageEvent,
} from "./types.js";

function requireUserId(event: LineEvent): string | null {
  return event.source?.userId ?? null;
}

async function showTellers(replyToken: string): Promise<void> {
  const tellers = await listTellers();
  await replyMessage(replyToken, [
    textMessage("相談したい占い師を選んでください。"),
    tellerCarousel(tellers),
  ]);
}

async function handleFollow(event: LineFollowEvent): Promise<void> {
  const userId = requireUserId(event);
  if (!userId) return;
  await ensureUser(userId);
  await showTellers(event.replyToken);
}

async function handleText(event: LineTextMessageEvent): Promise<void> {
  const userId = requireUserId(event);
  if (!userId) return;
  await ensureUser(userId);

  const text = event.message.text.trim();
  if (["メニュー", "占い師", "占い師を選ぶ"].includes(text)) {
    await showTellers(event.replyToken);
    return;
  }

  const user = await getUser(userId);

  if (user.state === "waiting_result") {
    await replyMessage(event.replyToken, [
      textMessage(
        "現在、1件のご相談を鑑定中です。鑑定結果が届いた後に次の相談をお送りください。",
      ),
    ]);
    return;
  }

  if (user.state === "awaiting_payment") {
    const consultation = await findAwaitingPayment(userId);
    if (!consultation) {
      await replyMessage(event.replyToken, [
        textMessage("支払い待ちの相談が見つかりません。もう一度ご相談ください。"),
      ]);
      return;
    }
    const checkoutUrl = await getOrCreateCheckoutUrl(consultation.id, userId);
    await replyMessage(event.replyToken, [paymentMessage(checkoutUrl)]);
    return;
  }

  if (!user.selected_teller_id) {
    await showTellers(event.replyToken);
    return;
  }

  if (!text) {
    await replyMessage(event.replyToken, [textMessage("相談内容を入力してください。")]);
    return;
  }

  if (text.length > config.maxQuestionChars) {
    await replyMessage(event.replyToken, [
      textMessage(
        `相談内容は${config.maxQuestionChars}文字以内で送ってください。現在は${text.length}文字です。`,
      ),
    ]);
    return;
  }

  const draft = await saveDraft(userId, text);
  if (draft.type === "no_teller") {
    await showTellers(event.replyToken);
    return;
  }
  if (draft.type === "active") {
    await replyMessage(event.replyToken, [
      textMessage("現在処理中の相談があります。完了後に次の相談をお送りください。"),
    ]);
    return;
  }

  await replyMessage(event.replyToken, [
    confirmConsultationMessage(draft.consultationId, text),
  ]);
}

async function handlePostback(event: LinePostbackEvent): Promise<void> {
  const userId = requireUserId(event);
  if (!userId) return;
  await ensureUser(userId);

  const params = new URLSearchParams(event.postback.data);
  const action = params.get("action");

  if (action === "select_teller") {
    const tellerId = params.get("teller_id");
    if (!tellerId) return;
    const result = await selectTeller(userId, tellerId);
    if (result === "active") {
      await replyMessage(event.replyToken, [
        textMessage("現在の相談が完了するまで占い師は変更できません。"),
      ]);
      return;
    }
    if (result === "not_found") {
      await replyMessage(event.replyToken, [textMessage("占い師が見つかりません。")]);
      return;
    }
    await replyMessage(event.replyToken, [
      textMessage(
        `占い師を選択しました。相談したいことを${config.maxQuestionChars}文字以内で、1回のメッセージにまとめて送ってください。`,
      ),
    ]);
    return;
  }

  if (action === "rewrite_consultation") {
    const consultationId = params.get("consultation_id");
    if (!consultationId) return;
    await resetDraft(userId, consultationId);
    await replyMessage(event.replyToken, [
      textMessage("相談内容を書き直してください。まだ無料枠やチケットは消費していません。"),
    ]);
    return;
  }

  if (action === "confirm_consultation") {
    const consultationId = params.get("consultation_id");
    if (!consultationId) return;
    const result = await confirmConsultation(userId, consultationId);

    if (result.type === "accepted") {
      const remaining =
        result.entitlement === "free"
          ? `\n無料相談の残り：${result.freeRemaining}件`
          : "";
      await replyMessage(event.replyToken, [
        textMessage(
          `ご相談を受け付けました。AI鑑定結果は通常1時間30分〜2時間以内にお送りします。${remaining}`,
        ),
      ]);
      return;
    }

    if (result.type === "needs_payment") {
      const checkoutUrl = await getOrCreateCheckoutUrl(result.consultationId, userId);
      await replyMessage(event.replyToken, [paymentMessage(checkoutUrl)]);
      return;
    }

    if (result.type === "daily_limit") {
      await replyMessage(event.replyToken, [
        textMessage(
          `安全な運用のため、相談確定は24時間に${config.maxDailyConsultationsPerUser}件までです。時間を置いてお試しください。`,
        ),
      ]);
      return;
    }

    if (result.type === "system_limit") {
      await replyMessage(event.replyToken, [
        textMessage(
          "本日の受付上限に達したため、新しい相談を一時停止しています。決済は発生していません。",
        ),
      ]);
      return;
    }

    await replyMessage(event.replyToken, [
      textMessage("この相談はすでに処理中か、操作の有効期限が切れています。"),
    ]);
  }
}

export async function handleLineEvent(event: LineEvent): Promise<void> {
  const eventId = event.webhookEventId;
  if (!eventId) return;
  if (!(await claimLineEvent(eventId))) return;

  try {
    if (event.type === "follow") {
      await handleFollow(event as LineFollowEvent);
    } else if (
      event.type === "message" &&
      (event as LineTextMessageEvent).message?.type === "text"
    ) {
      await handleText(event as LineTextMessageEvent);
    } else if (event.type === "postback") {
      await handlePostback(event as LinePostbackEvent);
    }
  } catch (error) {
    await releaseLineEvent(eventId);
    throw error;
  }
}

export async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  if (event.type === "checkout.session.expired") {
    await expireStripeCheckout(
      event.id,
      event.data.object as Stripe.Checkout.Session,
    );
    return;
  }

  if (event.type !== "checkout.session.completed") return;

  const result = await completeStripeCheckout(
    event.id,
    event.data.object as Stripe.Checkout.Session,
  );

  if (result.type === "completed") {
    try {
      await pushMessage(
        result.lineUserId,
        [
          textMessage(
            "お支払いを確認しました。ご相談を受け付けました。AI鑑定結果は通常1時間30分〜2時間以内にお送りします。",
          ),
        ],
        crypto.randomUUID(),
      );
    } catch (error) {
      // 決済処理自体は完了しているため、通知失敗でStripe Webhookを再試行させない。
      console.error("Payment confirmation push failed", error);
    }
  }
}
