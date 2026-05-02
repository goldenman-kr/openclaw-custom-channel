import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.NATIVE_COMMAND_SETTINGS_PATH = join(mkdtempSync(join(tmpdir(), "native-command-test-")), "settings.json");
process.env.OPENCLAW_GATEWAY_MODEL = "openai-codex/gpt-5.5";

const { executeNativeCommand } = await import("./nativeCommands.js");

test("/model changes are admin-only", async () => {
  const denied = await executeNativeCommand("/model llamacpp/Qwen3.6-35B-A3B", { userRole: "user" });
  assert.equal(denied?.reply, "❌ 모델 변경은 관리자만 할 수 있습니다. 현재 모델 확인만 허용됩니다.");

  const current = await executeNativeCommand("/model", { userRole: "user" });
  assert.match(current?.reply ?? "", /현재 모델: openai-codex\/gpt-5\.5/);
  assert.match(current?.reply ?? "", /모델 변경은 관리자만 할 수 있습니다/);
});

test("/model admin response marks override as global", async () => {
  const changed = await executeNativeCommand("/model llamacpp/Qwen3.6-35B-A3B", { userRole: "admin" });
  assert.match(changed?.reply ?? "", /전역 모델 override를 변경했습니다/);
  assert.match(changed?.reply ?? "", /llamacpp\/Qwen3\.6-35B-A3B/);

  const reset = await executeNativeCommand("/model default", { userRole: "admin" });
  assert.match(reset?.reply ?? "", /전역 모델 override를 해제했습니다/);
  assert.match(reset?.reply ?? "", /openai-codex\/gpt-5\.5/);
});
