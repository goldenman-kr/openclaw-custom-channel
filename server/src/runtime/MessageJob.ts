export type JobState = "queued" | "running" | "completed" | "failed";

export interface MessageJob {
  id: string;
  sessionId: string;
  conversationId?: string;
  state: JobState;
  createdAt: string;
  updatedAt: string;
  error?: string;
}
