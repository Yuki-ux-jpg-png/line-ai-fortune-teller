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
    altText: "占い師を選んでください",
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
                label: "この占い師に相談",
                data: new URLSearchParams({
                  action: "select_teller",
                  teller_id: teller.id,
                }).toString(),
                displayText: `${teller.name}を選びました`,
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
    altText: "相談内容を確認してください",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          {
            type: "text",
            text: "この内容で相談しますか？",
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
            text: "確定後に無料枠または相談チケットを1回分消費します。",
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
              label: "この内容で相談する",
              data: new URLSearchParams({
                action: "confirm_consultation",
                consultation_id: consultationId,
              }).toString(),
              displayText: "この内容で相談します",
            },
          },
          {
            type: "button",
            action: {
              type: "postback",
              label: "書き直す",
              data: new URLSearchParams({
                action: "rewrite_consultation",
                consultation_id: consultationId,
              }).toString(),
              displayText: "相談内容を書き直します",
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
    altText: "有料相談のお支払い",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          {
            type: "text",
            text: `無料相談${config.freeConsultationLimit}回を利用済みです`,
            weight: "bold",
            size: "lg",
            wrap: true,
          },
          {
            type: "text",
            text: `${config.consultationPriceJpy.toLocaleString("ja-JP")}円で相談1件をご利用いただけます。相談文1通と鑑定結果1通で完了です。`,
            wrap: true,
          },
          {
            type: "text",
            text: "決済完了後、通常1時間30分〜2時間以内に相談に回答します。少々お待ちください。",
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
              label: `${config.consultationPriceJpy.toLocaleString("ja-JP")}円を支払う`,
              uri: checkoutUrl,
            },
          },
        ],
      },
    },
  };
}
