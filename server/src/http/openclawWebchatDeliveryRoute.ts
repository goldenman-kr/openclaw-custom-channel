import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import type { ConversationStore, JobStore, MessageStore } from "../session/SqliteChatStore.js";
import type { ConversationEventRecord } from "../events/ConversationEventPublisher.js";
import type { JobEventRecord } from "../events/SseJobEventPublisher.js";

export interface WebchatDeliveryRouteDeps {
  conversationStore: ConversationStore & MessageStore & JobStore;
  readJsonBody(request: IncomingMessage): Promise<unknown>;
  sendJson(response: ServerResponse, statusCode: number, body: unknown): void;
  publishConversationEvent(event: ConversationEventRecord): void;
  publishJobEvent(event: JobEventRecord): void;
}

interface WebchatDeliveryBody {
  phase?: string;
  conversationId?: string;
  jobId?: string;
  messageId?: string;
  text?: string;
  createdAt?: string;
}

const DELIVERY_PATH = "/internal/openclaw/webchat-delivery";

function getSingleHeader(headers: IncomingMessage["headers"], name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function safeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function isAuthorized(request: IncomingMessage): boolean {
  const expected = process.env.OPENCLAW_WEBCHAT_DELIVERY_SECRET || process.env.OPENCLAW_GATEWAY_TOKEN || "";
  if (!expected) {
    return process.env.NODE_ENV !== "production";
  }
  const actual = getSingleHeader(request.headers, "x-openclaw-webchat-secret") ?? "";
  return safeEquals(actual, expected);
}

function readBody(value: unknown): WebchatDeliveryBody | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as WebchatDeliveryBody;
}

function validPhase(phase: string | undefined): phase is "partial" | "boundary" | "final" | "error" {
  return phase === "partial" || phase === "boundary" || phase === "final" || phase === "error";
}

export async function handleOpenClawWebchatDeliveryRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  deps: WebchatDeliveryRouteDeps,
): Promise<boolean> {
  if (request.method !== "POST" || url.pathname !== DELIVERY_PATH) {
    return false;
  }

  if (!isAuthorized(request)) {
    deps.sendJson(response, 401, { ok: false, error: "unauthorized" });
    return true;
  }

  const body = readBody(await deps.readJsonBody(request));
  if (!body || !validPhase(body.phase) || !body.conversationId) {
    deps.sendJson(response, 400, { ok: false, error: "invalid webchat delivery payload" });
    return true;
  }

  console.log(
    `OpenClaw webchat delivery phase=${body.phase} conversation=${body.conversationId} job=${body.jobId ?? ""} chars=${body.text?.length ?? 0}`,
  );

  const conversation = deps.conversationStore.getConversation(body.conversationId);
  if (!conversation) {
    deps.sendJson(response, 404, { ok: false, error: "conversation not found" });
    return true;
  }

  const now = body.createdAt || new Date().toISOString();
  const messageId = body.messageId?.trim() || `oc_${randomUUID()}`;

  if (body.phase === "boundary") {
    deps.conversationStore.updateMessage(messageId, { completedAt: now });
    deps.sendJson(response, 200, { ok: true });
    return true;
  }

  const text = body.text ?? "";
  const existing = deps.conversationStore.updateMessage(messageId, {
    role: body.phase === "error" ? "system" : "assistant",
    text,
    ...(body.jobId ? { jobId: body.jobId } : {}),
    completedAt: body.phase === "partial" ? null : now,
  });

  if (!existing) {
    deps.conversationStore.addMessage({
      id: messageId,
      conversationId: conversation.id,
      role: body.phase === "error" ? "system" : "assistant",
      text,
      ...(body.jobId ? { jobId: body.jobId } : {}),
      createdAt: now,
      completedAt: body.phase === "partial" ? null : now,
    });
  }

  if (body.phase === "final" && body.jobId) {
    deps.conversationStore.updateJob(body.jobId, { state: "completed", error: null, now });
    deps.publishJobEvent({ id: body.jobId, state: "completed" });
  }

  deps.publishConversationEvent({
    id: `evt_${randomUUID()}`,
    type: "message",
    messageId,
    conversationId: conversation.id,
    createdAt: now,
  });
  deps.sendJson(response, 200, { ok: true, messageId });
  return true;
}
