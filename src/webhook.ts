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
  intakeModeMessage,
  intakeInputMessage,
  guidedWelcomeMessage,
  guidedFollowupMessage,
} from "./line.js";
import {
  startIntake, getIntake, changeIntakeStage, setIntakeReview, addIntakeTurn,
  finishIntake, cancelIntake, followUpQuestion, summarizeIntake,
  transcribeLineVoice, urgentSafetyConcern,
} from "./intake.js";
import { getOrCreateCheckoutUrl } from "./payments.js";
import type {
  LineEvent,
  LineFollowEvent,
  LinePostbackEvent,
  LineTextMessageEvent,
  LineAudioMessageEvent,
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

async function showPreparedDraft(userId: string, replyToken: string, content: string): Promise<void> {
  const text = content.trim();
  if (!text) {
    await replyMessage(replyToken, [textMessage("相談内容が空です。短い一言からで大丈夫です。")]);
    return;
  }
  if (text.length > config.maxQuestionChars) {
    await replyMessage(replyToken, [textMessage(`相談内容は${config.maxQuestionChars}文字以内で送ってください。現在は${text.length}文字です。`)]);
    return;
  }
  const draft = await saveDraft(userId, text);
  if (draft.type === "no_teller") {
    await showTellers(replyToken);
    return;
  }
  if (draft.type === "active") {
    await finishIntake(userId);
    await replyMessage(replyToken, [textMessage("処理中の相談があるため、新しい相談はまだ作れません。")]);
    return;
  }
  const reviewed = await setIntakeReview(userId, draft.consultationId);
  if (!reviewed) {
    // A late response after expiry must not leave a blocking draft behind.
    await cancelIntake(userId);
    await replyMessage(replyToken, [textMessage("相談の準備時間が過ぎました。占い師を選び直してください。")]);
    return;
  }
  await replyMessage(replyToken, [confirmConsultationMessage(draft.consultationId, text)]);
}

async function intakeMessage(userId: string, replyToken: string, text: string): Promise<void> {
  const session = await getIntake(userId);
  // No explicit preparation session: never hijack an ordinary LINE chat message.
  if (!session || !["text", "voice", "guided"].includes(session.stage)) return;
  if (!text.trim()) return;
  if (text.length > config.maxQuestionChars) {
    await replyMessage(replyToken, [textMessage(`${config.maxQuestionChars}文字以内でお願いします。長い場合は内容を短く区切ってください。`)]);
    return;
  }
  if (await urgentSafetyConcern(text)) {
    await cancelIntake(userId);
    await replyMessage(replyToken, [textMessage("今、安全が心配な状態なら、占いの回答を待たずに地域の緊急窓口や身近な信頼できる方へ連絡してください。命に関わる危険があるときは緊急通報を利用してください。")]);
    return;
  }
  if (session.stage !== "guided") {
    await showPreparedDraft(userId, replyToken, text);
    return;
  }
  const latest = await addIntakeTurn(userId, text);
  if (!latest) return;
  if (latest.step >= 3) {
    await showPreparedDraft(userId, replyToken, await summarizeIntake(latest.turns));
  } else {
    const question = await followUpQuestion(latest.turns);
    await replyMessage(replyToken, [guidedFollowupMessage(question)]);
  }
}

async function handleText(event: LineTextMessageEvent): Promise<void> {
  const userId = requireUserId(event);
  if (!userId) return;
  const text = event.message.text.trim();
  if (["メニュー", "占い師", "占い師を選ぶ"].includes(text)) {
    await ensureUser(userId);
    // Leaving for the menu ends the old preparation session.
    await cancelIntake(userId);
    await showTellers(event.replyToken);
    return;
  }
  if (["相談を終了", "相談中止", "相談終了"].includes(text)) {
    const stopped = await cancelIntake(userId);
    if (stopped) {
      await replyMessage(event.replyToken, [textMessage("相談の準備を終了しました。下書きは破棄しました。通常のメッセージは相談として記録されません。")]);
    }
    return;
  }
  if (text === "相談状況") {
    const user = await getUser(userId);
    if (user.state === "waiting_result") {
      await replyMessage(event.replyToken, [textMessage("現在、鑑定結果を準備中です。相談の受付は完了しています。")]);
    } else if (user.state === "awaiting_payment") {
      const pending = await findAwaitingPayment(userId);
      if (pending) {
        const checkoutUrl = await getOrCreateCheckoutUrl(pending.id, userId);
        await replyMessage(event.replyToken, [paymentMessage(checkoutUrl)]);
      }
    } else {
      await replyMessage(event.replyToken, [textMessage("現在、鑑定中の相談はありません。")]);
    }
    return;
  }
  await intakeMessage(userId, event.replyToken, text);
}

async function handleAudio(event: LineAudioMessageEvent): Promise<void> {
  const userId = requireUserId(event);
  if (!userId) return;
  const session = await getIntake(userId);
  if (!session || !["voice", "guided"].includes(session.stage)) return;
  if (event.message.contentProvider?.type === "external") {
    await replyMessage(event.replyToken, [textMessage("この音声は読み取れません。LINEの音声メッセージとして送ってください。")]);
    return;
  }
  try {
    const transcript = await transcribeLineVoice(event.message.id, event.message.duration);
    // A two-minute spoken account may exceed 500 characters; organize it
    // into a shorter draft instead of rejecting the voice message.
    const text = transcript.length > config.maxQuestionChars && session.stage === "voice"
      ? await summarizeIntake([transcript])
      : transcript;
    await intakeMessage(userId, event.replyToken, text);
  } catch (error) {
    console.error("Consultation voice processing failed", error instanceof Error ? error.name : "unknown");
    await replyMessage(event.replyToken, [textMessage("音声を処理できませんでした。2分以内で録り直すか、文字で送ってください。")]);
  }
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
    await startIntake(userId);
    await replyMessage(event.replyToken, [intakeModeMessage()]);
    return;
  }

  if (action === "intake_cancel") {
    const stopped = await cancelIntake(userId);
    if (stopped) {
      await replyMessage(event.replyToken, [textMessage("相談の準備を終了しました。下書きは破棄されました。通常のメッセージは相談として記録されません。")]);
    }
    return;
  }

  if (["intake_guided", "intake_voice", "intake_text"].includes(action ?? "")) {
    const current = await getIntake(userId);
    if (!current || current.stage !== "mode") return;
    const mode = action === "intake_guided" ? "guided" : action === "intake_voice" ? "voice" : "text";
    await changeIntakeStage(userId, mode, true);
    await replyMessage(event.replyToken, [mode === "guided" ? guidedWelcomeMessage() : intakeInputMessage(mode)]);
    return;
  }

  if (action === "intake_topic") {
    const current = await getIntake(userId);
    if (!current || current.stage !== "guided" || current.step !== 0) return;
    const allowedTopics = ["恋愛のことで悩んでいます", "仕事のことで悩んでいます", "人間関係のことで悩んでいます", "今の気持ちを整理したいです"];
    const topic = params.get("topic") ?? "";
    if (allowedTopics.includes(topic)) await intakeMessage(userId, event.replyToken, topic);
    return;
  }

  if (action === "intake_finish") {
    const current = await getIntake(userId);
    if (!current || current.stage !== "guided") return;
    if (current.turns.length === 0) {
      await replyMessage(event.replyToken, [guidedWelcomeMessage()]);
      return;
    }
    await showPreparedDraft(userId, event.replyToken, await summarizeIntake(current.turns));
    return;
  }

  if (action === "rewrite_consultation") {
    const consultationId = params.get("consultation_id");
    if (!consultationId) return;
    const current = await getIntake(userId);
    if (!current || current.stage !== "review") return;
    await resetDraft(userId, consultationId);
    await changeIntakeStage(userId, "text", true);
    await replyMessage(event.replyToken, [intakeInputMessage("text")]);
    return;
  }

  if (action === "confirm_consultation") {
    const consultationId = params.get("consultation_id");
    const current = await getIntake(userId);
    if (!consultationId || !current || current.stage !== "review" || current.draft_consultation_id !== consultationId) return;
    const result = await confirmConsultation(userId, consultationId);

    if (result.type === "accepted") {
      await finishIntake(userId);
      const remaining =
        result.entitlement === "free"
          ? `\n無料相談の残り：${result.freeRemaining}件`
          : "";
      await replyMessage(event.replyToken, [
        textMessage(
          `ご相談を受け付けました。相談への回答は通常1時間30分〜2時間以内にお送りします。しばらくお待ちください${remaining}`,
        ),
      ]);
      return;
    }

    if (result.type === "needs_payment") {
      await finishIntake(userId);
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
    } else if (
      event.type === "message" &&
      (event as LineAudioMessageEvent).message?.type === "audio"
    ) {
      await handleAudio(event as LineAudioMessageEvent);
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
            "お支払いを確認しました。ご相談を受け付けました。相談への回答は通常1時間30分〜2時間以内にお送りします。少々お待ちください。",
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
