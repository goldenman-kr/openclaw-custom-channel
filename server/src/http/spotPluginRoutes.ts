import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthContext } from "./authRoutes.js";
import type { ConversationRecord, ConversationStore, MessageStore } from "../session/SqliteChatStore.js";
import type { SpotOrderStore } from "../session/SpotOrderStore.js";

const RELAY_URL = "https://agents-sink.orbs.network/orders/new";

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
