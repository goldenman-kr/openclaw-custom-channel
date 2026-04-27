import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { API_CONTRACT_V1, type ErrorResponseDto, type MessageRequestDto } from "./contracts/apiContractV1.js";
import { handlePostMessage } from "./http/messageHandler.js";
import { createOpenClawClient } from "./openclaw/createOpenClawClient.js";
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

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "authorization,content-type,x-device-id,x-user-id",
};

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    ...corsHeaders,
  });
  response.end(JSON.stringify(body));
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
