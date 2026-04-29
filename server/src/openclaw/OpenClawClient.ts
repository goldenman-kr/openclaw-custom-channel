import type { MessageAttachment, MessageRequestMetadata } from "../contracts/apiContractV1.js";
import type { ChatRuntimeCallbacks } from "../runtime/ChatRuntime.js";

export interface OpenClawClientInput {
  sessionId: string;
  message: string;
  userId?: string;
  attachments?: MessageAttachment[];
  metadata?: MessageRequestMetadata;
  callbacks?: ChatRuntimeCallbacks;
}

export interface OpenClawClientResult {
  reply: string;
  raw?: unknown;
}

export interface OpenClawClient {
  sendMessage(input: OpenClawClientInput): Promise<OpenClawClientResult>;
}
