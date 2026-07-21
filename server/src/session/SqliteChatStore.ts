import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import type { HistoryAttachment, HistoryRole } from "./HistoryStore.js";

export type ConversationRole = HistoryRole;
export type JobState = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface ConversationRecord {
  id: string;
  ownerId: string;
  title: string;
  openclawSessionId: string;
  createdAt: string;
  updatedAt: string;
  finalResponseAt?: string;
  archivedAt?: string;
  pinned: boolean;
}

export interface ChatMessageRecord {
  id: string;
  conversationId: string;
  role: ConversationRole;
  text: string;
  jobId?: string;
  jobState?: JobState;
  createdAt: string;
  completedAt?: string;
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
  createConversation(input?: { ownerId?: string; title?: string; openclawSessionId?: string; now?: string }): ConversationRecord;
  getConversation(id: string): ConversationRecord | null;
  getConversationByOpenClawSessionId(openclawSessionId: string): ConversationRecord | null;
  listConversations(input?: { ownerId?: string; includeArchived?: boolean; limit?: number }): ConversationRecord[];
  searchConversationMessageText(input: { query: string; ownerId?: string; includeArchived?: boolean; limit?: number }): string[];
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
    completedAt?: string | null;
    retainOnFinalCleanup?: boolean;
    attachments?: HistoryAttachment[];
  }): ChatMessageRecord;
  updateMessage(id: string, patch: { role?: ConversationRole; text?: string; jobId?: string | null; createdAt?: string; completedAt?: string | null; retainOnFinalCleanup?: boolean; attachments?: HistoryAttachment[] }): ChatMessageRecord | null;
  deleteMessage(id: string): boolean;
  deleteAssistantMessagesForJob?(jobId: string, exceptMessageId?: string): number;
  listMessages(conversationId: string, input?: { limit?: number }): ChatMessageRecord[];
  clearMessages(conversationId: string, input?: { now?: string }): number;
}

export interface AttachmentVisibilityStore {
  isAttachmentPathVisibleToOwner(path: string, ownerId: string): boolean;
}

export interface JobStore {
  createJob(input: { conversationId: string; id?: string; state?: JobState; error?: string; now?: string }): JobRecord;
  getJob(id: string): JobRecord | null;
  updateJob(id: string, patch: { state?: JobState; error?: string | null; now?: string }): JobRecord | null;
  hasEarlierRunningJob(id: string): boolean;
  deleteQueuedJob(id: string, input?: { now?: string }): boolean;
}

export interface StaleJobCleanupResult {
  jobs: number;
  messages: number;
}

interface ConversationRow {
  id: string;
  owner_id: string;
  title: string;
  openclaw_session_id: string;
  created_at: string;
  updated_at: string;
  final_response_at: string | null;
  archived_at: string | null;
  pinned: number;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: ConversationRole;
  text: string;
  job_id: string | null;
  job_state?: JobState | null;
  created_at: string;
  completed_at: string | null;
  retain_on_final_cleanup: number;
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

  createConversation(input: { ownerId?: string; title?: string; openclawSessionId?: string; now?: string } = {}): ConversationRecord {
    const now = input.now ?? new Date().toISOString();
    const id = `conv_${randomUUID()}`;
    const ownerId = input.ownerId ?? "admin";
    const openclawSessionId = input.openclawSessionId ?? `pwa-webchat:${id}`;
    this.db
      .prepare(
        `INSERT INTO conversations (id, owner_id, title, openclaw_session_id, created_at, updated_at)
         VALUES (@id, @ownerId, @title, @openclawSessionId, @now, @now)`,
      )
      .run({ id, ownerId, title: input.title ?? "새 대화", openclawSessionId, now });
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

  getConversationByOpenClawSessionId(openclawSessionId: string): ConversationRecord | null {
    const row = this.db.prepare("SELECT * FROM conversations WHERE openclaw_session_id = ?").get(openclawSessionId) as ConversationRow | undefined;
    return row ? mapConversation(row) : null;
  }

  listConversations(input: { ownerId?: string; includeArchived?: boolean; limit?: number } = {}): ConversationRecord[] {
    const limit = Math.max(1, Math.min(input.limit ?? 100, 500));
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (input.ownerId) {
      conditions.push("owner_id = ?");
      params.push(input.ownerId);
    }
    if (!input.includeArchived) {
      conditions.push("archived_at IS NULL");
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`SELECT * FROM conversations ${where} ORDER BY pinned DESC, updated_at DESC, created_at DESC LIMIT ?`)
      .all(...params, limit) as ConversationRow[];
    return rows.map(mapConversation);
  }


  searchConversationMessageText(input: { query: string; ownerId?: string; includeArchived?: boolean; limit?: number }): string[] {
    const query = input.query.trim();
    if (!query) {
      return [];
    }
    const limit = Math.max(1, Math.min(input.limit ?? 500, 500));
    const conditions = ["messages.text LIKE ? ESCAPE '\\'"];
    const params: unknown[] = [`%${escapeLikePattern(query)}%`];
    if (input.ownerId) {
      conditions.push("conversations.owner_id = ?");
      params.push(input.ownerId);
    }
    if (!input.includeArchived) {
      conditions.push("conversations.archived_at IS NULL");
    }
    const rows = this.db
      .prepare(
        `SELECT DISTINCT conversations.id, conversations.pinned, conversations.updated_at, conversations.created_at
         FROM conversations
         JOIN messages ON messages.conversation_id = conversations.id
         WHERE ${conditions.join(" AND ")}
         ORDER BY conversations.pinned DESC, conversations.updated_at DESC, conversations.created_at DESC
         LIMIT ?`,
      )
      .all(...params, limit) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  updateConversation(id: string, patch: { title?: string; pinned?: boolean; archivedAt?: string | null; now?: string }): ConversationRecord | null {
    const current = this.getConversation(id);
    if (!current) {
      return null;
    }
    const nextPinned = patch.pinned === undefined ? current.pinned : patch.pinned;
    const nextArchivedAt = patch.archivedAt === undefined ? current.archivedAt ?? null : patch.archivedAt;
    const shouldTouchUpdatedAt = nextPinned !== current.pinned || nextArchivedAt !== (current.archivedAt ?? null);
    const updatedAt = shouldTouchUpdatedAt ? patch.now ?? new Date().toISOString() : current.updatedAt;
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
        pinned: nextPinned ? 1 : 0,
        archivedAt: nextArchivedAt,
        updatedAt,
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
    completedAt?: string | null;
    retainOnFinalCleanup?: boolean;
    attachments?: HistoryAttachment[];
  }): ChatMessageRecord {
    const id = input.id ?? `msg_${randomUUID()}`;
    const createdAt = input.createdAt ?? new Date().toISOString();
    const insert = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO messages (id, conversation_id, role, text, job_id, created_at, completed_at, retain_on_final_cleanup)
           VALUES (@id, @conversationId, @role, @text, @jobId, @createdAt, @completedAt, @retainOnFinalCleanup)`,
        )
        .run({
          id,
          conversationId: input.conversationId,
          role: input.role,
          text: input.text,
          jobId: input.jobId ?? null,
          createdAt,
          completedAt: input.completedAt ?? null,
          retainOnFinalCleanup: input.retainOnFinalCleanup === true ? 1 : 0,
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

  updateMessage(id: string, patch: { role?: ConversationRole; text?: string; jobId?: string | null; createdAt?: string; completedAt?: string | null; retainOnFinalCleanup?: boolean; attachments?: HistoryAttachment[] }): ChatMessageRecord | null {
    const current = this.db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as MessageRow | undefined;
    if (!current) {
      return null;
    }
    const createdAt = patch.createdAt ?? current.created_at;
    const updatedAt = patch.createdAt ?? new Date().toISOString();
    const update = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE messages
           SET role = @role, text = @text, job_id = @jobId, created_at = @createdAt, completed_at = @completedAt,
               retain_on_final_cleanup = @retainOnFinalCleanup
           WHERE id = @id`,
        )
        .run({
          id,
          role: patch.role ?? current.role,
          text: patch.text ?? current.text,
          jobId: patch.jobId === undefined ? current.job_id : patch.jobId,
          createdAt,
          completedAt: patch.completedAt === undefined ? current.completed_at : patch.completedAt,
          retainOnFinalCleanup: patch.retainOnFinalCleanup === undefined
            ? current.retain_on_final_cleanup
            : patch.retainOnFinalCleanup ? 1 : 0,
        });
      if (patch.attachments !== undefined) {
        this.db.prepare("DELETE FROM attachments WHERE message_id = ?").run(id);
        this.insertAttachments(id, patch.attachments, createdAt);
      }
      this.db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(updatedAt, current.conversation_id);
    });
    update();
    const row = this.db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as MessageRow | undefined;
    return row ? mapMessage(row, this.attachmentsFor([id]).get(id) ?? []) : null;
  }

  deleteMessage(id: string): boolean {
    const current = this.db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as MessageRow | undefined;
    if (!current) {
      return false;
    }
    const now = new Date().toISOString();
    const remove = this.db.transaction(() => {
      this.db.prepare("DELETE FROM attachments WHERE message_id = ?").run(id);
      const result = this.db.prepare("DELETE FROM messages WHERE id = ?").run(id);
      this.db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(now, current.conversation_id);
      return result.changes > 0;
    });
    return remove();
  }

  deleteAssistantMessagesForJob(jobId: string, exceptMessageId?: string): number {
    const rows = this.db
      .prepare(
        `SELECT id, conversation_id
         FROM messages
         WHERE job_id = ? AND role = 'assistant' AND id != ? AND retain_on_final_cleanup = 0`,
      )
      .all(jobId, exceptMessageId ?? "") as Array<{ id: string; conversation_id: string }>;
    if (rows.length === 0) {
      return 0;
    }
    const now = new Date().toISOString();
    const remove = this.db.transaction(() => {
      const ids = rows.map((row) => row.id);
      const placeholders = ids.map(() => "?").join(",");
      this.db.prepare(`DELETE FROM attachments WHERE message_id IN (${placeholders})`).run(...ids);
      const deleted = this.db.prepare(`DELETE FROM messages WHERE id IN (${placeholders})`).run(...ids).changes;
      for (const conversationId of new Set(rows.map((row) => row.conversation_id))) {
        this.db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(now, conversationId);
      }
      return deleted;
    });
    return remove();
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
    const limit = Math.max(1, Math.min(input.limit ?? 300, 5000));
    const rows = this.db
      .prepare(
        `SELECT * FROM (
           SELECT messages.*,
                  (SELECT jobs.state FROM jobs WHERE jobs.id = messages.job_id) AS job_state
           FROM messages
           WHERE conversation_id = ?
           ORDER BY CASE WHEN job_state = 'queued' THEN 1 ELSE 0 END DESC,
                    created_at DESC,
                    CASE role WHEN 'assistant' THEN 2 WHEN 'system' THEN 2 ELSE 1 END DESC,
                    id DESC
           LIMIT ?
         ) ORDER BY CASE WHEN job_state = 'queued' THEN 1 ELSE 0 END ASC,
                  created_at ASC,
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
    const nextState = patch.state ?? current.state;
    const update = this.db.transaction(() => {
      this.db
        .prepare("UPDATE jobs SET state = @state, error = @error, updated_at = @updatedAt WHERE id = @id")
        .run({ id, state: nextState, error: patch.error === undefined ? current.error ?? null : patch.error, updatedAt: now });
      if (nextState === "running" && current.state === "queued") {
        this.db.prepare("UPDATE messages SET created_at = ? WHERE job_id = ?").run(now, id);
        this.db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(now, current.conversationId);
      }
      if (nextState === "completed" && current.state !== "completed") {
        const priorCompletion = this.db
          .prepare(
            `SELECT MAX(earlier.updated_at) AS completed_at
             FROM jobs AS current
             JOIN jobs AS earlier
               ON earlier.conversation_id = current.conversation_id
              AND earlier.rowid < current.rowid
              AND earlier.state = 'completed'
             WHERE current.id = ?`,
          )
          .get(id) as { completed_at: string | null } | undefined;
        const userMessage = this.db
          .prepare("SELECT MIN(created_at) AS created_at FROM messages WHERE job_id = ? AND role = 'user'")
          .get(id) as { created_at: string | null } | undefined;
        if (priorCompletion?.completed_at && userMessage?.created_at && userMessage.created_at < priorCompletion.completed_at) {
          this.db.prepare("UPDATE messages SET created_at = ? WHERE job_id = ? AND role = 'user'").run(now, id);
        }
        this.db.prepare("UPDATE conversations SET final_response_at = ? WHERE id = ?").run(now, current.conversationId);
      }
    });
    update();
    return this.getJob(id);
  }

  hasEarlierRunningJob(id: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1
         FROM jobs AS current
         JOIN jobs AS earlier
           ON earlier.conversation_id = current.conversation_id
          AND earlier.rowid < current.rowid
          AND earlier.state = 'running'
         WHERE current.id = ?
         LIMIT 1`,
      )
      .get(id);
    return Boolean(row);
  }

  deleteQueuedJob(id: string, input: { now?: string } = {}): boolean {
    const current = this.db.prepare("SELECT conversation_id, state FROM jobs WHERE id = ?").get(id) as { conversation_id: string; state: JobState } | undefined;
    if (!current || current.state !== "queued") {
      return false;
    }
    const now = input.now ?? new Date().toISOString();
    const discard = this.db.transaction(() => {
      const messageIds = this.db.prepare("SELECT id FROM messages WHERE job_id = ?").all(id) as Array<{ id: string }>;
      if (messageIds.length > 0) {
        const placeholders = messageIds.map(() => "?").join(",");
        this.db.prepare(`DELETE FROM attachments WHERE message_id IN (${placeholders})`).run(...messageIds.map((row) => row.id));
        this.db.prepare(`DELETE FROM messages WHERE id IN (${placeholders})`).run(...messageIds.map((row) => row.id));
      }
      const deleted = this.db.prepare("DELETE FROM jobs WHERE id = ? AND state = 'queued'").run(id).changes > 0;
      if (deleted) {
        this.db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(now, current.conversation_id);
      }
      return deleted;
    });
    return discard();
  }

  cancelStaleJobs(input: { olderThanMs: number; now?: string; reason?: string }): StaleJobCleanupResult {
    const now = input.now ?? new Date().toISOString();
    const cutoff = new Date(Date.parse(now) - input.olderThanMs).toISOString();
    const reason = input.reason ?? "Cancelled stale job on service startup.";
    const pendingTexts = ["응답 대기 중입니다…", "응답을 처리 중입니다…"];
    const cancel = this.db.transaction(() => {
      const staleRows = this.db
        .prepare("SELECT id FROM jobs WHERE state IN ('queued', 'running') AND created_at < ?")
        .all(cutoff) as Array<{ id: string }>;
      if (staleRows.length === 0) {
        return { jobs: 0, messages: 0 };
      }

      const placeholders = staleRows.map(() => "?").join(",");
      const ids = staleRows.map((row) => row.id);
      const jobs = this.db
        .prepare(`UPDATE jobs SET state = 'cancelled', error = ?, updated_at = ? WHERE id IN (${placeholders})`)
        .run(reason, now, ...ids).changes;
      const messages = this.db
        .prepare(
          `UPDATE messages
           SET role = 'system', text = '요청이 취소되었습니다.', completed_at = COALESCE(completed_at, ?)
           WHERE job_id IN (${placeholders}) AND text IN (?, ?)`,
        )
        .run(now, ...ids, pendingTexts[0], pendingTexts[1]).changes;
      return { jobs, messages };
    });
    return cancel();
  }

  isAttachmentPathVisibleToOwner(path: string, ownerId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT attachments.id
         FROM attachments
         JOIN messages ON messages.id = attachments.message_id
         JOIN conversations ON conversations.id = messages.conversation_id
         WHERE attachments.path = ? AND conversations.owner_id = ?
         LIMIT 1`,
      )
      .get(path, ownerId) as { id: string } | undefined;
    return Boolean(row);
  }

  private migrate(): void {
    const migration = this.db.transaction(() => {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS conversations (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          openclaw_session_id TEXT NOT NULL UNIQUE,
          owner_id TEXT NOT NULL DEFAULT 'admin',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          final_response_at TEXT,
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
          completed_at TEXT,
          retain_on_final_cleanup INTEGER NOT NULL DEFAULT 0,
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
          state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
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
      this.ensureJobsCancelledStateAllowed();
      const conversationColumns = new Set(
        (this.db.prepare("PRAGMA table_info(conversations)").all() as Array<{ name: string }>).map((column) => column.name),
      );
      if (!conversationColumns.has("archived_at")) {
        this.db.exec("ALTER TABLE conversations ADD COLUMN archived_at TEXT");
      }
      if (!conversationColumns.has("pinned")) {
        this.db.exec("ALTER TABLE conversations ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0");
      }
      if (!conversationColumns.has("owner_id")) {
        this.db.exec("ALTER TABLE conversations ADD COLUMN owner_id TEXT NOT NULL DEFAULT 'admin'");
      }
      if (!conversationColumns.has("final_response_at")) {
        this.db.exec("ALTER TABLE conversations ADD COLUMN final_response_at TEXT");
      }
      const messageColumns = new Set(
        (this.db.prepare("PRAGMA table_info(messages)").all() as Array<{ name: string }>).map((column) => column.name),
      );
      if (!messageColumns.has("completed_at")) {
        this.db.exec("ALTER TABLE messages ADD COLUMN completed_at TEXT");
      }
      if (!messageColumns.has("retain_on_final_cleanup")) {
        this.db.exec("ALTER TABLE messages ADD COLUMN retain_on_final_cleanup INTEGER NOT NULL DEFAULT 0");
      }
      this.setMeta("schema_version", "1");
    });
    migration();
  }

  private ensureJobsCancelledStateAllowed(): void {
    const row = this.db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'jobs'").get() as { sql?: string } | undefined;
    if (row?.sql?.includes("'cancelled'")) {
      return;
    }

    this.db.exec(`
      CREATE TABLE jobs_new (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );
      INSERT INTO jobs_new (id, conversation_id, state, error, created_at, updated_at)
        SELECT id, conversation_id, state, error, created_at, updated_at FROM jobs;
      DROP TABLE jobs;
      ALTER TABLE jobs_new RENAME TO jobs;
    `);
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

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function mapConversation(row: ConversationRow): ConversationRecord {
  return {
    id: row.id,
    ownerId: row.owner_id ?? "admin",
    title: row.title,
    openclawSessionId: row.openclaw_session_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.final_response_at ? { finalResponseAt: row.final_response_at } : {}),
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
    ...(row.job_state ? { jobState: row.job_state } : {}),
    createdAt: row.created_at,
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
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
