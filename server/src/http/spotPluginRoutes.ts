import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthContext } from "./authRoutes.js";
import type { ConversationRecord, ConversationStore, MessageStore } from "../session/SqliteChatStore.js";
import type { SpotOrderStore } from "../session/SpotOrderStore.js";

const RELAY_URL = "https://agents-sink.orbs.network/orders/new";
const RELAY_QUERY_URL = "https://agents-sink.orbs.network/orders";
const RELAY_TERMINAL_STATUSES = new Set(["filled", "completed", "partially_completed", "cancelled", "expired", "failed", "rejected"]);
const activeRelayPolls = new Set<string>();

export interface SpotPluginRouteDeps {
  conversationStore: ConversationStore & MessageStore;
  spotOrderStore: SpotOrderStore;
  getAuthContext(request: IncomingMessage): AuthContext | null;
  isConversationVisibleToAuth(conversation: ConversationRecord, auth: AuthContext): boolean;
  sendJson(response: ServerResponse, statusCode: number, body: unknown): void;
  readJsonBody(request: IncomingMessage): Promise<unknown>;
  publishConversationEvent?(event: { id: string; type: "message"; messageId: string; conversationId: string; createdAt: string }): void;
}

interface SubmitSignatureBody {
  conversation_id?: unknown;
  typedData?: unknown;
  signature?: unknown;
  signer?: unknown;
}

export async function handleSpotPluginRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  deps: SpotPluginRouteDeps,
): Promise<boolean> {
  if (request.method !== "POST" || url.pathname !== "/v1/plugins/spot/orders/submit-signed") {
    return false;
  }

  const auth = deps.getAuthContext(request);
  if (!auth) {
    deps.sendJson(response, 401, { error: { code: "AUTH_INVALID_TOKEN", message: "로그인이 필요합니다." } });
    return true;
  }

  const body = (await deps.readJsonBody(request).catch(() => ({}))) as SubmitSignatureBody;
  const conversationId = typeof body.conversation_id === "string" ? body.conversation_id.trim() : "";
  const conversation = conversationId ? deps.conversationStore.getConversation(conversationId) : null;
  if (!conversation || !deps.isConversationVisibleToAuth(conversation, auth)) {
    deps.sendJson(response, 404, { error: { code: "CONVERSATION_NOT_FOUND", message: "대화를 찾지 못했습니다." } });
    return true;
  }

  const typedData = body.typedData;
  const signature = typeof body.signature === "string" ? body.signature.trim() : "";
  const signer = normalizeAddress(typeof body.signer === "string" ? body.signer : "");
  const swapper = normalizeAddress(readPath(typedData, ["message", "witness", "swapper"]) ?? readPath(typedData, ["message", "swapper"]));
  const chainId = String(readPath(typedData, ["domain", "chainId"]) ?? "");

  if (!typedData || typeof typedData !== "object" || !signature || !signer || !swapper || !chainId) {
    deps.sendJson(response, 400, { error: { code: "VALIDATION_SPOT_ORDER_INVALID", message: "서명 제출 payload가 올바르지 않습니다." } });
    return true;
  }

  if (signer !== swapper) {
    const message = `서명 지갑(${signer})과 주문 swapper(${swapper})가 일치하지 않아 중단했습니다.`;
    const saved = deps.conversationStore.addMessage({ conversationId, role: "system", text: message, createdAt: new Date().toISOString() });
    deps.publishConversationEvent?.({ id: saved.id, type: "message", messageId: saved.id, conversationId, createdAt: saved.createdAt });
    deps.sendJson(response, 400, { error: { code: "VALIDATION_SPOT_SIGNER_MISMATCH", message } });
    return true;
  }

  const relayPayload = {
    order: (typedData as { message?: unknown }).message,
    signature,
    status: "pending",
  };

  const record = deps.spotOrderStore.create({
    conversationId,
    signer,
    swapper,
    chainId,
    typedData,
    signature,
    relayPayload,
    state: "signed",
  });

  try {
    const relayResponse = await fetch(RELAY_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(relayPayload),
      signal: AbortSignal.timeout(15_000),
    });
    const relayBody = await relayResponse.json().catch(async () => ({ text: await relayResponse.text().catch(() => "") }));
    if (!relayResponse.ok) {
      throw new Error(`Relay HTTP ${relayResponse.status}: ${JSON.stringify(relayBody)}`);
    }
    const relayOrderHash = extractRelayOrderHash(relayBody);
    deps.spotOrderStore.update(record.id, { state: "submitted", relayOrderHash, error: null });
    const text = [
      "Spot 주문 서명 및 제출 완료",
      "",
      `- 내부 기록 ID: ${record.id}`,
      ...(relayOrderHash ? [`- Relay orderHash: ${relayOrderHash}`] : []),
      `- Chain ID: ${chainId}`,
      `- Swapper: ${swapper}`,
    ].join("\n");
    const saved = deps.conversationStore.addMessage({ conversationId, role: "system", text, createdAt: new Date().toISOString() });
    deps.publishConversationEvent?.({ id: saved.id, type: "message", messageId: saved.id, conversationId, createdAt: saved.createdAt });
    if (relayOrderHash) {
      startSpotOrderPolling({ deps, spotOrderId: record.id, conversationId, relayOrderHash });
    }
    deps.sendJson(response, 200, { ok: true, spot_order_id: record.id, relay_order_hash: relayOrderHash || null });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.spotOrderStore.update(record.id, { state: "failed", error: message });
    const text = [
      "Spot 주문 제출 실패",
      "",
      `- 내부 기록 ID: ${record.id}`,
      `- 사유: ${message}`,
      "- 서명값과 typedData는 재시도를 위해 서버 DB에 보관했습니다.",
    ].join("\n");
    const saved = deps.conversationStore.addMessage({ conversationId, role: "system", text, createdAt: new Date().toISOString() });
    deps.publishConversationEvent?.({ id: saved.id, type: "message", messageId: saved.id, conversationId, createdAt: saved.createdAt });
    deps.sendJson(response, 502, { error: { code: "UPSTREAM_SPOT_RELAY_FAILED", message }, spot_order_id: record.id });
  }

  return true;
}

export function resumeSpotOrderPolling(deps: SpotPluginRouteDeps): void {
  for (const order of deps.spotOrderStore.listPollable()) {
    if (order.relayOrderHash) {
      startSpotOrderPolling({ deps, spotOrderId: order.id, conversationId: order.conversationId, relayOrderHash: order.relayOrderHash });
    }
  }
}

export function startSpotOrderPolling(input: { deps: SpotPluginRouteDeps; spotOrderId: string; conversationId: string; relayOrderHash: string }): void {
  if (activeRelayPolls.has(input.spotOrderId)) {
    return;
  }
  activeRelayPolls.add(input.spotOrderId);
  void pollRelayResult(input).finally(() => activeRelayPolls.delete(input.spotOrderId));
}

async function pollRelayResult(input: { deps: SpotPluginRouteDeps; spotOrderId: string; conversationId: string; relayOrderHash: string }): Promise<void> {
  const { deps, spotOrderId, conversationId, relayOrderHash } = input;
  const startedAt = Date.now();
  const maxMs = computePollingMaxMs(deps, spotOrderId);
  let lastBody: unknown = null;
  let lastStatus = "pending";

  while (Date.now() - startedAt < maxMs) {
    try {
      const body = await queryRelayOrder(relayOrderHash);
      lastBody = body;
      lastStatus = extractRelayStatus(body);
      deps.spotOrderStore.updateRelayResult(spotOrderId, { relayStatus: lastStatus, relayResult: body, error: null });
      if (RELAY_TERMINAL_STATUSES.has(lastStatus)) {
        publishRelayResultMessage(deps, conversationId, spotOrderId, relayOrderHash, lastStatus, body);
        return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      deps.spotOrderStore.updateRelayResult(spotOrderId, { relayStatus: lastStatus, relayResult: lastBody, error: message });
    }
    await delay(computePollingIntervalMs(Date.now() - startedAt));
  }

  publishRelayResultMessage(deps, conversationId, spotOrderId, relayOrderHash, lastStatus, lastBody, "폴링 제한 시간 내 최종 상태에 도달하지 않았습니다.");
}

function computePollingMaxMs(deps: SpotPluginRouteDeps, spotOrderId: string): number {
  const fallbackMs = 14 * 24 * 60 * 60_000;
  const record = deps.spotOrderStore.get(spotOrderId);
  if (!record) {
    return fallbackMs;
  }
  try {
    const typedData = JSON.parse(record.typedDataJson) as Record<string, unknown>;
    const deadline = Number(readPath(typedData, ["message", "witness", "deadline"]) ?? readPath(typedData, ["message", "deadline"]));
    if (Number.isFinite(deadline) && deadline > 0) {
      const untilDeadlineMs = deadline * 1000 - Date.now();
      return Math.max(60_000, untilDeadlineMs + 60 * 60_000);
    }
  } catch {
    // Keep fallback for older/malformed records.
  }
  return fallbackMs;
}

function computePollingIntervalMs(elapsedMs: number): number {
  if (elapsedMs < 60_000) {
    return 5_000;
  }
  if (elapsedMs < 10 * 60_000) {
    return 15_000;
  }
  return 60_000;
}

async function queryRelayOrder(relayOrderHash: string): Promise<unknown> {
  const url = `${RELAY_QUERY_URL}?hash=${encodeURIComponent(relayOrderHash)}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const body = await response.json().catch(async () => ({ text: await response.text().catch(() => "") }));
  if (!response.ok) {
    throw new Error(`Relay query HTTP ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

function publishRelayResultMessage(
  deps: SpotPluginRouteDeps,
  conversationId: string,
  spotOrderId: string,
  relayOrderHash: string,
  status: string,
  body: unknown,
  note?: string,
): void {
  const firstOrder = readFirstOrder(body);
  const metadata = firstOrder && typeof firstOrder === "object" ? (firstOrder as Record<string, unknown>).metadata : undefined;
  const summary = metadata && typeof metadata === "object" ? metadata as Record<string, unknown> : {};
  const text = [
    "Spot 주문 서버 처리 결과",
    "",
    `- 내부 기록 ID: ${spotOrderId}`,
    `- Relay orderHash: ${relayOrderHash}`,
    `- Status: ${status}`,
    ...(typeof summary.displayOnlyStatus === "string" ? [`- Display status: ${formatSpotDisplayStatus(summary.displayOnlyStatus)}`] : []),
    ...(typeof summary.displayOnlyStatusDescription === "string" ? [`- Description: ${summary.displayOnlyStatusDescription}`] : []),
    ...(typeof summary.orderType === "string" ? [`- Order type: ${summary.orderType}`] : []),
    ...(typeof summary.displayOnlyOrderTotalUSD === "string" ? [`- Order total USD: ${summary.displayOnlyOrderTotalUSD}`] : []),
    ...(note ? [`- Note: ${note}`] : []),
    "",
    "폴링 원문 결과는 서버 DB spot_orders.relay_result_json 에 저장했습니다.",
  ].join("\n");
  const conversation = deps.conversationStore.getConversation(conversationId);
  if (!conversation) {
    deps.spotOrderStore.updateRelayResult(spotOrderId, { relayStatus: status, relayResult: body, error: "Target conversation was deleted before result delivery." });
    return;
  }
  const saved = deps.conversationStore.addMessage({ conversationId, role: "system", text, createdAt: new Date().toISOString() });
  deps.publishConversationEvent?.({ id: saved.id, type: "message", messageId: saved.id, conversationId, createdAt: saved.createdAt });
}

function extractRelayStatus(body: unknown): string {
  const order = readFirstOrder(body);
  const metadataStatus = readPath(order, ["metadata", "status"]);
  const orderStatus = readPath(order, ["status"]);
  return String(metadataStatus ?? orderStatus ?? "pending");
}

export function formatSpotDisplayStatus(status: string): string {
  const trimmed = status.trim();
  if (!trimmed) {
    return status;
  }
  if (/^(✅|⚠️|⏰|⏳|🟢|🟡|🚫|❔)\s*/u.test(trimmed)) {
    return trimmed;
  }

  const normalized = trimmed.toUpperCase().replace(/[\s-]+/g, "_");
  const emoji = getSpotStatusEmoji(normalized);
  return `${emoji} ${trimmed}`;
}

function getSpotStatusEmoji(normalizedStatus: string): string {
  if (/(PARTIAL|PARTIALLY_FILLED|PARTIALLY_COMPLETED)/.test(normalizedStatus)) {
    return "🟡";
  }
  if (/(SUCCEEDED|SUCCESS|FILLED|EXECUTED|COMPLETED)/.test(normalizedStatus)) {
    return "✅";
  }
  if (/(FAILED|REJECTED|ERROR)/.test(normalizedStatus)) {
    return "⚠️";
  }
  if (/EXPIRED/.test(normalizedStatus)) {
    return "⏰";
  }
  if (/(PENDING|QUEUED|WAITING)/.test(normalizedStatus)) {
    return "⏳";
  }
  if (/(SUBMITTED|RELAYED|OPEN|ACTIVE)/.test(normalizedStatus)) {
    return "🟢";
  }
  if (/(CANCELLED|CANCELED)/.test(normalizedStatus)) {
    return "🚫";
  }
  return "❔";
}

function readFirstOrder(body: unknown): unknown {
  if (!body || typeof body !== "object") {
    return undefined;
  }
  const orders = (body as { orders?: unknown }).orders;
  return Array.isArray(orders) ? orders[0] : undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readPath(value: unknown, path: string[]): string | number | undefined {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || !(key in current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" || typeof current === "number" ? current : undefined;
}

function normalizeAddress(value: unknown): string {
  const address = String(value || "").trim().toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(address) ? address : "";
}

function extractRelayOrderHash(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }
  const body = value as { orderHash?: unknown; signedOrder?: { hash?: unknown } };
  return typeof body.orderHash === "string" ? body.orderHash : typeof body.signedOrder?.hash === "string" ? body.signedOrder.hash : "";
}
