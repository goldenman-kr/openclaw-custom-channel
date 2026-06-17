import assert from "node:assert/strict";
import { test } from "node:test";

// @ts-expect-error public browser module intentionally has no TypeScript declaration.
const navigation = await import("../public/modules/navigation.js");

test("builds an absolute conversation URL for sharing", () => {
  assert.equal(
    navigation.conversationUrl("conv_4f7d0e28-6d71-423a-b7d6-67084f66ffc9", "https://ai.kryp.xyz"),
    "https://ai.kryp.xyz/chat/conv_4f7d0e28-6d71-423a-b7d6-67084f66ffc9",
  );
});

test("encodes conversation ids in share URLs", () => {
  assert.equal(
    navigation.conversationUrl("conv_with space", "https://ai.kryp.xyz"),
    "https://ai.kryp.xyz/chat/conv_with%20space",
  );
});
