export const API_CONTRACT_V1 = {
  endpoint: "/v1/message",
  limits: {
    maxAttachments: 3,
    maxAttachmentBytes: 5 * 1024 * 1024,
    maxTotalAttachmentBytes: 10 * 1024 * 1024,
  },
  allowedMimeTypes: {
    image: ["image/jpeg", "image/png", "image/webp"],
    file: ["application/pdf", "text/plain", "application/zip"],
  },
} as const;

export type AttachmentType = "image" | "file";

export interface MessageAttachment {
  type: AttachmentType;
  name: string;
  mime_type: string;
  content_base64: string;
}

export interface MessageLocationMetadata {
  latitude: number;
  longitude: number;
  accuracy?: number;
  captured_at?: string;
}

export interface MessageRequestMetadata {
  location?: MessageLocationMetadata;
}

export interface MessageRequestDto {
  message: string;
  attachments?: MessageAttachment[];
  metadata?: MessageRequestMetadata;
}

export interface MessageResponseDto {
  reply: string;
  request_id: string;
  session_id: string;
}

export interface ErrorResponseDto {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
  request_id: string;
}

export type ErrorCode =
  | "AUTH_INVALID_TOKEN"
  | "AUTH_MISSING_TOKEN"
  | "VALIDATION_MESSAGE_REQUIRED"
  | "VALIDATION_SLASH_WITH_ATTACHMENTS"
  | "VALIDATION_ATTACHMENT_TYPE_NOT_ALLOWED"
  | "VALIDATION_ATTACHMENT_TOO_LARGE"
  | "VALIDATION_ATTACHMENT_TOTAL_TOO_LARGE"
  | "VALIDATION_ATTACHMENT_COUNT_EXCEEDED"
  | "UPSTREAM_OPENCLAW_UNAVAILABLE"
  | "UPSTREAM_OPENCLAW_TIMEOUT"
  | "INTERNAL_SERVER_ERROR";

export interface ContractValidationError {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

function isNonEmptyTrimmed(value: string): boolean {
  return value.trim().length > 0;
}

function parseDecodedByteLength(base64Payload: string): number {
  const trimmed = base64Payload.trim();
  if (!trimmed) {
    return 0;
  }

  const paddingLength = trimmed.endsWith("==")
    ? 2
    : trimmed.endsWith("=")
      ? 1
      : 0;

  return Math.floor((trimmed.length * 3) / 4) - paddingLength;
}

export function extractBearerToken(
  authorizationHeader?: string,
): string | ContractValidationError {
  if (!authorizationHeader) {
    return {
      code: "AUTH_MISSING_TOKEN",
      message: "Authorization header is required.",
    };
  }

  const [scheme, token] = authorizationHeader.split(" ");
  if (scheme !== "Bearer" || !token?.trim()) {
    return {
      code: "AUTH_INVALID_TOKEN",
      message: "Authorization header must be in Bearer token format.",
    };
  }

  return token.trim();
}

export function validateMessageRequestDto(
  payload: MessageRequestDto,
): ContractValidationError | null {
  if (!payload?.message || !isNonEmptyTrimmed(payload.message)) {
    return {
      code: "VALIDATION_MESSAGE_REQUIRED",
      message: "message is required and cannot be blank.",
    };
  }

  const attachments = payload.attachments ?? [];

  if (payload.message.trimStart().startsWith("/") && attachments.length > 0) {
    return {
      code: "VALIDATION_SLASH_WITH_ATTACHMENTS",
      message: "slash command messages cannot include attachments.",
    };
  }

  if (attachments.length > API_CONTRACT_V1.limits.maxAttachments) {
    return {
      code: "VALIDATION_ATTACHMENT_COUNT_EXCEEDED",
      message: `attachments must be <= ${API_CONTRACT_V1.limits.maxAttachments}.`,
      details: { max: API_CONTRACT_V1.limits.maxAttachments, actual: attachments.length },
    };
  }

  let totalBytes = 0;
  for (const attachment of attachments) {
    const allowedMimeTypesForType: readonly string[] =
      attachment.type === "image"
        ? API_CONTRACT_V1.allowedMimeTypes.image
        : API_CONTRACT_V1.allowedMimeTypes.file;

    if (!allowedMimeTypesForType.includes(attachment.mime_type)) {
      return {
        code: "VALIDATION_ATTACHMENT_TYPE_NOT_ALLOWED",
        message: `mime type is not allowed for type=${attachment.type}.`,
        details: { type: attachment.type, mime_type: attachment.mime_type },
      };
    }

    const byteLength = parseDecodedByteLength(attachment.content_base64);
    if (byteLength > API_CONTRACT_V1.limits.maxAttachmentBytes) {
      return {
        code: "VALIDATION_ATTACHMENT_TOO_LARGE",
        message: `attachment exceeds ${API_CONTRACT_V1.limits.maxAttachmentBytes} bytes.`,
        details: { name: attachment.name, max: API_CONTRACT_V1.limits.maxAttachmentBytes, actual: byteLength },
      };
    }

    totalBytes += byteLength;
    if (totalBytes > API_CONTRACT_V1.limits.maxTotalAttachmentBytes) {
      return {
        code: "VALIDATION_ATTACHMENT_TOTAL_TOO_LARGE",
        message: `total attachment size exceeds ${API_CONTRACT_V1.limits.maxTotalAttachmentBytes} bytes.`,
        details: { max: API_CONTRACT_V1.limits.maxTotalAttachmentBytes, actual: totalBytes },
      };
    }
  }

  return null;
}
