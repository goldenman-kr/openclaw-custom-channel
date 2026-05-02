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
import type { RuntimeWorkspaceScope } from "../openclaw/OpenClawClient.js";
import type { ChatRuntime, ChatRuntimeCallbacks } from "../runtime/ChatRuntime.js";
import type { AuthContext } from "./authRoutes.js";
import type { ConversationStore } from "../session/SqliteChatStore.js";
import type { SessionStore } from "../session/SessionStore.js";

export interface HttpResult {
  statusCode: number;
  body: MessageResponseDto | ErrorResponseDto;
}

export interface MessageHandlerDeps {
  chatRuntime: ChatRuntime;
  sessionStore: SessionStore;
  validApiKeys: Set<string>;
  conversationStore?: Pick<ConversationStore, "getConversation">;
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
  return (
    typeof error === "object" &&
    error !== null &&
    "signal" in error &&
    (error as { signal?: unknown }).signal === "SIGTERM"
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

  try {
    const result = await deps.chatRuntime.sendMessage({
      sessionId,
      message: payload.message,
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
        message: "OpenClaw request timed out.",
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
