import assert from "node:assert/strict";
import test from "node:test";
import { extractGatewayChatDelta } from "./GatewayNativeOpenClawClient.js";

test("extracts native Gateway chat deltaText as stream token", () => {
  const delta = extractGatewayChatDelta({
    state: "delta",
    deltaText: "hello",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "hello" }],
    },
  });

  assert.deepEqual(delta, { token: "hello", text: "hello" });
});
test("extracts native Gateway chat token from accumulated message text", () => {
  const delta = extractGatewayChatDelta({
    state: "delta",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "hello world" }],
    },
  }, "hello");

  assert.deepEqual(delta, { token: " world", text: "hello world" });
});

test("skips replacement deltas that cannot be appended without duplicating text", () => {
  const delta = extractGatewayChatDelta({
    state: "delta",
    replace: true,
    deltaText: "new text",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "new text" }],
    },
  }, "old text");

  assert.equal(delta, null);
});
