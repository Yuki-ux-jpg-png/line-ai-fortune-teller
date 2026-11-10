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
    altText: "請選擇占卜師",
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
                label: "向這位占卜師諮詢",
                data: new URLSearchParams({
                  action: "select_teller",
                  teller_id: teller.id,
                }).toString(),
                displayText: `已選擇${teller.name}`,
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
    altText: "請確認諮詢內容",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          {
            type: "text",
            text: "要以這些內容進行諮詢嗎？",
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
            text: "確認後將使用1次免費諮詢額度或1張諮詢券。",
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
              label: "確認諮詢內容",
              data: new URLSearchParams({
                action: "confirm_consultation",
                consultation_id: consultationId,
              }).toString(),
              displayText: "以這些內容進行諮詢",
            },
          },
          {
            type: "button",
            action: {
              type: "postback",
              label: "重新輸入",
              data: new URLSearchParams({
                action: "rewrite_consultation",
                consultation_id: consultationId,
              }).toString(),
              displayText: "重新輸入諮詢內容",
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
    altText: "付費諮詢付款",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          {
            type: "text",
            text: `你已使用完${config.freeConsultationLimit}次免費諮詢`,
            weight: "bold",
            size: "lg",
            wrap: true,
          },
          {
            type: "text",
            text: `每次諮詢費用為${config.consultationPriceJpy.toLocaleString("zh-TW")}日圓（JPY），包含一則諮詢內容與一份占卜結果。`,
            wrap: true,
          },
          {
            type: "text",
            text: "完成付款後，通常會在1小時30分鐘至2小時內回覆諮詢，請稍候。",
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
              label: `支付${config.consultationPriceJpy.toLocaleString("zh-TW")}日圓`,
              uri: checkoutUrl,
            },
          },
        ],
      },
    },
  };
}

