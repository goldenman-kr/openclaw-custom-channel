import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN;
if (!gatewayToken) {
  console.error("OPENCLAW_GATEWAY_TOKEN is required.");
  process.exit(2);
}

const serverDir = process.cwd();
const tmpDir = await mkdtemp(join(tmpdir(), "openclaw-bridge-gateway-openai-smoke-"));
const port = String(33_000 + Math.floor(Math.random() * 2_000));
const baseUrl = `http://127.0.0.1:${port}`;
const apiKey = "dev-api-key";
const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL ?? "http://127.0.0.1:18789";
const gatewayModel = process.env.OPENCLAW_GATEWAY_MODEL ?? "openclaw";

const child = spawn(process.execPath, ["dist/index.js"], {
  cwd: serverDir,
  env: {
    ...process.env,
    PORT: port,
    HOST: "127.0.0.1",
    OPENCLAW_TRANSPORT: "gateway-openai",
    OPENCLAW_GATEWAY_URL: gatewayUrl,
    OPENCLAW_GATEWAY_TOKEN: gatewayToken,
    OPENCLAW_GATEWAY_MODEL: gatewayModel,
    OPENCLAW_GATEWAY_TIMEOUT_MS: process.env.OPENCLAW_GATEWAY_TIMEOUT_MS ?? "180000",
    BRIDGE_API_KEYS: apiKey,
    HISTORY_DIR: join(tmpDir, "history"),
    HISTORY_MEDIA_DIR: join(tmpDir, "history-media"),
    CHAT_DB_PATH: join(tmpDir, "chat.sqlite"),
    PUBLIC_DIR: resolve(serverDir, "public"),
    MEDIA_ROOT: join(tmpDir, "media-root"),
    OPENCLAW_MEDIA_DIR: join(tmpDir, "openclaw-media"),
    UPLOAD_DIR: join(tmpDir, "uploads"),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => {
  stdout += String(chunk);
});
child.stderr.on("data", (chunk) => {
  stderr += String(chunk);
});

try {
  await waitForHealth();
  const conversation = await postJson("/v1/conversations", { title: "Gateway OpenAI E2E Smoke" });
  const conversationId = conversation.conversation.id;
  const message = await postJson("/v1/message", {
    conversation_id: conversationId,
    message: process.env.OPENCLAW_GATEWAY_BRIDGE_SMOKE_MESSAGE ?? "한 문장으로만 답해주세요: bridge gateway token e2e",
  });
  const jobId = message.job_id;
  assert.ok(jobId, "message response should include job_id");

  const events = await fetchText(`/v1/jobs/${encodeURIComponent(jobId)}/events?conversation_id=${encodeURIComponent(conversationId)}`, {
    signal: AbortSignal.timeout(Number(process.env.OPENCLAW_GATEWAY_BRIDGE_SMOKE_TIMEOUT_MS ?? 180_000)),
  });
  assert.match(events, /event: token/);
  assert.match(events, /event: job/);
  assert.match(events, /"state":"completed"/);

  const tokenEvents = events.split(/\r?\n/).filter((line) => line === "event: token").length;
  console.log(JSON.stringify({
    ok: true,
    gatewayUrl,
    gatewayModel,
    tokenEvents,
    likelyTokenStreaming: tokenEvents > 1,
  }, null, 2));
} finally {
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
  await rm(tmpDir, { recursive: true, force: true });
}

async function waitForHealth() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 8_000) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited early with code ${child.exitCode}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Server is still starting.
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for health.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
}

async function postJson(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => null);
  assert.equal(response.ok, true, `${path} failed with ${response.status}: ${JSON.stringify(json)}`);
  return json;
}

async function fetchText(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${apiKey}`,
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  assert.equal(response.ok, true, `${path} failed with ${response.status}: ${text}`);
  return text;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
