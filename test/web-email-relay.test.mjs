import test from "node:test";
import assert from "node:assert/strict";
import {
  emailDelivery,
  emailDeliveryAudience,
} from "../dist/web-email-relay.js";
test("email relay uses its fixed HTTPS destination and separate short-lived authorization", async () => {
  let call;
  const result = await emailDelivery(
    "Bearer test-mail-audience-token",
    { preflight: true },
    async (url, init) => {
      call = { url, init };
      return Response.json({ smtpVerified: 1 });
    },
  );
  assert.equal(result.smtpVerified, 1);
  assert.equal(call.url, emailDeliveryAudience);
  assert.equal(call.init.redirect, "error");
  assert.equal(
    call.init.headers.Authorization,
    "Bearer test-mail-audience-token",
  );
  assert.deepEqual(JSON.parse(call.init.body), { preflight: true });
  await assert.rejects(
    emailDelivery("", { preflight: true }, async () => {
      throw new Error("must not connect");
    }),
    /EMAIL_JOB_AUTHORIZATION/,
  );
  await assert.rejects(
    emailDelivery(
      "Bearer invalid",
      { preflight: true },
      async () => new Response("", { status: 401 }),
    ),
    /EMAIL_DELIVERY_401/,
  );
});
