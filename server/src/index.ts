import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import {
  API_CONTRACT_V1,
  extractBearerToken,
  type ErrorResponseDto,
  type MessageRequestDto,
} from "./contracts/apiContractV1.js";
import { handlePostMessage } from "./http/messageHandler.js";
import { createOpenClawClient } from "./openclaw/createOpenClawClient.js";
import { FileHistoryStore } from "./session/HistoryStore.js";
import { InMemorySessionStore } from "./session/SessionStore.js";

const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 29999);
const validApiKeys = new Set(
  (process.env.BRIDGE_API_KEYS ?? "dev-api-key")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean),
);

const openClawClient = createOpenClawClient();
const sessionStore = new InMemorySessionStore();
const historyStore = new FileHistoryStore(
  resolve(process.env.HISTORY_DIR ?? join(process.cwd(), "state", "history")),
);
const publicDir = resolve(process.env.PUBLIC_DIR ?? join(process.cwd(), "public"));

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
  "access-control-allow-headers": "authorization,content-type,x-device-id,x-user-id",
};

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    ...corsHeaders,
  });
  response.end(JSON.stringify(body));
}

function contentTypeFor(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
    case ".webmanifest":
      return "application/manifest+json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    default:
      return "application/octet-stream";
  }
}

async function tryServeStatic(urlPathname: string, response: ServerResponse): Promise<boolean> {
  const pathname = decodeURIComponent(urlPathname);
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const normalizedPath = normalize(relativePath);
  if (normalizedPath.startsWith("..") || normalizedPath.includes("/../")) {
    return false;
  }

  let filePath = resolve(publicDir, normalizedPath);
  if (!filePath.startsWith(`${publicDir}/`) && filePath !== publicDir) {
    return false;
  }

  try {
    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) {
      filePath = resolve(filePath, "index.html");
    } else if (!fileStat.isFile()) {
      return false;
    }
  } catch {
    return false;
  }

  response.writeHead(200, {
    "content-type": contentTypeFor(filePath),
    "cache-control": filePath.endsWith("index.html") ? "no-cache" : "public, max-age=3600",
  });
  createReadStream(filePath).pipe(response);
  return true;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");
  return rawBody ? JSON.parse(rawBody) : {};
}

function invalidJsonResponse(): ErrorResponseDto {
  return {
    error: {
      code: "VALIDATION_MESSAGE_REQUIRED",
      message: "Request body must be valid JSON.",
    },
    request_id: "req_unavailable",
  };
}

function getSingleHeader(headers: IncomingMessage["headers"], name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function sessionIdFromHeaders(request: IncomingMessage): string {
  return sessionStore.getSessionId({
    deviceId: getSingleHeader(request.headers, "x-device-id"),
    userId: getSingleHeader(request.headers, "x-user-id"),
  });
}

function shouldPersistMessage(message: string): boolean {
  return message.trim() !== "연결 테스트입니다. OK만 답해주세요.";
}

function isAuthorized(request: IncomingMessage): boolean {
  const tokenOrError = extractBearerToken(getSingleHeader(request.headers, "authorization"));
  return typeof tokenOrError === "string" && validApiKeys.has(tokenOrError);
}

function normalizeHistoryMessages(payload: unknown) {
  const rawMessages =
    typeof payload === "object" && payload !== null && Array.isArray((payload as { messages?: unknown }).messages)
      ? (payload as { messages: unknown[] }).messages
      : [];

  return rawMessages
    .filter((item): item is { role: string; text: string; savedAt?: string } => {
      if (typeof item !== "object" || item === null) {
        return false;
      }
      const candidate = item as Record<string, unknown>;
      return (
        ["user", "assistant", "system"].includes(String(candidate.role)) &&
        typeof candidate.text === "string" &&
        candidate.text.trim().length > 0
      );
    })
    .map((item) => ({
      role: item.role as "user" | "assistant" | "system",
      text: item.text,
      savedAt: typeof item.savedAt === "string" ? item.savedAt : new Date().toISOString(),
    }));
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (request.method === "OPTIONS") {
    response.writeHead(204, corsHeaders);
    response.end();
    return;
  }

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, {
      status: "ok",
      transport: process.env.OPENCLAW_TRANSPORT ?? "cli",
    });
    return;
  }

  if (url.pathname === "/v1/history" && ["GET", "POST", "DELETE"].includes(request.method ?? "")) {
    if (!isAuthorized(request)) {
      sendJson(response, 401, {
        error: {
          code: "AUTH_INVALID_TOKEN",
          message: "API key is invalid.",
        },
        request_id: "req_unavailable",
      } satisfies ErrorResponseDto);
      return;
    }

    if (request.method === "GET") {
      sendJson(response, 200, {
        messages: await historyStore.list(sessionIdFromHeaders(request)),
      });
      return;
    }

    if (request.method === "POST") {
      const payload = await readJsonBody(request);
      const messages = normalizeHistoryMessages(payload);
      if (messages.length > 0) {
        await historyStore.append(sessionIdFromHeaders(request), messages);
      }
      sendJson(response, 200, { ok: true, imported: messages.length });
      return;
    }

    await historyStore.clear(sessionIdFromHeaders(request));
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "GET" || request.method === "HEAD") {
    const served = await tryServeStatic(url.pathname, response);
    if (served) {
      return;
    }
  }

  if (request.method !== "POST" || url.pathname !== API_CONTRACT_V1.endpoint) {
    sendJson(response, 404, {
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Route not found.",
      },
      request_id: "req_unavailable",
    } satisfies ErrorResponseDto);
    return;
  }

  try {
    const payload = (await readJsonBody(request)) as MessageRequestDto;
    const result = await handlePostMessage(
      {
        openClawClient,
        sessionStore,
        validApiKeys,
      },
      request.headers,
      payload,
    );

    if (result.statusCode >= 200 && result.statusCode < 300 && "reply" in result.body && shouldPersistMessage(payload.message)) {
      await historyStore.append(sessionIdFromHeaders(request), [
        { role: "user", text: payload.message, savedAt: new Date().toISOString() },
        { role: "assistant", text: result.body.reply, savedAt: new Date().toISOString() },
      ]);
    }

    sendJson(response, result.statusCode, result.body);
  } catch (error) {
    if (error instanceof SyntaxError) {
      sendJson(response, 400, invalidJsonResponse());
      return;
    }

    sendJson(response, 500, {
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Unexpected server error.",
        details: {
          reason: error instanceof Error ? error.message : String(error),
        },
      },
      request_id: "req_unavailable",
    } satisfies ErrorResponseDto);
  }
});

server.listen(port, host, () => {
  console.log(`Bridge server listening on http://${host}:${port}`);
});
