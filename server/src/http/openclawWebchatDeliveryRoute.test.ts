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
        getJob: () => null,
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

test("stores delivered message attachments for PWA history rendering", async () => {
  let savedAttachments: Array<{ name: string; mime_type: string; type: string; path: string }> | undefined;

  const handled = await handleOpenClawWebchatDeliveryRoute(
    requestStub(),
    responseStub(),
    new URL("http://localhost/internal/openclaw/webchat-delivery"),
    {
      conversationStore: {
        getConversation: (id: string) => ({ id, ownerUserId: "usr_test" }),
        getJob: () => null,
        updateMessage: () => null,
        addMessage: (message: { attachments?: Array<{ name: string; mime_type: string; type: string; path: string }> }) => {
          savedAttachments = message.attachments;
          return { ...message, id: "oc_test" };
        },
        updateJob: () => null,
      } as never,
      readJsonBody: async () => ({
        phase: "event",
        conversationId: "conv_test",
        messageId: "oc_test",
        text: "첨부입니다",
        mediaUrls: ["https://example.com/files/chart.png"],
      }),
      sendJson: () => {},
      publishConversationEvent: () => {},
      publishJobEvent: () => {},
      publishJobToken: () => {},
    },
  );

  assert.equal(handled, true);
  assert.deepEqual(savedAttachments, [
    {
      name: "chart.png",
      mime_type: "image/png",
      type: "image",
      path: "https://example.com/files/chart.png",
    },
  ]);
});

test("ignores late delivery for cancelled jobs", async () => {
  let statusCode = 0;
  let responseBody: unknown;
  let addMessageCalls = 0;
  let publishCalls = 0;
  let updateJobCalls = 0;

  const handled = await handleOpenClawWebchatDeliveryRoute(
    requestStub(),
    responseStub(),
    new URL("http://localhost/internal/openclaw/webchat-delivery"),
    {
      conversationStore: {
        getConversation: (id: string) => ({ id, ownerUserId: "usr_test" }),
        getJob: () => ({ id: "job_test", conversationId: "conv_test", state: "cancelled", error: null, createdAt: "", updatedAt: "" }),
        updateMessage: () => null,
        addMessage: () => {
          addMessageCalls += 1;
          return { id: "oc_test" };
        },
        updateJob: () => {
          updateJobCalls += 1;
          return null;
        },
      } as never,
      readJsonBody: async () => ({
        phase: "event",
        conversationId: "conv_test",
        jobId: "job_test",
        messageId: "oc_late",
        text: "late",
      }),
      sendJson: (_response, status, body) => {
        statusCode = status;
        responseBody = body;
      },
      publishConversationEvent: () => {
        publishCalls += 1;
      },
      publishJobEvent: () => {
        publishCalls += 1;
      },
      publishJobToken: () => {
        publishCalls += 1;
      },
    },
  );

  assert.equal(handled, true);
  assert.equal(statusCode, 200);
  assert.deepEqual(responseBody, { ok: true, ignored: true, reason: "job-cancelled" });
  assert.equal(addMessageCalls, 0);
  assert.equal(updateJobCalls, 0);
  assert.equal(publishCalls, 0);
});
