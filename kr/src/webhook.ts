import crypto from "node:crypto";
import type Stripe from "stripe";
import { config } from "./config.js";
import {
  claimLineEvent,
  completeStripeCheckout,
  confirmConsultation,
  ensureUser,
  endIntake,
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
    textMessage("상담하고 싶은 점술가를 선택해 주세요."),
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
  if (["메뉴", "점술가", "점술가 선택", "상담하기", "점술가에게 상담하기"].includes(text)) {
    await showTellers(event.replyToken);
    return;
  }

  const user = await getUser(userId);
  if (["종료", "취소", "상담 종료"].includes(text)) {
    await endIntake(userId);
    await replyMessage(event.replyToken, [textMessage("상담 준비를 종료했습니다. 확정 전의 무료 횟수나 상담권은 사용되지 않았습니다.")]);
    return;
  }


  if (user.state === "waiting_result") {
    await replyMessage(event.replyToken, [
      textMessage(
        "현재 상담 결과를 준비하고 있습니다. 결과를 받은 후 다음 상담을 신청해 주세요.",
      ),
    ]);
    return;
  }

  if (user.state === "awaiting_payment") {
    const consultation = await findAwaitingPayment(userId);
    if (!consultation) {
      await replyMessage(event.replyToken, [
        textMessage("결제 대기 중인 상담을 찾을 수 없습니다. 상담을 다시 신청해 주세요."),
      ]);
      return;
    }
    const checkoutUrl = await getOrCreateCheckoutUrl(consultation.id, userId);
    await replyMessage(event.replyToken, [paymentMessage(checkoutUrl)]);
    return;
  }

  if (!user.intake_expires_at || new Date(user.intake_expires_at).getTime() <= Date.now()) {
    await endIntake(userId);
    await replyMessage(event.replyToken, [textMessage("상담을 시작하려면 ‘상담하기’를 선택해 주세요. 오늘의 운세는 ‘오늘의 운세’라고 입력하면 확인할 수 있어요.")]);
    return;
  }

  if (!user.selected_teller_id) {
    await showTellers(event.replyToken);
    return;
  }

  if (!text) {
    await replyMessage(event.replyToken, [textMessage("상담하고 싶은 내용을 입력해 주세요.")]);
    return;
  }

  if (text.length > config.maxQuestionChars) {
    await replyMessage(event.replyToken, [
      textMessage(
        `상담 내용은 ${config.maxQuestionChars}자 이내로 입력해 주세요. 현재 ${text.length}자입니다.`,
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
      textMessage("현재 진행 중인 상담이 있습니다. 완료 후 다음 상담을 신청해 주세요."),
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
        textMessage("진행 중인 상담이 끝나면 점술가를 변경할 수 있습니다."),
      ]);
      return;
    }
    if (result === "not_found") {
      await replyMessage(event.replyToken, [textMessage("해당 점술가를 찾을 수 없습니다.")]);
      return;
    }
    await replyMessage(event.replyToken, [
      textMessage(
        `점술가를 선택했습니다. 상담 내용을 메시지 하나로 정리해 ${config.maxQuestionChars}자 이내로 보내 주세요. 준비를 마치려면 종료라고 입력해 주세요.`,
      ),
    ]);
    return;
  }

  if (action === "rewrite_consultation") {
    const consultationId = params.get("consultation_id");
    if (!consultationId) return;
    if (!(await resetDraft(userId, consultationId))) {
      await replyMessage(event.replyToken, [textMessage("이미 처리되었거나 유효기간이 지난 요청입니다.")]);
      return;
    }
    await replyMessage(event.replyToken, [
      textMessage("상담 내용을 다시 입력해 주세요. 무료 횟수와 상담권은 아직 사용되지 않았습니다."),
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
          ? `\n남은 무료 상담: ${result.freeRemaining}회`
          : "";
      await replyMessage(event.replyToken, [
        textMessage(
          `상담을 접수했습니다. 보통 90~120분 이내에 결과를 보내 드립니다.${remaining}`,
        ),
      ]);
      return;
    }

    if (result.type === "payments_unavailable") {
      await replyMessage(event.replyToken, [textMessage("무료 상담 횟수를 모두 이용하셨습니다. 유료 상담은 준비 중이며 결제는 발생하지 않았습니다.")]);
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
          `상담은 24시간 동안 최대 ${config.maxDailyConsultationsPerUser}회 확정할 수 있습니다. 잠시 후 다시 이용해 주세요.`,
        ),
      ]);
      return;
    }

    if (result.type === "system_limit") {
      await replyMessage(event.replyToken, [
        textMessage(
          "오늘의 접수 한도에 도달했습니다. 나중에 다시 이용해 주세요. 결제는 발생하지 않았습니다.",
        ),
      ]);
      return;
    }

    await replyMessage(event.replyToken, [
      textMessage("이미 처리 중인 상담이거나 유효기간이 지난 요청입니다."),
    ]);
  }
}

export async function handleLineEvent(event: LineEvent): Promise<void> {
  if (!config.consultationsEnabled) {
    if (event.replyToken) await replyMessage(event.replyToken, [textMessage("점술가 상담은 준비 중입니다. ‘오늘의 운세’라고 입력하면 일일 운세를 확인할 수 있어요.")]);
    return;
  }
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
    if (session.metadata?.product_type !== "fortune_consultation_credit_kr" || session.metadata?.locale !== "ko-KR") return;
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
            "결제를 확인하고 상담을 접수했습니다. 보통 90~120분 이내에 결과를 보내 드립니다.",
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


