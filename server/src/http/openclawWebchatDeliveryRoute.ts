import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { HistoryAttachment } from "../session/HistoryStore.js";
import type { ConversationStore, JobStore, MessageStore } from "../session/SqliteChatStore.js";
import type { ConversationEventRecord } from "../events/ConversationEventPublisher.js";
import type { JobEventRecord, JobTokenEventRecord } from "../events/SseJobEventPublisher.js";

export interface WebchatDeliveryRouteDeps {
  conversationStore: ConversationStore & MessageStore & JobStore;
  readJsonBody(request: IncomingMessage): Promise<unknown>;
  sendJson(response: ServerResponse, statusCode: number, body: unknown): void;
  publishConversationEvent(event: ConversationEventRecord): void;
  publishJobEvent(event: JobEventRecord): void;
  publishJobToken(event: JobTokenEventRecord): void;
  cleanupEmptyPwaWebChatMirrorSession?(): void | Promise<void>;
}

interface WebchatDeliveryBody {
  phase?: string;
  conversationId?: string;
  jobId?: string;
  messageId?: string;
  text?: string;
  token?: string;
  createdAt?: string;
  mediaUrl?: string;
  mediaUrls?: unknown;
  attachments?: unknown;
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

function validPhase(phase: string | undefined): phase is "partial" | "boundary" | "final" | "error" | "event" {
  return phase === "partial" || phase === "boundary" || phase === "final" || phase === "error" || phase === "event";
}

function mimeTypeForName(name: string): string {
  const ext = extname(name).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".txt") return "text/plain";
  if (ext === ".md") return "text/markdown";
  if (ext === ".csv") return "text/csv";
  return "application/octet-stream";
}

function attachmentKindForName(name: string): "image" | "file" {
  return /^\.(png|jpe?g|webp|gif|svg)$/i.test(extname(name)) ? "image" : "file";
}

function collectDeliveryMediaRefs(body: WebchatDeliveryBody): string[] {
  const refs: string[] = [];
  const seen = new Set<string>();
  const push = (value: unknown) => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    refs.push(trimmed);
  };
  push(body.mediaUrl);
  if (Array.isArray(body.mediaUrls)) {
    for (const mediaUrl of body.mediaUrls) push(mediaUrl);
  }
  return refs;
}

function normalizeDeliveryAttachment(value: unknown): HistoryAttachment | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const path = typeof record.path === "string"
    ? record.path
    : typeof record.media === "string"
      ? record.media
      : typeof record.mediaUrl === "string"
        ? record.mediaUrl
        : typeof record.url === "string"
          ? record.url
          : "";
  if (!path.trim()) return null;
  const name = typeof record.name === "string" && record.name.trim()
    ? record.name.trim()
    : basename(path.startsWith("file://") ? new URL(path).pathname : path) || "download";
  const mimeType = typeof record.mime_type === "string" && record.mime_type.trim()
    ? record.mime_type.trim()
    : typeof record.mimeType === "string" && record.mimeType.trim()
      ? record.mimeType.trim()
      : mimeTypeForName(name);
  const size = typeof record.size === "number" && Number.isFinite(record.size) ? record.size : undefined;
  return {
    name,
    mime_type: mimeType,
    type: mimeType.startsWith("image/") ? "image" : attachmentKindForName(name),
    path,
    ...(size !== undefined ? { size } : {}),
  };
}

async function attachmentFromMediaRef(ref: string): Promise<HistoryAttachment | null> {
  if (/^https?:\/\//i.test(ref)) {
    const name = basename(new URL(ref).pathname) || "download";
    return {
      name,
      mime_type: mimeTypeForName(name),
      type: attachmentKindForName(name),
      path: ref,
    };
  }

  const localPath = ref.startsWith("file://") ? new URL(ref).pathname : ref;
  try {
    const fileStat = await stat(localPath);
    if (!fileStat.isFile()) return null;
    const name = basename(localPath);
    return {
      name,
      mime_type: mimeTypeForName(name),
      type: attachmentKindForName(name),
      path: localPath,
      size: fileStat.size,
    };
  } catch {
    return null;
  }
}

async function attachmentsFromDeliveryBody(body: WebchatDeliveryBody): Promise<HistoryAttachment[]> {
  const attachments: HistoryAttachment[] = [];
  const seen = new Set<string>();
  const push = (attachment: HistoryAttachment | null) => {
    if (!attachment || seen.has(attachment.path)) return;
    seen.add(attachment.path);
    attachments.push(attachment);
  };
  if (Array.isArray(body.attachments)) {
    for (const attachment of body.attachments) push(normalizeDeliveryAttachment(attachment));
  }
  for (const ref of collectDeliveryMediaRefs(body)) {
    push(await attachmentFromMediaRef(ref));
  }
  return attachments;
}

async function cleanupEmptyPwaWebChatMirrorSession(deps: WebchatDeliveryRouteDeps): Promise<void> {
  try {
    await deps.cleanupEmptyPwaWebChatMirrorSession?.();
  } catch (error) {
    console.warn(`OpenClaw webchat empty mirror cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
  }
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
  const job = body.jobId ? deps.conversationStore.getJob(body.jobId) : null;
  if (job?.state === "cancelled") {
    console.log(
      `OpenClaw webchat delivery ignored cancelled job phase=${body.phase} conversation=${body.conversationId} job=${body.jobId}`,
    );
    deps.sendJson(response, 200, { ok: true, ignored: true, reason: "job-cancelled" });
    return true;
  }

  if (body.phase === "boundary") {
    const existing = deps.conversationStore.updateMessage(messageId, { completedAt: now });
    if (existing) {
      deps.publishConversationEvent({
        id: `evt_${randomUUID()}`,
        type: "message",
        messageId,
        conversationId: conversation.id,
        createdAt: now,
      });
    }
    await cleanupEmptyPwaWebChatMirrorSession(deps);
    deps.sendJson(response, 200, { ok: true });
    return true;
  }

  const text = body.text ?? "";
  const attachments = await attachmentsFromDeliveryBody(body);
  const existing = deps.conversationStore.updateMessage(messageId, {
    role: body.phase === "error" ? "system" : "assistant",
    text,
    ...(body.jobId ? { jobId: body.jobId } : {}),
    completedAt: body.phase === "partial" ? null : now,
    ...(attachments.length > 0 ? { attachments } : {}),
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
      ...(attachments.length > 0 ? { attachments } : {}),
    });
  }

  if (body.phase === "partial") {
    const token = body.token ?? "";
    if (body.jobId && token) {
      deps.publishJobToken({ id: body.jobId, token });
    } else {
      deps.publishConversationEvent({
        id: `evt_${randomUUID()}`,
        type: "message",
        messageId,
        conversationId: conversation.id,
        createdAt: now,
      });
    }
    deps.sendJson(response, 200, { ok: true, messageId });
    return true;
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
  await cleanupEmptyPwaWebChatMirrorSession(deps);
  deps.sendJson(response, 200, { ok: true, messageId });
  return true;
}
