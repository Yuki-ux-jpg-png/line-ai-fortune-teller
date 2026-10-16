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

const deploymentUrl = optionalHttpsUrl("KR_APP_BASE_URL") ?? optionalHttpsUrl("RENDER_EXTERNAL_URL");
if (!deploymentUrl) throw new Error("KR_APP_BASE_URL または RENDER_EXTERNAL_URL が設定されていません");
const appBaseUrl = deploymentUrl.replace(/\/$/, "");
const minDelayMinutes = integer("MIN_DELAY_MINUTES", 90);
const maxDelayMinutes = integer("MAX_DELAY_MINUTES", 120);

if (maxDelayMinutes < minDelayMinutes) {
  throw new Error("MAX_DELAY_MINUTES は MIN_DELAY_MINUTES 以上にしてください");
}

export const config = {
  port: integer("PORT", 3000),
  databaseSchema: "line_kr",
  timezone: "Asia/Seoul",
  nodeEnv: process.env.NODE_ENV ?? "development",
  databaseUrl: required("KR_DATABASE_URL"),
  databaseSsl: boolean("KR_DATABASE_SSL", true),
  lineChannelSecret: required("LINE_KR_CHANNEL_SECRET"),
  lineChannelAccessToken: required("LINE_KR_CHANNEL_ACCESS_TOKEN"),
  consultationsEnabled: boolean("KR_CONSULTATIONS_ENABLED", false),
  openAiApiKey: process.env.KR_OPENAI_API_KEY?.trim() || "not-configured",
  openAiModel: process.env.KR_OPENAI_MODEL?.trim() || "not-configured",
  stripeSecretKey: process.env.KR_STRIPE_SECRET_KEY?.trim() || "sk_test_not_configured",
  // Bootstrap before Stripe can register the new deployment URL. Payments stay disabled.
  stripeWebhookSecret: process.env.KR_STRIPE_WEBHOOK_SECRET?.trim() ?? "",
  appBaseUrl,
  freeConsultationLimit: integer("FREE_CONSULTATION_LIMIT", 2),
  consultationPriceKrw: integer("KR_CONSULTATION_PRICE_KRW", 0),
  paymentsEnabled: boolean("KR_PAYMENTS_ENABLED", false),
  minDelayMinutes,
  maxDelayMinutes,
  maxQuestionChars: integer("MAX_QUESTION_CHARS", 500),
  maxDailyConsultationsPerUser: integer(
    "MAX_DAILY_CONSULTATIONS_PER_USER",
    5,
  ),
  dailyAiGenerationLimit: integer("DAILY_AI_GENERATION_LIMIT", 200),
};

if (config.consultationsEnabled && (!process.env.KR_OPENAI_API_KEY?.trim() || !process.env.KR_OPENAI_MODEL?.trim())) throw new Error("KR consultation AI credentials are missing");
if (config.paymentsEnabled && (!process.env.KR_STRIPE_SECRET_KEY?.trim() || !config.stripeWebhookSecret || config.consultationPriceKrw <= 0)) throw new Error("KR payment configuration is incomplete");

export function randomDeliveryDate(now = new Date()): Date {
  const width = config.maxDelayMinutes - config.minDelayMinutes + 1;
  const delay = config.minDelayMinutes + Math.floor(Math.random() * width);
  return new Date(now.getTime() + delay * 60_000);
}

