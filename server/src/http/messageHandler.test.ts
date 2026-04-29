import assert from "node:assert/strict";
import test from "node:test";
import { handlePostMessage } from "./messageHandler.js";
import type { ChatRuntime } from "../runtime/ChatRuntime.js";
import { InMemorySessionStore } from "../session/SessionStore.js";

let fakeRuntimeCalls = 0;

const fakeChatRuntime: ChatRuntime = {
  async sendMessage(input) {
    fakeRuntimeCalls += 1;
    return {
      reply: `reply:${input.message}`,
    };
  },
};

function deps() {
  return {
    chatRuntime: fakeChatRuntime,
    sessionStore: new InMemorySessionStore(),
    validApiKeys: new Set(["test-key"]),
  };
}

test("accepts a valid message", async () => {
  const result = await handlePostMessage(
    deps(),
    {
      authorization: "Bearer test-key",
      "x-device-id": "abc-123",
    },
    {
      message: "hello",
    },
  );

  assert.equal(result.statusCode, 200);
  assert.equal("reply" in result.body, true);
  if ("reply" in result.body) {
    assert.equal(result.body.reply, "reply:hello");
    assert.equal(result.body.session_id, "mobile-abc-123");
    assert.match(result.body.request_id, /^req_/);
  }
});

test("rejects missing auth token", async () => {
  const result = await handlePostMessage(deps(), {}, { message: "hello" });

  assert.equal(result.statusCode, 401);
  assert.equal("error" in result.body, true);
  if ("error" in result.body) {
    assert.equal(result.body.error.code, "AUTH_MISSING_TOKEN");
  }
});

test("rejects blank message", async () => {
  const result = await handlePostMessage(
    deps(),
    { authorization: "Bearer test-key" },
    { message: "   " },
  );

  assert.equal(result.statusCode, 400);
  assert.equal("error" in result.body, true);
  if ("error" in result.body) {
    assert.equal(result.body.error.code, "VALIDATION_MESSAGE_REQUIRED");
  }
});

test("blocks direct /new command before calling OpenClaw", async () => {
  fakeRuntimeCalls = 0;
  const result = await handlePostMessage(
    deps(),
    { authorization: "Bearer test-key" },
    { message: "/new" },
  );

  assert.equal(result.statusCode, 400);
  assert.equal(fakeRuntimeCalls, 0);
  assert.equal("error" in result.body, true);
  if ("error" in result.body) {
    assert.equal(result.body.error.code, "VALIDATION_NEW_COMMAND_BLOCKED");
    assert.equal(result.body.error.message, "이 웹챗에서는 /new 대신 “새 대화 시작” 버튼을 사용해주세요.");
  }
});

test("rejects slash commands with attachments", async () => {
  const result = await handlePostMessage(
    deps(),
    { authorization: "Bearer test-key" },
    {
      message: "/status",
      attachments: [
        {
          type: "file",
          name: "notes.txt",
          mime_type: "text/plain",
          content_base64: "aGVsbG8=",
        },
      ],
    },
  );

  assert.equal(result.statusCode, 400);
  assert.equal("error" in result.body, true);
  if ("error" in result.body) {
    assert.equal(result.body.error.code, "VALIDATION_SLASH_WITH_ATTACHMENTS");
  }
});

test("passes runtime token callbacks to ChatRuntime", async () => {
  const tokens: string[] = [];
  const runtime: ChatRuntime = {
    async sendMessage(input) {
      await input.callbacks?.onToken?.("hello");
      await input.callbacks?.onToken?.(" world");
      return { reply: "done" };
    },
  };

  const result = await handlePostMessage(
    {
      chatRuntime: runtime,
      sessionStore: new InMemorySessionStore(),
      validApiKeys: new Set(["test-key"]),
      runtimeCallbacks: {
        onToken(token) {
          tokens.push(token);
        },
      },
    },
    { authorization: "Bearer test-key" },
    { message: "hello" },
  );

  assert.equal(result.statusCode, 200);
  assert.deepEqual(tokens, ["hello", " world"]);
});
