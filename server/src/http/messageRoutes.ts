import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  API_CONTRACT_V1,
  extractBearerToken,
  validateMessageRequestDto,
  type ErrorResponseDto,
  type MessageRequestDto,
} from "../contracts/apiContractV1.js";
import { handlePostMessage } from "./messageHandler.js";
import type { ChatRuntime } from "../runtime/ChatRuntime.js";
import type { MessageJob } from "../runtime/MessageJob.js";
import type { HistoryStore } from "../session/HistoryStore.js";
import type { ConversationRecord, ConversationStore, JobStore, MessageStore } from "../session/SqliteChatStore.js";
import type { SessionStore } from "../session/SessionStore.js";
import type { AuthContext } from "./authRoutes.js";

export interface MessageRouteDeps {
  chatRuntime: ChatRuntime;
  sessionStore: SessionStore;
  validApiKeys: Set<string>;
  getAuthContext(request: IncomingMessage): AuthContext | null;
  isConversationVisibleToAuth(conversation: ConversationRecord, auth: AuthContext): boolean;
  conversationStore: ConversationStore & MessageStore & JobStore;
  historyStore: HistoryStore;
  sendJson(response: ServerResponse, statusCode: number, body: unknown): void;
  readJsonBody(request: IncomingMessage): Promise<unknown>;
  sessionIdFromRequest(request: IncomingMessage): string;
  persistConversationUserMessage(conversation: ConversationRecord, payload: MessageRequestDto): Promise<void>;
  persistUserHistory(sessionId: string, payload: MessageRequestDto): Promise<void>;
  enqueueMessageJob(job: MessageJob, headers: IncomingMessage["headers"], payload: MessageRequestDto): void;
  registerJob(job: MessageJob): void;
  shouldPersistMessage(message: string): boolean;
}

function getSingleHeader(headers: IncomingMessage["headers"], name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
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

function makeErrorResponse(code: ErrorResponseDto["error"]["code"], message: string, details?: Record<string, unknown>): ErrorResponseDto {
  return {
    error: { code, message, ...(details ? { details } : {}) },
    request_id: "req_unavailable",
  };
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

function validateAuthorizedMessage(headers: IncomingMessage["headers"], payload: MessageRequestDto, validApiKeys: Set<string>, auth?: AuthContext | null): ErrorResponseDto | null {
  if (!auth) {
    const tokenOrError = extractBearerToken(getSingleHeader(headers, "authorization"));
    if (typeof tokenOrError !== "string") {
      return makeErrorResponse(tokenOrError.code, tokenOrError.message, tokenOrError.details);
    }
    if (!validApiKeys.has(tokenOrError)) {
      return makeErrorResponse("AUTH_INVALID_TOKEN", "API key is invalid.");
    }
  }
  const validationError = validateMessageRequestDto(payload);
  if (validationError) {
    return makeErrorResponse(validationError.code, validationError.message, validationError.details);
  }
  return null;
}

function conversationIdFromPayload(payload: MessageRequestDto): string | null {
  return typeof payload.conversation_id === "string" && payload.conversation_id.trim() ? payload.conversation_id.trim() : null;
}

export async function handleMessageRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  deps: MessageRouteDeps,
): Promise<boolean> {
  if (request.method !== "POST" || url.pathname !== API_CONTRACT_V1.endpoint) {
    return false;
  }

  try {
    const payload = (await deps.readJsonBody(request)) as MessageRequestDto;

    if (getSingleHeader(request.headers, "x-openclaw-sync") === "1") {
      const result = await handlePostMessage(
        {
          chatRuntime: deps.chatRuntime,
          sessionStore: deps.sessionStore,
          validApiKeys: deps.validApiKeys,
          conversationStore: deps.conversationStore,
        },
        request.headers,
        payload,
      );
      deps.sendJson(response, result.statusCode, result.body);
      return true;
    }

    const auth = deps.getAuthContext(request);
    const validationError = validateAuthorizedMessage(request.headers, payload, deps.validApiKeys, auth);
    if (validationError) {
      deps.sendJson(response, statusForErrorCode(validationError.error.code), validationError);
      return true;
    }

    const requestedConversationId = conversationIdFromPayload(payload);
    const conversation = requestedConversationId ? deps.conversationStore.getConversation(requestedConversationId) : null;
    if (requestedConversationId && (!auth || !conversation || !deps.isConversationVisibleToAuth(conversation, auth))) {
      deps.sendJson(response, 404, makeErrorResponse("CONVERSATION_NOT_FOUND", "Conversation not found.", { conversation_id: requestedConversationId }));
      return true;
    }

    const sessionId = conversation?.openclawSessionId ?? deps.sessionIdFromRequest(request);
    if (conversation) {
      await deps.persistConversationUserMessage(conversation, payload);
    } else {
      await deps.persistUserHistory(sessionId, payload);
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
    deps.registerJob(job);
    if (conversation) {
      deps.conversationStore.createJob({ id: job.id, conversationId: conversation.id, state: "queued", now });
    }
    if (deps.shouldPersistMessage(payload.message)) {
      if (conversation) {
        deps.conversationStore.addMessage({
          id: job.id,
          conversationId: conversation.id,
          role: "assistant",
          text: "응답 대기 중입니다…",
          jobId: job.id,
          createdAt: now,
        });
      } else {
        await deps.historyStore.append(sessionId, [
          {
            id: job.id,
            role: "assistant",
            text: "응답 대기 중입니다…",
            savedAt: now,
          },
        ]);
      }
    }
    deps.enqueueMessageJob(job, request.headers, payload);

    deps.sendJson(response, 202, {
      job_id: job.id,
      status: job.state,
      session_id: sessionId,
      ...(conversation ? { conversation_id: conversation.id } : {}),
    });
    return true;
  } catch (error) {
    if (error instanceof SyntaxError) {
      deps.sendJson(response, 400, invalidJsonResponse());
      return true;
    }

    deps.sendJson(response, 500, {
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Unexpected server error.",
        details: {
          reason: error instanceof Error ? error.message : String(error),
        },
      },
      request_id: "req_unavailable",
    } satisfies ErrorResponseDto);
    return true;
  }
}
