import type { IncomingMessage, ServerResponse } from "node:http";
import type { ErrorResponseDto } from "../contracts/apiContractV1.js";
import type { AuthContext } from "./authRoutes.js";
import type { ChatMessageRecord, ConversationRecord, ConversationStore, MessageStore } from "../session/SqliteChatStore.js";

export interface ConversationCleanupResult {
  removedSessionIndex: boolean;
  removedFiles: string[];
  skipped?: boolean | string;
  error?: string;
}

export interface ConversationRouteDeps {
  conversationStore: ConversationStore & Pick<MessageStore, "listMessages">;
  isAuthorized(request: IncomingMessage): boolean;
  getAuthContext(request: IncomingMessage): AuthContext | null;
  isConversationVisibleToAuth(conversation: ConversationRecord, auth: AuthContext): boolean;
  sendJson(response: ServerResponse, statusCode: number, body: unknown): void;
  makeErrorResponse(code: ErrorResponseDto["error"]["code"], message: string, details?: Record<string, unknown>): ErrorResponseDto;
  readJsonBody(request: IncomingMessage): Promise<unknown>;
  cleanupConversationSession(conversation: ConversationRecord): Promise<ConversationCleanupResult>;
  deleteConversationJobs(conversationId: string): void;
}

export function conversationToDto(conversation: ConversationRecord) {
  return {
    id: conversation.id,
    title: conversation.title,
    created_at: conversation.createdAt,
    updated_at: conversation.updatedAt,
    ...(conversation.archivedAt ? { archived_at: conversation.archivedAt } : {}),
    pinned: conversation.pinned,
  };
}

export function chatMessageToHistoryDto(message: ChatMessageRecord) {
  return {
    id: message.id,
    role: message.role,
    text: message.text,
    savedAt: message.createdAt,
    ...(message.jobId ? { jobId: message.jobId } : {}),
    ...(message.completedAt ? { completedAt: message.completedAt } : {}),
    ...(message.attachments && message.attachments.length > 0 ? { attachments: message.attachments } : {}),
  };
}

export function conversationHistoryResponse(
  conversation: ConversationRecord,
  messageStore: Pick<MessageStore, "listMessages">,
  input: { limit?: number } = {},
) {
  const requestedLimit = Math.max(1, Math.min(input.limit ?? 300, 5000));
  const messagesWithLookahead = messageStore.listMessages(conversation.id, { limit: requestedLimit + 1 });
  const hasMore = messagesWithLookahead.length > requestedLimit;
  const messages = (hasMore ? messagesWithLookahead.slice(1) : messagesWithLookahead).map(chatMessageToHistoryDto);
  return {
    version: `${conversation.updatedAt}:${messages.length}:${requestedLimit}:${hasMore ? 1 : 0}`,
    size: messages.length,
    limit: requestedLimit,
    hasMore,
    mtimeMs: Date.parse(conversation.updatedAt) || 0,
    conversation: conversationToDto(conversation),
    messages,
  };
}

export function historyLimitFromUrl(url: URL): number | undefined {
  const raw = url.searchParams.get("limit");
  if (!raw) {
    return undefined;
  }
  const limit = Number.parseInt(raw, 10);
  if (!Number.isFinite(limit)) {
    return undefined;
  }
  return Math.max(1, Math.min(limit, 5000));
}

export function conversationIdFromPath(pathname: string, suffix = ""): string | null {
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

function archivedAtFromPayload(payload: unknown): string | null | undefined {
  if (typeof payload !== "object" || payload === null || !("archived" in payload)) {
    return undefined;
  }
  return Boolean((payload as { archived?: unknown }).archived) ? new Date().toISOString() : null;
}

export async function handleConversationRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  deps: ConversationRouteDeps,
): Promise<boolean> {
  if (url.pathname === "/v1/conversations" && ["GET", "POST"].includes(request.method ?? "")) {
    if (!deps.isAuthorized(request)) {
      deps.sendJson(response, 401, deps.makeErrorResponse("AUTH_INVALID_TOKEN", "API key is invalid."));
      return true;
    }

    const auth = deps.getAuthContext(request);
    if (!auth) {
      deps.sendJson(response, 401, deps.makeErrorResponse("AUTH_INVALID_TOKEN", "Login is required."));
      return true;
    }

    if (request.method === "GET") {
      deps.sendJson(response, 200, {
        conversations: deps.conversationStore.listConversations({
          ownerId: auth.user.role === "admin" ? undefined : auth.user.id,
          includeArchived: url.searchParams.get("include_archived") === "1",
        }).filter((conversation) => deps.isConversationVisibleToAuth(conversation, auth)).map(conversationToDto),
      });
      return true;
    }

    const payload = await deps.readJsonBody(request);
    const conversation = deps.conversationStore.createConversation({ ownerId: auth.user.id, title: titleFromPayload(payload) });
    deps.sendJson(response, 201, { conversation: conversationToDto(conversation) });
    return true;
  }

  const conversationHistoryId = conversationIdFromPath(url.pathname, "/history");
  if (request.method === "GET" && conversationHistoryId) {
    if (!deps.isAuthorized(request)) {
      deps.sendJson(response, 401, deps.makeErrorResponse("AUTH_INVALID_TOKEN", "API key is invalid."));
      return true;
    }
    const auth = deps.getAuthContext(request);
    const conversation = deps.conversationStore.getConversation(conversationHistoryId);
    if (!auth || !conversation || !deps.isConversationVisibleToAuth(conversation, auth)) {
      deps.sendJson(response, 404, deps.makeErrorResponse("CONVERSATION_NOT_FOUND", "Conversation not found.", { conversation_id: conversationHistoryId }));
      return true;
    }
    deps.sendJson(response, 200, conversationHistoryResponse(conversation, deps.conversationStore, { limit: historyLimitFromUrl(url) }));
    return true;
  }

  const conversationId = conversationIdFromPath(url.pathname);
  if (conversationId && ["GET", "PATCH", "DELETE"].includes(request.method ?? "")) {
    if (!deps.isAuthorized(request)) {
      deps.sendJson(response, 401, deps.makeErrorResponse("AUTH_INVALID_TOKEN", "API key is invalid."));
      return true;
    }
    const auth = deps.getAuthContext(request);
    const conversation = deps.conversationStore.getConversation(conversationId);
    if (!auth || !conversation || !deps.isConversationVisibleToAuth(conversation, auth)) {
      deps.sendJson(response, 404, deps.makeErrorResponse("CONVERSATION_NOT_FOUND", "Conversation not found.", { conversation_id: conversationId }));
      return true;
    }

    if (request.method === "GET") {
      deps.sendJson(response, 200, { conversation: conversationToDto(conversation) });
      return true;
    }

    if (request.method === "PATCH") {
      const payload = await deps.readJsonBody(request);
      const updated = deps.conversationStore.updateConversation(conversation.id, {
        title: titleFromPayload(payload),
        pinned: pinnedFromPayload(payload),
        archivedAt: archivedAtFromPayload(payload),
      });
      deps.sendJson(response, 200, { conversation: conversationToDto(updated ?? conversation) });
      return true;
    }

    const cleanup = await deps.cleanupConversationSession(conversation);
    deps.deleteConversationJobs(conversation.id);
    const deleted = deps.conversationStore.deleteConversation(conversation.id);
    deps.sendJson(response, 200, {
      ok: deleted,
      conversation_id: conversation.id,
      session_cleanup: {
        removed_session_index: cleanup.removedSessionIndex,
        removed_files: cleanup.removedFiles.length,
        skipped: cleanup.skipped,
        ...(cleanup.error ? { error: cleanup.error } : {}),
      },
    });
    return true;
  }

  return false;
}
