import type { MessageAttachment, MessageRequestMetadata } from "../contracts/apiContractV1.js";
import type { ChatRuntimeCallbacks } from "../runtime/ChatRuntime.js";

export interface RuntimeWorkspaceScope {
  userId: string;
  username?: string;
  displayName?: string;
  workspaceRoot: string;
  userDir: string;
  commonDir: string;
  commonWritable: boolean;
  identityFile?: string;
}

export interface OpenClawClientInput {
  sessionId: string;
  message: string;
  history?: OpenClawConversationMessage[];
  userId?: string;
  runtimeWorkspace?: RuntimeWorkspaceScope;
  attachments?: MessageAttachment[];
  metadata?: MessageRequestMetadata;
  callbacks?: ChatRuntimeCallbacks;
  abortSignal?: AbortSignal;
}

export interface OpenClawConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface OpenClawClientResult {
  reply: string;
  raw?: unknown;
}

export interface OpenClawClient {
  sendMessage(input: OpenClawClientInput): Promise<OpenClawClientResult>;
}
