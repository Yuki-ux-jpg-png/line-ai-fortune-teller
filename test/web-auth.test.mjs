import test from "node:test";
import assert from "node:assert/strict";
import { authenticateWebMember } from "../dist/web-auth.js";
import {
  verifyOperationsToken,
  operationsAudience,
} from "../dist/web-operations-auth.js";
import { generateKeyPair, SignJWT } from "jose";
Object.assign(process.env, {
  WEB_CONSULTATION_ENABLED: "true",
  WEB_MEMBER_SUPABASE_URL: "https://vlvftfkfgkvlkrnrqgeq.supabase.co",
  WEB_MEMBER_PUBLISHABLE_KEY: "public_test",
});
const id = "11111111-1111-4111-8111-111111111111";
const fetcher =
  (state = {}, user = {}) =>
  async (url) =>
    Response.json(
      url.endsWith("/user")
        ? {
            id,
            email: "member@example.test",
            email_confirmed_at: "2026-01-01",
            ...user,
          }
        : {
            profile: {
              market: "jp",
              suspended: false,
              deletionRequested: false,
            },
            access: true,
            staff: false,
            ...state,
          },
    );
test("Web identity is obtained from hosted Auth, not a decoded or browser-supplied user ID", async () => {
  assert.deepEqual(
    await authenticateWebMember("Bearer arbitrary-opaque-token", fetcher()),
    { id, email: "member@example.test", access: true, staff: false },
  );
  await assert.rejects(
    authenticateWebMember(undefined, fetcher()),
    (e) => e.status === 401,
  );
  await assert.rejects(
    authenticateWebMember(
      "Bearer bad",
      async () => new Response("", { status: 401 }),
    ),
    (e) => e.status === 401,
  );
});
test("unverified, anonymous, suspended, deleted and other-market identities are denied", async () => {
  for (const user of [{ email_confirmed_at: null }, { is_anonymous: true }])
    await assert.rejects(
      authenticateWebMember("Bearer token", fetcher({}, user)),
      (e) => e.status === 401,
    );
  for (const profile of [
    { market: "kr" },
    { market: "jp", suspended: true },
    { market: "jp", deletionRequested: true },
  ])
    await assert.rejects(
      authenticateWebMember("Bearer token", fetcher({ profile })),
      (e) => e.status === 403,
    );
  assert.equal(
    (await authenticateWebMember("Bearer token", fetcher({ access: "true" })))
      .access,
    false,
  );
});
test("notification job OIDC validates signature, audience, exact repo/main/workflow and event", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const claims = {
    repository: "Yuki-ux-jpg-png/line-ai-fortune-teller",
    ref: "refs/heads/main",
    workflow_ref:
      "Yuki-ux-jpg-png/line-ai-fortune-teller/.github/workflows/send-scheduled-readings.yml@refs/heads/main",
    event_name: "schedule",
  };
  const sign = (extra = {}, aud = operationsAudience) =>
    new SignJWT({ ...claims, ...extra })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer("https://token.actions.githubusercontent.com")
      .setSubject(
        "repo:Yuki-ux-jpg-png/line-ai-fortune-teller:ref:refs/heads/main",
      )
      .setAudience(aud)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
  await verifyOperationsToken(await sign(), async () => publicKey);
  for (const extra of [
    { repository: "other/repo" },
    { ref: "refs/heads/other" },
    { event_name: "pull_request" },
    { workflow_ref: "other" },
  ])
    await assert.rejects(
      verifyOperationsToken(await sign(extra), async () => publicKey),
    );
  await assert.rejects(
    verifyOperationsToken(
      await sign({}, "wrong-audience"),
      async () => publicKey,
    ),
  );
  const { publicKey: wrong } = await generateKeyPair("RS256");
  await assert.rejects(verifyOperationsToken(await sign(), async () => wrong));
});
