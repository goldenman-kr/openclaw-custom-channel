import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import {
  API_CONTRACT_V1,
  extractBearerToken,
  validateMessageRequestDto,
  type ErrorResponseDto,
  type MessageRequestDto,
} from "./contracts/apiContractV1.js";
import { handlePostMessage } from "./http/messageHandler.js";
import { createOpenClawClient } from "./openclaw/createOpenClawClient.js";
import { deleteOpenClawSession } from "./openclaw/SessionCleaner.js";
import { FileHistoryStore, type HistoryAttachment } from "./session/HistoryStore.js";
import { InMemorySessionStore } from "./session/SessionStore.js";
import { SqliteChatStore, type ChatMessageRecord, type ConversationRecord } from "./session/SqliteChatStore.js";

const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 29999);
const validApiKeys = new Set(
  (process.env.BRIDGE_API_KEYS ?? "dev-api-key")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean),
);

const openClawClient = createOpenClawClient();
const sessionStore = new InMemorySessionStore();
const historyDir = resolve(process.env.HISTORY_DIR ?? join(process.cwd(), "state", "history"));
const historyStore = new FileHistoryStore(historyDir);
const publicDir = resolve(process.env.PUBLIC_DIR ?? join(process.cwd(), "public"));
const stateDir = resolve(process.cwd(), "state");
const historyMediaDir = resolve(process.env.HISTORY_MEDIA_DIR ?? join(stateDir, "history-media"));
const chatStore = new SqliteChatStore(resolve(process.env.CHAT_DB_PATH ?? join(stateDir, "chat.sqlite")));
const openClawAgentId = process.env.OPENCLAW_AGENT ?? "main";
type JobState = "queued" | "running" | "completed" | "failed";

interface MessageJob {
  id: string;
  sessionId: string;
  conversationId?: string;
  state: JobState;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

const jobs = new Map<string, MessageJob>();
const jobQueueTails = new Map<string, Promise<void>>();

const mediaRoots = [
  resolve(process.env.MEDIA_ROOT ?? "/home/orbsian/.openclaw/workspace"),
  resolve(process.env.OPENCLAW_MEDIA_DIR ?? "/home/orbsian/.openclaw/media"),
  resolve(process.env.UPLOAD_DIR ?? join(process.cwd(), "state", "uploads")),
  stateDir,
];

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "authorization,content-type,x-device-id,x-user-id,x-openclaw-sync",
};

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    ...corsHeaders,
  });
  response.end(JSON.stringify(body));
}

function contentTypeFor(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
    case ".webmanifest":
      return "application/manifest+json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".pdf":
      return "application/pdf";
    case ".txt":
      return "text/plain; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

async function tryServeStatic(urlPathname: string, response: ServerResponse): Promise<boolean> {
  const pathname = decodeURIComponent(urlPathname);
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const normalizedPath = normalize(relativePath);
  if (normalizedPath.startsWith("..") || normalizedPath.includes("/../")) {
    return false;
  }

  let filePath = resolve(publicDir, normalizedPath);
  if (!filePath.startsWith(`${publicDir}/`) && filePath !== publicDir) {
    return false;
  }

  try {
    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) {
      filePath = resolve(filePath, "index.html");
    } else if (!fileStat.isFile()) {
      return false;
    }
  } catch {
    return false;
  }

  response.writeHead(200, {
    "content-type": contentTypeFor(filePath),
    "cache-control": filePath.endsWith("index.html") ? "no-cache" : "public, max-age=3600",
  });
  createReadStream(filePath).pipe(response);
  return true;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  return rawBody ? JSON.parse(rawBody) : {};
}

function invalidJsonResponse(): ErrorResponseDto {
  return {
    error: {
      code: "VALIDATION_MESSAGE_REQUIRED",
      message: "Request body must be valid JSON.",
    },
    request_id: "req_unavailable",
  };
}

function getSingleHeader(headers: IncomingMessage["headers"], name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function sessionIdFromHeaders(request: IncomingMessage): string {
  return sessionStore.getSessionId({
    deviceId: getSingleHeader(request.headers, "x-device-id"),
    userId: getSingleHeader(request.headers, "x-user-id"),
  });
}

function shouldPersistMessage(message: string): boolean {
  return message.trim() !== "연결 테스트입니다. OK만 답해주세요.";
}

function statusForErrorCode(code: ErrorResponseDto["error"]["code"]): number {
  switch (code) {
    case "AUTH_INVALID_TOKEN":
    case "AUTH_MISSING_TOKEN":
      return 401;
    case "CONVERSATION_NOT_FOUND":
      return 404;
    case "UPSTREAM_OPENCLAW_TIMEOUT":
      return 504;
    case "UPSTREAM_OPENCLAW_UNAVAILABLE":
      return 502;
    case "INTERNAL_SERVER_ERROR":
      return 500;
    default:
      return 400;
  }
}

function makeErrorResponse(code: ErrorResponseDto["error"]["code"], message: string, details?: Record<string, unknown>): ErrorResponseDto {
  return {
    error: { code, message, ...(details ? { details } : {}) },
    request_id: "req_unavailable",
  };
}

function validateAuthorizedMessage(request: IncomingMessage, payload: MessageRequestDto): ErrorResponseDto | null {
  const tokenOrError = extractBearerToken(getSingleHeader(request.headers, "authorization"));
  if (typeof tokenOrError !== "string") {
    return makeErrorResponse(tokenOrError.code, tokenOrError.message, tokenOrError.details);
  }
  if (!validApiKeys.has(tokenOrError)) {
    return makeErrorResponse("AUTH_INVALID_TOKEN", "API key is invalid.");
  }
  const validationError = validateMessageRequestDto(payload);
  if (validationError) {
    return makeErrorResponse(validationError.code, validationError.message, validationError.details);
  }
  return null;
}

function formatUserHistoryText(payload: MessageRequestDto): string {
  const attachments = payload.attachments ?? [];
  if (attachments.length === 0) {
    return payload.message;
  }

  const summary = attachments
    .map((attachment) => `- ${attachment.name} (${attachment.mime_type}, ${attachment.type})`)
    .join("\n");
  return `${payload.message}\n\n첨부 파일:\n${summary}`;
}

function safeFileName(name: string, fallback: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.replace(/[^a-zA-Z0-9가-힣._ -]/g, "_") : fallback;
}

async function persistUserHistory(sessionId: string, payload: MessageRequestDto): Promise<void> {
  if (!shouldPersistMessage(payload.message)) {
    return;
  }
  const attachments = await saveHistoryAttachments(sessionId, payload);
  await historyStore.append(sessionId, [
    {
      role: "user",
      text: formatUserHistoryText(payload),
      savedAt: new Date().toISOString(),
      ...(attachments.length > 0 ? { attachments } : {}),
    },
  ]);
}

async function saveHistoryAttachments(sessionId: string, payload: MessageRequestDto): Promise<HistoryAttachment[]> {
  const attachments = payload.attachments ?? [];
  if (attachments.length === 0) {
    return [];
  }

  const safeSessionId = sessionId.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const targetDir = join(historyMediaDir, safeSessionId, randomUUID());
  await mkdir(targetDir, { recursive: true });

  return Promise.all(
    attachments.map(async (attachment, index) => {
      const name = safeFileName(attachment.name, `attachment-${index + 1}`);
      const path = join(targetDir, `${index + 1}-${name}`);
      const buffer = Buffer.from(attachment.content_base64, "base64");
      await writeFile(path, buffer);
      return {
        name: attachment.name,
        mime_type: attachment.mime_type,
        type: attachment.type,
        path,
        size: buffer.byteLength,
      };
    }),
  );
}

function isAuthorized(request: IncomingMessage): boolean {
  const tokenOrError = extractBearerToken(getSingleHeader(request.headers, "authorization"));
  return typeof tokenOrError === "string" && validApiKeys.has(tokenOrError);
}

function isWithinRoot(filePath: string, root: string): boolean {
  return filePath === root || filePath.startsWith(`${root}/`);
}

function resolveAllowedMediaPath(rawPath: string): string | null {
  const filePath = resolve(rawPath);
  return mediaRoots.some((root) => isWithinRoot(filePath, root)) ? filePath : null;
}

async function serveMediaFile(request: IncomingMessage, response: ServerResponse, rawPath: string): Promise<void> {
  if (!isAuthorized(request)) {
    sendJson(response, 401, {
      error: {
        code: "AUTH_INVALID_TOKEN",
        message: "API key is invalid.",
      },
      request_id: "req_unavailable",
    } satisfies ErrorResponseDto);
    return;
  }

  const filePath = resolveAllowedMediaPath(rawPath);
  if (!filePath) {
    sendJson(response, 403, {
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Media path is not allowed.",
      },
      request_id: "req_unavailable",
    } satisfies ErrorResponseDto);
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      throw new Error("not a file");
    }
    response.writeHead(200, {
      "content-type": contentTypeFor(filePath),
      "content-length": String(fileStat.size),
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(filePath.split("/").pop() ?? "media")}`,
      ...corsHeaders,
    });
    createReadStream(filePath).pipe(response);
  } catch {
    sendJson(response, 404, {
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Media file not found.",
      },
      request_id: "req_unavailable",
    } satisfies ErrorResponseDto);
  }
}

function updateJob(job: MessageJob, patch: Partial<Pick<MessageJob, "state" | "error">>): void {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  jobs.set(job.id, job);
  if (job.conversationId) {
    chatStore.updateJob(job.id, {
      ...(patch.state ? { state: patch.state } : {}),
      ...(patch.error !== undefined ? { error: patch.error } : {}),
      now: job.updatedAt,
    });
  }
}

function jobForRequest(jobId: string, request: IncomingMessage, url: URL): MessageJob | ReturnType<typeof chatStore.getJob> | null {
  const job = jobs.get(jobId) ?? chatStore.getJob(jobId);
  const conversationId = url.searchParams.get("conversation_id")?.trim();
  if (job && "conversationId" in job && job.conversationId) {
    return job.conversationId === conversationId ? job : null;
  }
  const sessionId = sessionIdFromHeaders(request);
  if (job && "sessionId" in job && job.sessionId === sessionId) {
    return job;
  }
  return null;
}

function writeSseEvent(response: ServerResponse, event: string, data: unknown): void {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

function serveJobEvents(request: IncomingMessage, response: ServerResponse, url: URL, jobId: string): void {
  if (!isAuthorized(request)) {
    sendJson(response, 401, makeErrorResponse("AUTH_INVALID_TOKEN", "API key is invalid."));
    return;
  }

  const initialJob = jobForRequest(jobId, request, url);
  if (!initialJob) {
    sendJson(response, 404, makeErrorResponse("INTERNAL_SERVER_ERROR", "Job not found."));
    return;
  }

  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    ...corsHeaders,
  });

  const sendCurrent = (): boolean => {
    const job = jobForRequest(jobId, request, url);
    if (!job) {
      writeSseEvent(response, "expired", { id: jobId, state: "expired" });
      return true;
    }
    writeSseEvent(response, "job", job);
    return job.state === "completed" || job.state === "failed";
  };

  if (sendCurrent()) {
    response.end();
    return;
  }

  const interval = setInterval(() => {
    if (sendCurrent()) {
      clearInterval(interval);
      response.end();
    }
  }, 2000);

  request.on("close", () => clearInterval(interval));
}

function jobQueueKey(job: MessageJob): string {
  return job.conversationId ? `conversation:${job.conversationId}` : `session:${job.sessionId}`;
}

function enqueueMessageJob(job: MessageJob, headers: IncomingMessage["headers"], payload: MessageRequestDto): void {
  const key = jobQueueKey(job);
  const previousTail = jobQueueTails.get(key) ?? Promise.resolve();
  const nextTail = previousTail
    .catch(() => {})
    .then(() => runMessageJob(job, headers, payload))
    .catch(async (error) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (shouldPersistMessage(payload.message)) {
        const savedAt = new Date().toISOString();
        if (job.conversationId) {
          chatStore.updateMessage(job.id, { role: "system", text: `전송 실패: ${errorMessage}` });
        } else {
          await historyStore.replaceById(job.sessionId, job.id, {
            role: "system",
            text: `전송 실패: ${errorMessage}`,
            savedAt,
          }).catch(() => {});
        }
      }
      updateJob(job, { state: "failed", error: errorMessage });
    })
    .finally(() => {
      if (jobQueueTails.get(key) === nextTail) {
        jobQueueTails.delete(key);
      }
    });
  jobQueueTails.set(key, nextTail);
}

async function runMessageJob(job: MessageJob, headers: IncomingMessage["headers"], payload: MessageRequestDto): Promise<void> {
  updateJob(job, { state: "running" });
  if (job.conversationId && shouldPersistMessage(payload.message)) {
    chatStore.updateMessage(job.id, {
      role: "assistant",
      text: "응답을 처리 중입니다…",
    });
  }
  const result = await handlePostMessage(
    {
      openClawClient,
      sessionStore,
      validApiKeys,
      conversationStore: chatStore,
    },
    headers,
    payload,
  );

  if (result.statusCode >= 200 && result.statusCode < 300 && "reply" in result.body) {
    if (shouldPersistMessage(payload.message)) {
      const text = sanitizeAssistantReply(result.body.reply);
      const savedAt = new Date().toISOString();
      if (job.conversationId) {
        chatStore.updateMessage(job.id, {
          role: "assistant",
          text,
        });
      } else {
        await historyStore.replaceById(job.sessionId, job.id, {
          role: "assistant",
          text,
          savedAt,
        });
      }
    }
    updateJob(job, { state: "completed" });
    return;
  }

  const errorMessage = "error" in result.body ? result.body.error.message : "OpenClaw request failed.";
  if (shouldPersistMessage(payload.message)) {
    const text = `전송 실패: ${errorMessage}`;
    const savedAt = new Date().toISOString();
    if (job.conversationId) {
      chatStore.updateMessage(job.id, { role: "system", text });
    } else {
      await historyStore.replaceById(job.sessionId, job.id, {
        role: "system",
        text,
        savedAt,
      });
    }
  }
  updateJob(job, { state: "failed", error: errorMessage });
}

function sanitizeAssistantReply(reply: string): string {
  const extracted = extractEmbeddedPayloadText(reply);
  if (extracted) {
    return extracted;
  }

  const looksLikeRawAgentOutput =
    reply.includes('"payloads"') ||
    reply.includes('"systemPromptReport"') ||
    reply.includes('Gateway agent failed; falling back to embedded') ||
    reply.includes('Gateway target: ws://') ||
    reply.includes('Config: /home/');

  if (looksLikeRawAgentOutput) {
    return "응답은 완료됐지만 내부 출력 형식이 섞여 표시되지 않도록 차단했습니다.";
  }

  return reply;
}

function extractEmbeddedPayloadText(text: string): string | null {
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    return null;
  }

  try {
    const parsed = JSON.parse(text.slice(firstBrace, lastBrace + 1)) as { payloads?: Array<{ text?: unknown }>; result?: { payloads?: Array<{ text?: unknown }> } };
    const directText = parsed.payloads?.[0]?.text;
    if (typeof directText === "string" && directText.trim()) {
      return directText.trim();
    }
    const resultText = parsed.result?.payloads?.[0]?.text;
    if (typeof resultText === "string" && resultText.trim()) {
      return resultText.trim();
    }
  } catch {
    return null;
  }

  return null;
}

function normalizeHistoryAttachment(value: unknown): HistoryAttachment | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.name !== "string" ||
    typeof candidate.mime_type !== "string" ||
    typeof candidate.path !== "string" ||
    !["image", "file"].includes(String(candidate.type))
  ) {
    return null;
  }
  return {
    name: candidate.name,
    mime_type: candidate.mime_type,
    type: candidate.type as "image" | "file",
    path: candidate.path,
    ...(typeof candidate.size === "number" ? { size: candidate.size } : {}),
  };
}

function normalizeHistoryMessages(payload: unknown) {
  const rawMessages =
    typeof payload === "object" && payload !== null && Array.isArray((payload as { messages?: unknown }).messages)
      ? (payload as { messages: unknown[] }).messages
      : [];

  return rawMessages
    .filter((item): item is { role: string; text: string; savedAt?: string; attachments?: unknown[] } => {
      if (typeof item !== "object" || item === null) {
        return false;
      }
      const candidate = item as Record<string, unknown>;
      return (
        ["user", "assistant", "system"].includes(String(candidate.role)) &&
        typeof candidate.text === "string" &&
        candidate.text.trim().length > 0
      );
    })
    .map((item) => {
      const attachments = Array.isArray(item.attachments)
        ? item.attachments.map(normalizeHistoryAttachment).filter((attachment): attachment is HistoryAttachment => Boolean(attachment))
        : [];
      return {
        role: item.role as "user" | "assistant" | "system",
        text: item.text,
        savedAt: typeof item.savedAt === "string" ? item.savedAt : new Date().toISOString(),
        ...(attachments.length > 0 ? { attachments } : {}),
      };
    });
}

function conversationToDto(conversation: ConversationRecord) {
  return {
    id: conversation.id,
    title: conversation.title,
    created_at: conversation.createdAt,
    updated_at: conversation.updatedAt,
    ...(conversation.archivedAt ? { archived_at: conversation.archivedAt } : {}),
    pinned: conversation.pinned,
  };
}

function chatMessageToHistoryDto(message: ChatMessageRecord) {
  return {
    id: message.id,
    role: message.role,
    text: message.text,
    savedAt: message.createdAt,
    ...(message.attachments && message.attachments.length > 0 ? { attachments: message.attachments } : {}),
  };
}

function conversationIdFromPath(pathname: string, suffix = ""): string | null {
  const prefix = "/v1/conversations/";
  if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) {
    return null;
  }
  const raw = pathname.slice(prefix.length, suffix ? -suffix.length : undefined);
  if (!raw || raw.includes("/")) {
    return null;
  }
  return decodeURIComponent(raw);
}

function titleFromPayload(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }
  const title = (payload as { title?: unknown }).title;
  return typeof title === "string" && title.trim() ? title.trim().slice(0, 120) : undefined;
}

function pinnedFromPayload(payload: unknown): boolean | undefined {
  if (typeof payload !== "object" || payload === null || !("pinned" in payload)) {
    return undefined;
  }
  return Boolean((payload as { pinned?: unknown }).pinned);
}

function conversationIdFromPayload(payload: MessageRequestDto): string | null {
  return typeof payload.conversation_id === "string" && payload.conversation_id.trim() ? payload.conversation_id.trim() : null;
}

function titleFromMessage(message: string): string {
  const firstLine = message.replace(/\s+/g, " ").trim();
  if (!firstLine) {
    return "새 대화";
  }
  return firstLine.length > 40 ? `${firstLine.slice(0, 40)}…` : firstLine;
}

async function persistConversationUserMessage(conversation: ConversationRecord, payload: MessageRequestDto): Promise<void> {
  if (!shouldPersistMessage(payload.message)) {
    return;
  }
  const isFirstMessage = chatStore.listMessages(conversation.id, { limit: 1 }).length === 0;
  const attachments = await saveHistoryAttachments(conversation.openclawSessionId, payload);
  chatStore.addMessage({
    conversationId: conversation.id,
    role: "user",
    text: formatUserHistoryText(payload),
    attachments,
  });
  if (isFirstMessage && conversation.title === "새 대화") {
    chatStore.updateConversation(conversation.id, { title: titleFromMessage(payload.message) });
  }
}

function getConversationForMessage(payload: MessageRequestDto): ConversationRecord | null {
  const conversationId = conversationIdFromPayload(payload);
  return conversationId ? chatStore.getConversation(conversationId) : null;
}

function conversationHistoryResponse(conversation: ConversationRecord) {
  const messages = chatStore.listMessages(conversation.id).map(chatMessageToHistoryDto);
  return {
    version: `${conversation.updatedAt}:${messages.length}`,
    size: messages.length,
    mtimeMs: Date.parse(conversation.updatedAt) || 0,
    conversation: conversationToDto(conversation),
    messages,
  };
}

function conversationFromQuery(url: URL): ConversationRecord | null {
  const conversationId = url.searchParams.get("conversation_id")?.trim();
  return conversationId ? chatStore.getConversation(conversationId) : null;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (request.method === "OPTIONS") {
    response.writeHead(204, corsHeaders);
    response.end();
    return;
  }

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, {
      status: "ok",
      transport: process.env.OPENCLAW_TRANSPORT ?? "cli",
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/v1/media") {
    await serveMediaFile(request, response, url.searchParams.get("path") ?? "");
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/v1/jobs/") && url.pathname.endsWith("/events")) {
    const jobId = decodeURIComponent(url.pathname.slice("/v1/jobs/".length, -"/events".length));
    serveJobEvents(request, response, url, jobId);
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/v1/jobs/")) {
    if (!isAuthorized(request)) {
      sendJson(response, 401, makeErrorResponse("AUTH_INVALID_TOKEN", "API key is invalid."));
      return;
    }
    const jobId = decodeURIComponent(url.pathname.slice("/v1/jobs/".length));
    const job = jobForRequest(jobId, request, url);
    if (!job) {
      sendJson(response, 404, makeErrorResponse("INTERNAL_SERVER_ERROR", "Job not found."));
      return;
    }
    sendJson(response, 200, job);
    return;
  }

  if (url.pathname === "/v1/conversations" && ["GET", "POST"].includes(request.method ?? "")) {
    if (!isAuthorized(request)) {
      sendJson(response, 401, makeErrorResponse("AUTH_INVALID_TOKEN", "API key is invalid."));
      return;
    }

    if (request.method === "GET") {
      sendJson(response, 200, {
        conversations: chatStore.listConversations({
          includeArchived: url.searchParams.get("include_archived") === "1",
        }).map(conversationToDto),
      });
      return;
    }

    const payload = await readJsonBody(request);
    const conversation = chatStore.createConversation({ title: titleFromPayload(payload) });
    sendJson(response, 201, { conversation: conversationToDto(conversation) });
    return;
  }

  const conversationHistoryId = conversationIdFromPath(url.pathname, "/history");
  if (request.method === "GET" && conversationHistoryId) {
    if (!isAuthorized(request)) {
      sendJson(response, 401, makeErrorResponse("AUTH_INVALID_TOKEN", "API key is invalid."));
      return;
    }
    const conversation = chatStore.getConversation(conversationHistoryId);
    if (!conversation) {
      sendJson(response, 404, makeErrorResponse("CONVERSATION_NOT_FOUND", "Conversation not found.", { conversation_id: conversationHistoryId }));
      return;
    }
    sendJson(response, 200, conversationHistoryResponse(conversation));
    return;
  }

  const conversationId = conversationIdFromPath(url.pathname);
  if (conversationId && ["GET", "PATCH", "DELETE"].includes(request.method ?? "")) {
    if (!isAuthorized(request)) {
      sendJson(response, 401, makeErrorResponse("AUTH_INVALID_TOKEN", "API key is invalid."));
      return;
    }
    const conversation = chatStore.getConversation(conversationId);
    if (!conversation) {
      sendJson(response, 404, makeErrorResponse("CONVERSATION_NOT_FOUND", "Conversation not found.", { conversation_id: conversationId }));
      return;
    }

    if (request.method === "GET") {
      sendJson(response, 200, { conversation: conversationToDto(conversation) });
      return;
    }

    if (request.method === "PATCH") {
      const payload = await readJsonBody(request);
      const updated = chatStore.updateConversation(conversation.id, {
        title: titleFromPayload(payload),
        pinned: pinnedFromPayload(payload),
      });
      sendJson(response, 200, { conversation: conversationToDto(updated ?? conversation) });
      return;
    }

    const cleanup = await deleteOpenClawSession({
      explicitSessionId: conversation.openclawSessionId,
      agentId: openClawAgentId,
    });
    for (const [jobId, job] of jobs.entries()) {
      if (job.conversationId === conversation.id) {
        jobs.delete(jobId);
      }
    }
    const deleted = chatStore.deleteConversation(conversation.id);
    sendJson(response, 200, {
      ok: deleted,
      conversation_id: conversation.id,
      session_cleanup: {
        removed_session_index: cleanup.removedSessionIndex,
        removed_files: cleanup.removedFiles.length,
        skipped: cleanup.skipped,
        ...(cleanup.error ? { error: cleanup.error } : {}),
      },
    });
    return;
  }

  if (url.pathname === "/v1/history" && ["GET", "POST", "DELETE"].includes(request.method ?? "")) {
    if (!isAuthorized(request)) {
      sendJson(response, 401, {
        error: {
          code: "AUTH_INVALID_TOKEN",
          message: "API key is invalid.",
        },
        request_id: "req_unavailable",
      } satisfies ErrorResponseDto);
      return;
    }

    const queryConversationId = url.searchParams.get("conversation_id")?.trim();
    const queryConversation = conversationFromQuery(url);
    if (queryConversationId && !queryConversation) {
      sendJson(response, 404, makeErrorResponse("CONVERSATION_NOT_FOUND", "Conversation not found.", { conversation_id: queryConversationId }));
      return;
    }

    if (request.method === "GET") {
      if (queryConversation) {
        const body = conversationHistoryResponse(queryConversation);
        if (url.searchParams.get("meta") === "1") {
          sendJson(response, 200, { version: body.version, size: body.size, mtimeMs: body.mtimeMs, conversation: body.conversation });
          return;
        }
        sendJson(response, 200, body);
        return;
      }

      const sessionId = sessionIdFromHeaders(request);
      if (url.searchParams.get("meta") === "1") {
        sendJson(response, 200, await historyStore.meta(sessionId));
        return;
      }
      sendJson(response, 200, {
        ...(await historyStore.meta(sessionId)),
        messages: await historyStore.list(sessionId),
      });
      return;
    }

    if (request.method === "POST") {
      const payload = await readJsonBody(request);
      const messages = normalizeHistoryMessages(payload);
      if (messages.length > 0) {
        if (queryConversation) {
          for (const message of messages) {
            chatStore.addMessage({
              conversationId: queryConversation.id,
              role: message.role,
              text: message.text,
              createdAt: message.savedAt,
              attachments: message.attachments,
            });
          }
        } else {
          await historyStore.append(sessionIdFromHeaders(request), messages);
        }
      }
      sendJson(response, 200, { ok: true, imported: messages.length });
      return;
    }

    if (queryConversation) {
      chatStore.clearMessages(queryConversation.id);
    } else {
      await historyStore.clear(sessionIdFromHeaders(request));
    }
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "GET" || request.method === "HEAD") {
    const served = await tryServeStatic(url.pathname, response);
    if (served) {
      return;
    }
  }

  if (request.method !== "POST" || url.pathname !== API_CONTRACT_V1.endpoint) {
    sendJson(response, 404, {
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Route not found.",
      },
      request_id: "req_unavailable",
    } satisfies ErrorResponseDto);
    return;
  }

  try {
    const payload = (await readJsonBody(request)) as MessageRequestDto;

    if (getSingleHeader(request.headers, "x-openclaw-sync") === "1") {
      const result = await handlePostMessage(
        {
          openClawClient,
          sessionStore,
          validApiKeys,
          conversationStore: chatStore,
        },
        request.headers,
        payload,
      );
      sendJson(response, result.statusCode, result.body);
      return;
    }

    const validationError = validateAuthorizedMessage(request, payload);
    if (validationError) {
      sendJson(response, statusForErrorCode(validationError.error.code), validationError);
      return;
    }

    const requestedConversationId = conversationIdFromPayload(payload);
    const conversation = getConversationForMessage(payload);
    if (requestedConversationId && !conversation) {
      sendJson(response, 404, makeErrorResponse("CONVERSATION_NOT_FOUND", "Conversation not found.", { conversation_id: requestedConversationId }));
      return;
    }

    const sessionId = conversation?.openclawSessionId ?? sessionIdFromHeaders(request);
    if (conversation) {
      await persistConversationUserMessage(conversation, payload);
    } else {
      await persistUserHistory(sessionId, payload);
    }

    const now = new Date().toISOString();
    const job: MessageJob = {
      id: `job_${randomUUID()}`,
      sessionId,
      ...(conversation ? { conversationId: conversation.id } : {}),
      state: "queued",
      createdAt: now,
      updatedAt: now,
    };
    jobs.set(job.id, job);
    if (conversation) {
      chatStore.createJob({ id: job.id, conversationId: conversation.id, state: "queued", now });
    }
    if (shouldPersistMessage(payload.message)) {
      if (conversation) {
        chatStore.addMessage({
          id: job.id,
          conversationId: conversation.id,
          role: "assistant",
          text: "응답 대기 중입니다…",
          jobId: job.id,
          createdAt: now,
        });
      } else {
        await historyStore.append(sessionId, [
          {
            id: job.id,
            role: "assistant",
            text: "응답 대기 중입니다…",
            savedAt: now,
          },
        ]);
      }
    }
    enqueueMessageJob(job, request.headers, payload);

    sendJson(response, 202, {
      job_id: job.id,
      status: job.state,
      session_id: sessionId,
      ...(conversation ? { conversation_id: conversation.id } : {}),
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      sendJson(response, 400, invalidJsonResponse());
      return;
    }

    sendJson(response, 500, {
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Unexpected server error.",
        details: {
          reason: error instanceof Error ? error.message : String(error),
        },
      },
      request_id: "req_unavailable",
    } satisfies ErrorResponseDto);
  }
});

server.listen(port, host, () => {
  console.log(`Bridge server listening on http://${host}:${port}`);
});
