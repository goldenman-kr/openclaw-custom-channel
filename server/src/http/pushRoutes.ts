import type { IncomingMessage, ServerResponse } from "node:http";
import type { ErrorResponseDto } from "../contracts/apiContractV1.js";
import type { AuthContext } from "./authRoutes.js";
import type { PushSubscriptionStore } from "../session/PushSubscriptionStore.js";

export interface PushRouteDeps {
  pushSubscriptionStore: PushSubscriptionStore;
  vapidPublicKey?: string;
  isAuthorized(request: IncomingMessage): boolean;
  getAuthContext(request: IncomingMessage): AuthContext | null;
  sendJson(response: ServerResponse, statusCode: number, body: unknown, extraHeaders?: Record<string, string>): void;
  makeErrorResponse(code: ErrorResponseDto["error"]["code"], message: string, details?: Record<string, unknown>): ErrorResponseDto;
  readJsonBody(request: IncomingMessage): Promise<unknown>;
}

export async function handlePushRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  deps: PushRouteDeps,
): Promise<boolean> {
  if (!url.pathname.startsWith("/v1/push/")) {
    return false;
  }

  if (request.method === "GET" && url.pathname === "/v1/push/vapid-public-key") {
    const publicKey = deps.vapidPublicKey?.trim() ?? "";
    deps.sendJson(response, publicKey ? 200 : 503, publicKey
      ? { public_key: publicKey }
      : deps.makeErrorResponse("INTERNAL_SERVER_ERROR", "Web Push VAPID key is not configured."));
    return true;
  }

  if (!deps.isAuthorized(request)) {
    deps.sendJson(response, 401, deps.makeErrorResponse("AUTH_INVALID_TOKEN", "Login is required."));
    return true;
  }
  const auth = deps.getAuthContext(request);
  if (!auth) {
    deps.sendJson(response, 401, deps.makeErrorResponse("AUTH_INVALID_TOKEN", "Login is required."));
    return true;
  }

  if (request.method === "POST" && url.pathname === "/v1/push/subscriptions") {
    const body = await deps.readJsonBody(request).catch(() => ({}));
    const parsed = parseSubscriptionBody(body);
    if (!parsed) {
      deps.sendJson(response, 400, deps.makeErrorResponse("VALIDATION_MESSAGE_REQUIRED", "Valid push subscription is required."));
      return true;
    }
    const deviceId = singleHeader(request.headers, "x-device-id") || parsed.deviceId || "unknown-device";
    const record = deps.pushSubscriptionStore.upsert({
      ownerId: auth.user.id,
      deviceId,
      endpoint: parsed.endpoint,
      p256dh: parsed.p256dh,
      auth: parsed.auth,
      userAgent: singleHeader(request.headers, "user-agent"),
    });
    deps.sendJson(response, 200, {
      ok: true,
      subscription: {
        id: record.id,
        endpoint: record.endpoint,
        device_id: record.deviceId,
        updated_at: record.updatedAt,
      },
    });
    return true;
  }

  if (request.method === "DELETE" && url.pathname === "/v1/push/subscriptions") {
    const body = await deps.readJsonBody(request).catch(() => ({}));
    const endpoint = typeof (body as { endpoint?: unknown })?.endpoint === "string" ? (body as { endpoint: string }).endpoint.trim() : "";
    if (!endpoint) {
      deps.sendJson(response, 400, deps.makeErrorResponse("VALIDATION_MESSAGE_REQUIRED", "Subscription endpoint is required."));
      return true;
    }
    deps.pushSubscriptionStore.disableByEndpoint(auth.user.id, endpoint);
    deps.sendJson(response, 200, { ok: true });
    return true;
  }

  deps.sendJson(response, 404, deps.makeErrorResponse("INTERNAL_SERVER_ERROR", "Push route not found."));
  return true;
}

function parseSubscriptionBody(body: unknown): { endpoint: string; p256dh: string; auth: string; deviceId?: string } | null {
  const candidate = body as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown }; device_id?: unknown; deviceId?: unknown };
  const endpoint = typeof candidate?.endpoint === "string" ? candidate.endpoint.trim() : "";
  const p256dh = typeof candidate?.keys?.p256dh === "string" ? candidate.keys.p256dh.trim() : "";
  const auth = typeof candidate?.keys?.auth === "string" ? candidate.keys.auth.trim() : "";
  const deviceId = typeof candidate?.device_id === "string"
    ? candidate.device_id.trim()
    : typeof candidate?.deviceId === "string"
      ? candidate.deviceId.trim()
      : "";
  if (!endpoint || !p256dh || !auth) {
    return null;
  }
  return { endpoint, p256dh, auth, ...(deviceId ? { deviceId } : {}) };
}

function singleHeader(headers: IncomingMessage["headers"], name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}
