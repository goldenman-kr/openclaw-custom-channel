export const API_CONTRACT_V1 = {
  endpoint: "/v1/message",
  limits: {
    maxAttachments: 3,
    maxAttachmentBytes: 5 * 1024 * 1024,
    maxTotalAttachmentBytes: 10 * 1024 * 1024,
  },
  allowedMimeTypes: {
    image: ["image/jpeg", "image/png", "image/webp"],
    file: [
      "application/pdf",
      "text/plain",
      "text/csv",
      "application/csv",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/zip",
    ],
  },
} as const;

export type AttachmentType = "image" | "file";

const ATTACHMENT_MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip",
};

function inferAttachmentMimeType(name: string, mimeType: string): string {
  const allowed = [
    ...API_CONTRACT_V1.allowedMimeTypes.image,
    ...API_CONTRACT_V1.allowedMimeTypes.file,
  ];
  if ((allowed as readonly string[]).includes(mimeType)) {
    return mimeType;
  }
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  return ATTACHMENT_MIME_BY_EXTENSION[extension] ?? mimeType;
}

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
  conversation_id?: string;
  message: string;
  attachments?: MessageAttachment[];
  metadata?: MessageRequestMetadata;
}

export interface MessageResponseDto {
  reply: string;
  request_id: string;
  session_id: string;
  conversation_id?: string;
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
  | "VALIDATION_NEW_COMMAND_BLOCKED"
  | "VALIDATION_ATTACHMENT_TYPE_NOT_ALLOWED"
  | "VALIDATION_ATTACHMENT_TOO_LARGE"
  | "VALIDATION_ATTACHMENT_TOTAL_TOO_LARGE"
  | "VALIDATION_ATTACHMENT_COUNT_EXCEEDED"
  | "VALIDATION_CONVERSATION_ARCHIVED"
  | "CONVERSATION_NOT_FOUND"
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

  const normalizedMessage = payload.message.trim();
  const attachments = payload.attachments ?? [];

  if (normalizedMessage === "/new" || normalizedMessage.startsWith("/new ")) {
    return {
      code: "VALIDATION_NEW_COMMAND_BLOCKED",
      message: "이 웹챗에서는 /new 대신 “새 대화 시작” 버튼을 사용해주세요.",
    };
  }

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

    const normalizedMimeType = inferAttachmentMimeType(attachment.name, attachment.mime_type);

    if (!allowedMimeTypesForType.includes(normalizedMimeType)) {
      return {
        code: "VALIDATION_ATTACHMENT_TYPE_NOT_ALLOWED",
        message: `mime type is not allowed for type=${attachment.type}.`,
        details: { type: attachment.type, mime_type: attachment.mime_type, inferred_mime_type: normalizedMimeType },
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
