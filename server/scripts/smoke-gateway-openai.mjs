import assert from "node:assert/strict";

const baseUrl = process.env.OPENCLAW_GATEWAY_URL ?? "http://127.0.0.1:18789";
const token = process.env.OPENCLAW_GATEWAY_TOKEN;
const model = process.env.OPENCLAW_GATEWAY_MODEL ?? "openclaw";
const sessionKey = process.env.OPENCLAW_GATEWAY_SMOKE_SESSION ?? `webchat-gateway-openai-smoke-${Date.now()}`;
const message = process.env.OPENCLAW_GATEWAY_SMOKE_MESSAGE ?? "한 문장으로 짧게 답해주세요: token streaming smoke";
const timeoutMs = Number(process.env.OPENCLAW_GATEWAY_TIMEOUT_MS ?? 120_000);
const url = new URL("/v1/chat/completions", baseUrl);

const abortController = new AbortController();
const timeout = setTimeout(() => abortController.abort(new Error("Gateway OpenAI smoke timed out.")), timeoutMs);

try {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      accept: "text/event-stream",
      "content-type": "application/json",
      "x-openclaw-session-key": sessionKey,
      "x-openclaw-message-channel": "webchat",
    },
    body: JSON.stringify({
      model,
      stream: true,
      messages: [{ role: "user", content: message }],
    }),
    signal: abortController.signal,
  });

  if (response.status === 404) {
    console.error("GATEWAY_OPENAI_SMOKE_ENDPOINT_DISABLED: /v1/chat/completions returned 404. Enable gateway.http.endpoints.chatCompletions first.");
    await response.body?.cancel();
    process.exit(2);
  }

  const text = await readText(response);
  assert.equal(response.ok, true, `Gateway returned ${response.status}: ${text.slice(0, 500)}`);

  const contentChunks = parseOpenAiSseContentChunks(text);
  assert.ok(contentChunks.length > 0, `No streamed content chunks found. Raw prefix: ${text.slice(0, 500)}`);

  const chunkCount = contentChunks.length;
  const reply = contentChunks.join("");
  console.log(JSON.stringify({
    ok: true,
    endpoint: url.toString(),
    model,
    sessionKey,
    contentChunkCount: chunkCount,
    likelyTokenStreaming: chunkCount > 1,
    replyPreview: reply.slice(0, 200),
  }, null, 2));
} finally {
  clearTimeout(timeout);
}

async function readText(response) {
  const reader = response.body?.getReader();
  if (!reader) {
    return await response.text();
  }

  const decoder = new TextDecoder();
  let output = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    output += decoder.decode(value, { stream: true });
  }
  output += decoder.decode();
  return output;
}

function parseOpenAiSseContentChunks(text) {
  const chunks = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data:")) {
      continue;
    }
    const data = line.slice("data:".length).trimStart();
    if (!data || data === "[DONE]") {
      continue;
    }
    try {
      const parsed = JSON.parse(data);
      const content = parsed.choices?.map((choice) => choice.delta?.content ?? "").join("") ?? "";
      if (content) {
        chunks.push(content);
      }
    } catch {
      // Ignore non-JSON data lines.
    }
  }
  return chunks;
}
