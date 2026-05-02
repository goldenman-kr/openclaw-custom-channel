import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { GatewayOpenAiOpenClawClient } from "./GatewayOpenAiOpenClawClient.js";

async function withServer(handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>) {
  const server = createServer((req, res) => {
    void handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.equal(typeof address, "object");
  assert.ok(address);
  const addressInfo = address as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${addressInfo.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

test("streams OpenAI-compatible Gateway chunks as runtime tokens", async () => {
  const requests: Array<{ url?: string; headers: IncomingMessage["headers"]; body: Record<string, unknown> }> = [];
  const server = await withServer(async (req, res) => {
    requests.push({ url: req.url, headers: req.headers, body: await readJson(req) });
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
    });
    res.write('data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n');
    res.write('data: {"choices":[{"delta":{"content":"hello"}}]}\n\n');
    res.write('data: {"choices":[{"delta":{"content":" world"}}]}\n\n');
    res.end("data: [DONE]\n\n");
  });

  try {
    const tokens: string[] = [];
    const client = new GatewayOpenAiOpenClawClient(server.baseUrl, "gateway-token", "openclaw-test", 5_000);
    const result = await client.sendMessage({
      sessionId: "session-stream-test",
      message: "hello",
      callbacks: {
        async onToken(token) {
          tokens.push(token);
        },
      },
    });

    assert.equal(result.reply, "hello world");
    assert.deepEqual(tokens, ["hello", " world"]);
    assert.equal(requests[0]?.url, "/v1/chat/completions");
    assert.equal(requests[0]?.headers.authorization, "Bearer gateway-token");
    assert.equal(requests[0]?.headers["x-openclaw-session-key"], "session-stream-test");
    assert.equal(requests[0]?.body.model, "openclaw-test");
    assert.equal(requests[0]?.body.stream, true);
  } finally {
    await server.close();
  }
});


test("extracts OpenClaw payload text from Gateway SSE chunks", async () => {
  const server = await withServer(async (_req, res) => {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
    });
    res.write('data: {"payloads":[{"text":"payload answer"}]}\n\n');
    res.end("data: [DONE]\n\n");
  });

  try {
    const tokens: string[] = [];
    const client = new GatewayOpenAiOpenClawClient(server.baseUrl, undefined, "openclaw-test", 5_000);
    const result = await client.sendMessage({
      sessionId: "session-payload-test",
      message: "hello",
      callbacks: {
        async onToken(token) {
          tokens.push(token);
        },
      },
    });

    assert.equal(result.reply, "payload answer");
    assert.deepEqual(tokens, ["payload answer"]);
  } finally {
    await server.close();
  }
});

test("falls back to non-stream response when Gateway SSE has no visible text", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const server = await withServer(async (req, res) => {
    const body = await readJson(req);
    requests.push(body);
    if (body.stream === true) {
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
      res.end('data: {"choices":[{"delta":{"role":"assistant"}}]}\n\ndata: [DONE]\n\n');
      return;
    }

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: "non-stream answer" } }] }));
  });

  try {
    const client = new GatewayOpenAiOpenClawClient(server.baseUrl, undefined, "openclaw-test", 5_000);
    const result = await client.sendMessage({ sessionId: "session-nonstream-test", message: "hello" });

    assert.equal(result.reply, "non-stream answer");
    assert.equal(requests.length, 2);
    assert.equal(requests[0]?.stream, true);
    assert.equal(requests[1]?.stream, false);
    assert.equal((result.raw as { usedNonStreamFallback?: boolean }).usedNonStreamFallback, true);
  } finally {
    await server.close();
  }
});

test("passes runtime workspace metadata to Gateway requests", async () => {
  const requests: Array<{ headers: IncomingMessage["headers"]; body: Record<string, unknown> }> = [];
  const server = await withServer(async (req, res) => {
    requests.push({ headers: req.headers, body: await readJson(req) });
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
    res.end('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
  });

  try {
    const client = new GatewayOpenAiOpenClawClient(server.baseUrl, undefined, "openclaw-test", 5_000);
    await client.sendMessage({
      sessionId: "session-workspace-test",
      message: "hello",
      runtimeWorkspace: {
        userId: "usr_alice",
        username: "alice",
        displayName: "Alice",
        workspaceRoot: "/tmp/workspaces",
        userDir: "/tmp/workspaces/alice",
        commonDir: "/tmp/workspaces/common",
        commonWritable: false,
        identityFile: "/tmp/workspaces/alice/WEBCHAT_USER.md",
      },
    });

    assert.equal(requests[0]?.headers["x-openclaw-runtime-user-dir"], "/tmp/workspaces/alice");
    assert.equal(requests[0]?.headers["x-openclaw-runtime-username"], "alice");
    const messages = requests[0]?.body.messages as Array<{ content: string }>;
    assert.match(messages[0]?.content, /current_webchat_username=alice/);
    assert.match(messages[0]?.content, /user_dir=\/tmp\/workspaces\/alice/);
    assert.match(messages[0]?.content, /common_writable=false/);
    assert.match(messages[0]?.content, /Eddy가 아닙니다/);
  } finally {
    await server.close();
  }
});
