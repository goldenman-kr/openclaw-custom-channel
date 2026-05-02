import type { IncomingMessage, ServerResponse } from "node:http";
import type { ErrorResponseDto } from "../contracts/apiContractV1.js";
import type { AuthContext } from "./authRoutes.js";
import { conversationHistoryResponse } from "./conversationRoutes.js";
import type { HistoryAttachment, HistoryMessage, HistoryStore } from "../session/HistoryStore.js";
import type { ConversationRecord, ConversationStore, MessageStore } from "../session/SqliteChatStore.js";

export interface HistoryRouteDeps {
  historyStore: HistoryStore;
  conversationStore: ConversationStore & MessageStore;
  isAuthorized(request: IncomingMessage): boolean;
  getAuthContext(request: IncomingMessage): AuthContext | null;
  isConversationVisibleToAuth(conversation: ConversationRecord, auth: AuthContext): boolean;
  sendJson(response: ServerResponse, statusCode: number, body: unknown): void;
  makeErrorResponse(code: ErrorResponseDto["error"]["code"], message: string, details?: Record<string, unknown>): ErrorResponseDto;
  readJsonBody(request: IncomingMessage): Promise<unknown>;
  sessionIdFromRequest(request: IncomingMessage): string;
}

function normalizeHistoryAttachment(input: unknown): HistoryAttachment | null {
  if (typeof input !== "object" || input === null) {
    return null;
  }
  const candidate = input as Partial<HistoryAttachment>;
  if (
    typeof candidate.name !== "string" ||
    typeof candidate.mime_type !== "string" ||
    !["image", "file"].includes(String(candidate.type)) ||
    typeof candidate.path !== "string"
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

function normalizeHistoryMessages(payload: unknown): HistoryMessage[] {
  const rawMessages = Array.isArray((payload as { messages?: unknown })?.messages)
    ? (payload as { messages: unknown[] }).messages
    : [];
  return rawMessages
    .filter((item) => {
      const candidate = item as Partial<HistoryMessage>;
      return (
        ["user", "assistant", "system"].includes(String(candidate.role)) &&
        typeof candidate.text === "string" &&
        candidate.text.trim().length > 0
      );
    })
    .map((item) => {
      const candidate = item as Partial<HistoryMessage>;
      const attachments = Array.isArray(candidate.attachments)
        ? candidate.attachments.map(normalizeHistoryAttachment).filter((attachment): attachment is HistoryAttachment => Boolean(attachment))
        : [];
      return {
        role: candidate.role as "user" | "assistant" | "system",
        text: candidate.text ?? "",
        savedAt: typeof candidate.savedAt === "string" ? candidate.savedAt : new Date().toISOString(),
        ...(attachments.length > 0 ? { attachments } : {}),
      };
    });
}

function conversationFromQuery(url: URL, store: ConversationStore): ConversationRecord | null {
  const conversationId = url.searchParams.get("conversation_id")?.trim();
  return conversationId ? store.getConversation(conversationId) : null;
}

export async function handleHistoryRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  deps: HistoryRouteDeps,
): Promise<boolean> {
  if (url.pathname !== "/v1/history" || !["GET", "POST", "DELETE"].includes(request.method ?? "")) {
    return false;
  }

  if (!deps.isAuthorized(request)) {
    deps.sendJson(response, 401, deps.makeErrorResponse("AUTH_INVALID_TOKEN", "API key is invalid."));
    return true;
  }

  const auth = deps.getAuthContext(request);
  const queryConversationId = url.searchParams.get("conversation_id")?.trim();
  const queryConversation = conversationFromQuery(url, deps.conversationStore);
  if (queryConversationId && (!auth || !queryConversation || !deps.isConversationVisibleToAuth(queryConversation, auth))) {
    deps.sendJson(response, 404, deps.makeErrorResponse("CONVERSATION_NOT_FOUND", "Conversation not found.", { conversation_id: queryConversationId }));
    return true;
  }

  if (request.method === "GET") {
    if (queryConversation) {
      const body = conversationHistoryResponse(queryConversation, deps.conversationStore);
      if (url.searchParams.get("meta") === "1") {
        deps.sendJson(response, 200, { version: body.version, size: body.size, mtimeMs: body.mtimeMs, conversation: body.conversation });
        return true;
      }
      deps.sendJson(response, 200, body);
      return true;
    }

    const sessionId = deps.sessionIdFromRequest(request);
    if (url.searchParams.get("meta") === "1") {
      deps.sendJson(response, 200, await deps.historyStore.meta(sessionId));
      return true;
    }
    deps.sendJson(response, 200, {
      ...(await deps.historyStore.meta(sessionId)),
      messages: await deps.historyStore.list(sessionId),
    });
    return true;
  }

  if (request.method === "POST") {
    const payload = await deps.readJsonBody(request);
    const messages = normalizeHistoryMessages(payload);
    if (messages.length > 0) {
      if (queryConversation) {
        for (const message of messages) {
          deps.conversationStore.addMessage({
            conversationId: queryConversation.id,
            role: message.role,
            text: message.text,
            createdAt: message.savedAt,
            attachments: message.attachments,
          });
        }
      } else {
        await deps.historyStore.append(deps.sessionIdFromRequest(request), messages);
      }
    }
    deps.sendJson(response, 200, { ok: true, imported: messages.length });
    return true;
  }

  if (queryConversation) {
    deps.conversationStore.clearMessages(queryConversation.id);
  } else {
    await deps.historyStore.clear(deps.sessionIdFromRequest(request));
  }
  deps.sendJson(response, 200, { ok: true });
  return true;
}
