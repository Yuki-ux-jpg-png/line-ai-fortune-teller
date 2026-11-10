import {webServiceOrigin} from "./web-market.js";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
export const operationsAudience =
  webServiceOrigin+"/web/operations";
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
      "repository_id",
      "repository_owner_id",
      "ref",
      "workflow_ref",
      "event_name",
    ],
  });
  if (
    typeof p.sub !== "string" || !p.sub ||
    p.repository_id !== "1324948792" ||
    p.repository_owner_id !== "58500553" ||
    p.repository !== "Yuki-ux-jpg-png/line-ai-fortune-teller" ||
    p.ref !== "refs/heads/main" ||
    p.workflow_ref !==
      "Yuki-ux-jpg-png/line-ai-fortune-teller/.github/workflows/send-scheduled-readings.yml@refs/heads/main" ||
    !["schedule", "workflow_dispatch"].includes(String(p.event_name))
  )
    throw new Error("OIDC_UNAUTHORIZED");
}
