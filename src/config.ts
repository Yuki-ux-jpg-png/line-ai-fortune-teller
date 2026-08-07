import "dotenv/config";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`環境変数 ${name} が設定されていません`);
  }
  return value;
}

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) {
    throw new Error(`環境変数 ${name} は整数で指定してください`);
  }
  return value;
}

function boolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function optionalHttpsUrl(name: string): string | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`環境変数 ${name} は有効なURLで指定してください`);
  }

  if (url.protocol !== "https:") {
    throw new Error(`環境変数 ${name} は https:// で始まるURLにしてください`);
  }

  return url.toString();
}

const appBaseUrl = required("APP_BASE_URL").replace(/\/$/, "");
const minDelayMinutes = integer("MIN_DELAY_MINUTES", 90);
const maxDelayMinutes = integer("MAX_DELAY_MINUTES", 120);

if (maxDelayMinutes < minDelayMinutes) {
  throw new Error("MAX_DELAY_MINUTES は MIN_DELAY_MINUTES 以上にしてください");
}

export const config = {
  port: integer("PORT", 3000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  databaseUrl: required("DATABASE_URL"),
  databaseSsl: boolean("DATABASE_SSL", true),
  lineChannelSecret: required("LINE_CHANNEL_SECRET"),
  lineChannelAccessToken: required("LINE_CHANNEL_ACCESS_TOKEN"),
  legacyFortuneWebhookUrl: optionalHttpsUrl("LEGACY_FORTUNE_WEBHOOK_URL"),
  openAiApiKey: required("OPENAI_API_KEY"),
  openAiModel: process.env.OPENAI_MODEL?.trim() || "gpt-5.6-terra",
  stripeSecretKey: required("STRIPE_SECRET_KEY"),
  stripeWebhookSecret: required("STRIPE_WEBHOOK_SECRET"),
  appBaseUrl,
  freeConsultationLimit: integer("FREE_CONSULTATION_LIMIT", 2),
  consultationPriceJpy: integer("CONSULTATION_PRICE_JPY", 500),
  minDelayMinutes,
  maxDelayMinutes,
  maxQuestionChars: integer("MAX_QUESTION_CHARS", 500),
  maxDailyConsultationsPerUser: integer(
    "MAX_DAILY_CONSULTATIONS_PER_USER",
    5,
  ),
  dailyAiGenerationLimit: integer("DAILY_AI_GENERATION_LIMIT", 200),
};

export function randomDeliveryDate(now = new Date()): Date {
  const width = config.maxDelayMinutes - config.minDelayMinutes + 1;
  const delay = config.minDelayMinutes + Math.floor(Math.random() * width);
  return new Date(now.getTime() + delay * 60_000);
}
