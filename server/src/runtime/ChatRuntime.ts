import type { MessageAttachment, MessageRequestMetadata } from "../contracts/apiContractV1.js";

export interface ChatRuntimeCallbacks {
  onToken?(token: string): void | Promise<void>;
}

export interface ChatRuntimeInput {
  sessionId: string;
  message: string;
  userId?: string;
  attachments?: MessageAttachment[];
  metadata?: MessageRequestMetadata;
  callbacks?: ChatRuntimeCallbacks;
  abortSignal?: AbortSignal;
}

export interface ChatRuntimeResult {
  reply: string;
  raw?: unknown;
}

export interface ChatRuntime {
  sendMessage(input: ChatRuntimeInput): Promise<ChatRuntimeResult>;
}
