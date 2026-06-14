import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import test from "node:test";
import { handleOpenClawWebchatDeliveryRoute } from "./openclawWebchatDeliveryRoute.js";

function requestStub(): IncomingMessage {
  return {
    method: "POST",
    headers: {
      "x-openclaw-webchat-secret": process.env.OPENCLAW_WEBCHAT_DELIVERY_SECRET ?? process.env.OPENCLAW_GATEWAY_TOKEN ?? "",
    },
  } as unknown as IncomingMessage;
}

function responseStub(): ServerResponse {
  return {} as ServerResponse;
}

test("cleans the empty PWA outbound mirror session after delivered event messages", async () => {
  let cleanupCalls = 0;
  let statusCode = 0;
  let responseBody: unknown;
  const messages = new Map<string, unknown>();

  const handled = await handleOpenClawWebchatDeliveryRoute(
    requestStub(),
    responseStub(),
    new URL("http://localhost/internal/openclaw/webchat-delivery"),
    {
      conversationStore: {
        getConversation: (id: string) => ({ id, ownerUserId: "usr_test" }),
        updateMessage: () => null,
        addMessage: (message: { id?: string }) => {
          const id = message.id ?? "message-id";
          messages.set(id, message);
          return { ...message, id };
        },
        updateJob: () => null,
      } as never,
      readJsonBody: async () => ({
        phase: "event",
        conversationId: "conv_test",
        jobId: "job_test",
        messageId: "oc_test",
        text: "delivered",
      }),
      sendJson: (_response, status, body) => {
        statusCode = status;
        responseBody = body;
      },
      publishConversationEvent: () => {},
      publishJobEvent: () => {},
      publishJobToken: () => {},
      cleanupEmptyPwaWebChatMirrorSession: () => {
        cleanupCalls += 1;
      },
    },
  );

  assert.equal(handled, true);
  assert.equal(statusCode, 200);
  assert.deepEqual(responseBody, { ok: true, messageId: "oc_test" });
  assert.equal(messages.size, 1);
  assert.equal(cleanupCalls, 1);
});
