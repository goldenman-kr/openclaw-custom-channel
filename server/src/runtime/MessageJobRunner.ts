import type { IncomingMessage } from "node:http";
import type { MessageRequestDto } from "../contracts/apiContractV1.js";
import { handlePostMessage } from "../http/messageHandler.js";
import type { HistoryStore } from "../session/HistoryStore.js";
import type { ConversationStore, JobStore, MessageStore } from "../session/SqliteChatStore.js";
import type { SessionStore } from "../session/SessionStore.js";
import type { ChatRuntime } from "./ChatRuntime.js";
import type { MessageJob } from "./MessageJob.js";

export interface MessageJobRunnerDeps {
  chatRuntime: ChatRuntime;
  sessionStore: SessionStore;
  validApiKeys: Set<string>;
  conversationStore: ConversationStore & MessageStore & JobStore;
  historyStore: HistoryStore;
  shouldPersistMessage(message: string): boolean;
  updateJob(job: MessageJob, patch: Partial<Pick<MessageJob, "state" | "error">>): void;
}

export class MessageJobRunner {
  private readonly queueTails = new Map<string, Promise<void>>();

  constructor(private readonly deps: MessageJobRunnerDeps) {}

  enqueue(job: MessageJob, headers: IncomingMessage["headers"], payload: MessageRequestDto): void {
    const key = this.jobQueueKey(job);
    const previousTail = this.queueTails.get(key) ?? Promise.resolve();
    const nextTail = previousTail
      .catch(() => {})
      .then(() => this.run(job, headers, payload))
      .catch(async (error) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await this.persistFailure(job, payload, `전송 실패: ${errorMessage}`);
        this.deps.updateJob(job, { state: "failed", error: errorMessage });
      })
      .finally(() => {
        if (this.queueTails.get(key) === nextTail) {
          this.queueTails.delete(key);
        }
      });
    this.queueTails.set(key, nextTail);
  }

  private jobQueueKey(job: MessageJob): string {
    return job.conversationId ? `conversation:${job.conversationId}` : `session:${job.sessionId}`;
  }

  private async run(job: MessageJob, headers: IncomingMessage["headers"], payload: MessageRequestDto): Promise<void> {
    this.deps.updateJob(job, { state: "running" });
    if (job.conversationId && this.deps.shouldPersistMessage(payload.message)) {
      this.deps.conversationStore.updateMessage(job.id, {
        role: "assistant",
        text: "응답을 처리 중입니다…",
      });
    }

    const result = await handlePostMessage(
      {
        chatRuntime: this.deps.chatRuntime,
        sessionStore: this.deps.sessionStore,
        validApiKeys: this.deps.validApiKeys,
        conversationStore: this.deps.conversationStore,
      },
      headers,
      payload,
    );

    if (result.statusCode >= 200 && result.statusCode < 300 && "reply" in result.body) {
      if (this.deps.shouldPersistMessage(payload.message)) {
        const text = sanitizeAssistantReply(result.body.reply);
        const savedAt = new Date().toISOString();
        if (job.conversationId) {
          this.deps.conversationStore.updateMessage(job.id, {
            role: "assistant",
            text,
          });
        } else {
          await this.deps.historyStore.replaceById(job.sessionId, job.id, {
            role: "assistant",
            text,
            savedAt,
          });
        }
      }
      this.deps.updateJob(job, { state: "completed" });
      return;
    }

    const errorMessage = "error" in result.body ? result.body.error.message : "OpenClaw request failed.";
    await this.persistFailure(job, payload, `전송 실패: ${errorMessage}`);
    this.deps.updateJob(job, { state: "failed", error: errorMessage });
  }

  private async persistFailure(job: MessageJob, payload: MessageRequestDto, text: string): Promise<void> {
    if (!this.deps.shouldPersistMessage(payload.message)) {
      return;
    }
    const savedAt = new Date().toISOString();
    if (job.conversationId) {
      this.deps.conversationStore.updateMessage(job.id, { role: "system", text });
      return;
    }
    await this.deps.historyStore.replaceById(job.sessionId, job.id, {
      role: "system",
      text,
      savedAt,
    }).catch(() => {});
  }
}

function sanitizeAssistantReply(reply: string): string {
  const extracted = extractEmbeddedPayloadText(reply);
  if (extracted) {
    return extracted;
  }

  const looksLikeRawAgentOutput =
    reply.includes('"payloads"') ||
    reply.includes('"systemPromptReport"') ||
    reply.includes("Gateway agent failed; falling back to embedded") ||
    reply.includes("Gateway target: ws://") ||
    reply.includes("Config: /home/");

  if (looksLikeRawAgentOutput) {
    return "응답은 완료됐지만 내부 출력 형식이 섞여 표시되지 않도록 차단했습니다.";
  }

  return reply;
}

function extractEmbeddedPayloadText(text: string): string | null {
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    return null;
  }

  try {
    const parsed = JSON.parse(text.slice(firstBrace, lastBrace + 1)) as { payloads?: Array<{ text?: unknown }>; result?: { payloads?: Array<{ text?: unknown }> } };
    const directText = parsed.payloads?.[0]?.text;
    if (typeof directText === "string" && directText.trim()) {
      return directText.trim();
    }
    const resultText = parsed.result?.payloads?.[0]?.text;
    if (typeof resultText === "string" && resultText.trim()) {
      return resultText.trim();
    }
  } catch {
    return null;
  }

  return null;
}
