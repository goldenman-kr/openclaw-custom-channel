import type { IncomingHttpHeaders } from "node:http";
import { randomUUID } from "node:crypto";
import {
  extractBearerToken,
  type ErrorCode,
  type ErrorResponseDto,
  type MessageRequestDto,
  type MessageResponseDto,
  validateMessageRequestDto,
} from "../contracts/apiContractV1.js";
import type { OpenClawConversationMessage, RuntimeWorkspaceScope } from "../openclaw/OpenClawClient.js";
import type { ChatRuntime, ChatRuntimeCallbacks } from "../runtime/ChatRuntime.js";
import type { AuthContext } from "./authRoutes.js";
import type { ChatMessageRecord, ConversationStore, MessageStore } from "../session/SqliteChatStore.js";
import type { SessionStore } from "../session/SessionStore.js";

export interface HttpResult {
  statusCode: number;
  body: MessageResponseDto | ErrorResponseDto;
}

export interface MessageHandlerDeps {
  chatRuntime: ChatRuntime;
  sessionStore: SessionStore;
  validApiKeys: Set<string>;
  conversationStore?: Pick<ConversationStore, "getConversation"> & Partial<Pick<MessageStore, "listMessages">>;
  authContext?: AuthContext | null;
  runtimeWorkspace?: RuntimeWorkspaceScope;
  runtimeCallbacks?: ChatRuntimeCallbacks;
  abortSignal?: AbortSignal;
}

const ERROR_STATUS: Record<ErrorCode, number> = {
  AUTH_INVALID_TOKEN: 401,
  AUTH_MISSING_TOKEN: 401,
  VALIDATION_MESSAGE_REQUIRED: 400,
  VALIDATION_SLASH_WITH_ATTACHMENTS: 400,
  VALIDATION_NEW_COMMAND_BLOCKED: 400,
  VALIDATION_ATTACHMENT_TYPE_NOT_ALLOWED: 400,
  VALIDATION_ATTACHMENT_TOO_LARGE: 400,
  VALIDATION_ATTACHMENT_TOTAL_TOO_LARGE: 400,
  VALIDATION_ATTACHMENT_COUNT_EXCEEDED: 400,
  VALIDATION_CONVERSATION_ARCHIVED: 409,
  VALIDATION_MODEL_INVALID: 400,
  UPSTREAM_OPENCLAW_UNAVAILABLE: 502,
  UPSTREAM_OPENCLAW_TIMEOUT: 504,
  CONVERSATION_NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
};

function createRequestId(): string {
  return `req_${randomUUID()}`;
}

function errorResponse(input: {
  requestId: string;
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}): HttpResult {
  return {
    statusCode: ERROR_STATUS[input.code],
    body: {
      error: {
        code: input.code,
        message: input.message,
        details: input.details,
      },
      request_id: input.requestId,
    },
  };
}

function getSingleHeader(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function isTimeoutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const cause = error instanceof Error ? error.cause : undefined;
  const causeMessage = cause instanceof Error ? cause.message : String(cause ?? "");
  const causeCode = typeof cause === "object" && cause !== null && "code" in cause ? String((cause as { code?: unknown }).code ?? "") : "";
  const combined = `${message}\n${causeMessage}\n${causeCode}`.toLowerCase();

  return (
    combined.includes("timed out") ||
    combined.includes("timeout") ||
    combined.includes("und_err_body_timeout") ||
    (typeof error === "object" &&
      error !== null &&
      "signal" in error &&
      (error as { signal?: unknown }).signal === "SIGTERM")
  );
}

export async function handlePostMessage(
  deps: MessageHandlerDeps,
  headers: IncomingHttpHeaders,
  payload: MessageRequestDto,
): Promise<HttpResult> {
  const requestId = createRequestId();
  if (!deps.authContext) {
    const tokenOrError = extractBearerToken(getSingleHeader(headers, "authorization"));
    if (typeof tokenOrError !== "string") {
      return errorResponse({
        requestId,
        code: tokenOrError.code,
        message: tokenOrError.message,
        details: tokenOrError.details,
      });
    }

    if (!deps.validApiKeys.has(tokenOrError)) {
      return errorResponse({
        requestId,
        code: "AUTH_INVALID_TOKEN",
        message: "API key is invalid.",
      });
    }
  }

  const validationError = validateMessageRequestDto(payload);
  if (validationError) {
    return errorResponse({
      requestId,
      code: validationError.code,
      message: validationError.message,
      details: validationError.details,
    });
  }

  const deviceId = getSingleHeader(headers, "x-device-id");
  const userId = deps.authContext?.user.id ?? getSingleHeader(headers, "x-user-id");
  const conversationId = payload.conversation_id?.trim();
  const conversation = conversationId && deps.conversationStore ? deps.conversationStore.getConversation(conversationId) : null;
  if (conversationId && deps.conversationStore && !conversation) {
    return errorResponse({
      requestId,
      code: "CONVERSATION_NOT_FOUND",
      message: "Conversation not found.",
      details: { conversation_id: conversationId },
    });
  }
  if (conversation?.archivedAt) {
    return errorResponse({
      requestId,
      code: "VALIDATION_CONVERSATION_ARCHIVED",
      message: "보관된 대화에는 새 메시지를 보낼 수 없습니다. 아카이브를 해제한 뒤 이어가세요.",
      details: { conversation_id: conversation.id },
    });
  }
  const sessionId = conversation?.openclawSessionId ?? deps.sessionStore.getSessionId({ deviceId, userId });
  const history = conversation && deps.conversationStore?.listMessages
    ? recentConversationHistory(deps.conversationStore.listMessages(conversation.id, { limit: 80 }), payload.message)
    : undefined;

  try {
    const result = await deps.chatRuntime.sendMessage({
      sessionId,
      message: payload.message,
      history,
      userId,
      runtimeWorkspace: deps.runtimeWorkspace,
      attachments: payload.attachments,
      metadata: payload.metadata,
      callbacks: deps.runtimeCallbacks,
      abortSignal: deps.abortSignal,
    });

    return {
      statusCode: 200,
      body: {
        reply: result.reply,
        request_id: requestId,
        session_id: sessionId,
        ...(conversation ? { conversation_id: conversation.id } : {}),
      },
    };
  } catch (error) {
    if (isTimeoutError(error)) {
      return errorResponse({
        requestId,
        code: "UPSTREAM_OPENCLAW_TIMEOUT",
        message: "작업 처리에 시간이 오래 걸려 요청 시간이 초과되었습니다. 같은 요청을 다시 보내면 재시도할 수 있습니다.",
      });
    }

    return errorResponse({
      requestId,
      code: "UPSTREAM_OPENCLAW_UNAVAILABLE",
      message: "OpenClaw is unavailable.",
      details: {
        reason: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

const PLACEHOLDER_TEXTS = new Set(["응답 대기 중입니다…", "응답을 처리 중입니다…", "요청이 취소되었습니다."]);
const MAX_HISTORY_MESSAGES = Number(process.env.PWA_GATEWAY_HISTORY_MESSAGES ?? 24);
const MAX_HISTORY_CHARS = Number(process.env.PWA_GATEWAY_HISTORY_CHARS ?? 24_000);
const MAX_HISTORY_MESSAGE_CHARS = Number(process.env.PWA_GATEWAY_HISTORY_MESSAGE_CHARS ?? 4_000);

function recentConversationHistory(messages: ChatMessageRecord[], currentMessage: string): OpenClawConversationMessage[] {
  const eligible = messages.filter((message) => isHistoryMessageEligible(message));
  const withoutCurrentUser = dropCurrentUserMessage(eligible, currentMessage);
  const bounded = boundHistory(withoutCurrentUser.map(toOpenClawHistoryMessage));
  return bounded;
}

function isHistoryMessageEligible(message: ChatMessageRecord): boolean {
  const text = message.text.trim();
  if (!text || PLACEHOLDER_TEXTS.has(text) || message.id.includes(":partial:")) {
    return false;
  }
  if (message.role === "assistant") {
    return Boolean(message.completedAt);
  }
  return message.role === "user" || message.role === "system";
}

function dropCurrentUserMessage(messages: ChatMessageRecord[], currentMessage: string): ChatMessageRecord[] {
  const normalizedCurrent = normalizeHistoryText(currentMessage);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") {
      continue;
    }
    const normalizedText = normalizeHistoryText(message.text);
    if (normalizedText === normalizedCurrent || normalizedText.startsWith(normalizedCurrent)) {
      return [...messages.slice(0, index), ...messages.slice(index + 1)];
    }
    break;
  }
  return messages;
}

function toOpenClawHistoryMessage(message: ChatMessageRecord): OpenClawConversationMessage {
  return {
    role: message.role,
    content: truncateHistoryMessage(message.text.trim()),
  };
}

function boundHistory(messages: OpenClawConversationMessage[]): OpenClawConversationMessage[] {
  const maxMessages = Math.max(0, MAX_HISTORY_MESSAGES);
  const maxChars = Math.max(0, MAX_HISTORY_CHARS);
  const selected: OpenClawConversationMessage[] = [];
  let totalChars = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || selected.length >= maxMessages) {
      break;
    }
    const nextTotal = totalChars + message.content.length;
    if (selected.length > 0 && nextTotal > maxChars) {
      break;
    }
    selected.push(message);
    totalChars = nextTotal;
  }
  return selected.reverse();
}

function truncateHistoryMessage(text: string): string {
  const maxChars = Math.max(1, MAX_HISTORY_MESSAGE_CHARS);
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n[history message truncated]` : text;
}

function normalizeHistoryText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}
