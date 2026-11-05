import test from "node:test";
import assert from "node:assert/strict";
import { useTestEnvironment } from "./helpers/database.mjs";

useTestEnvironment();
const { pushMessage, replyMessage, guidedWelcomeMessage, textMessage } = await import("../dist/line.js");

test("guided topic buttons all contain usable postback text", () => {
  const actions = guidedWelcomeMessage().quickReply.items.map((item) => item.action);
  assert.deepEqual(actions.slice(0, 4).map((action) => action.label), ["恋愛", "仕事", "人間関係", "気持ちの整理"]);
  for (const action of actions.slice(0, 4)) {
    const parameters = new URLSearchParams(action.data);
    assert.equal(parameters.get("action"), "intake_topic");
    assert.equal(parameters.get("topic"), action.displayText);
    assert.ok(action.displayText?.length);
  }
  assert.equal(new URLSearchParams(actions[4].data).get("action"), "intake_cancel");
});

test("an accepted push retry after a lost response preserves the key and payload", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, headers: options.headers, body: options.body });
    if (requests.length === 1) throw new TypeError("response lost after acceptance");
    return new Response(null, { status: 409, headers: { "x-line-accepted-request-id": "accepted-request" } });
  });
  const send = () => pushMessage("test-user", [textMessage("test-result")], "00000000-0000-4000-8000-000000000001");
  await assert.rejects(send(), /response lost/);
  await send();
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0], requests[1]);
});

test("a generic 409 is not mistaken for an accepted message", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("conflict", { status: 409 }));
  await assert.rejects(pushMessage("test-user", [textMessage("test")], "test-retry"), /409/);
});

test("a reply conflict cannot use the push retry success path", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 409, headers: { "x-line-accepted-request-id": "accepted-request" } }));
  await assert.rejects(replyMessage("test-reply", [textMessage("test")]), /409/);
});

test("rate limits still fail so the delivery job can retain its retry state", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("rate limited", { status: 429 }));
  await assert.rejects(pushMessage("test-user", [textMessage("test")], "test-retry"), /429/);
});
