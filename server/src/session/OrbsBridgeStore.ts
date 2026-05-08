import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";

export type OrbsBridgeDirection = "ethereum-to-polygon" | "polygon-to-ethereum";
export type OrbsBridgeState = "source-submitted" | "source-confirmed" | "checkpoint-ready" | "exit-submitted" | "completed" | "failed";

export interface OrbsBridgeRecord {
  id: string;
  ownerId: string;
  conversationId?: string;
  account: string;
  direction: OrbsBridgeDirection;
  amount: string;
  sourceChainId: number;
  sourceTxHash?: string;
  sourceBlockNumber?: string;
  exitPayload?: string;
  exitTxHash?: string;
  state: OrbsBridgeState;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

interface OrbsBridgeRow {
  id: string;
  owner_id: string;
  conversation_id: string | null;
  account: string;
  direction: OrbsBridgeDirection;
  amount: string;
  source_chain_id: number;
  source_tx_hash: string | null;
  source_block_number: string | null;
  exit_payload: string | null;
  exit_tx_hash: string | null;
  state: OrbsBridgeState;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export class OrbsBridgeStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    const resolvedPath = resolve(dbPath);
    mkdirSync(dirname(resolvedPath), { recursive: true });
    this.db = new Database(resolvedPath);
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  upsert(input: {
    ownerId: string;
    conversationId?: string;
    account: string;
    direction: OrbsBridgeDirection;
    amount: string;
    sourceChainId: number;
    sourceTxHash?: string;
    sourceBlockNumber?: string;
    exitPayload?: string;
    exitTxHash?: string;
    state?: OrbsBridgeState;
    error?: string | null;
    now?: string;
  }): OrbsBridgeRecord {
    const now = input.now ?? new Date().toISOString();
    const existing = input.sourceTxHash ? this.findBySourceTx(input.ownerId, input.direction, input.sourceTxHash) : null;
    if (existing) {
      return this.update(existing.id, {
        conversationId: input.conversationId ?? existing.conversationId,
        amount: input.amount,
        sourceChainId: input.sourceChainId,
        sourceBlockNumber: input.sourceBlockNumber ?? existing.sourceBlockNumber,
        exitPayload: input.exitPayload ?? existing.exitPayload,
        exitTxHash: input.exitTxHash ?? existing.exitTxHash,
        state: input.state ?? existing.state,
        error: input.error === undefined ? existing.error ?? null : input.error,
        now,
      }) ?? existing;
    }

    const id = `orbs_bridge_${randomUUID()}`;
    this.db
      .prepare(
        `INSERT INTO orbs_bridge_records (
          id, owner_id, conversation_id, account, direction, amount, source_chain_id,
          source_tx_hash, source_block_number, exit_payload, exit_tx_hash, state, error, created_at, updated_at
        ) VALUES (
          @id, @ownerId, @conversationId, @account, @direction, @amount, @sourceChainId,
          @sourceTxHash, @sourceBlockNumber, @exitPayload, @exitTxHash, @state, @error, @now, @now
        )`,
      )
      .run({
        id,
        ownerId: input.ownerId,
        conversationId: input.conversationId ?? null,
        account: normalizeAddress(input.account),
        direction: input.direction,
        amount: input.amount,
        sourceChainId: input.sourceChainId,
        sourceTxHash: input.sourceTxHash ?? null,
        sourceBlockNumber: input.sourceBlockNumber ?? null,
        exitPayload: input.exitPayload ?? null,
        exitTxHash: input.exitTxHash ?? null,
        state: input.state ?? "source-submitted",
        error: input.error ?? null,
        now,
      });
    const record = this.get(id);
    if (!record) {
      throw new Error("Failed to create ORBS bridge record.");
    }
    return record;
  }

  get(id: string): OrbsBridgeRecord | null {
    const row = this.db.prepare("SELECT * FROM orbs_bridge_records WHERE id = ?").get(id) as OrbsBridgeRow | undefined;
    return row ? mapRecord(row) : null;
  }

  list(input: { ownerId?: string; account?: string; activeOnly?: boolean; limit?: number }): OrbsBridgeRecord[] {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (input.ownerId) {
      conditions.push("owner_id = ?");
      params.push(input.ownerId);
    }
    const account = normalizeAddress(input.account ?? "");
    if (account) {
      conditions.push("account = ?");
      params.push(account);
    }
    if (input.activeOnly) {
      conditions.push("state NOT IN ('completed', 'failed')");
    }
    const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`SELECT * FROM orbs_bridge_records ${where} ORDER BY updated_at DESC, created_at DESC LIMIT ?`)
      .all(...params, limit) as OrbsBridgeRow[];
    return rows.map(mapRecord);
  }

  listCheckpointPollable(): OrbsBridgeRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM orbs_bridge_records
         WHERE direction = 'polygon-to-ethereum'
           AND state IN ('source-submitted', 'source-confirmed')
           AND source_tx_hash IS NOT NULL
           AND source_block_number IS NOT NULL
           AND conversation_id IS NOT NULL
         ORDER BY updated_at ASC, created_at ASC
         LIMIT 100`,
      )
      .all() as OrbsBridgeRow[];
    return rows.map(mapRecord);
  }

  update(id: string, patch: {
    conversationId?: string;
    amount?: string;
    sourceChainId?: number;
    sourceTxHash?: string | null;
    sourceBlockNumber?: string | null;
    exitPayload?: string | null;
    exitTxHash?: string | null;
    state?: OrbsBridgeState;
    error?: string | null;
    now?: string;
  }): OrbsBridgeRecord | null {
    const current = this.get(id);
    if (!current) {
      return null;
    }
    const now = patch.now ?? new Date().toISOString();
    this.db
      .prepare(
        `UPDATE orbs_bridge_records
         SET conversation_id = @conversationId,
             amount = @amount,
             source_chain_id = @sourceChainId,
             source_tx_hash = @sourceTxHash,
             source_block_number = @sourceBlockNumber,
             exit_payload = @exitPayload,
             exit_tx_hash = @exitTxHash,
             state = @state,
             error = @error,
             updated_at = @now
         WHERE id = @id`,
      )
      .run({
        id,
        conversationId: patch.conversationId ?? current.conversationId ?? null,
        amount: patch.amount ?? current.amount,
        sourceChainId: patch.sourceChainId ?? current.sourceChainId,
        sourceTxHash: patch.sourceTxHash === undefined ? current.sourceTxHash ?? null : patch.sourceTxHash,
        sourceBlockNumber: patch.sourceBlockNumber === undefined ? current.sourceBlockNumber ?? null : patch.sourceBlockNumber,
        exitPayload: patch.exitPayload === undefined ? current.exitPayload ?? null : patch.exitPayload,
        exitTxHash: patch.exitTxHash === undefined ? current.exitTxHash ?? null : patch.exitTxHash,
        state: patch.state ?? current.state,
        error: patch.error === undefined ? current.error ?? null : patch.error,
        now,
      });
    return this.get(id);
  }

  private findBySourceTx(ownerId: string, direction: OrbsBridgeDirection, sourceTxHash: string): OrbsBridgeRecord | null {
    const row = this.db
      .prepare("SELECT * FROM orbs_bridge_records WHERE owner_id = ? AND direction = ? AND source_tx_hash = ?")
      .get(ownerId, direction, sourceTxHash) as OrbsBridgeRow | undefined;
    return row ? mapRecord(row) : null;
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS orbs_bridge_records (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        conversation_id TEXT,
        account TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('ethereum-to-polygon', 'polygon-to-ethereum')),
        amount TEXT NOT NULL,
        source_chain_id INTEGER NOT NULL,
        source_tx_hash TEXT,
        source_block_number TEXT,
        exit_payload TEXT,
        exit_tx_hash TEXT,
        state TEXT NOT NULL CHECK (state IN ('source-submitted', 'source-confirmed', 'checkpoint-ready', 'exit-submitted', 'completed', 'failed')),
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_orbs_bridge_owner_account_updated
        ON orbs_bridge_records(owner_id, account, updated_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_orbs_bridge_owner_direction_source_tx
        ON orbs_bridge_records(owner_id, direction, source_tx_hash)
        WHERE source_tx_hash IS NOT NULL;
    `);
  }
}

function normalizeAddress(value: string): string {
  const address = value.trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(address) ? address : value.trim();
}

function mapRecord(row: OrbsBridgeRow): OrbsBridgeRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    ...(row.conversation_id ? { conversationId: row.conversation_id } : {}),
    account: row.account,
    direction: row.direction,
    amount: row.amount,
    sourceChainId: row.source_chain_id,
    ...(row.source_tx_hash ? { sourceTxHash: row.source_tx_hash } : {}),
    ...(row.source_block_number ? { sourceBlockNumber: row.source_block_number } : {}),
    ...(row.exit_payload ? { exitPayload: row.exit_payload } : {}),
    ...(row.exit_tx_hash ? { exitTxHash: row.exit_tx_hash } : {}),
    state: row.state,
    ...(row.error ? { error: row.error } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
