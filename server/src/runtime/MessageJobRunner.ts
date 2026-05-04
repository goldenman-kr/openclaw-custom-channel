import { stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { IncomingMessage } from "node:http";
import type { MessageRequestDto } from "../contracts/apiContractV1.js";
import { handlePostMessage } from "../http/messageHandler.js";
import type { HistoryAttachment, HistoryStore } from "../session/HistoryStore.js";
import type { ConversationStore, JobStore, MessageStore } from "../session/SqliteChatStore.js";
import type { SessionStore } from "../session/SessionStore.js";
import type { ChatRuntime, ChatRuntimeAgentEvent } from "./ChatRuntime.js";
import type { MessageJob } from "./MessageJob.js";

export interface MessageJobRunnerDeps {
  chatRuntime: ChatRuntime;
  sessionStore: SessionStore;
  validApiKeys: Set<string>;
  conversationStore: ConversationStore & MessageStore & JobStore;
  historyStore: HistoryStore;
  shouldPersistMessage(message: string): boolean;
  updateJob(job: MessageJob, patch: { state?: MessageJob["state"]; error?: string | null }): void;
  publishToken?(job: MessageJob, token: string): void;
  publishAgentEvent?(job: MessageJob, event: ChatRuntimeAgentEvent): void;
  generatedMediaDirs?: string[];
}

const STREAMING_IDLE_CHECKPOINT_MS = Number(process.env.STREAMING_IDLE_CHECKPOINT_MS ?? 0);
const MIN_STREAMING_CHECKPOINT_CHARS = Number(process.env.MIN_STREAMING_CHECKPOINT_CHARS ?? 12);

export class MessageJobRunner {
  private readonly queueTails = new Map<string, Promise<void>>();
  private readonly cancelledJobIds = new Set<string>();
  private readonly abortControllers = new Map<string, AbortController>();

  constructor(private readonly deps: MessageJobRunnerDeps) {}

  enqueue(job: MessageJob, headers: IncomingMessage["headers"], payload: MessageRequestDto): void {
    const key = this.jobQueueKey(job);
    const previousTail = this.queueTails.get(key) ?? Promise.resolve();
    const nextTail = previousTail
      .catch(() => {})
      .then(() => {
        if (this.isCancelled(job)) {
          return;
        }
        return this.run(job, headers, payload);
      })
      .catch(async (error) => {
        if (this.isCancelled(job)) {
          return;
        }
        const errorMessage = error instanceof Error ? error.message : String(error);
        await this.persistFailure(job, payload, failureTextForError(errorMessage));
        this.deps.updateJob(job, { state: "failed", error: errorMessage });
      })
      .finally(() => {
        if (this.queueTails.get(key) === nextTail) {
          this.queueTails.delete(key);
        }
      });
    this.queueTails.set(key, nextTail);
  }

  cancel(job: MessageJob): boolean {
    if (this.isTerminal(job)) {
      return false;
    }

    this.cancelledJobIds.add(job.id);
    this.abortControllers.get(job.id)?.abort(new Error("Message job cancelled."));
    this.persistCancellation(job).catch(() => {});
    this.deps.updateJob(job, { state: "cancelled", error: null });
    return true;
  }

  private jobQueueKey(job: MessageJob): string {
    return job.conversationId ? `conversation:${job.conversationId}` : `session:${job.sessionId}`;
  }

  private async run(job: MessageJob, headers: IncomingMessage["headers"], payload: MessageRequestDto): Promise<void> {
    if (this.isCancelled(job)) {
      return;
    }

    const abortController = new AbortController();
    this.abortControllers.set(job.id, abortController);
    this.deps.updateJob(job, { state: "running" });
    if (job.conversationId && this.deps.shouldPersistMessage(payload.message)) {
      this.deps.conversationStore.updateMessage(job.id, {
        role: "assistant",
        text: "응답을 처리 중입니다…",
      });
    }

    let streamSegmentText = "";
    let persistedPartialText = "";
    let lastPersistedStreamText = "";
    let lastStreamPersistAt = 0;
    let streamIdleTimer: NodeJS.Timeout | undefined;
    let partialSegmentIndex = 0;
    const clearStreamIdleTimer = () => {
      if (streamIdleTimer) {
        clearTimeout(streamIdleTimer);
        streamIdleTimer = undefined;
      }
    };
    const persistStreamCheckpoint = (force = false) => {
      if (!force && STREAMING_IDLE_CHECKPOINT_MS <= 0) {
        return;
      }
      if (!job.conversationId || !this.deps.shouldPersistMessage(payload.message) || !streamSegmentText.trim()) {
        return;
      }
      const now = Date.now();
      if (!force && (now - lastStreamPersistAt < 2_000 || streamSegmentText === lastPersistedStreamText)) {
        return;
      }
      this.deps.conversationStore.updateMessage(job.id, {
        role: "assistant",
        text: streamSegmentText,
      });
      lastPersistedStreamText = streamSegmentText;
      lastStreamPersistAt = now;
    };
    const persistIdlePartialMessage = (resetTimer = true) => {
      if (resetTimer) {
        streamIdleTimer = undefined;
      }
      if (!job.conversationId || !this.deps.shouldPersistMessage(payload.message) || this.isCancelled(job)) {
        return;
      }
      const segmentText = streamSegmentText.trim();
      if (segmentText.length < MIN_STREAMING_CHECKPOINT_CHARS) {
        return;
      }
      partialSegmentIndex += 1;
      const partialMessageId = `${job.id}:partial:${partialSegmentIndex}`;
      const nowMs = Date.now();
      const now = new Date(nowMs).toISOString();
      const placeholderCreatedAt = new Date(nowMs + 1_000).toISOString();
      this.deps.conversationStore.addMessage({
        id: partialMessageId,
        conversationId: job.conversationId,
        role: "assistant",
        text: streamSegmentText,
        createdAt: now,
        completedAt: now,
      });
      persistedPartialText = `${persistedPartialText}${streamSegmentText}`;
      streamSegmentText = "";
      lastPersistedStreamText = "";
      this.deps.conversationStore.updateMessage(job.id, {
        role: "assistant",
        text: "응답을 처리 중입니다…",
        createdAt: placeholderCreatedAt,
        completedAt: null,
      });
    };
    const persistBoundaryPartialMessage = () => {
      clearStreamIdleTimer();
      persistIdlePartialMessage(false);
    };
    const scheduleIdlePartialMessage = () => {
      if (STREAMING_IDLE_CHECKPOINT_MS <= 0) {
        return;
      }
      clearStreamIdleTimer();
      streamIdleTimer = setTimeout(persistIdlePartialMessage, STREAMING_IDLE_CHECKPOINT_MS);
      streamIdleTimer.unref?.();
    };

    const result = await (async () => {
      try {
        return await handlePostMessage(
          {
            chatRuntime: this.deps.chatRuntime,
            sessionStore: this.deps.sessionStore,
            validApiKeys: this.deps.validApiKeys,
            conversationStore: this.deps.conversationStore,
            authContext: job.authContext,
            runtimeWorkspace: job.runtimeWorkspace,
            runtimeCallbacks: {
              onToken: (token) => {
                streamSegmentText += token;
                persistStreamCheckpoint();
                scheduleIdlePartialMessage();
                this.deps.publishToken?.(job, token);
              },
              onAgentEvent: (event) => {
                this.deps.publishAgentEvent?.(job, event);
                if (event.stream === "tool" && event.data?.phase === "start") {
                  persistBoundaryPartialMessage();
                }
              },
            },
            abortSignal: abortController.signal,
          },
          headers,
          payload,
        );
      } finally {
        clearStreamIdleTimer();
        persistStreamCheckpoint(true);
        this.abortControllers.delete(job.id);
      }
    })();
    if (this.isCancelled(job)) {
      return;
    }

    if (result.statusCode >= 200 && result.statusCode < 300 && "reply" in result.body) {
      if (this.deps.shouldPersistMessage(payload.message)) {
        const fullText = sanitizeAssistantReply(result.body.reply);
        const remainingText = persistedPartialText && fullText.startsWith(persistedPartialText)
          ? fullText.slice(persistedPartialText.length).trimStart()
          : fullText;
        const text = remainingText || fullText;
        const attachments = await attachmentsFromMediaRefs(text);
        const savedAt = new Date().toISOString();
        const shouldRemoveTerminalPlaceholder = Boolean(persistedPartialText) && !remainingText && attachments.length === 0;
        if (job.conversationId) {
          if (shouldRemoveTerminalPlaceholder) {
            this.deps.conversationStore.deleteMessage(job.id);
          } else {
            this.deps.conversationStore.updateMessage(job.id, {
              role: "assistant",
              text,
              createdAt: savedAt,
              completedAt: savedAt,
              attachments,
            });
          }
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

    const errorCode = "error" in result.body ? result.body.error.code : undefined;
    const errorMessage = "error" in result.body ? result.body.error.message : "OpenClaw request failed.";
    await this.persistFailure(job, payload, failureTextForError(errorMessage, errorCode));
    this.deps.updateJob(job, { state: "failed", error: errorMessage });
  }

  private isCancelled(job: MessageJob): boolean {
    return job.state === "cancelled" || this.cancelledJobIds.has(job.id);
  }

  private isTerminal(job: MessageJob): boolean {
    return job.state === "completed" || job.state === "failed" || job.state === "cancelled";
  }

  private async persistCancellation(job: MessageJob): Promise<void> {
    const text = "요청이 취소되었습니다.";
    if (job.conversationId) {
      this.deps.conversationStore.updateMessage(job.id, { role: "system", text });
      return;
    }
    await this.deps.historyStore.replaceById(job.sessionId, job.id, {
      role: "system",
      text,
      savedAt: job.createdAt,
    }).catch(() => {});
  }

  private async persistFailure(job: MessageJob, payload: MessageRequestDto, text: string): Promise<void> {
    if (!this.deps.shouldPersistMessage(payload.message)) {
      return;
    }
    const savedAt = new Date().toISOString();
    if (job.conversationId) {
      this.deps.conversationStore.updateMessage(job.id, { role: "system", text, createdAt: savedAt });
      return;
    }
    await this.deps.historyStore.replaceById(job.sessionId, job.id, {
      role: "system",
      text,
      savedAt,
    }).catch(() => {});
  }
}

function failureTextForError(errorMessage: string, errorCode?: string): string {
  if (errorCode === "UPSTREAM_OPENCLAW_TIMEOUT" || /timed?\s*out|timeout/i.test(errorMessage)) {
    return "처리 시간이 초과되었습니다. 작업 처리에 시간이 오래 걸렸습니다. 같은 요청을 다시 보내면 재시도할 수 있습니다.";
  }

  return `전송 실패: ${errorMessage}`;
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
    const parsed = JSON.parse(text.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
    return pickPayloadVisibleText(parsed) ?? pickPayloadVisibleText(asRecord(parsed.result));
  } catch {
    return null;
  }
}

function pickPayloadVisibleText(parsed: Record<string, unknown> | null): string | null {
  const payloads = asArray(parsed?.payloads);
  const parts = payloads?.flatMap(payloadToVisibleParts).filter(Boolean) ?? [];
  return parts.length > 0 ? parts.join("\n\n") : null;
}

function payloadToVisibleParts(payload: unknown): string[] {
  const record = asRecord(payload);
  if (!record) {
    return [];
  }

  const parts: string[] = [];
  const text = asNonEmptyString(record.text);
  if (text) {
    parts.push(text);
  }
  for (const mediaUrl of payloadMediaUrls(record)) {
    parts.push(`MEDIA:${mediaUrl}`);
  }
  return parts;
}

function payloadMediaUrls(record: Record<string, unknown>): string[] {
  const urls = [record.mediaUrls, record.MediaUrls, record.MediaPaths]
    .flatMap((value) => asArray(value) ?? [])
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());
  const singles = [record.mediaUrl, record.MediaUrl, record.MediaPath]
    .map(asNonEmptyString)
    .filter((value): value is string => Boolean(value));
  return [...urls, ...singles];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const MEDIA_REF_LINE = /^\s*`{0,3}\s*MEDIA:\s*(.+?)\s*`{0,3}\s*$/i;

function extractMediaRefs(text: string): string[] {
  const refs: string[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(MEDIA_REF_LINE);
    if (!match) {
      continue;
    }
    const ref = cleanMediaRef(match[1] ?? "");
    if (!ref || seen.has(ref)) {
      continue;
    }
    seen.add(ref);
    refs.push(ref);
  }
  return refs;
}

function cleanMediaRef(ref: string): string {
  const trimmed = ref.trim().replace(/^`+|`+$/g, "").trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

async function attachmentsFromMediaRefs(text: string): Promise<HistoryAttachment[]> {
  const attachments: HistoryAttachment[] = [];
  for (const ref of extractMediaRefs(text)) {
    const attachment = await attachmentFromMediaRef(ref);
    if (attachment) {
      attachments.push(attachment);
    }
  }
  return attachments;
}

async function attachmentFromMediaRef(ref: string): Promise<HistoryAttachment | null> {
  if (/^https?:\/\//i.test(ref)) {
    const name = basename(new URL(ref).pathname) || "download";
    return {
      name,
      mime_type: mimeTypeForName(name),
      type: attachmentKindForName(name),
      path: ref,
    };
  }

  const localPath = ref.startsWith("file://") ? new URL(ref).pathname : ref;
  try {
    const fileStat = await stat(localPath);
    if (!fileStat.isFile()) {
      return null;
    }
    const name = basename(localPath);
    return {
      name,
      mime_type: mimeTypeForName(name),
      type: attachmentKindForName(name),
      path: localPath,
      size: fileStat.size,
    };
  } catch {
    return null;
  }
}

function attachmentKindForName(name: string): "image" | "file" {
  return /^\.(png|jpe?g|webp|gif|svg)$/i.test(extname(name)) ? "image" : "file";
}

function mimeTypeForName(name: string): string {
  switch (extname(name).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    case ".pdf":
      return "application/pdf";
    case ".xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case ".xls":
      return "application/vnd.ms-excel";
    case ".csv":
      return "text/csv; charset=utf-8";
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".zip":
      return "application/zip";
    default:
      return "application/octet-stream";
  }
}
