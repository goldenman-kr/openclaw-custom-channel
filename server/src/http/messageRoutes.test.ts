import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SqliteChatStore } from "../session/SqliteChatStore.js";
import { handleMessageRoute } from "./messageRoutes.js";

test("links a queued user message and pending bubble to the same job", async () => {
  const dir = mkdtempSync(join(tmpdir(), "openclaw-message-route-"));
  const store = new SqliteChatStore(join(dir, "chat.sqlite"));
  try {
    const conversation = store.createConversation({ ownerId: "usr_test" });
    let responseStatus = 0;
    let responseBody: { job_id?: string } | undefined;
    let enqueued = false;
    const handled = await handleMessageRoute(
      { method: "POST", headers: {} } as IncomingMessage,
      {} as ServerResponse,
      new URL("http://localhost/v1/message"),
      {
        chatRuntime: {} as never,
        sessionStore: {} as never,
        validApiKeys: new Set(),
        getAuthContext: () => ({ user: { id: "usr_test", username: "test", displayName: "Test", role: "admin", enabled: true } as never, source: "cookie" }),
        isConversationVisibleToAuth: () => true,
        conversationStore: store,
        historyStore: {} as never,
        sendJson: (_response, statusCode, body) => {
          responseStatus = statusCode;
          responseBody = body as { job_id?: string };
        },
        readJsonBody: async () => ({ conversation_id: conversation.id, message: "두 번째 대기 요청" }),
        sessionIdFromRequest: () => conversation.id,
        persistConversationUserMessage: async (_conversation, payload) => store.addMessage({
          conversationId: conversation.id,
          role: "user",
          text: payload.message,
        }),
        persistUserHistory: async () => {},
        enqueueMessageJob: () => { enqueued = true; },
        registerJob: () => {},
        shouldPersistMessage: () => true,
      },
    );

    assert.equal(handled, true);
    assert.equal(responseStatus, 202);
    assert.equal(enqueued, true);
    assert.match(responseBody?.job_id ?? "", /^job_/);
    const messages = store.listMessages(conversation.id);
    assert.equal(messages.length, 2);
    assert.deepEqual(new Set(messages.map((message) => message.jobId)), new Set([responseBody?.job_id]));
    assert.deepEqual(new Set(messages.map((message) => message.jobState)), new Set(["queued"]));
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
