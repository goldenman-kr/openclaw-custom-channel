import type { MessageAttachment, MessageRequestMetadata } from "../contracts/apiContractV1.js";

export interface OpenClawClient {
  sendMessage(input: {
    sessionId: string;
    message: string;
    userId?: string;
    attachments?: MessageAttachment[];
    metadata?: MessageRequestMetadata;
  }): Promise<{
    reply: string;
    raw?: unknown;
  }>;
}
