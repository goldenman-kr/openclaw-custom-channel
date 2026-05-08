import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthContext } from "./authRoutes.js";
import type { ConversationRecord, ConversationStore, MessageStore } from "../session/SqliteChatStore.js";
import { OrbsBridgeStore, type OrbsBridgeDirection, type OrbsBridgeState } from "../session/OrbsBridgeStore.js";

const CHECKPOINT_STATUS_URL = "https://proof-generator.polygon.technology/api/v1/matic/block-included";
const EXIT_PAYLOAD_URL = "https://proof-generator.polygon.technology/api/v1/matic/exit-payload";
const WITHDRAW_TRANSFER_EVENT_SIGNATURE = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ORBS_BRIDGE_CHECKPOINT_POLL_INTERVAL_MS = 10 * 60_000;
let checkpointPollingTimer: ReturnType<typeof setInterval> | null = null;
let checkpointPollingRunning = false;

export interface OrbsBridgePluginRouteDeps {
  conversationStore: ConversationStore & MessageStore;
  orbsBridgeStore: OrbsBridgeStore;
  getAuthContext(request: IncomingMessage): AuthContext | null;
  isConversationVisibleToAuth(conversation: ConversationRecord, auth: AuthContext): boolean;
  sendJson(response: ServerResponse, statusCode: number, body: unknown): void;
  readJsonBody(request: IncomingMessage): Promise<unknown>;
  publishConversationEvent?(event: { id: string; type: "message"; messageId: string; conversationId: string; createdAt: string }): void;
}

interface UpsertBody {
  conversation_id?: unknown;
  account?: unknown;
  direction?: unknown;
  amount?: unknown;
  source_chain_id?: unknown;
  source_tx_hash?: unknown;
  source_block_number?: unknown;
  exit_payload?: unknown;
  exit_tx_hash?: unknown;
  state?: unknown;
  error?: unknown;
}

interface PatchBody {
  conversation_id?: unknown;
  amount?: unknown;
  source_chain_id?: unknown;
  source_tx_hash?: unknown;
  source_block_number?: unknown;
  exit_payload?: unknown;
  exit_tx_hash?: unknown;
  state?: unknown;
  error?: unknown;
}

export async function handleOrbsBridgePluginRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  deps: OrbsBridgePluginRouteDeps,
): Promise<boolean> {
  if (!url.pathname.startsWith("/v1/plugins/orbs-bridge/records")) {
    return false;
  }

  const auth = deps.getAuthContext(request);
  if (!auth) {
    deps.sendJson(response, 401, { error: { code: "AUTH_INVALID_TOKEN", message: "로그인이 필요합니다." } });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/v1/plugins/orbs-bridge/records") {
    const account = normalizeAddress(url.searchParams.get("account") ?? "");
    const activeOnly = url.searchParams.get("active") !== "0";
    if (url.searchParams.has("account") && !account) {
      deps.sendJson(response, 400, { error: { code: "VALIDATION_ORBS_BRIDGE_ACCOUNT_INVALID", message: "지갑 주소가 올바르지 않습니다." } });
      return true;
    }
    const records = deps.orbsBridgeStore.list({ ownerId: auth.user.id, account: account || undefined, activeOnly });
    deps.sendJson(response, 200, { records: records.map(publicRecord) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/v1/plugins/orbs-bridge/records") {
    const body = (await deps.readJsonBody(request).catch(() => ({}))) as UpsertBody;
    const account = normalizeAddress(readString(body.account));
    const direction = normalizeDirection(readString(body.direction));
    const amount = readAmount(body.amount);
    const sourceChainId = readPositiveInteger(body.source_chain_id);
    const state = normalizeState(readString(body.state)) || "source-submitted";
    const conversationId = await validateConversation(body.conversation_id, auth, deps);

    if (!account || !direction || !amount || !sourceChainId) {
      deps.sendJson(response, 400, { error: { code: "VALIDATION_ORBS_BRIDGE_RECORD_INVALID", message: "브릿지 기록 payload가 올바르지 않습니다." } });
      return true;
    }
    if (conversationId === false) {
      deps.sendJson(response, 404, { error: { code: "CONVERSATION_NOT_FOUND", message: "대화를 찾지 못했습니다." } });
      return true;
    }

    const record = deps.orbsBridgeStore.upsert({
      ownerId: auth.user.id,
      ...(conversationId ? { conversationId } : {}),
      account,
      direction,
      amount,
      sourceChainId,
      sourceTxHash: readHexString(body.source_tx_hash),
      sourceBlockNumber: readDecimalString(body.source_block_number),
      exitPayload: readHexString(body.exit_payload),
      exitTxHash: readHexString(body.exit_tx_hash),
      state,
      error: readNullableString(body.error),
    });
    deps.sendJson(response, 200, { record: publicRecord(record) });
    return true;
  }

  const patchMatch = url.pathname.match(/^\/v1\/plugins\/orbs-bridge\/records\/([^/]+)$/);
  if (request.method === "PATCH" && patchMatch) {
    const current = deps.orbsBridgeStore.get(decodeURIComponent(patchMatch[1]));
    if (!current || current.ownerId !== auth.user.id) {
      deps.sendJson(response, 404, { error: { code: "ORBS_BRIDGE_RECORD_NOT_FOUND", message: "브릿지 기록을 찾지 못했습니다." } });
      return true;
    }
    const body = (await deps.readJsonBody(request).catch(() => ({}))) as PatchBody;
    const conversationId = await validateConversation(body.conversation_id, auth, deps);
    if (conversationId === false) {
      deps.sendJson(response, 404, { error: { code: "CONVERSATION_NOT_FOUND", message: "대화를 찾지 못했습니다." } });
      return true;
    }
    const state = normalizeState(readString(body.state));
    const sourceChainId = body.source_chain_id === undefined ? undefined : readPositiveInteger(body.source_chain_id);
    if (body.state !== undefined && !state) {
      deps.sendJson(response, 400, { error: { code: "VALIDATION_ORBS_BRIDGE_STATE_INVALID", message: "브릿지 상태값이 올바르지 않습니다." } });
      return true;
    }
    if (body.source_chain_id !== undefined && !sourceChainId) {
      deps.sendJson(response, 400, { error: { code: "VALIDATION_ORBS_BRIDGE_SOURCE_CHAIN_INVALID", message: "source_chain_id가 올바르지 않습니다." } });
      return true;
    }
    const record = deps.orbsBridgeStore.update(current.id, {
      ...(conversationId ? { conversationId } : {}),
      ...(body.amount !== undefined ? { amount: readAmount(body.amount) || current.amount } : {}),
      ...(sourceChainId ? { sourceChainId } : {}),
      ...(body.source_tx_hash !== undefined ? { sourceTxHash: readHexString(body.source_tx_hash) ?? null } : {}),
      ...(body.source_block_number !== undefined ? { sourceBlockNumber: readDecimalString(body.source_block_number) ?? null } : {}),
      ...(body.exit_payload !== undefined ? { exitPayload: readHexString(body.exit_payload) ?? null } : {}),
      ...(body.exit_tx_hash !== undefined ? { exitTxHash: readHexString(body.exit_tx_hash) ?? null } : {}),
      ...(state ? { state } : {}),
      ...(body.error !== undefined ? { error: readNullableString(body.error) } : {}),
    });
    deps.sendJson(response, 200, { record: record ? publicRecord(record) : null });
    return true;
  }

  return false;
}

async function validateConversation(value: unknown, auth: AuthContext, deps: OrbsBridgePluginRouteDeps): Promise<string | false | undefined> {
  const conversationId = readString(value);
  if (!conversationId) {
    return undefined;
  }
  const conversation = deps.conversationStore.getConversation(conversationId);
  if (!conversation || !deps.isConversationVisibleToAuth(conversation, auth)) {
    return false;
  }
  return conversationId;
}

export function resumeOrbsBridgeCheckpointPolling(deps: OrbsBridgePluginRouteDeps): void {
  if (checkpointPollingTimer) {
    return;
  }
  void pollOrbsBridgeCheckpoints(deps);
  checkpointPollingTimer = setInterval(() => {
    void pollOrbsBridgeCheckpoints(deps);
  }, ORBS_BRIDGE_CHECKPOINT_POLL_INTERVAL_MS);
  checkpointPollingTimer.unref?.();
}

export async function pollOrbsBridgeCheckpoints(deps: OrbsBridgePluginRouteDeps): Promise<void> {
  if (checkpointPollingRunning) {
    return;
  }
  checkpointPollingRunning = true;
  try {
    for (const record of deps.orbsBridgeStore.listCheckpointPollable()) {
      await pollOrbsBridgeCheckpointRecord(deps, record);
    }
  } finally {
    checkpointPollingRunning = false;
  }
}

async function pollOrbsBridgeCheckpointRecord(
  deps: OrbsBridgePluginRouteDeps,
  record: ReturnType<OrbsBridgeStore["get"]> extends infer R ? NonNullable<R> : never,
): Promise<void> {
  if (!record.sourceTxHash || !record.sourceBlockNumber || !record.conversationId) {
    return;
  }
  try {
    const checkpoint = await fetchCheckpointStatus(record.sourceBlockNumber);
    if (checkpoint?.message !== "success") {
      return;
    }
    const exitPayload = await fetchExitPayload(record.sourceTxHash);
    const updated = deps.orbsBridgeStore.update(record.id, {
      exitPayload,
      state: "checkpoint-ready",
      error: null,
    });
    if (updated?.conversationId) {
      publishOrbsBridgeCheckpointReadyMessage(deps, updated);
    }
  } catch (error) {
    deps.orbsBridgeStore.update(record.id, { error: error instanceof Error ? error.message : String(error) });
  }
}

async function fetchCheckpointStatus(blockNumber: string): Promise<{ message?: string }> {
  const response = await fetch(`${CHECKPOINT_STATUS_URL}/${encodeURIComponent(blockNumber)}`, { signal: AbortSignal.timeout(15_000) });
  const body = await response.json().catch(async () => ({ text: await response.text().catch(() => "") }));
  if (!response.ok) {
    throw new Error(`Checkpoint HTTP ${response.status}: ${JSON.stringify(body)}`);
  }
  return body as { message?: string };
}

async function fetchExitPayload(txHash: string): Promise<string> {
  const url = `${EXIT_PAYLOAD_URL}/${encodeURIComponent(txHash)}?eventSignature=${WITHDRAW_TRANSFER_EVENT_SIGNATURE}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const body = await response.json().catch(async () => ({ text: await response.text().catch(() => "") }));
  if (!response.ok) {
    throw new Error(`Exit payload HTTP ${response.status}: ${JSON.stringify(body)}`);
  }
  const payload = typeof (body as { result?: unknown }).result === "string" && String((body as { result: string }).result).startsWith("0x")
    ? (body as { result: string }).result
    : typeof (body as { message?: unknown }).message === "string" && String((body as { message: string }).message).startsWith("0x")
      ? (body as { message: string }).message
      : "";
  if (!payload) {
    throw new Error("Exit payload response did not include a 0x payload.");
  }
  return payload;
}

function publishOrbsBridgeCheckpointReadyMessage(
  deps: OrbsBridgePluginRouteDeps,
  record: ReturnType<OrbsBridgeStore["get"]> extends infer R ? NonNullable<R> : never,
): void {
  if (!record.conversationId) {
    return;
  }
  const conversation = deps.conversationStore.getConversation(record.conversationId);
  if (!conversation) {
    deps.orbsBridgeStore.update(record.id, { error: "Target PWA conversation was deleted before checkpoint delivery." });
    return;
  }
  const text = [
    "ORBS Polygon → Ethereum 브릿지 체크포인트 준비 완료",
    "",
    `- 브릿지 기록 ID: ${record.id}`,
    `- Withdraw tx: ${record.sourceTxHash ?? "-"}`,
    `- Polygon block: ${record.sourceBlockNumber ?? "-"}`,
    `- Amount: ${formatOrbsAmount(record.amount)} ORBS`,
    "- 다음 단계: 이 채팅방의 브릿지 카드에서 `Ethereum exit 실행`을 눌러 최종 수령 트랜잭션을 서명하세요.",
    "",
    "이 알림은 PWA 채팅방 내부에만 기록했습니다.",
  ].join("\n");
  const saved = deps.conversationStore.addMessage({ conversationId: record.conversationId, role: "system", text, createdAt: new Date().toISOString() });
  deps.publishConversationEvent?.({ id: saved.id, type: "message", messageId: saved.id, conversationId: record.conversationId, createdAt: saved.createdAt });
}

function formatOrbsAmount(value: string): string {
  try {
    const raw = BigInt(value);
    const scale = 10n ** 18n;
    const whole = raw / scale;
    const fraction = raw % scale;
    if (fraction === 0n) return whole.toString();
    const trimmed = fraction.toString().padStart(18, "0").replace(/0+$/, "").slice(0, 8).replace(/0+$/, "");
    return trimmed ? `${whole}.${trimmed}` : whole.toString();
  } catch {
    return value;
  }
}

function publicRecord(record: ReturnType<OrbsBridgeStore["get"]> extends infer R ? NonNullable<R> : never) {
  return {
    id: record.id,
    conversation_id: record.conversationId ?? null,
    account: record.account,
    direction: record.direction,
    amount: record.amount,
    source_chain_id: record.sourceChainId,
    source_tx_hash: record.sourceTxHash ?? null,
    source_block_number: record.sourceBlockNumber ?? null,
    exit_payload: record.exitPayload ?? null,
    exit_tx_hash: record.exitTxHash ?? null,
    state: record.state,
    error: record.error ?? null,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readNullableString(value: unknown): string | null {
  if (value === null) return null;
  const text = readString(value);
  return text || null;
}

function readHexString(value: unknown): string | undefined {
  const text = readString(value);
  return /^0x[0-9a-fA-F]+$/.test(text) ? text : undefined;
}

function readDecimalString(value: unknown): string | undefined {
  const text = readString(value);
  return /^(?:0|[1-9]\d*)$/.test(text) ? text : undefined;
}

function readAmount(value: unknown): string {
  const text = readString(value);
  return /^(?:0|[1-9]\d*)$/.test(text) ? text : "";
}

function readPositiveInteger(value: unknown): number {
  const number = typeof value === "number" ? value : Number(readString(value));
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function normalizeAddress(value: string): string {
  const address = value.trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(address) ? address : "";
}

function normalizeDirection(value: string): OrbsBridgeDirection | "" {
  if (value === "ethereum-to-polygon" || value === "polygon-to-ethereum") {
    return value;
  }
  return "";
}

function normalizeState(value: string): OrbsBridgeState | "" {
  if (["source-submitted", "source-confirmed", "checkpoint-ready", "exit-submitted", "completed", "failed"].includes(value)) {
    return value as OrbsBridgeState;
  }
  return "";
}
