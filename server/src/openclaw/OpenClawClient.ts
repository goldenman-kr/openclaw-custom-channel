import type { MessageAttachment } from "../contracts/apiContractV1.js";

export interface OpenClawClient {
  sendMessage(input: {
    sessionId: string;
    message: string;
    userId?: string;
    attachments?: MessageAttachment[];
  }): Promise<{
    reply: string;
    raw?: unknown;
  }>;
}
