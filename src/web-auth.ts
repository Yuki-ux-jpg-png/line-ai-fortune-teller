import {webText} from "./web-locale.js";
import { webMarket, webConsultationsAvailable } from "./web-market.js";
/** Fixed trusted Auth origin; never trust browser-supplied user IDs or JWT claims. */
export class WebError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(webText(message));
  }
}
export type WebMember = {
  id: string;
  access: boolean;
  email: string;
  staff: boolean;
};
export async function authenticateWebMember(
  authorization: string | undefined,
  fetcher: typeof fetch = fetch,
): Promise<WebMember> {
  if (process.env.WEB_CONSULTATION_ENABLED !== "true" || !webConsultationsAvailable)
    throw new WebError(503, "Web相談は準備中です。");
  const origin = process.env.WEB_MEMBER_SUPABASE_URL;
  const key = process.env.WEB_MEMBER_PUBLISHABLE_KEY;
  if (!origin || !/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(origin) || !key)
    throw new WebError(503, "会員認証の接続を確認中です。");
  if (!authorization?.startsWith("Bearer ") || authorization.length > 10000)
    throw new WebError(401, "ログインしてください。");
  const headers = { Authorization: authorization, apikey: key };
  const u = await fetcher(`${origin}/auth/v1/user`, {
    headers,
    signal: AbortSignal.timeout(10000),
    redirect: "error",
  });
  if (!u.ok)
    throw new WebError(
      u.status >= 500 ? 503 : 401,
      "ログイン状態を確認できません。",
    );
  const user = (await u.json()) as {
    id?: string;
    email?: string;
    email_confirmed_at?: string;
    is_anonymous?: boolean;
  };
  if (
    !user.id ||
    !/^[0-9a-f-]{36}$/i.test(user.id) ||
    !user.email ||
    !user.email_confirmed_at ||
    user.is_anonymous
  )
    throw new WebError(401, "メールの本人確認が必要です。");
  const s = await fetcher(`${origin}/rest/v1/rpc/kb_member_api`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "state", payload: {} }),
    signal: AbortSignal.timeout(10000),
    redirect: "error",
  });
  if (!s.ok) throw new WebError(403, "会員の利用状態を確認してください。");
  const state = (await s.json()) as {
    profile?: {
      market?: string;
      suspended?: boolean;
      deletionRequested?: boolean;
    };
    access?: boolean;
    staff?: boolean;
  };
  if (
    !state.profile ||
    state.profile.suspended ||
    state.profile.deletionRequested
  )
    throw new WebError(403, "現在は相談を利用できません。");
  if (state.profile.market !== webMarket)
    throw new WebError(403, "登録した地域の相談窓口を利用してください。");
  return {
    id: user.id,
    access: state.access === true,
    email: user.email,
    staff: state.staff === true,
  };
}
