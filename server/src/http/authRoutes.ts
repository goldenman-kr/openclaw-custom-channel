import type { IncomingMessage, ServerResponse } from "node:http";
import type { ErrorResponseDto } from "../contracts/apiContractV1.js";
import { publicUser, type AuthStore, type PublicUserRecord, type UserRecord } from "../session/AuthStore.js";

export const AUTH_COOKIE_NAME = "oc_session";

export interface AuthContext {
  user: PublicUserRecord;
  source: "cookie" | "api_key";
}

export interface AuthRouteDeps {
  authStore: AuthStore;
  sendJson(response: ServerResponse, statusCode: number, body: unknown, extraHeaders?: Record<string, string>): void;
  makeErrorResponse(code: ErrorResponseDto["error"]["code"], message: string, details?: Record<string, unknown>): ErrorResponseDto;
  readJsonBody(request: IncomingMessage): Promise<unknown>;
  cookieSecure: boolean;
  sessionTtlMs: number;
  getSessionToken(request: IncomingMessage): string | null;
  getAuthContext(request: IncomingMessage): AuthContext | null;
}

export async function handleAuthRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  deps: AuthRouteDeps,
): Promise<boolean> {
  if (!url.pathname.startsWith("/v1/auth/")) {
    return false;
  }

  if (request.method === "POST" && url.pathname === "/v1/auth/login") {
    const payload = await deps.readJsonBody(request);
    const username = typeof (payload as { username?: unknown })?.username === "string"
      ? (payload as { username: string }).username
      : typeof (payload as { id?: unknown })?.id === "string"
        ? (payload as { id: string }).id
        : "";
    const password = typeof (payload as { password?: unknown })?.password === "string" ? (payload as { password: string }).password : "";
    const user = username && password ? deps.authStore.verifyPassword(username, password) : null;
    if (!user) {
      deps.sendJson(response, 401, deps.makeErrorResponse("AUTH_INVALID_TOKEN", "Username or password is invalid."));
      return true;
    }
    const { token } = deps.authStore.createSession(user.id, { ttlMs: deps.sessionTtlMs });
    deps.sendJson(response, 200, { user: userToDto(user) }, { "set-cookie": makeSessionCookie(token, deps.cookieSecure, deps.sessionTtlMs) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/v1/auth/logout") {
    const token = deps.getSessionToken(request);
    if (token) {
      deps.authStore.revokeSessionByToken(token);
    }
    deps.sendJson(response, 200, { ok: true }, { "set-cookie": expireSessionCookie(deps.cookieSecure) });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/v1/auth/me") {
    const auth = deps.getAuthContext(request);
    if (!auth) {
      deps.sendJson(response, 401, deps.makeErrorResponse("AUTH_INVALID_TOKEN", "Login is required."));
      return true;
    }
    deps.sendJson(response, 200, { user: auth.user, auth_source: auth.source });
    return true;
  }

  deps.sendJson(response, 404, deps.makeErrorResponse("INTERNAL_SERVER_ERROR", "Auth route not found."));
  return true;
}

export function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (!rawName || rawValue.length === 0) {
      continue;
    }
    cookies.set(rawName, decodeURIComponent(rawValue.join("=")));
  }
  return cookies;
}

function userToDto(user: UserRecord): PublicUserRecord {
  return publicUser(user);
}

function makeSessionCookie(token: string, secure: boolean, ttlMs: number): string {
  const maxAge = Math.floor(ttlMs / 1000);
  return `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

function expireSessionCookie(secure: boolean): string {
  return `${AUTH_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}
