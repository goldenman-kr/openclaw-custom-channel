import { randomUUID, createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";

export type SpotOrderState = "signed" | "submitted" | "failed";

export interface SpotOrderRecord {
  id: string;
  conversationId: string;
  signer: string;
  swapper: string;
  chainId: string;
  typedDataHash: string;
  typedDataJson: string;
  signature: string;
  relayPayloadJson: string;
  relayOrderHash?: string;
  state: SpotOrderState;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

interface SpotOrderRow {
  id: string;
  conversation_id: string;
  signer: string;
  swapper: string;
  chain_id: string;
  typed_data_hash: string;
  typed_data_json: string;
  signature: string;
  relay_payload_json: string;
  relay_order_hash: string | null;
  state: SpotOrderState;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export class SpotOrderStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    const resolvedPath = resolve(dbPath);
    mkdirSync(dirname(resolvedPath), { recursive: true });
    this.db = new Database(resolvedPath);
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  create(input: {
    conversationId: string;
    signer: string;
    swapper: string;
    chainId: string;
    typedData: unknown;
    signature: string;
    relayPayload: unknown;
    state?: SpotOrderState;
    relayOrderHash?: string;
    error?: string;
    now?: string;
  }): SpotOrderRecord {
    const now = input.now ?? new Date().toISOString();
    const typedDataJson = stableJson(input.typedData);
    const relayPayloadJson = stableJson(input.relayPayload);
    const id = `spot_${randomUUID()}`;
    this.db
      .prepare(
        `INSERT INTO spot_orders (
          id, conversation_id, signer, swapper, chain_id, typed_data_hash, typed_data_json,
          signature, relay_payload_json, relay_order_hash, state, error, created_at, updated_at
        ) VALUES (
          @id, @conversationId, @signer, @swapper, @chainId, @typedDataHash, @typedDataJson,
          @signature, @relayPayloadJson, @relayOrderHash, @state, @error, @now, @now
        )`,
      )
      .run({
        id,
        conversationId: input.conversationId,
        signer: input.signer,
        swapper: input.swapper,
        chainId: input.chainId,
        typedDataHash: sha256(typedDataJson),
        typedDataJson,
        signature: input.signature,
        relayPayloadJson,
        relayOrderHash: input.relayOrderHash ?? null,
        state: input.state ?? "signed",
        error: input.error ?? null,
        now,
      });
    const record = this.get(id);
    if (!record) {
      throw new Error("Failed to create Spot order record.");
    }
    return record;
  }

  get(id: string): SpotOrderRecord | null {
    const row = this.db.prepare("SELECT * FROM spot_orders WHERE id = ?").get(id) as SpotOrderRow | undefined;
    return row ? mapSpotOrder(row) : null;
  }

  update(id: string, patch: { state?: SpotOrderState; relayOrderHash?: string | null; error?: string | null; now?: string }): SpotOrderRecord | null {
    const current = this.get(id);
    if (!current) {
      return null;
    }
    const now = patch.now ?? new Date().toISOString();
    this.db
      .prepare(
        `UPDATE spot_orders
         SET state = @state, relay_order_hash = @relayOrderHash, error = @error, updated_at = @now
         WHERE id = @id`,
      )
      .run({
        id,
        state: patch.state ?? current.state,
        relayOrderHash: patch.relayOrderHash === undefined ? current.relayOrderHash ?? null : patch.relayOrderHash,
        error: patch.error === undefined ? current.error ?? null : patch.error,
        now,
      });
    return this.get(id);
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS spot_orders (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        signer TEXT NOT NULL,
        swapper TEXT NOT NULL,
        chain_id TEXT NOT NULL,
        typed_data_hash TEXT NOT NULL,
        typed_data_json TEXT NOT NULL,
        signature TEXT NOT NULL,
        relay_payload_json TEXT NOT NULL,
        relay_order_hash TEXT,
        state TEXT NOT NULL CHECK (state IN ('signed', 'submitted', 'failed')),
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_spot_orders_conversation_created
        ON spot_orders(conversation_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_spot_orders_relay_hash
        ON spot_orders(relay_order_hash);
    `);
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortJson(item)]),
    );
  }
  return value;
}

function mapSpotOrder(row: SpotOrderRow): SpotOrderRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    signer: row.signer,
    swapper: row.swapper,
    chainId: row.chain_id,
    typedDataHash: row.typed_data_hash,
    typedDataJson: row.typed_data_json,
    signature: row.signature,
    relayPayloadJson: row.relay_payload_json,
    ...(row.relay_order_hash ? { relayOrderHash: row.relay_order_hash } : {}),
    state: row.state,
    ...(row.error ? { error: row.error } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
