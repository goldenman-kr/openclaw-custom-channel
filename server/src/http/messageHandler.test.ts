import assert from "node:assert/strict";
import test from "node:test";
import { handlePostMessage } from "./messageHandler.js";
import type { OpenClawClient } from "../openclaw/OpenClawClient.js";
import { InMemorySessionStore } from "../session/SessionStore.js";

const fakeOpenClawClient: OpenClawClient = {
  async sendMessage(input) {
    return {
      reply: `reply:${input.message}`,
    };
  },
};

function deps() {
  return {
    openClawClient: fakeOpenClawClient,
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
