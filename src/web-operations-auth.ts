import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
export const operationsAudience =
  "https://line-fortune-bot-zs2z.onrender.com/web/operations";
const issuer = "https://token.actions.githubusercontent.com";
const keys = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks`), {
  timeoutDuration: 5000,
});
export async function verifyOperationsToken(
  token: string,
  key: JWTVerifyGetKey = keys,
) {
  if (token.length > 16000) throw new Error("OIDC_INVALID");
  const { payload: p } = await jwtVerify(token, key, {
    issuer,
    audience: operationsAudience,
    algorithms: ["RS256"],
    maxTokenAge: "10m",
    clockTolerance: 5,
    requiredClaims: [
      "sub",
      "exp",
      "iat",
      "repository",
      "ref",
      "workflow_ref",
      "event_name",
    ],
  });
  if (
    p.sub !==
      "repo:Yuki-ux-jpg-png/line-ai-fortune-teller:ref:refs/heads/main" ||
    p.repository !== "Yuki-ux-jpg-png/line-ai-fortune-teller" ||
    p.ref !== "refs/heads/main" ||
    p.workflow_ref !==
      "Yuki-ux-jpg-png/line-ai-fortune-teller/.github/workflows/send-scheduled-readings.yml@refs/heads/main" ||
    !["schedule", "workflow_dispatch"].includes(String(p.event_name))
  )
    throw new Error("OIDC_UNAUTHORIZED");
}
