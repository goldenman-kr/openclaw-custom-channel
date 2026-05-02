import assert from "node:assert/strict";
import test from "node:test";
import { handlePostMessage } from "./messageHandler.js";
import type { ChatRuntime } from "../runtime/ChatRuntime.js";
import { InMemorySessionStore } from "../session/SessionStore.js";
import type { ConversationStore } from "../session/SqliteChatStore.js";

let capturedSessionId = "";
let capturedRuntimeWorkspaceUserDir = "";
let capturedUserId = "";

const fakeChatRuntime: ChatRuntime = {
  async sendMessage(input) {
    capturedSessionId = input.sessionId;
    capturedRuntimeWorkspaceUserDir = input.runtimeWorkspace?.userDir ?? "";
    capturedUserId = input.userId ?? "";
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
      ownerId: "admin",
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
    chatRuntime: fakeChatRuntime,
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

test("accepts cookie auth context without Authorization header", async () => {
  capturedUserId = "";
  const result = await handlePostMessage(
    {
      ...deps(),
      authContext: { user: { id: "usr_soprano", username: "soprano", displayName: "soprano", role: "user" }, source: "cookie" },
    },
    {},
    { message: "hello" },
  );

  assert.equal(result.statusCode, 200);
  assert.equal(capturedUserId, "usr_soprano");
});

test("passes runtime workspace to chat runtime", async () => {
  capturedRuntimeWorkspaceUserDir = "";
  const result = await handlePostMessage(
    {
      ...deps(),
      runtimeWorkspace: {
        userId: "usr_alice",
        username: "alice",
        displayName: "Alice",
        workspaceRoot: "/tmp/workspaces",
        userDir: "/tmp/workspaces/alice",
        commonDir: "/tmp/workspaces/common",
        commonWritable: false,
        identityFile: "/tmp/workspaces/alice/WEBCHAT_USER.md",
      },
    },
    { authorization: "Bearer test-key" },
    { message: "hello" },
  );

  assert.equal(result.statusCode, 200);
  assert.equal(capturedRuntimeWorkspaceUserDir, "/tmp/workspaces/alice");
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
