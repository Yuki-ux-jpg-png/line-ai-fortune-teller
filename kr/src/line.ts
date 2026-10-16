import crypto from "node:crypto";
import { config } from "./config.js";
import type { LineMessage } from "./types.js";

const LINE_API_BASE = "https://api.line.me/v2/bot/message";

export function verifyLineSignature(
  rawBody: Buffer,
  signature: string,
): boolean {
  const expected = crypto
    .createHmac("sha256", config.lineChannelSecret)
    .update(rawBody)
    .digest();

  let actual: Buffer;
  try {
    actual = Buffer.from(signature, "base64");
  } catch {
    return false;
  }

  return (
    actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
  );
}

async function lineRequest(
  endpoint: "reply" | "push",
  body: unknown,
  retryKey?: string,
): Promise<void> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.lineChannelAccessToken}`,
  };
  if (retryKey) headers["X-Line-Retry-Key"] = retryKey;

  const response = await fetch(`${LINE_API_BASE}/${endpoint}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(
      `LINE API ${endpoint} failed: ${response.status} ${await response.text()}`,
    );
  }
}

export async function replyMessage(
  replyToken: string,
  messages: LineMessage[],
): Promise<void> {
  await lineRequest("reply", { replyToken, messages });
}

export async function pushMessage(
  lineUserId: string,
  messages: LineMessage[],
  retryKey: string,
): Promise<void> {
  await lineRequest("push", { to: lineUserId, messages }, retryKey);
}

export function textMessage(text: string): LineMessage {
  return { type: "text", text };
}

export type TellerCard = {
  id: string;
  name: string;
  description: string;
  image_url: string;
};

export function tellerCarousel(tellers: TellerCard[]): LineMessage {
  return {
    type: "flex",
    altText: "상담할 점술가를 선택해 주세요",
    contents: {
      type: "carousel",
      contents: tellers.slice(0, 12).map((teller) => ({
        type: "bubble",
        hero: {
          type: "image",
          url: teller.image_url,
          size: "full",
          aspectRatio: "20:13",
          aspectMode: "cover",
        },
        body: {
          type: "box",
          layout: "vertical",
          spacing: "md",
          contents: [
            {
              type: "text",
              text: teller.name,
              weight: "bold",
              size: "xl",
              wrap: true,
            },
            {
              type: "text",
              text: teller.description,
              size: "sm",
              color: "#666666",
              wrap: true,
            },
          ],
        },
        footer: {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "button",
              style: "primary",
              action: {
                type: "postback",
                label: "이 점술가에게 상담하기",
                data: new URLSearchParams({
                  action: "select_teller",
                  teller_id: teller.id,
                }).toString(),
                displayText: `${teller.name}님을 선택했습니다`,
              },
            },
          ],
        },
      })),
    },
  };
}

export function confirmConsultationMessage(
  consultationId: string,
  question: string,
): LineMessage {
  const preview = question.length > 180 ? `${question.slice(0, 180)}…` : question;
  return {
    type: "flex",
    altText: "상담 내용을 확인해 주세요",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          {
            type: "text",
            text: "이 내용으로 상담하시겠어요?",
            weight: "bold",
            size: "lg",
            wrap: true,
          },
          {
            type: "text",
            text: preview,
            wrap: true,
            size: "sm",
            color: "#555555",
          },
          {
            type: "text",
            text: "확정하면 무료 상담 1회 또는 상담권 1장이 사용됩니다.",
            wrap: true,
            size: "xs",
            color: "#888888",
          },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          {
            type: "button",
            style: "primary",
            action: {
              type: "postback",
              label: "상담 확정하기",
              data: new URLSearchParams({
                action: "confirm_consultation",
                consultation_id: consultationId,
              }).toString(),
              displayText: "이 내용으로 상담합니다",
            },
          },
          {
            type: "button",
            action: {
              type: "postback",
              label: "다시 입력하기",
              data: new URLSearchParams({
                action: "rewrite_consultation",
                consultation_id: consultationId,
              }).toString(),
              displayText: "상담 내용 다시 입력하기",
            },
          },
        ],
      },
    },
  };
}

export function paymentMessage(checkoutUrl: string): LineMessage {
  return {
    type: "flex",
    altText: "유료 상담 결제",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          {
            type: "text",
            text: `무료 상담 ${config.freeConsultationLimit}회를 모두 이용하셨습니다`,
            weight: "bold",
            size: "lg",
            wrap: true,
          },
          {
            type: "text",
            text: `상담 1회 요금은 ${config.consultationPriceKrw.toLocaleString("ko-KR")}원(KRW)이며, 상담 내용 1건과 해석 결과 1건이 포함됩니다.`,
            wrap: true,
          },
          {
            type: "text",
            text: "결제 확인 후 보통 90~120분 이내에 결과를 보내 드립니다.",
            size: "sm",
            color: "#666666",
            wrap: true,
          },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "button",
            style: "primary",
            action: {
              type: "uri",
              label: `${config.consultationPriceKrw.toLocaleString("ko-KR")}원 결제`,
              uri: checkoutUrl,
            },
          },
        ],
      },
    },
  };
}


