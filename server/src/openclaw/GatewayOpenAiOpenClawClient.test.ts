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
