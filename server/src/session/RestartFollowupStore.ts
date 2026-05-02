import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export interface RestartFollowupRecord {
  id: string;
  conversationId: string;
  serviceName: string;
  healthUrl?: string;
  requestedAt: string;
  checkAfter: string;
  createdBy?: string;
}

export class RestartFollowupStore {
  constructor(private readonly dir: string) {}

  async create(input: {
    conversationId: string;
    serviceName?: string;
    healthUrl?: string;
    delayMs?: number;
    createdBy?: string;
    now?: Date;
  }): Promise<RestartFollowupRecord> {
    await mkdir(this.dir, { recursive: true });
    const now = input.now ?? new Date();
    const record: RestartFollowupRecord = {
      id: `restart_${randomUUID()}`,
      conversationId: input.conversationId,
      serviceName: input.serviceName ?? "openclaw-custom-channel.service",
      healthUrl: input.healthUrl,
      requestedAt: now.toISOString(),
      checkAfter: new Date(now.getTime() + (input.delayMs ?? 30_000)).toISOString(),
      ...(input.createdBy ? { createdBy: input.createdBy } : {}),
    };
    await writeFile(this.pendingPath(record.id), `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
    return record;
  }

  async listPending(): Promise<RestartFollowupRecord[]> {
    await mkdir(this.dir, { recursive: true });
    const names = await readdir(this.dir).catch(() => []);
    const records: RestartFollowupRecord[] = [];
    for (const name of names) {
      if (!name.endsWith(".json") || name.includes(".done.") || name.includes(".failed.")) {
        continue;
      }
      const path = join(this.dir, name);
      try {
        const parsed = JSON.parse(await readFile(path, "utf8")) as RestartFollowupRecord;
        if (parsed.id && parsed.conversationId && parsed.serviceName && parsed.checkAfter) {
          records.push(parsed);
        }
      } catch (error) {
        await rename(path, join(this.dir, `${name}.failed.${Date.now()}`)).catch(() => undefined);
      }
    }
    return records.sort((a, b) => Date.parse(a.checkAfter) - Date.parse(b.checkAfter));
  }

  async markDone(id: string): Promise<void> {
    const path = this.pendingPath(id);
    await unlink(path).catch(async () => {
      await rename(path, join(this.dir, `${id}.done.${Date.now()}.json`)).catch(() => undefined);
    });
  }

  pendingPath(id: string): string {
    return resolve(this.dir, `${safeId(id)}.json`);
  }
}

export function safeConversationIdFromSessionKey(sessionKey: string): string | null {
  const trimmed = sessionKey.trim();
  const match = trimmed.match(/(?:^|:)web-(conv_[a-zA-Z0-9-]+)/);
  return match?.[1] ?? null;
}

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_.-]/g, "_");
}
