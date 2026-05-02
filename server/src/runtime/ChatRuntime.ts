import type { MessageAttachment, MessageRequestMetadata } from "../contracts/apiContractV1.js";
import type { RuntimeWorkspaceScope } from "../openclaw/OpenClawClient.js";

export interface ChatRuntimeAgentEvent {
  stream?: string;
  sessionKey?: string;
  runId?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ChatRuntimeCallbacks {
  onToken?(token: string): void | Promise<void>;
  onAgentEvent?(event: ChatRuntimeAgentEvent): void | Promise<void>;
}

export interface ChatRuntimeInput {
  sessionId: string;
  message: string;
  userId?: string;
  runtimeWorkspace?: RuntimeWorkspaceScope;
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
