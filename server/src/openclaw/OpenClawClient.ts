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
  userId?: string;
  runtimeWorkspace?: RuntimeWorkspaceScope;
  attachments?: MessageAttachment[];
  metadata?: MessageRequestMetadata;
  callbacks?: ChatRuntimeCallbacks;
  abortSignal?: AbortSignal;
}

export interface OpenClawClientResult {
  reply: string;
  raw?: unknown;
}

export interface OpenClawConversationSessionInput {
  conversationId: string;
  userId?: string;
  userLabel?: string;
  abortSignal?: AbortSignal;
}

export interface OpenClawConversationSessionResult {
  conversationId: string;
  sessionKey?: string;
  scopedSessionKey?: string;
  raw?: unknown;
}

export interface OpenClawAbortInput {
  conversationId: string;
  jobId?: string;
  abortSignal?: AbortSignal;
}

export interface OpenClawAbortResult {
  aborted?: boolean;
  runIds?: string[];
  raw?: unknown;
}

export interface OpenClawClient {
  ensureConversationSession?(input: OpenClawConversationSessionInput): Promise<OpenClawConversationSessionResult>;
  abortActive?(input: OpenClawAbortInput): Promise<OpenClawAbortResult>;
  sendMessage(input: OpenClawClientInput): Promise<OpenClawClientResult>;
}
