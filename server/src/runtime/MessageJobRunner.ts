import { readdirSync, statSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import type { IncomingMessage } from "node:http";
import type { MessageRequestDto } from "../contracts/apiContractV1.js";
import { handlePostMessage } from "../http/messageHandler.js";
import type { HistoryAttachment, HistoryStore } from "../session/HistoryStore.js";
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
  updateJob(job: MessageJob, patch: { state?: MessageJob["state"]; error?: string | null }): void;
  publishToken?(job: MessageJob, token: string): void;
  generatedMediaDirs?: string[];
}

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

    let streamedText = "";
    let lastPersistedStreamText = "";
    let lastStreamPersistAt = 0;
    const persistStreamCheckpoint = (force = false) => {
      if (!job.conversationId || !this.deps.shouldPersistMessage(payload.message) || !streamedText.trim()) {
        return;
      }
      const now = Date.now();
      if (!force && (now - lastStreamPersistAt < 2_000 || streamedText === lastPersistedStreamText)) {
        return;
      }
      this.deps.conversationStore.updateMessage(job.id, {
        role: "assistant",
        text: streamedText,
      });
      lastPersistedStreamText = streamedText;
      lastStreamPersistAt = now;
    };

    const result = await handlePostMessage(
      {
        chatRuntime: this.deps.chatRuntime,
        sessionStore: this.deps.sessionStore,
        validApiKeys: this.deps.validApiKeys,
        conversationStore: this.deps.conversationStore,
        authContext: job.authContext,
        runtimeWorkspace: job.runtimeWorkspace,
        runtimeCallbacks: {
          onToken: (token) => {
            streamedText += token;
            persistStreamCheckpoint();
            this.deps.publishToken?.(job, token);
          },
        },
        abortSignal: abortController.signal,
      },
      headers,
      payload,
    );

    persistStreamCheckpoint(true);
    this.abortControllers.delete(job.id);
    if (this.isCancelled(job)) {
      return;
    }

    if (result.statusCode >= 200 && result.statusCode < 300 && "reply" in result.body) {
      if (this.deps.shouldPersistMessage(payload.message)) {
        const text = await appendRecentGeneratedMediaRefs(sanitizeAssistantReply(result.body.reply), job.createdAt, this.deps.generatedMediaDirs);
        const attachments = mergeAttachments(
          await attachmentsFromMediaRefs(text),
          await attachmentsFromFileMentions(`${payload.message}\n${text}`),
        );
        const savedAt = new Date().toISOString();
        if (job.conversationId) {
          this.deps.conversationStore.updateMessage(job.id, {
            role: "assistant",
            text,
            completedAt: savedAt,
            attachments,
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

async function appendRecentGeneratedMediaRefs(text: string, jobCreatedAt: string, generatedMediaDirs?: string[]): Promise<string> {
  const dirs = generatedMediaDirs ?? [];
  if (dirs.length === 0) {
    return text;
  }

  const jobStartMs = Date.parse(jobCreatedAt);
  const sinceMs = Number.isFinite(jobStartMs) ? jobStartMs - 5_000 : Date.now() - 10 * 60_000;
  const refs = (await Promise.all(dirs.map((dir) => recentFilesInDir(dir, sinceMs))))
    .flat()
    .filter((filePath) => !text.includes(filePath))
    .sort();
  if (refs.length === 0) {
    return text;
  }
  return `${text.trim()}\n\n${refs.map((filePath) => `MEDIA:${filePath}`).join("\n")}`.trim();
}

async function recentFilesInDir(dir: string, sinceMs: number): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      const filePath = join(dir, entry.name);
      const fileStat = await stat(filePath);
      if (fileStat.mtimeMs >= sinceMs && fileStat.size > 0) {
        files.push(filePath);
      }
    }
    return files;
  } catch {
    return [];
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

const MEDIA_REF_LINE = /^\s*MEDIA:\s*(.+?)\s*$/i;

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

async function attachmentsFromFileMentions(text: string): Promise<HistoryAttachment[]> {
  const attachments: HistoryAttachment[] = [];
  for (const ref of extractLocalFileMentions(text)) {
    const attachment = await attachmentFromMediaRef(ref);
    if (attachment) {
      attachments.push(attachment);
    }
  }
  return attachments;
}

function extractLocalFileMentions(text: string): string[] {
  const refs: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(/(?:file:\/\/)?\/[^\s`'"<>]+\.(?:pdf|xlsx?|csv|png|jpe?g|webp|gif|svg|zip|txt)/gi)) {
    const resolved = resolveMentionedLocalFile(cleanMediaRef(match[0] ?? ""));
    if (!resolved || seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    refs.push(resolved);
  }
  return refs;
}

function resolveMentionedLocalFile(ref: string): string | null {
  const localPath = ref.startsWith("file://") ? new URL(ref).pathname : ref;
  return fileExistsSyncish(localPath) ? localPath : findSiblingByLooseBasename(localPath);
}

function fileExistsSyncish(filePath: string): boolean {
  try {
    return statSyncish(filePath)?.isFile() === true;
  } catch {
    return false;
  }
}

function statSyncish(filePath: string): { isFile(): boolean } | null {
  try {
    return statSync(filePath);
  } catch {
    return null;
  }
}

function findSiblingByLooseBasename(filePath: string): string | null {
  const dir = dirname(filePath);
  const wanted = looseFileName(basename(filePath));
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  const match = entries.find((entry) => looseFileName(entry) === wanted);
  return match ? join(dir, match) : null;
}

function looseFileName(name: string): string {
  return name.normalize("NFC").replace(/[\s_-]+/g, "").toLowerCase();
}

function mergeAttachments(...groups: HistoryAttachment[][]): HistoryAttachment[] {
  const merged: HistoryAttachment[] = [];
  const seen = new Set<string>();
  for (const attachment of groups.flat()) {
    if (seen.has(attachment.path)) {
      continue;
    }
    seen.add(attachment.path);
    merged.push(attachment);
  }
  return merged;
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
