import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const tempDir = mkdtempSync(join(tmpdir(), "native-command-test-"));
process.env.OPENCLAW_GATEWAY_MODEL = "openclaw";
process.env.OPENCLAW_AGENT = "main";
process.env.OPENCLAW_CONFIG_PATH = join(tempDir, "openclaw.json");
process.env.OPENCLAW_SESSION_STORE_PATH = join(tempDir, "sessions.json");

writeFileSync(process.env.OPENCLAW_CONFIG_PATH, JSON.stringify({
  agents: {
    defaults: {
      model: {
        primary: "openai-codex/gpt-5.5",
        fallbacks: ["openai-codex/gpt-5.4"],
      },
    },
  },
  models: {
    providers: {
      "openai-codex": { models: [{ id: "gpt-5.5" }, { id: "gpt-5.4" }] },
      llamacpp: { models: [{ id: "Qwen3.6-35B-A3B" }] },
    },
  },
}, null, 2));
writeFileSync(process.env.OPENCLAW_SESSION_STORE_PATH, JSON.stringify({
  "agent:main:web-conv_test": {
    sessionId: "session-test",
    updatedAt: Date.now(),
  },
}, null, 2));

const { executeNativeCommand } = await import("./nativeCommands.js");

test("/model changes are admin-only", async () => {
  const denied = await executeNativeCommand("/model llamacpp/Qwen3.6-35B-A3B", { userRole: "user", sessionKey: "web-conv_test" });
  assert.equal(denied?.reply, "❌ 모델 변경은 관리자만 할 수 있습니다. 현재 채팅 모델 확인만 허용됩니다.");

  const current = await executeNativeCommand("/model", { userRole: "user", sessionKey: "web-conv_test" });
  assert.match(current?.reply ?? "", /현재 채팅 모델: openai-codex\/gpt-5\.5/);
  assert.match(current?.reply ?? "", /Gateway routing: openclaw/);
  assert.match(current?.reply ?? "", /모델 변경은 관리자만 할 수 있습니다/);
});

test("/model admin response updates current chat session only", async () => {
  const changed = await executeNativeCommand("/model llamacpp/Qwen3.6-35B-A3B", { userRole: "admin", sessionKey: "web-conv_test" });
  assert.match(changed?.reply ?? "", /현재 채팅의 모델 override를 변경했습니다/);
  assert.match(changed?.reply ?? "", /llamacpp\/Qwen3\.6-35B-A3B/);

  const current = await executeNativeCommand("/model", { userRole: "admin", sessionKey: "web-conv_test" });
  assert.match(current?.reply ?? "", /현재 채팅 모델: llamacpp\/Qwen3\.6-35B-A3B/);
  assert.match(current?.reply ?? "", /Gateway routing: openclaw/);

  const reset = await executeNativeCommand("/model default", { userRole: "admin", sessionKey: "web-conv_test" });
  assert.match(reset?.reply ?? "", /현재 채팅의 모델 override를 해제했습니다/);
  assert.match(reset?.reply ?? "", /openai-codex\/gpt-5\.5/);
});
