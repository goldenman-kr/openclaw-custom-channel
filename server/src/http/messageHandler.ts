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
import type { OpenClawClient } from "../openclaw/OpenClawClient.js";
import type { SessionStore } from "../session/SessionStore.js";

export interface HttpResult {
  statusCode: number;
  body: MessageResponseDto | ErrorResponseDto;
}

export interface MessageHandlerDeps {
  openClawClient: OpenClawClient;
  sessionStore: SessionStore;
  validApiKeys: Set<string>;
}

const ERROR_STATUS: Record<ErrorCode, number> = {
  AUTH_INVALID_TOKEN: 401,
  AUTH_MISSING_TOKEN: 401,
  VALIDATION_MESSAGE_REQUIRED: 400,
  VALIDATION_SLASH_WITH_ATTACHMENTS: 400,
  VALIDATION_ATTACHMENT_TYPE_NOT_ALLOWED: 400,
  VALIDATION_ATTACHMENT_TOO_LARGE: 400,
  VALIDATION_ATTACHMENT_TOTAL_TOO_LARGE: 400,
  VALIDATION_ATTACHMENT_COUNT_EXCEEDED: 400,
  UPSTREAM_OPENCLAW_UNAVAILABLE: 502,
  UPSTREAM_OPENCLAW_TIMEOUT: 504,
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
  const userId = getSingleHeader(headers, "x-user-id");
  const sessionId = deps.sessionStore.getSessionId({ deviceId, userId });

  try {
    const result = await deps.openClawClient.sendMessage({
      sessionId,
      message: payload.message,
      userId,
      attachments: payload.attachments,
      metadata: payload.metadata,
    });

    return {
      statusCode: 200,
      body: {
        reply: result.reply,
        request_id: requestId,
        session_id: sessionId,
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
