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
    textMessage("請選擇你想諮詢的占卜師。"),
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
  if (["選單", "占卜師", "選擇占卜師", "メニュー", "占い師", "占い師を選ぶ"].includes(text)) {
    await showTellers(event.replyToken);
    return;
  }

  const user = await getUser(userId);

  if (user.state === "waiting_result") {
    await replyMessage(event.replyToken, [
      textMessage(
        "目前有一則諮詢正在解讀中。請等收到占卜結果後，再提出下一則諮詢。",
      ),
    ]);
    return;
  }

  if (user.state === "awaiting_payment") {
    const consultation = await findAwaitingPayment(userId);
    if (!consultation) {
      await replyMessage(event.replyToken, [
        textMessage("找不到等待付款的諮詢，請重新提出諮詢。"),
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
    await replyMessage(event.replyToken, [textMessage("請輸入你想諮詢的內容。")]);
    return;
  }

  if (text.length > config.maxQuestionChars) {
    await replyMessage(event.replyToken, [
      textMessage(
        `諮詢內容請在${config.maxQuestionChars}字以內，目前為${text.length}字。`,
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
      textMessage("目前有諮詢正在處理中。完成後，請再提出下一則諮詢。"),
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
        textMessage("目前的諮詢完成前，暫時無法更換占卜師。"),
      ]);
      return;
    }
    if (result === "not_found") {
      await replyMessage(event.replyToken, [textMessage("找不到這位占卜師。")]);
      return;
    }
    await replyMessage(event.replyToken, [
      textMessage(
        `已選好占卜師。請將你想諮詢的內容整理成一則訊息，並在${config.maxQuestionChars}字以內傳送。`,
      ),
    ]);
    return;
  }

  if (action === "rewrite_consultation") {
    const consultationId = params.get("consultation_id");
    if (!consultationId) return;
    await resetDraft(userId, consultationId);
    await replyMessage(event.replyToken, [
      textMessage("請重新輸入諮詢內容，目前還沒有使用免費次數或諮詢券。"),
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
          ? `\n剩餘免費諮詢：${result.freeRemaining}次`
          : "";
      await replyMessage(event.replyToken, [
        textMessage(
          `已收到你的諮詢，通常會在1小時30分鐘至2小時內將回覆傳給你。請稍候${remaining}`,
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
          `為維持服務品質，每24小時最多可確認${config.maxDailyConsultationsPerUser}則諮詢，請稍後再試。`,
        ),
      ]);
      return;
    }

    if (result.type === "system_limit") {
      await replyMessage(event.replyToken, [
        textMessage(
          "今天的受理量已達上限，暫時停止接受新諮詢，尚未產生任何付款。",
        ),
      ]);
      return;
    }

    await replyMessage(event.replyToken, [
      textMessage("這則諮詢已在處理中，或此操作已逾期。"),
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
  if (event.type === "checkout.session.expired" || event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.metadata?.product_type !== "fortune_consultation_credit_tw" || session.metadata?.locale !== "zh-TW") return;
  }
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
            "已確認付款並收到你的諮詢，通常會在1小時30分鐘至2小時內將回覆傳給你，請稍候。",
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

