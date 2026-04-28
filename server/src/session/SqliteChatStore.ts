import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import type { HistoryAttachment, HistoryRole } from "./HistoryStore.js";

export type ConversationRole = HistoryRole;
export type JobState = "queued" | "running" | "completed" | "failed";

export interface ConversationRecord {
  id: string;
  title: string;
  openclawSessionId: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  pinned: boolean;
}

export interface ChatMessageRecord {
  id: string;
  conversationId: string;
  role: ConversationRole;
  text: string;
  jobId?: string;
  createdAt: string;
  attachments?: HistoryAttachment[];
}

export interface JobRecord {
  id: string;
  conversationId: string;
  state: JobState;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationStore {
  createConversation(input?: { title?: string; openclawSessionId?: string; now?: string }): ConversationRecord;
  getConversation(id: string): ConversationRecord | null;
  listConversations(input?: { includeArchived?: boolean; limit?: number }): ConversationRecord[];
  updateConversation(id: string, patch: { title?: string; pinned?: boolean; archivedAt?: string | null; now?: string }): ConversationRecord | null;
  deleteConversation(id: string): boolean;
}

export interface MessageStore {
  addMessage(input: {
    conversationId: string;
    role: ConversationRole;
    text: string;
    id?: string;
    jobId?: string;
    createdAt?: string;
    attachments?: HistoryAttachment[];
  }): ChatMessageRecord;
  updateMessage(id: string, patch: { role?: ConversationRole; text?: string; jobId?: string | null; createdAt?: string }): ChatMessageRecord | null;
  listMessages(conversationId: string, input?: { limit?: number }): ChatMessageRecord[];
  clearMessages(conversationId: string, input?: { now?: string }): number;
}

export interface JobStore {
  createJob(input: { conversationId: string; id?: string; state?: JobState; error?: string; now?: string }): JobRecord;
  getJob(id: string): JobRecord | null;
  updateJob(id: string, patch: { state?: JobState; error?: string | null; now?: string }): JobRecord | null;
}

interface ConversationRow {
  id: string;
  title: string;
  openclaw_session_id: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  pinned: number;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: ConversationRole;
  text: string;
  job_id: string | null;
  created_at: string;
}

interface AttachmentRow {
  id: string;
  message_id: string;
  name: string;
  mime_type: string;
  type: "image" | "file";
  path: string;
  size: number | null;
  created_at: string;
}

interface JobRow {
  id: string;
  conversation_id: string;
  state: JobState;
  error: string | null;
  created_at: string;
  updated_at: string;
}


export class SqliteChatStore implements ConversationStore, MessageStore, JobStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    const resolvedPath = resolve(dbPath);
    mkdirSync(dirname(resolvedPath), { recursive: true });
    this.db = new Database(resolvedPath);
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  createConversation(input: { title?: string; openclawSessionId?: string; now?: string } = {}): ConversationRecord {
    const now = input.now ?? new Date().toISOString();
    const id = `conv_${randomUUID()}`;
    const openclawSessionId = input.openclawSessionId ?? `web-${id}`;
    this.db
      .prepare(
        `INSERT INTO conversations (id, title, openclaw_session_id, created_at, updated_at)
         VALUES (@id, @title, @openclawSessionId, @now, @now)`,
      )
      .run({ id, title: input.title ?? "새 대화", openclawSessionId, now });
    const conversation = this.getConversation(id);
    if (!conversation) {
      throw new Error("Failed to create conversation.");
    }
    return conversation;
  }

  getConversation(id: string): ConversationRecord | null {
    const row = this.db.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as ConversationRow | undefined;
    return row ? mapConversation(row) : null;
  }

  listConversations(input: { includeArchived?: boolean; limit?: number } = {}): ConversationRecord[] {
    const limit = Math.max(1, Math.min(input.limit ?? 100, 500));
    const where = input.includeArchived ? "" : "WHERE archived_at IS NULL";
    const rows = this.db
      .prepare(`SELECT * FROM conversations ${where} ORDER BY pinned DESC, updated_at DESC, created_at DESC LIMIT ?`)
      .all(limit) as ConversationRow[];
    return rows.map(mapConversation);
  }

  updateConversation(id: string, patch: { title?: string; pinned?: boolean; archivedAt?: string | null; now?: string }): ConversationRecord | null {
    const current = this.getConversation(id);
    if (!current) {
      return null;
    }
    const now = patch.now ?? new Date().toISOString();
    this.db
      .prepare(
        `UPDATE conversations
         SET title = @title,
             pinned = @pinned,
             archived_at = @archivedAt,
             updated_at = @updatedAt
         WHERE id = @id`,
      )
      .run({
        id,
        title: patch.title ?? current.title,
        pinned: patch.pinned === undefined ? (current.pinned ? 1 : 0) : patch.pinned ? 1 : 0,
        archivedAt: patch.archivedAt === undefined ? current.archivedAt ?? null : patch.archivedAt,
        updatedAt: now,
      });
    return this.getConversation(id);
  }

  deleteConversation(id: string): boolean {
    const result = this.db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
    return result.changes > 0;
  }

  addMessage(input: {
    conversationId: string;
    role: ConversationRole;
    text: string;
    id?: string;
    jobId?: string;
    createdAt?: string;
    attachments?: HistoryAttachment[];
  }): ChatMessageRecord {
    const id = input.id ?? `msg_${randomUUID()}`;
    const createdAt = input.createdAt ?? new Date().toISOString();
    const insert = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO messages (id, conversation_id, role, text, job_id, created_at)
           VALUES (@id, @conversationId, @role, @text, @jobId, @createdAt)`,
        )
        .run({
          id,
          conversationId: input.conversationId,
          role: input.role,
          text: input.text,
          jobId: input.jobId ?? null,
          createdAt,
        });
      this.insertAttachments(id, input.attachments ?? [], createdAt);
      this.db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(createdAt, input.conversationId);
    });
    insert();
    const row = this.db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as MessageRow | undefined;
    if (!row) {
      throw new Error("Failed to create message.");
    }
    return mapMessage(row, this.attachmentsFor([id]).get(id) ?? []);
  }

  updateMessage(id: string, patch: { role?: ConversationRole; text?: string; jobId?: string | null; createdAt?: string }): ChatMessageRecord | null {
    const current = this.db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as MessageRow | undefined;
    if (!current) {
      return null;
    }
    const createdAt = patch.createdAt ?? current.created_at;
    const updatedAt = patch.createdAt ?? new Date().toISOString();
    this.db
      .prepare(
        `UPDATE messages
         SET role = @role, text = @text, job_id = @jobId, created_at = @createdAt
         WHERE id = @id`,
      )
      .run({
        id,
        role: patch.role ?? current.role,
        text: patch.text ?? current.text,
        jobId: patch.jobId === undefined ? current.job_id : patch.jobId,
        createdAt,
      });
    this.db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(updatedAt, current.conversation_id);
    const row = this.db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as MessageRow | undefined;
    return row ? mapMessage(row, this.attachmentsFor([id]).get(id) ?? []) : null;
  }

  clearMessages(conversationId: string, input: { now?: string } = {}): number {
    const now = input.now ?? new Date().toISOString();
    const clear = this.db.transaction(() => {
      const result = this.db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(conversationId);
      this.db.prepare("DELETE FROM jobs WHERE conversation_id = ?").run(conversationId);
      this.db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(now, conversationId);
      return result.changes;
    });
    return clear();
  }

  listMessages(conversationId: string, input: { limit?: number } = {}): ChatMessageRecord[] {
    const limit = Math.max(1, Math.min(input.limit ?? 200, 1000));
    const rows = this.db
      .prepare(
        `SELECT * FROM (
           SELECT * FROM messages
           WHERE conversation_id = ?
           ORDER BY created_at DESC,
                    CASE role WHEN 'assistant' THEN 2 WHEN 'system' THEN 2 ELSE 1 END DESC,
                    id DESC
           LIMIT ?
         ) ORDER BY created_at ASC,
                  CASE role WHEN 'user' THEN 1 WHEN 'assistant' THEN 2 ELSE 3 END ASC,
                  id ASC`,
      )
      .all(conversationId, limit) as MessageRow[];
    const attachmentsByMessage = this.attachmentsFor(rows.map((row) => row.id));
    return rows.map((row) => mapMessage(row, attachmentsByMessage.get(row.id) ?? []));
  }

  createJob(input: { conversationId: string; id?: string; state?: JobState; error?: string; now?: string }): JobRecord {
    const id = input.id ?? `job_${randomUUID()}`;
    const now = input.now ?? new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO jobs (id, conversation_id, state, error, created_at, updated_at)
         VALUES (@id, @conversationId, @state, @error, @now, @now)`,
      )
      .run({ id, conversationId: input.conversationId, state: input.state ?? "queued", error: input.error ?? null, now });
    const job = this.getJob(id);
    if (!job) {
      throw new Error("Failed to create job.");
    }
    return job;
  }

  getJob(id: string): JobRecord | null {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | undefined;
    return row ? mapJob(row) : null;
  }

  updateJob(id: string, patch: { state?: JobState; error?: string | null; now?: string }): JobRecord | null {
    const current = this.getJob(id);
    if (!current) {
      return null;
    }
    const now = patch.now ?? new Date().toISOString();
    this.db
      .prepare("UPDATE jobs SET state = @state, error = @error, updated_at = @updatedAt WHERE id = @id")
      .run({ id, state: patch.state ?? current.state, error: patch.error === undefined ? current.error ?? null : patch.error, updatedAt: now });
    return this.getJob(id);
  }

  private migrate(): void {
    const migration = this.db.transaction(() => {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS conversations (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          openclaw_session_id TEXT NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          archived_at TEXT,
          pinned INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
          text TEXT NOT NULL,
          job_id TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
          ON messages(conversation_id, created_at);

        CREATE TABLE IF NOT EXISTS attachments (
          id TEXT PRIMARY KEY,
          message_id TEXT NOT NULL,
          name TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          type TEXT NOT NULL CHECK (type IN ('image', 'file')),
          path TEXT NOT NULL,
          size INTEGER,
          created_at TEXT NOT NULL,
          FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS jobs (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'completed', 'failed')),
          error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS app_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);
      this.setMeta("schema_version", "1");
    });
    migration();
  }

  private insertAttachments(messageId: string, attachments: HistoryAttachment[], createdAt: string): void {
    const statement = this.db.prepare(
      `INSERT INTO attachments (id, message_id, name, mime_type, type, path, size, created_at)
       VALUES (@id, @messageId, @name, @mimeType, @type, @path, @size, @createdAt)`,
    );
    for (const attachment of attachments) {
      statement.run({
        id: `att_${randomUUID()}`,
        messageId,
        name: attachment.name,
        mimeType: attachment.mime_type,
        type: attachment.type,
        path: attachment.path,
        size: attachment.size ?? null,
        createdAt,
      });
    }
  }

  private attachmentsFor(messageIds: string[]): Map<string, HistoryAttachment[]> {
    const result = new Map<string, HistoryAttachment[]>();
    if (messageIds.length === 0) {
      return result;
    }
    const placeholders = messageIds.map(() => "?").join(",");
    const rows = this.db
      .prepare(`SELECT * FROM attachments WHERE message_id IN (${placeholders}) ORDER BY created_at ASC, id ASC`)
      .all(...messageIds) as AttachmentRow[];
    for (const row of rows) {
      const current = result.get(row.message_id) ?? [];
      current.push({
        name: row.name,
        mime_type: row.mime_type,
        type: row.type,
        path: row.path,
        ...(row.size === null ? {} : { size: row.size }),
      });
      result.set(row.message_id, current);
    }
    return result;
  }

  private getMeta(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM app_meta WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  private setMeta(key: string, value: string): void {
    this.db.prepare("INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }
}

function mapConversation(row: ConversationRow): ConversationRecord {
  return {
    id: row.id,
    title: row.title,
    openclawSessionId: row.openclaw_session_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.archived_at ? { archivedAt: row.archived_at } : {}),
    pinned: row.pinned === 1,
  };
}

function mapMessage(row: MessageRow, attachments: HistoryAttachment[]): ChatMessageRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    text: row.text,
    ...(row.job_id ? { jobId: row.job_id } : {}),
    createdAt: row.created_at,
    ...(attachments.length > 0 ? { attachments } : {}),
  };
}

function mapJob(row: JobRow): JobRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    state: row.state,
    ...(row.error ? { error: row.error } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
