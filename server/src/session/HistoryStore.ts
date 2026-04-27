import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type HistoryRole = "user" | "assistant" | "system";

export interface HistoryAttachment {
  name: string;
  mime_type: string;
  type: "image" | "file";
  path: string;
  size?: number;
}

export interface HistoryMessage {
  id?: string;
  role: HistoryRole;
  text: string;
  savedAt: string;
  attachments?: HistoryAttachment[];
}

export interface HistoryMeta {
  version: string;
  size: number;
  mtimeMs: number;
}

export interface HistoryStore {
  list(sessionId: string): Promise<HistoryMessage[]>;
  meta(sessionId: string): Promise<HistoryMeta>;
  append(sessionId: string, messages: HistoryMessage[]): Promise<void>;
  replaceById(sessionId: string, id: string, message: HistoryMessage): Promise<void>;
  clear(sessionId: string): Promise<void>;
}

const MAX_HISTORY_MESSAGES = 200;

export class FileHistoryStore implements HistoryStore {
  constructor(private readonly baseDir: string) {}

  async list(sessionId: string): Promise<HistoryMessage[]> {
    try {
      const raw = await readFile(this.filePath(sessionId), "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.filter(isHistoryMessage).slice(-MAX_HISTORY_MESSAGES);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async meta(sessionId: string): Promise<HistoryMeta> {
    try {
      const fileStat = await stat(this.filePath(sessionId));
      return {
        version: `${Math.round(fileStat.mtimeMs)}:${fileStat.size}`,
        size: fileStat.size,
        mtimeMs: fileStat.mtimeMs,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { version: "0:0", size: 0, mtimeMs: 0 };
      }
      throw error;
    }
  }

  async append(sessionId: string, messages: HistoryMessage[]): Promise<void> {
    const current = await this.list(sessionId);
    await this.write(sessionId, [...current, ...messages].slice(-MAX_HISTORY_MESSAGES));
  }

  async replaceById(sessionId: string, id: string, message: HistoryMessage): Promise<void> {
    const current = await this.list(sessionId);
    const next = current.map((item) => (item.id === id ? { ...message, id } : item));
    if (!next.some((item) => item.id === id)) {
      next.push({ ...message, id });
    }
    await this.write(sessionId, next.slice(-MAX_HISTORY_MESSAGES));
  }

  async clear(sessionId: string): Promise<void> {
    await this.write(sessionId, []);
  }

  private async write(sessionId: string, messages: HistoryMessage[]): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
    await writeFile(this.filePath(sessionId), JSON.stringify(messages, null, 2), "utf8");
  }

  private filePath(sessionId: string): string {
    return join(this.baseDir, `${sanitizeSessionId(sessionId)}.json`);
  }
}

function sanitizeSessionId(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function isHistoryMessage(value: unknown): value is HistoryMessage {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.id === undefined || typeof candidate.id === "string") &&
    ["user", "assistant", "system"].includes(String(candidate.role)) &&
    typeof candidate.text === "string" &&
    typeof candidate.savedAt === "string" &&
    (candidate.attachments === undefined || Array.isArray(candidate.attachments))
  );
}
