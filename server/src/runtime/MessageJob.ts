import type { AuthContext } from "../http/authRoutes.js";
import type { RuntimeWorkspaceScope } from "../openclaw/OpenClawClient.js";

export type JobState = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface MessageJob {
  id: string;
  sessionId: string;
  conversationId?: string;
  authContext?: AuthContext;
  runtimeWorkspace?: RuntimeWorkspaceScope;
  state: JobState;
  createdAt: string;
  updatedAt: string;
  error?: string;
}
