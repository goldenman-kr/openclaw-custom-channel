import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import {
  extractBearerToken,
  type ErrorResponseDto,
  type MessageRequestDto,
} from "./contracts/apiContractV1.js";
import { ConversationEventPublisher } from "./events/ConversationEventPublisher.js";
import { SseJobEventPublisher, type JobEventRecord } from "./events/SseJobEventPublisher.js";
import { AUTH_COOKIE_NAME, handleAuthRoute, parseCookies, type AuthContext } from "./http/authRoutes.js";
import { conversationIdFromPath, handleConversationRoute } from "./http/conversationRoutes.js";
import { handleHistoryRoute } from "./http/historyRoutes.js";
import { handleJobRoute } from "./http/jobRoutes.js";
import { handleMessageRoute } from "./http/messageRoutes.js";
import { applyNativeModelSelection, getNativeModelMenu } from "./http/nativeCommands.js";
import { handleMediaRoute, handleStaticRoute } from "./http/staticRoutes.js";
import { GatewayAutonomousAnnounceBridge } from "./openclaw/GatewayAutonomousAnnounceBridge.js";
import { createOpenClawClient } from "./openclaw/createOpenClawClient.js";
import type { RuntimeWorkspaceScope } from "./openclaw/OpenClawClient.js";
import { deleteOpenClawSession } from "./openclaw/SessionCleaner.js";
import type { MessageJob } from "./runtime/MessageJob.js";
import { attachmentsFromMediaRefs, MessageJobRunner } from "./runtime/MessageJobRunner.js";
import { OpenClawChatRuntime } from "./runtime/OpenClawChatRuntime.js";
import { resolveAllowedWorkspacePath } from "./security/workspaceScope.js";
import { FileHistoryStore, type HistoryAttachment } from "./session/HistoryStore.js";
import { AuthStore, publicUser, type WorkspaceScopeRecord } from "./session/AuthStore.js";
import { InMemorySessionStore } from "./session/SessionStore.js";
import { RestartFollowupStore, type RestartFollowupRecord } from "./session/RestartFollowupStore.js";
import { SqliteChatStore, type ConversationRecord } from "./session/SqliteChatStore.js";

const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 29999);
const serverRuntimeVersion = "pwa-server-2026-05-03-001";
const apiContractVersion = 1;
const minClientApiVersion = 1;
const execFileAsync = promisify(execFile);

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
const stateDir = resolve(process.env.CHANNEL_STATE_DIR ?? join(process.cwd(), "state"));
const historyMediaDir = resolve(process.env.HISTORY_MEDIA_DIR ?? join(stateDir, "history-media"));
const assistantGeneratedMediaDirs = (process.env.ASSISTANT_MEDIA_SCAN_DIRS ?? "/home/orbsian/.openclaw/media")
  .split(":")
  .map((dir) => dir.trim())
  .filter(Boolean)
  .map((dir) => resolve(dir));
const chatDbPath = resolve(process.env.CHAT_DB_PATH ?? join(stateDir, "chat.sqlite"));
const authStore = new AuthStore(chatDbPath);
const chatStore = new SqliteChatStore(chatDbPath);
const staleJobCleanup = chatStore.cancelStaleJobs({
  olderThanMs: Number(process.env.STALE_JOB_CLEANUP_AFTER_MS ?? 30 * 60 * 1000),
  reason: "Cancelled stale job on PWA service startup.",
});
if (staleJobCleanup.jobs > 0) {
  console.log(
    `Cancelled stale message jobs on startup: jobs=${staleJobCleanup.jobs} messages=${staleJobCleanup.messages}`,
  );
}
const restartFollowupStore = new RestartFollowupStore(join(stateDir, "restart-followups"));
configureInitialAdminUser();
const openClawAgentId = process.env.OPENCLAW_AGENT ?? "main";
const jobs = new Map<string, MessageJob>();
const sessionTtlMs = Number(process.env.AUTH_SESSION_TTL_MS ?? 30 * 24 * 60 * 60 * 1000);
const cookieSecure = process.env.AUTH_COOKIE_SECURE ? process.env.AUTH_COOKIE_SECURE === "1" : process.env.NODE_ENV === "production";
const workspaceRoot = resolve(process.env.USER_WORKSPACE_ROOT ?? join(stateDir, "workspaces"));
const workspaceCommonDir = resolve(process.env.USER_WORKSPACE_COMMON_DIR ?? join(workspaceRoot, "common"));
const workspaceCommonWritable = process.env.USER_WORKSPACE_COMMON_WRITABLE === "1";

const mediaRoots = [
  resolve(process.env.MEDIA_ROOT ?? "/home/orbsian/.openclaw/workspace"),
  resolve(process.env.OPENCLAW_MEDIA_DIR ?? "/home/orbsian/.openclaw/media"),
  resolve(process.env.OPENCLAW_CANVAS_DIR ?? join(homedir(), ".openclaw", "canvas")),
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


async function processRestartFollowups(): Promise<void> {
  const pending = await restartFollowupStore.listPending();
  for (const record of pending) {
    const delayMs = Math.max(0, Date.parse(record.checkAfter) - Date.now());
    setTimeout(() => {
      handleRestartFollowup(record).catch((error) => {
        console.error(`Restart follow-up failed (${record.id}):`, error);
      });
    }, delayMs).unref?.();
  }
}

async function handleRestartFollowup(record: RestartFollowupRecord): Promise<void> {
  const conversation = chatStore.getConversation(record.conversationId);
  if (!conversation) {
    await restartFollowupStore.markDone(record.id);
    return;
  }

  const status = await execFileAsync("systemctl", ["--user", "status", record.serviceName, "--no-pager", "-n", "12"], {
    timeout: 10_000,
    maxBuffer: 512 * 1024,
  }).then((result) => ({ ok: true, text: `${result.stdout}\n${result.stderr}`.trim() })).catch((error) => ({
    ok: false,
    text: error instanceof Error ? error.message : String(error),
  }));

  const healthUrl = record.healthUrl ?? "http://127.0.0.1:29999/health";
  const health = await fetch(healthUrl, { signal: AbortSignal.timeout(5_000) })
    .then(async (response) => ({ ok: response.ok, text: await response.text() }))
    .catch((error) => ({ ok: false, text: error instanceof Error ? error.message : String(error) }));

  const now = new Date().toISOString();
  const interruptedJobs = markPendingMessagesInterrupted(conversation.id, now);
  const activeLine = status.text.split("\n").find((line) => line.trim().startsWith("Active:"))?.trim();
  const startedLine = status.text.split("\n").find((line) => line.includes("Started OpenClaw Custom Web Channel"))?.trim();
  const ok = status.ok && /Active:\s+active \(running\)/.test(status.text) && health.ok;
  const text = [
    ok ? "PWA 서비스 재시작 확인 완료: 정상입니다." : "PWA 서비스 재시작 확인 결과: 문제가 있을 수 있습니다.",
    "",
    `- 서비스: ${record.serviceName}`,
    `- 상태: ${activeLine ?? (status.ok ? "status 확인됨" : "status 확인 실패")}`,
    ...(startedLine ? [`- 재시작 로그: ${startedLine}`] : []),
    `- /health: ${health.text || (health.ok ? "OK" : "응답 없음")}`,
    ...(interruptedJobs > 0 ? ["", `참고: 재시작 중 끊긴 응답 ${interruptedJobs}개를 중단 처리했습니다.`] : []),
  ].join("\n");

  chatStore.addMessage({
    conversationId: conversation.id,
    role: "system",
    text,
    createdAt: new Date().toISOString(),
  });
  await restartFollowupStore.markDone(record.id);
}


function markPendingMessagesInterrupted(conversationId: string, now: string): number {
  const pendingTexts = new Set(["응답 대기 중입니다…", "응답을 처리 중입니다…"]);
  const messages = chatStore.listMessages(conversationId);
  let interrupted = 0;
  for (const message of messages) {
    if (!message.jobId || !pendingTexts.has(message.text.trim())) {
      continue;
    }
    const notice = "이전 응답은 PWA 서비스 재시작 중 연결이 끊겨 중단 처리했습니다. 필요한 경우 다시 요청해주세요.";
    chatStore.updateMessage(message.id, {
      role: "system",
      text: notice,
      jobId: null,
      completedAt: now,
    });
    chatStore.updateJob(message.jobId, {
      state: "cancelled",
      error: "Interrupted by PWA service restart.",
      now,
    });
    interrupted += 1;
  }
  return interrupted;
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

function isConversationVisibleToAuth(conversation: ConversationRecord, auth: AuthContext): boolean {
  // Even admins should not see/delete another user's conversations in the normal chat UI/API.
  // Cross-user administration should be a separate explicit admin surface later.
  return conversation.ownerId === auth.user.id;
}

function normalizeMediaPath(rawPath: string): string {
  if (rawPath.startsWith("file://")) {
    try {
      return decodeURIComponent(new URL(rawPath).pathname);
    } catch {
      return rawPath;
    }
  }
  return rawPath;
}

async function ensureWorkspaceIdentityFile(scope: RuntimeWorkspaceScope): Promise<string> {
  const identityFile = join(scope.userDir, "WEBCHAT_USER.md");
  const displayName = scope.displayName?.trim() || scope.username || scope.userId;
  const username = scope.username?.trim() || scope.userId;
  const content = [
    "# Webchat User Identity",
    "",
    `- Current webchat login user id: ${scope.userId}`,
    `- Current webchat username: ${username}`,
    `- Current webchat display name: ${displayName}`,
    "- This user is not Eddy unless the username/display name explicitly says Eddy.",
    "- Do not apply Eddy-specific memories, preferences, private details, or identity assumptions to this user.",
    "- Treat this directory as this user's private workspace context.",
    "- If new durable preferences or facts are learned for this user, store them under this user workspace, not the global Eddy workspace.",
    "",
  ].join("\n");
  await writeFile(identityFile, content, { flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") {
      throw error;
    }
  });
  return identityFile;
}

async function workspaceScopeForAuth(auth: AuthContext): Promise<RuntimeWorkspaceScope> {
  const existing = authStore.getWorkspaceScope(auth.user.id);
  if (existing) {
    const scope = { ...existing, username: auth.user.username, displayName: auth.user.displayName, identityFile: join(existing.userDir, "WEBCHAT_USER.md") };
    await ensureWorkspaceIdentityFile(scope);
    return scope;
  }
  const userDir = resolve(workspaceRoot, safeFileName(auth.user.username, auth.user.id));
  await mkdir(userDir, { recursive: true });
  await mkdir(workspaceCommonDir, { recursive: true });
  const scope = {
    userId: auth.user.id,
    username: auth.user.username,
    displayName: auth.user.displayName,
    workspaceRoot,
    userDir,
    commonDir: workspaceCommonDir,
    commonWritable: workspaceCommonWritable,
    identityFile: join(userDir, "WEBCHAT_USER.md"),
  };
  authStore.upsertWorkspaceScope(scope);
  await ensureWorkspaceIdentityFile(scope);
  return scope;
}

async function resolveAuthorizedMediaPath(rawPath: string, auth: AuthContext): Promise<string | null> {
  const candidate = await realpath(resolve(normalizeMediaPath(rawPath))).catch(() => null);
  if (!candidate) {
    return null;
  }
  if (chatStore.isAttachmentPathVisibleToOwner(candidate, auth.user.id)) {
    return candidate;
  }
  if (auth.user.role !== "admin") {
    const scope = await workspaceScopeForAuth(auth);
    return resolveAllowedWorkspacePath(candidate, scope, "read").catch(() => null);
  }
  const realRoots = await Promise.all(mediaRoots.map(async (root) => realpath(root).catch(() => resolve(root))));
  if (realRoots.some((root) => candidate === root || candidate.startsWith(`${root}/`))) {
    return candidate;
  }
  return null;
}

function publicJob(job: MessageJob): JobEventRecord {
  return {
    id: job.id,
    sessionId: job.sessionId,
    ...(job.conversationId ? { conversationId: job.conversationId } : {}),
    state: job.state,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    ...(job.error ? { error: job.error } : {}),
  } as JobEventRecord;
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
  jobEventPublisher.publishJob(publicJob(job));
}

function jobForRequest(jobId: string, request: IncomingMessage, url: URL): JobEventRecord | null {
  const auth = getAuthContext(request);
  if (!auth) {
    return null;
  }
  const job = jobs.get(jobId) ?? chatStore.getJob(jobId);
  const conversationId = url.searchParams.get("conversation_id")?.trim();
  if (job && "conversationId" in job && job.conversationId) {
    if (conversationId && job.conversationId !== conversationId) {
      return null;
    }
    const conversation = chatStore.getConversation(job.conversationId);
    return conversation && isConversationVisibleToAuth(conversation, auth) ? publicJob(job as MessageJob) : null;
  }
  const sessionId = sessionIdFromHeaders(request);
  if (job && "sessionId" in job && job.sessionId === sessionId) {
    return publicJob(job as MessageJob);
  }
  return null;
}

function conversationForOpenClawSessionId(openclawSessionId: string): ConversationRecord | null {
  if (openclawSessionId.startsWith("web-conv_")) {
    const candidate = chatStore.getConversation(openclawSessionId.slice("web-".length));
    if (candidate?.openclawSessionId === openclawSessionId) {
      return candidate;
    }
  }
  return chatStore.listConversations({ includeArchived: true, limit: 500 })
    .find((conversation) => conversation.openclawSessionId === openclawSessionId) ?? null;
}

function isConversationVisibleForRequest(conversationId: string, request: IncomingMessage): boolean {
  const auth = getAuthContext(request);
  if (!auth) {
    return false;
  }
  const conversation = chatStore.getConversation(conversationId);
  return Boolean(conversation && isConversationVisibleToAuth(conversation, auth));
}

function cancelJobForRequest(jobId: string, request: IncomingMessage, url: URL): JobEventRecord | null {
  const visibleJob = jobForRequest(jobId, request, url);
  if (!visibleJob || ["completed", "failed", "cancelled"].includes(visibleJob.state)) {
    return null;
  }

  const memoryJob = jobs.get(jobId);
  if (memoryJob) {
    messageJobRunner.cancel(memoryJob);
    return publicJob(memoryJob);
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

const conversationEventPublisher = new ConversationEventPublisher({
  corsHeaders,
  isAuthorized,
  isVisible: isConversationVisibleForRequest,
  sendError(response, statusCode, code, message) {
    sendJson(response, statusCode, makeErrorResponse(code as ErrorResponseDto["error"]["code"], message));
  },
});

const autonomousAnnounceBridge = process.env.OPENCLAW_AUTONOMOUS_ANNOUNCE_BRIDGE === "0" ? null : new GatewayAutonomousAnnounceBridge({
  baseUrl: process.env.OPENCLAW_GATEWAY_URL,
  token: process.env.OPENCLAW_GATEWAY_TOKEN,
  agentId: openClawAgentId,
  getConversationByOpenClawSessionId: conversationForOpenClawSessionId,
  messageStore: chatStore,
  attachmentsFromMediaRefs,
  onAnnouncement(announcement) {
    conversationEventPublisher.publish({
      id: announcement.id,
      type: "message",
      messageId: announcement.id,
      conversationId: announcement.conversationId,
      createdAt: announcement.createdAt,
    });
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
  publishAgentEvent(job, event) {
    jobEventPublisher.publishAgentEvent({ id: job.id, stream: event.stream, data: event.data });
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
      build_id: serverRuntimeVersion,
      server_runtime_version: serverRuntimeVersion,
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/v1/version") {
    response.setHeader("cache-control", "no-store");
    sendJson(response, 200, {
      build_id: serverRuntimeVersion,
      server_runtime_version: serverRuntimeVersion,
      api_contract_version: apiContractVersion,
      min_client_api_version: minClientApiVersion,
      app: "openclaw-custom-channel",
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
    getAuthContext,
    resolveAuthorizedMediaPath,
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

  const conversationEventsId = conversationIdFromPath(url.pathname, "/events");
  if (conversationEventsId && request.method === "GET") {
    conversationEventPublisher.serve(request, response, conversationEventsId);
    return;
  }

  if (await handleConversationRoute(request, response, url, {
    conversationStore: chatStore,
    isAuthorized,
    getAuthContext,
    isConversationVisibleToAuth,
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
    getAuthContext,
    isConversationVisibleToAuth,
    sendJson,
    makeErrorResponse,
    readJsonBody,
    sessionIdFromRequest: sessionIdFromHeaders,
  })) {
    return;
  }

  const conversationModelId = conversationIdFromPath(url.pathname, "/model");
  if (conversationModelId && ["GET", "PATCH"].includes(request.method ?? "")) {
    if (!isAuthorized(request)) {
      sendJson(response, 401, makeErrorResponse("AUTH_INVALID_TOKEN", "API key is invalid."));
      return;
    }
    const auth = getAuthContext(request);
    const conversation = chatStore.getConversation(conversationModelId);
    if (!auth || !conversation || !isConversationVisibleToAuth(conversation, auth)) {
      sendJson(response, 404, makeErrorResponse("CONVERSATION_NOT_FOUND", "Conversation not found.", { conversation_id: conversationModelId }));
      return;
    }

    const modelContext = {
      userLabel: auth.user.displayName ?? auth.user.username ?? auth.user.id,
      userRole: auth.user.role,
      sessionKey: conversation.openclawSessionId,
    };

    if (request.method === "GET") {
      sendJson(response, 200, await getNativeModelMenu(modelContext));
      return;
    }

    const payload = await readJsonBody(request).catch(() => ({}));
    const requestedModel = typeof (payload as { model?: unknown }).model === "string" ? (payload as { model: string }).model : "";
    try {
      const result = await applyNativeModelSelection(requestedModel, modelContext);
      sendJson(response, 200, {
        ok: true,
        current_model: result.currentModel,
        ...(result.warning ? { warning: result.warning } : {}),
        reset: result.reset,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(response, message.includes("관리자만") ? 403 : 400, makeErrorResponse(message.includes("관리자만") ? "AUTH_INVALID_TOKEN" : "VALIDATION_MODEL_INVALID", message));
    }
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
    isConversationVisibleToAuth,
    conversationStore: chatStore,
    historyStore,
    sendJson,
    readJsonBody,
    sessionIdFromRequest: sessionIdFromHeaders,
    persistConversationUserMessage,
    persistUserHistory,
    workspaceScopeForAuth,
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
  autonomousAnnounceBridge?.start();
  processRestartFollowups().catch((error) => console.error("Failed to process restart follow-ups:", error));
});
