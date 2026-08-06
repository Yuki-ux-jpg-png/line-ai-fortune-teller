export type LineSource = {
  userId?: string;
  type: string;
};

export type LineTextMessageEvent = {
  type: "message";
  webhookEventId: string;
  replyToken: string;
  source: LineSource;
  message: {
    id: string;
    type: "text";
    text: string;
  };
};

export type LinePostbackEvent = {
  type: "postback";
  webhookEventId: string;
  replyToken: string;
  source: LineSource;
  postback: {
    data: string;
  };
};

export type LineFollowEvent = {
  type: "follow";
  webhookEventId: string;
  replyToken: string;
  source: LineSource;
};

export type LineEvent =
  | LineTextMessageEvent
  | LinePostbackEvent
  | LineFollowEvent
  | {
      type: string;
      webhookEventId?: string;
      replyToken?: string;
      source?: LineSource;
      [key: string]: unknown;
    };

export type LineWebhookBody = {
  events: LineEvent[];
};

export type LineMessage = Record<string, unknown>;
