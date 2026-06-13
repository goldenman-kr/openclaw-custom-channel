import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { GatewayOpenAiOpenClawClient } from "./GatewayOpenAiOpenClawClient.js";
import { setSessionThinkingOverride } from "./modelOverride.js";

const tempDir = mkdtempSync(join(tmpdir(), "gateway-openclaw-client-test-"));
process.env.OPENCLAW_SESSION_STORE_PATH = join(tempDir, "sessions.json");
writeFileSync(process.env.OPENCLAW_SESSION_STORE_PATH, "{}\n");

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
    const client = new GatewayOpenAiOpenClawClient(server.baseUrl, "gateway-token", "openclaw-test", 5_000, undefined, undefined, undefined, "auto");
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

test("uses configured Gateway password when auth mode is password", async () => {
  const requests: Array<{ headers: IncomingMessage["headers"] }> = [];
  const server = await withServer(async (req, res) => {
    requests.push({ headers: req.headers });
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
    res.end('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
  });

  try {
    const client = new GatewayOpenAiOpenClawClient(
      server.baseUrl,
      "gateway-token",
      "openclaw-test",
      5_000,
      undefined,
      undefined,
      "gateway-password",
      "password",
    );
    const result = await client.sendMessage({
      sessionId: "session-password-auth-test",
      message: "hello",
    });

    assert.equal(result.reply, "ok");
    assert.equal(requests[0]?.headers.authorization, "Bearer gateway-password");
  } finally {
    await server.close();
  }
});

test("uses configured Gateway token when auth mode is token", async () => {
  const requests: Array<{ headers: IncomingMessage["headers"] }> = [];
  const server = await withServer(async (req, res) => {
    requests.push({ headers: req.headers });
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
    res.end('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
  });

  try {
    const client = new GatewayOpenAiOpenClawClient(
      server.baseUrl,
      "gateway-token",
      "openclaw-test",
      5_000,
      undefined,
      undefined,
      "gateway-password",
      "token",
    );
    const result = await client.sendMessage({
      sessionId: "session-token-auth-test",
      message: "hello",
    });

    assert.equal(result.reply, "ok");
    assert.equal(requests[0]?.headers.authorization, "Bearer gateway-token");
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

test("ignores Gateway preamble progressText as runtime tokens", async () => {
  const originalWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket;
  const sentFrames: Array<Record<string, unknown>> = [];

  class FakeWebSocket {
    private readonly listeners = new Map<string, Array<(event?: unknown) => void>>();

    constructor(_url: string) {
      setTimeout(() => {
        this.dispatch("open");
        this.dispatch("message", { data: JSON.stringify({ type: "event", event: "connect.challenge", payload: { nonce: "nonce-test" } }) });
      }, 0);
    }

    addEventListener(event: string, listener: (event?: unknown) => void): void {
      const listeners = this.listeners.get(event) ?? [];
      listeners.push(listener);
      this.listeners.set(event, listeners);
    }

    send(data: string): void {
      const frame = JSON.parse(data) as Record<string, unknown>;
      sentFrames.push(frame);
      const id = frame.id;
      if (typeof id !== "string") {
        return;
      }
      setTimeout(() => {
        this.dispatch("message", { data: JSON.stringify({ type: "res", id, ok: true, payload: {} }) });
        if (frame.method === "sessions.subscribe") {
          setTimeout(() => {
            this.dispatch("message", {
              data: JSON.stringify({
                type: "event",
                event: "agent",
                payload: {
                  sessionKey: "agent:main:session-agent-event-test",
                  stream: "item",
                  data: {
                    itemId: "msg-preamble-1",
                    kind: "preamble",
                    phase: "update",
                    progressText: "1. 요청 이해",
                  },
                },
              }),
            });
            this.dispatch("message", {
              data: JSON.stringify({
                type: "event",
                event: "agent",
                payload: {
                  sessionKey: "agent:main:session-agent-event-test",
                  stream: "item",
                  data: {
                    itemId: "msg-preamble-1",
                    kind: "preamble",
                    phase: "update",
                    progressText: "1. 요청 이해 완료",
                  },
                },
              }),
            });
            this.dispatch("message", {
              data: JSON.stringify({
                type: "event",
                event: "agent",
                payload: {
                  sessionKey: "agent:main:session-agent-event-test",
                  stream: "item",
                  data: {
                    itemId: "msg-preamble-2",
                    kind: "preamble",
                    phase: "update",
                    progressText: "2. 접근 방식",
                  },
                },
              }),
            });
            this.dispatch("message", {
              data: JSON.stringify({
                type: "event",
                event: "agent",
                payload: {
                  sessionKey: "agent:main:session-agent-event-test",
                  stream: "item",
                  data: {
                    itemId: "raw-assistant-1",
                    kind: "preamble",
                    phase: "update",
                    progressText: "2. 접근 방식",
                  },
                },
              }),
            });
            this.dispatch("message", {
              data: JSON.stringify({
                type: "event",
                event: "agent",
                payload: {
                  sessionKey: "agent:main:session-agent-event-test",
                  stream: "assistant",
                  data: { text: "final answer" },
                },
              }),
            });
          }, 5);
        }
      }, 0);
    }

    close(): void {
      this.dispatch("close");
    }

    private dispatch(event: string, payload?: unknown): void {
      for (const listener of this.listeners.get(event) ?? []) {
        listener(payload);
      }
    }
  }

  (globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocket;
  const server = await withServer(async (_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
    setTimeout(() => {
      res.end('data: {"choices":[{"delta":{"content":"final answer"}}]}\n\ndata: [DONE]\n\n');
    }, 20);
  });

  try {
    const tokens: string[] = [];
    const agentEvents: unknown[] = [];
    const client = new GatewayOpenAiOpenClawClient(server.baseUrl, "gateway-token", "openclaw-test", 5_000);
    const result = await client.sendMessage({
      sessionId: "session-agent-event-test",
      message: "hello",
      callbacks: {
        onToken(token) {
          tokens.push(token);
        },
        onAgentEvent(event) {
          agentEvents.push(event);
        },
      },
    });

    assert.equal(result.reply, "final answer");
    assert.deepEqual(tokens, ["final answer"]);
    assert.equal(agentEvents.length, 5);
    assert.ok(sentFrames.some((frame) => frame.method === "sessions.subscribe"));
  } finally {
    (globalThis as { WebSocket?: unknown }).WebSocket = originalWebSocket;
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

test("sends SVG image attachments as text instead of image_url parts", async () => {
  const requests: Array<{ body: Record<string, unknown> }> = [];
  const server = await withServer(async (req, res) => {
    requests.push({ body: await readJson(req) });
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
    res.end('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
  });

  try {
    const client = new GatewayOpenAiOpenClawClient(server.baseUrl, undefined, "openclaw-test", 5_000);
    await client.sendMessage({
      sessionId: "session-svg-test",
      message: "describe this",
      attachments: [
        {
          type: "image",
          name: "icon.svg",
          mime_type: "image/svg+xml",
          content_base64: Buffer.from('<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" /></svg>').toString("base64"),
        },
      ],
    });

    const messages = requests[0]?.body.messages as Array<{ content: unknown }>;
    assert.equal(typeof messages[0]?.content, "string");
    assert.match(messages[0]?.content as string, /icon\.svg \(image\/svg\+xml, image\)/);
    assert.match(messages[0]?.content as string, /<svg viewBox=/);
    assert.doesNotMatch(JSON.stringify(messages[0]?.content), /image_url/);
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
    assert.doesNotMatch(messages[0]?.content, /Web\/PWA 채팅 채널/);
  } finally {
    await server.close();
  }
});

test("can include optional webchat streaming hint when enabled", async () => {
  const previousHint = process.env.OPENCLAW_WEBCHAT_STREAMING_HINT;
  process.env.OPENCLAW_WEBCHAT_STREAMING_HINT = "1";
  const requests: Array<{ body: Record<string, unknown> }> = [];
  const server = await withServer(async (req, res) => {
    requests.push({ body: await readJson(req) });
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
    res.end('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
  });

  try {
    const client = new GatewayOpenAiOpenClawClient(server.baseUrl, undefined, "openclaw-test", 5_000);
    await client.sendMessage({ sessionId: "session-webchat-hint-test", message: "hello" });

    const messages = requests[0]?.body.messages as Array<{ content: string }>;
    assert.match(messages[0]?.content, /Web\/PWA 채팅 채널/);
    assert.match(messages[0]?.content, /assistant 본문\/commentary로 사용자에게 보이게 작성/);
  } finally {
    if (previousHint === undefined) {
      delete process.env.OPENCLAW_WEBCHAT_STREAMING_HINT;
    } else {
      process.env.OPENCLAW_WEBCHAT_STREAMING_HINT = previousHint;
    }
    await server.close();
  }
});

test("includes session thinking override in Gateway requests", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const server = await withServer(async (req, res) => {
    requests.push(await readJson(req));
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
    res.end('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
  });

  try {
    setSessionThinkingOverride("session-thinking-test", "high");
    const client = new GatewayOpenAiOpenClawClient(server.baseUrl, undefined, "openclaw-test", 5_000);
    await client.sendMessage({ sessionId: "session-thinking-test", message: "hello" });
    assert.equal(requests[0]?.thinking, "high");
  } finally {
    setSessionThinkingOverride("session-thinking-test", null);
    await server.close();
  }
});
