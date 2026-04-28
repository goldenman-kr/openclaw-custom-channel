import assert from "node:assert/strict";
import test from "node:test";
import { handlePostMessage } from "./messageHandler.js";
import type { OpenClawClient } from "../openclaw/OpenClawClient.js";
import { InMemorySessionStore } from "../session/SessionStore.js";
import type { ConversationStore } from "../session/SqliteChatStore.js";

let capturedSessionId = "";

const fakeOpenClawClient: OpenClawClient = {
  async sendMessage(input) {
    capturedSessionId = input.sessionId;
    return { reply: `reply:${input.message}` };
  },
};

const conversationStore: Pick<ConversationStore, "getConversation"> = {
  getConversation(id) {
    if (id !== "conv_test") {
      return null;
    }
    return {
      id: "conv_test",
      title: "테스트 대화",
      openclawSessionId: "openclaw-session-test",
      createdAt: "2026-04-29T00:00:00.000Z",
      updatedAt: "2026-04-29T00:00:00.000Z",
      pinned: false,
    };
  },
};

function deps() {
  return {
    openClawClient: fakeOpenClawClient,
    sessionStore: new InMemorySessionStore(),
    validApiKeys: new Set(["test-key"]),
    conversationStore,
  };
}

test("uses conversation openclawSessionId when conversation_id is provided", async () => {
  capturedSessionId = "";
  const result = await handlePostMessage(
    deps(),
    {
      authorization: "Bearer test-key",
      "x-device-id": "legacy-device",
    },
    {
      conversation_id: "conv_test",
      message: "hello",
    },
  );

  assert.equal(result.statusCode, 200);
  assert.equal(capturedSessionId, "openclaw-session-test");
  assert.equal("reply" in result.body, true);
  if ("reply" in result.body) {
    assert.equal(result.body.session_id, "openclaw-session-test");
    assert.equal(result.body.conversation_id, "conv_test");
  }
});

test("returns 404 for unknown conversation_id", async () => {
  const result = await handlePostMessage(
    deps(),
    { authorization: "Bearer test-key" },
    {
      conversation_id: "missing",
      message: "hello",
    },
  );

  assert.equal(result.statusCode, 404);
  assert.equal("error" in result.body, true);
  if ("error" in result.body) {
    assert.equal(result.body.error.code, "CONVERSATION_NOT_FOUND");
  }
});
