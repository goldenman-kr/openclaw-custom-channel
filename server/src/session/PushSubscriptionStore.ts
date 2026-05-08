import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";

export interface PushSubscriptionRecord {
  id: string;
  ownerId: string;
  deviceId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
  disabledAt?: string;
}

export interface UpsertPushSubscriptionInput {
  ownerId: string;
  deviceId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
  now?: string;
}

interface PushSubscriptionRow {
  id: string;
  owner_id: string;
  device_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
  disabled_at: string | null;
}

export class PushSubscriptionStore {
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

  upsert(input: UpsertPushSubscriptionInput): PushSubscriptionRecord {
    const now = input.now ?? new Date().toISOString();
    const existing = this.getByEndpoint(input.endpoint);
    if (existing) {
      this.db.prepare(
        `UPDATE push_subscriptions
         SET owner_id = @ownerId,
             device_id = @deviceId,
             p256dh = @p256dh,
             auth = @auth,
             user_agent = @userAgent,
             updated_at = @now,
             last_seen_at = @now,
             disabled_at = NULL
         WHERE endpoint = @endpoint`,
      ).run({
        ownerId: input.ownerId,
        deviceId: input.deviceId,
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        userAgent: input.userAgent ?? null,
        now,
      });
      const updated = this.getByEndpoint(input.endpoint);
      if (!updated) {
        throw new Error("Failed to update push subscription.");
      }
      return updated;
    }

    const id = `push_${randomUUID()}`;
    this.db.prepare(
      `INSERT INTO push_subscriptions
       (id, owner_id, device_id, endpoint, p256dh, auth, user_agent, created_at, updated_at, last_seen_at)
       VALUES (@id, @ownerId, @deviceId, @endpoint, @p256dh, @auth, @userAgent, @now, @now, @now)`,
    ).run({
      id,
      ownerId: input.ownerId,
      deviceId: input.deviceId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent ?? null,
      now,
    });
    const created = this.getByEndpoint(input.endpoint);
    if (!created) {
      throw new Error("Failed to create push subscription.");
    }
    return created;
  }

  listActiveByOwner(ownerId: string): PushSubscriptionRecord[] {
    const rows = this.db.prepare(
      `SELECT * FROM push_subscriptions
       WHERE owner_id = ? AND disabled_at IS NULL
       ORDER BY updated_at DESC`,
    ).all(ownerId) as PushSubscriptionRow[];
    return rows.map(mapRow);
  }

  disableByEndpoint(ownerId: string, endpoint: string, now = new Date().toISOString()): boolean {
    const result = this.db.prepare(
      `UPDATE push_subscriptions
       SET disabled_at = @now, updated_at = @now
       WHERE owner_id = @ownerId AND endpoint = @endpoint AND disabled_at IS NULL`,
    ).run({ ownerId, endpoint, now });
    return result.changes > 0;
  }

  disableById(id: string, now = new Date().toISOString()): boolean {
    const result = this.db.prepare(
      `UPDATE push_subscriptions
       SET disabled_at = @now, updated_at = @now
       WHERE id = @id AND disabled_at IS NULL`,
    ).run({ id, now });
    return result.changes > 0;
  }

  private getByEndpoint(endpoint: string): PushSubscriptionRecord | null {
    const row = this.db.prepare("SELECT * FROM push_subscriptions WHERE endpoint = ?").get(endpoint) as PushSubscriptionRow | undefined;
    return row ? mapRow(row) : null;
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        user_agent TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        disabled_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_push_subscriptions_owner_active
        ON push_subscriptions(owner_id, disabled_at, updated_at);
    `);
  }
}

function mapRow(row: PushSubscriptionRow): PushSubscriptionRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    deviceId: row.device_id,
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
    ...(row.user_agent ? { userAgent: row.user_agent } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSeenAt: row.last_seen_at,
    ...(row.disabled_at ? { disabledAt: row.disabled_at } : {}),
  };
}
