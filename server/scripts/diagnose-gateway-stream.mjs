#!/usr/bin/env node
import { readFileSync } from "node:fs";

const envPath = process.env.OPENCLAW_CUSTOM_CHANNEL_AUTH_ENV ?? "/home/orbsian/.config/openclaw-custom-channel/auth.env";
const baseUrl = process.env.OPENCLAW_GATEWAY_URL ?? "http://127.0.0.1:18789";
const model = process.env.OPENCLAW_GATEWAY_MODEL ?? "openclaw";
const sessionKey = `diag-pwa-stream-${Date.now()}`;
const inspectAgentEvents = process.argv.includes("--agent-events") || process.env.DIAG_GATEWAY_AGENT_EVENTS === "1";
const verboseAgentEvents = process.argv.includes("--agent-events-verbose") || process.env.DIAG_GATEWAY_AGENT_EVENTS_VERBOSE === "1";
const dumpAgentEvents = process.argv.includes("--agent-events-dump") || process.env.DIAG_GATEWAY_AGENT_EVENTS_DUMP === "1";
const inspectChatWs = process.argv.includes("--chat-ws") || process.env.DIAG_GATEWAY_CHAT_WS === "1";
const startedAt = Date.now();

let authSecret = process.env.OPENCLAW_GATEWAY_PASSWORD ?? process.env.OPENCLAW_GATEWAY_TOKEN ?? "";
let authField = process.env.OPENCLAW_GATEWAY_PASSWORD ? "password" : "token";
try {
  const env = readFileSync(envPath, "utf8");
  for (const line of env.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)=(.*)\s*$/);
    if (!match) {
      continue;
    }
    const value = match[2].replace(/^["']|["']$/g, "");
    if (!authSecret && (match[1] === "OPENCLAW_GATEWAY_PASSWORD" || match[1] === "OPENCLAW_GATEWAY_TOKEN")) {
      authSecret = value;
      authField = match[1] === "OPENCLAW_GATEWAY_PASSWORD" ? "password" : "token";
    }
  }
} catch {
  // The gateway may still be unauthenticated in local development.
}

const prompt = process.argv.slice(2).filter((arg) => arg !== "--agent-events" && arg !== "--agent-events-verbose" && arg !== "--agent-events-dump" && arg !== "--chat-ws").join(" ") || [
  "Streaming diagnostic.",
  "Do not answer all at once.",
  "Write five short labeled sections in this order:",
  "1. Request understood",
  "2. Approach selected",
  "3. Drafting",
  "4. Reviewing",
  "5. Final answer",
  "Use the final answer to explain blockchain usefulness in three short paragraphs.",
].join("\n");

if (inspectChatWs) {
  await runChatWsDiagnostic({ baseUrl, sessionKey, authSecret, authField, startedAt, prompt });
  process.exit(0);
}

const headers = {
  "content-type": "application/json",
  accept: "text/event-stream",
  "x-openclaw-session-key": sessionKey,
  "x-openclaw-message-channel": "webchat",
};
if (authSecret) {
  headers.authorization = `Bearer ${authSecret}`;
}

let eventSocket;
if (inspectAgentEvents) {
  eventSocket = await subscribeAgentEvents({ baseUrl, sessionKey, authSecret, authField, startedAt }).catch((error) => {
    console.log(`agent_events_subscribe_error=${JSON.stringify(error?.message ?? String(error))}`);
    return undefined;
  });
}
const response = await fetch(new URL("/v1/chat/completions", baseUrl), {
  method: "POST",
  headers,
  body: JSON.stringify({
    model,
    stream: true,
    messages: [{ role: "user", content: prompt }],
  }),
  signal: AbortSignal.timeout(Number(process.env.DIAG_GATEWAY_STREAM_TIMEOUT_MS ?? 120_000)),
});

console.log(`status=${response.status} content-type=${response.headers.get("content-type") ?? ""} session=${sessionKey}`);
if (!response.body) {
  console.log("no response body");
  process.exit(1);
}

function elapsedMs() {
  return Date.now() - startedAt;
}

function extractVisibleText(value) {
  const texts = [];
  const visit = (entry) => {
    if (!entry) {
      return;
    }
    if (typeof entry === "string") {
      texts.push(entry);
      return;
    }
    if (Array.isArray(entry)) {
      entry.forEach(visit);
      return;
    }
    if (typeof entry !== "object") {
      return;
    }
    if (typeof entry.content === "string") {
      texts.push(entry.content);
    }
    if (typeof entry.text === "string") {
      texts.push(entry.text);
    }
    if (typeof entry.output_text === "string") {
      texts.push(entry.output_text);
    }
    if (Array.isArray(entry.choices)) {
      entry.choices.forEach(visit);
    }
    visit(entry.delta);
    visit(entry.message);
    visit(entry.data);
    visit(entry.payload);
  };
  visit(value);
  return texts.join("");
}

const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
let chunkCount = 0;
let eventCount = 0;
let contentEventCount = 0;
let contentChars = 0;

while (true) {
  const { done, value } = await reader.read();
  if (done) {
    break;
  }
  chunkCount += 1;
  console.log(`chunk=${chunkCount} at_ms=${elapsedMs()} bytes=${value.byteLength}`);
  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.startsWith("data:")) {
      continue;
    }
    const data = line.slice("data:".length).trimStart();
    if (!data || data === "[DONE]") {
      console.log(`  event=done at_ms=${elapsedMs()}`);
      continue;
    }
    eventCount += 1;
    let visible = "";
    try {
      visible = extractVisibleText(JSON.parse(data));
    } catch {
      // Keep parsing failures visible without dumping payloads or secrets.
    }
    if (visible) {
      contentEventCount += 1;
      contentChars += visible.length;
      console.log(`  event=${eventCount} visible_chars=${visible.length} total_visible_chars=${contentChars} at_ms=${elapsedMs()} head=${JSON.stringify(visible.slice(0, 80))}`);
    } else {
      console.log(`  event=${eventCount} no_visible_content at_ms=${elapsedMs()}`);
    }
  }
}

console.log(`summary chunks=${chunkCount} events=${eventCount} content_events=${contentEventCount} visible_chars=${contentChars} elapsed_ms=${elapsedMs()}`);
eventSocket?.close?.();

function gatewayWsUrl(value) {
  const url = new URL(value);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

async function subscribeAgentEvents({ baseUrl, sessionKey, authSecret, authField, startedAt }) {
  const WebSocketCtor = globalThis.WebSocket;
  if (!WebSocketCtor) {
    throw new Error("WebSocket is not available.");
  }

  const socket = new WebSocketCtor(gatewayWsUrl(baseUrl));
  let readyResolve;
  let readyReject;
  let nextRequestId = 0;
  const pending = new Map();

  const request = (method, params) => new Promise((resolve, reject) => {
    const id = `diag-${++nextRequestId}`;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`request timeout: ${method}`));
    }, 5_000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ type: "req", id, method, params }));
  });

  socket.addEventListener("message", async (event) => {
    const text = typeof event.data === "string" ? event.data : Buffer.from(await event.data.arrayBuffer()).toString("utf8");
    let frame;
    try {
      frame = JSON.parse(text);
    } catch {
      return;
    }

    if (frame.type === "res" && frame.id && pending.has(frame.id)) {
      const pendingRequest = pending.get(frame.id);
      pending.delete(frame.id);
      clearTimeout(pendingRequest.timeout);
      if (frame.ok) {
        pendingRequest.resolve(frame.payload);
      } else {
        pendingRequest.reject(new Error(frame.error?.message || "gateway request failed"));
      }
      return;
    }

    if (frame.type !== "event") {
      return;
    }

    if (frame.event === "connect.challenge") {
      await request("connect", {
        minProtocol: 4,
        maxProtocol: 4,
        client: {
          id: "gateway-client",
          displayName: "Gateway Stream Diagnostic",
          version: "1.0.0",
          platform: process.platform,
          mode: "backend",
        },
        caps: [],
        auth: authSecret ? { [authField]: authSecret } : undefined,
        role: "operator",
        scopes: ["operator.read"],
      });
      await request("sessions.subscribe", {});
      readyResolve?.();
      return;
    }

    if (verboseAgentEvents && (frame.event === "agent" || frame.event === "session.tool")) {
      const data = frame.payload?.data ?? {};
      const visible = extractVisibleText(data);
      console.log(`agent_event_seen event=${frame.event} payload_session=${JSON.stringify(frame.payload?.sessionKey ?? "")} stream=${JSON.stringify(frame.payload?.stream ?? "")} phase=${JSON.stringify(data.phase ?? "")} visible_chars=${visible.length} at_ms=${Date.now() - startedAt} head=${JSON.stringify(visible.slice(0, 80))}`);
      if (dumpAgentEvents && frame.payload?.sessionKey === `agent:main:${sessionKey}`) {
        const compact = JSON.stringify(frame.payload, (_key, value) => {
          if (typeof value === "string" && value.length > 500) {
            return `${value.slice(0, 500)}...[truncated ${value.length}]`;
          }
          return value;
        });
        console.log(`agent_event_dump=${compact.slice(0, 2000)}`);
      }
    }

    if ((frame.event === "agent" || frame.event === "session.tool") && frame.payload?.sessionKey === sessionKey) {
      const data = frame.payload?.data ?? {};
      const visible = extractVisibleText(data);
      console.log(`agent_event event=${frame.event} stream=${JSON.stringify(frame.payload?.stream ?? "")} phase=${JSON.stringify(data.phase ?? "")} visible_chars=${visible.length} at_ms=${Date.now() - startedAt} head=${JSON.stringify(visible.slice(0, 80))}`);
    }
  });

  socket.addEventListener("error", () => readyReject?.(new Error("websocket error")));
  socket.addEventListener("close", () => readyReject?.(new Error("websocket closed before ready")));

  await new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
    setTimeout(() => reject(new Error("agent event subscription timeout")), 6_000);
  });
  console.log(`agent_events_subscribed session=${sessionKey} at_ms=${Date.now() - startedAt}`);
  return socket;
}

async function runChatWsDiagnostic({ baseUrl, sessionKey, authSecret, authField, startedAt, prompt }) {
  const WebSocketCtor = globalThis.WebSocket;
  if (!WebSocketCtor) {
    throw new Error("WebSocket is not available.");
  }

  const socket = new WebSocketCtor(gatewayWsUrl(baseUrl));
  let readyResolve;
  let readyReject;
  let finalResolve;
  let finalReject;
  let nextRequestId = 0;
  let chatEvents = 0;
  let deltaEvents = 0;
  let deltaChars = 0;
  const pending = new Map();

  const request = (method, params) => new Promise((resolve, reject) => {
    const id = `diag-chat-${++nextRequestId}`;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`request timeout: ${method}`));
    }, 10_000);
    pending.set(id, { resolve, reject, timeout, method });
    socket.send(JSON.stringify({ type: "req", id, method, params }));
  });

  socket.addEventListener("message", async (event) => {
    const text = typeof event.data === "string" ? event.data : Buffer.from(await event.data.arrayBuffer()).toString("utf8");
    let frame;
    try {
      frame = JSON.parse(text);
    } catch {
      return;
    }

    if (frame.type === "res" && frame.id && pending.has(frame.id)) {
      const pendingRequest = pending.get(frame.id);
      pending.delete(frame.id);
      clearTimeout(pendingRequest.timeout);
      if (frame.ok) {
        console.log(`chat_ws_response method=${pendingRequest.method} ok=true at_ms=${Date.now() - startedAt}`);
        pendingRequest.resolve(frame.payload);
      } else {
        const message = frame.error?.message || "gateway request failed";
        console.log(`chat_ws_response method=${pendingRequest.method} ok=false error=${JSON.stringify(message)} at_ms=${Date.now() - startedAt}`);
        pendingRequest.reject(new Error(message));
      }
      return;
    }

    if (frame.type !== "event") {
      return;
    }

    if (frame.event === "connect.challenge") {
      await request("connect", {
        minProtocol: 4,
        maxProtocol: 4,
        client: {
          id: "gateway-client",
          displayName: "Gateway Chat Diagnostic",
          version: "1.0.0",
          platform: process.platform,
          mode: "backend",
        },
        caps: [],
        auth: authSecret ? { [authField]: authSecret } : undefined,
        role: "operator",
        scopes: ["operator.read", "operator.write"],
      });
      await request("sessions.create", { key: sessionKey, agentId: "main" }).catch((error) => {
        if (!String(error?.message ?? error).includes("already")) {
          throw error;
        }
      });
      await request("sessions.messages.subscribe", { key: sessionKey, agentId: "main" });
      readyResolve?.();
      return;
    }

    const payload = frame.payload ?? {};
    const matches = payload.sessionKey === sessionKey || payload.key === sessionKey || String(payload.sessionKey ?? "").endsWith(`:${sessionKey}`);
    if (!matches) {
      return;
    }

    chatEvents += 1;
    const deltaText = typeof payload.deltaText === "string" ? payload.deltaText : "";
    if (deltaText) {
      deltaEvents += 1;
      deltaChars += deltaText.length;
    }
    console.log(`chat_ws_event event=${JSON.stringify(frame.event)} state=${JSON.stringify(payload.state ?? "")} delta_chars=${deltaText.length} total_delta_chars=${deltaChars} at_ms=${Date.now() - startedAt} head=${JSON.stringify(deltaText.slice(0, 80))}`);
    if (payload.state === "final" || payload.state === "error" || payload.state === "aborted") {
      finalResolve?.({ state: payload.state, chatEvents, deltaEvents, deltaChars });
    }
  });

  socket.addEventListener("error", () => {
    readyReject?.(new Error("websocket error"));
    finalReject?.(new Error("websocket error"));
  });
  socket.addEventListener("close", () => {
    readyReject?.(new Error("websocket closed before ready"));
    finalReject?.(new Error("websocket closed before final"));
  });

  await new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
    setTimeout(() => reject(new Error("chat websocket subscription timeout")), 10_000);
  });
  console.log(`chat_ws_subscribed session=${sessionKey} at_ms=${Date.now() - startedAt}`);
  await request("sessions.send", {
    key: sessionKey,
    agentId: "main",
    message: prompt,
    thinking: process.env.OPENCLAW_THINKING ?? "medium",
    idempotencyKey: `diag-${Date.now()}`,
  });
  const result = await new Promise((resolve, reject) => {
    finalResolve = resolve;
    finalReject = reject;
    setTimeout(() => reject(new Error("chat websocket final timeout")), Number(process.env.DIAG_GATEWAY_STREAM_TIMEOUT_MS ?? 120_000));
  });
  console.log(`chat_ws_summary state=${result.state} events=${result.chatEvents} delta_events=${result.deltaEvents} delta_chars=${result.deltaChars} elapsed_ms=${Date.now() - startedAt}`);
  socket.close?.();
}
