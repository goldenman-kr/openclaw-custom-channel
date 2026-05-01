import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import {
  extractBearerToken,
  type ErrorResponseDto,
  type MessageRequestDto,
} from "./contracts/apiContractV1.js";
import { SseJobEventPublisher, type JobEventRecord } from "./events/SseJobEventPublisher.js";
import { AUTH_COOKIE_NAME, handleAuthRoute, parseCookies, type AuthContext } from "./http/authRoutes.js";
import { handleConversationRoute } from "./http/conversationRoutes.js";
import { handleHistoryRoute } from "./http/historyRoutes.js";
import { handleJobRoute } from "./http/jobRoutes.js";
import { handleMessageRoute } from "./http/messageRoutes.js";
import { handleMediaRoute, handleStaticRoute } from "./http/staticRoutes.js";
import { createOpenClawClient } from "./openclaw/createOpenClawClient.js";
import { deleteOpenClawSession } from "./openclaw/SessionCleaner.js";
import type { MessageJob } from "./runtime/MessageJob.js";
import { MessageJobRunner } from "./runtime/MessageJobRunner.js";
import { OpenClawChatRuntime } from "./runtime/OpenClawChatRuntime.js";
import { FileHistoryStore, type HistoryAttachment } from "./session/HistoryStore.js";
import { AuthStore, publicUser } from "./session/AuthStore.js";
import { InMemorySessionStore } from "./session/SessionStore.js";
import { SqliteChatStore, type ConversationRecord } from "./session/SqliteChatStore.js";

const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 29999);
const validApiKeys = new Set(
  (process.env.BRIDGE_API_KEYS ?? "dev-api-key")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean),
);

const openClawClient = createOpenClawClient();
const chatRuntime = new OpenClawChatRuntime(openClawClient);
const sessionStore = new InMemorySessionStore();
const historyDir = resolve(process.env.HISTORY_DIR ?? join(process.cwd(), "state", "history"));
const historyStore = new FileHistoryStore(historyDir);
const publicDir = resolve(process.env.PUBLIC_DIR ?? join(process.cwd(), "public"));
const stateDir = resolve(process.cwd(), "state");
const historyMediaDir = resolve(process.env.HISTORY_MEDIA_DIR ?? join(stateDir, "history-media"));
const assistantGeneratedMediaDirs = (process.env.ASSISTANT_MEDIA_SCAN_DIRS ?? "/home/orbsian/.openclaw/media/outbound")
  .split(":")
  .map((dir) => dir.trim())
  .filter(Boolean)
  .map((dir) => resolve(dir));
const chatDbPath = resolve(process.env.CHAT_DB_PATH ?? join(stateDir, "chat.sqlite"));
const authStore = new AuthStore(chatDbPath);
const chatStore = new SqliteChatStore(chatDbPath);
configureInitialAdminUser();
const openClawAgentId = process.env.OPENCLAW_AGENT ?? "main";
const jobs = new Map<string, MessageJob>();
const sessionTtlMs = Number(process.env.AUTH_SESSION_TTL_MS ?? 30 * 24 * 60 * 60 * 1000);
const cookieSecure = process.env.AUTH_COOKIE_SECURE ? process.env.AUTH_COOKIE_SECURE === "1" : process.env.NODE_ENV === "production";

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
  "access-control-allow-credentials": "true",
};

function configureInitialAdminUser(): void {
  const password = process.env.AUTH_ADMIN_PASSWORD;
  if (!password) {
    return;
  }
  const username = process.env.AUTH_ADMIN_USERNAME ?? "admin";
  const displayName = process.env.AUTH_ADMIN_DISPLAY_NAME ?? "Admin";
  authStore.ensureUser({ username, displayName, password, role: "admin" });
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown, extraHeaders: Record<string, string> = {}): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    ...corsHeaders,
    ...extraHeaders,
  });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  return rawBody ? JSON.parse(rawBody) : {};
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

function makeErrorResponse(code: ErrorResponseDto["error"]["code"], message: string, details?: Record<string, unknown>): ErrorResponseDto {
  return {
    error: { code, message, ...(details ? { details } : {}) },
    request_id: "req_unavailable",
  };
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

function getSessionToken(request: IncomingMessage): string | null {
  return parseCookies(getSingleHeader(request.headers, "cookie")).get(AUTH_COOKIE_NAME) ?? null;
}

function getAuthContext(request: IncomingMessage): AuthContext | null {
  const sessionToken = getSessionToken(request);
  if (sessionToken) {
    const authSession = authStore.getSessionByToken(sessionToken);
    if (authSession) {
      return { user: publicUser(authSession.user), source: "cookie" };
    }
  }

  const tokenOrError = extractBearerToken(getSingleHeader(request.headers, "authorization"));
  if (typeof tokenOrError === "string" && validApiKeys.has(tokenOrError)) {
    return {
      user: { id: "admin", username: "admin", displayName: "Admin", role: "admin" },
      source: "api_key",
    };
  }

  return null;
}

function isAuthorized(request: IncomingMessage): boolean {
  return Boolean(getAuthContext(request));
}

function updateJob(job: MessageJob, patch: { state?: MessageJob["state"]; error?: string | null }): void {
  if (patch.state) {
    job.state = patch.state;
  }
  if (patch.error === null) {
    delete job.error;
  } else if (patch.error !== undefined) {
    job.error = patch.error;
  }
  job.updatedAt = new Date().toISOString();
  jobs.set(job.id, job);
  if (job.conversationId) {
    chatStore.updateJob(job.id, {
      ...(patch.state ? { state: patch.state } : {}),
      ...(patch.error !== undefined ? { error: patch.error } : {}),
      now: job.updatedAt,
    });
  }
  jobEventPublisher.publishJob(job);
}

function jobForRequest(jobId: string, request: IncomingMessage, url: URL): JobEventRecord | null {
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

function cancelJobForRequest(jobId: string, request: IncomingMessage, url: URL): JobEventRecord | null {
  const visibleJob = jobForRequest(jobId, request, url);
  if (!visibleJob || ["completed", "failed", "cancelled"].includes(visibleJob.state)) {
    return null;
  }

  const memoryJob = jobs.get(jobId);
  if (memoryJob) {
    messageJobRunner.cancel(memoryJob);
    return memoryJob;
  }

  const storedJob = chatStore.getJob(jobId);
  if (!storedJob) {
    return null;
  }
  const now = new Date().toISOString();
  const cancelled = chatStore.updateJob(jobId, { state: "cancelled", error: null, now });
  chatStore.updateMessage(jobId, { role: "system", text: "요청이 취소되었습니다." });
  if (cancelled) {
    jobEventPublisher.publishJob(cancelled);
  }
  return cancelled;
}

const jobEventPublisher = new SseJobEventPublisher({
  corsHeaders,
  isAuthorized,
  getJob: jobForRequest,
  sendError(response, statusCode, code, message) {
    sendJson(response, statusCode, makeErrorResponse(code as ErrorResponseDto["error"]["code"], message));
  },
});

const messageJobRunner = new MessageJobRunner({
  chatRuntime,
  sessionStore,
  validApiKeys,
  conversationStore: chatStore,
  historyStore,
  shouldPersistMessage,
  updateJob,
  publishToken(job, token) {
    jobEventPublisher.publishToken({ id: job.id, token });
  },
  generatedMediaDirs: assistantGeneratedMediaDirs,
});

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

  if (await handleAuthRoute(request, response, url, {
    authStore,
    sendJson,
    makeErrorResponse,
    readJsonBody,
    cookieSecure,
    sessionTtlMs,
    getSessionToken,
    getAuthContext,
  })) {
    return;
  }

  if (await handleMediaRoute(request, response, url, {
    corsHeaders,
    mediaRoots,
    isAuthorized,
    sendJson,
  })) {
    return;
  }

  if (handleJobRoute(request, response, url, {
    isAuthorized,
    sendJson,
    makeErrorResponse,
    getJob: jobForRequest,
    cancelJob: cancelJobForRequest,
    eventPublisher: jobEventPublisher,
  })) {
    return;
  }

  if (await handleConversationRoute(request, response, url, {
    conversationStore: chatStore,
    isAuthorized,
    sendJson,
    makeErrorResponse,
    readJsonBody,
    cleanupConversationSession(conversation) {
      return deleteOpenClawSession({
        explicitSessionId: conversation.openclawSessionId,
        agentId: openClawAgentId,
      });
    },
    deleteConversationJobs(conversationId) {
      for (const [jobId, job] of jobs.entries()) {
        if (job.conversationId === conversationId) {
          jobs.delete(jobId);
        }
      }
    },
  })) {
    return;
  }

  if (await handleHistoryRoute(request, response, url, {
    historyStore,
    conversationStore: chatStore,
    isAuthorized,
    sendJson,
    makeErrorResponse,
    readJsonBody,
    sessionIdFromRequest: sessionIdFromHeaders,
  })) {
    return;
  }

  if (await handleStaticRoute(request, response, url, { publicDir })) {
    return;
  }

  if (await handleMessageRoute(request, response, url, {
    chatRuntime,
    sessionStore,
    validApiKeys,
    getAuthContext,
    conversationStore: chatStore,
    historyStore,
    sendJson,
    readJsonBody,
    sessionIdFromRequest: sessionIdFromHeaders,
    persistConversationUserMessage,
    persistUserHistory,
    enqueueMessageJob(job, headers, payload) {
      messageJobRunner.enqueue(job, headers, payload);
    },
    registerJob(job) {
      jobs.set(job.id, job);
    },
    shouldPersistMessage,
  })) {
    return;
  }

  sendJson(response, 404, {
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "Route not found.",
    },
    request_id: "req_unavailable",
  } satisfies ErrorResponseDto);
});

server.listen(port, host, () => {
  console.log(`Bridge server listening on http://${host}:${port}`);
});
