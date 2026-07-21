import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
      models: {
        "openai-codex/gpt-5.5": {},
        "openai-codex/gpt-5.4": {},
        "openai/gpt-5.6-luna": {},
        "openai/gpt-5.6-sol": {},
        "openai/gpt-5.6-terra": {},
      },
    },
  },
  models: {
    providers: {
      "openai-codex": { models: [{ id: "gpt-5.5" }, { id: "gpt-5.4" }] },
      llamacpp: { models: [{ id: "Qwen3.6-27B-MTP" }] },
    },
  },
}, null, 2));
writeFileSync(process.env.OPENCLAW_SESSION_STORE_PATH, JSON.stringify({
  "agent:main:web-conv_test": {
    sessionId: "session-test",
    updatedAt: Date.now(),
  },
}, null, 2));

const { executeNativeCommand, getNativeModelMenu, applyNativeModelSelection, applyNativeSpeedSelection, applyNativeThinkingSelection, isOpenAiSpeedModel } = await import("./nativeCommands.js");
const { ensureSessionEntry, ensureSessionStandardSpeed, getSessionFastMode, getSessionThinkingOverride, setSessionFastMode, setSessionThinkingOverride } = await import("../openclaw/modelOverride.js");

test("/model changes are admin-only", async () => {
  const denied = await executeNativeCommand("/model llamacpp/Qwen3.6-27B-MTP", { userRole: "user", sessionKey: "web-conv_test" });
  assert.equal(denied?.reply, "❌ 모델 변경은 관리자만 할 수 있습니다. 현재 채팅 모델 확인만 허용됩니다.");

  const current = await executeNativeCommand("/model", { userRole: "user", sessionKey: "web-conv_test" });
  assert.match(current?.reply ?? "", /현재 채팅 모델: openai-codex\/gpt-5\.5/);
  assert.match(current?.reply ?? "", /Gateway routing: openclaw/);
  assert.match(current?.reply ?? "", /모델 변경은 관리자만 할 수 있습니다/);
});

test("model menu hides provider in labels and marks current selection", async () => {
  const menu = await getNativeModelMenu({ userRole: "admin", sessionKey: "web-conv_test" });
  assert.equal(menu.currentModel, "openai-codex/gpt-5.5");
  assert.equal(menu.currentThinking, "medium");
  assert.equal(menu.currentSpeed, "standard");
  assert.equal(menu.speedSupported, true);
  assert.equal(menu.canChange, true);
  assert.deepEqual(menu.models.map((entry) => entry.label), ["gpt-5.4", "gpt-5.5", "gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"]);
  assert.equal(menu.models.find((entry) => entry.ref === "openai-codex/gpt-5.5")?.selected, true);
  assert.deepEqual(menu.thinkingLevels.map((entry) => entry.ref), ["off", "low", "medium", "high", "xhigh", "max", "ultra"]);
  assert.equal(menu.thinkingLevels.find((entry) => entry.ref === "medium")?.selected, true);
  assert.deepEqual(menu.speedModes.map((entry) => entry.ref), ["standard", "fast"]);
  assert.equal(menu.speedModes.find((entry) => entry.ref === "standard")?.selected, true);
});

test("OpenAI and OpenAI Codex models support Speed while local models do not", () => {
  assert.equal(isOpenAiSpeedModel("openai/gpt-5.6-sol"), true);
  assert.equal(isOpenAiSpeedModel("openai-codex/gpt-5.5"), true);
  assert.equal(isOpenAiSpeedModel("llamacpp/Qwen3.6-27B-MTP"), false);
});

test("/model admin response updates current chat session only", async () => {
  const changed = await executeNativeCommand("/model llamacpp/Qwen3.6-27B-MTP", { userRole: "admin", sessionKey: "web-conv_test" });
  assert.match(changed?.reply ?? "", /현재 채팅의 모델 override를 변경했습니다/);
  assert.match(changed?.reply ?? "", /llamacpp\/Qwen3\.6-27B-MTP/);

  const current = await executeNativeCommand("/model", { userRole: "admin", sessionKey: "web-conv_test" });
  assert.match(current?.reply ?? "", /현재 채팅 모델: llamacpp\/Qwen3\.6-27B-MTP/);
  assert.match(current?.reply ?? "", /Gateway routing: openclaw/);

  const reset = await executeNativeCommand("/model default", { userRole: "admin", sessionKey: "web-conv_test" });
  assert.match(reset?.reply ?? "", /현재 채팅의 모델 override를 해제했습니다/);
  assert.match(reset?.reply ?? "", /openai-codex\/gpt-5\.5/);
});

test("applyNativeModelSelection enforces admin and updates selected model", async () => {
  await assert.rejects(() => applyNativeModelSelection("openai-codex/gpt-5.4", { userRole: "user", sessionKey: "web-conv_test" }), /관리자만/);

  const result = await applyNativeModelSelection("openai-codex/gpt-5.4", { userRole: "admin", sessionKey: "web-conv_test" });
  assert.equal(result.currentModel, "openai-codex/gpt-5.4");
  assert.equal(result.reset, false);
});

test("/think updates current chat session only", async () => {
  const changed = await executeNativeCommand("/think high", { userRole: "admin", sessionKey: "web-conv_test" });
  assert.match(changed?.reply ?? "", /현재 채팅의 thinking override를 변경했습니다/);
  assert.match(changed?.reply ?? "", /현재 채팅 thinking: high/);

  const current = await executeNativeCommand("/think", { userRole: "admin", sessionKey: "web-conv_test" });
  assert.match(current?.reply ?? "", /현재 채팅 thinking: high/);

  const reset = await executeNativeCommand("/think auto", { userRole: "admin", sessionKey: "web-conv_test" });
  assert.match(reset?.reply ?? "", /현재 채팅의 thinking override를 해제했습니다/);
  assert.match(reset?.reply ?? "", /현재 채팅 thinking: medium/);
});

test("applyNativeThinkingSelection updates and resets session thinking override", async () => {
  const result = await applyNativeThinkingSelection("xhigh", { userRole: "admin", sessionKey: "web-conv_test" });
  assert.equal(result.currentThinking, "xhigh");
  assert.equal(result.reset, false);

  const reset = await applyNativeThinkingSelection("default", { userRole: "admin", sessionKey: "web-conv_test" });
  assert.equal(reset.currentThinking, "medium");
  assert.equal(reset.reset, true);

  await assert.rejects(() => applyNativeThinkingSelection("turbo", { userRole: "admin", sessionKey: "web-conv_test" }), /thinking 값은/);
});

test("applyNativeThinkingSelection accepts GPT-5.6 extended thinking levels", async () => {
  for (const level of ["xhigh", "max", "ultra"]) {
    const result = await applyNativeThinkingSelection(level, { userRole: "admin", sessionKey: "web-conv_test" });
    assert.equal(result.currentThinking, level);
    assert.equal(result.reset, false);
  }
  setSessionThinkingOverride("web-conv_test", null);
});

test("applyNativeSpeedSelection persists Standard and Fast for the current OpenAI session", async () => {
  const fast = await applyNativeSpeedSelection("fast", { userRole: "admin", sessionKey: "web-conv_test" });
  assert.equal(fast.currentSpeed, "fast");
  assert.equal(fast.speedSupported, true);
  assert.equal(getSessionFastMode("web-conv_test"), true);

  const standard = await applyNativeSpeedSelection("standard", { userRole: "admin", sessionKey: "web-conv_test" });
  assert.equal(standard.currentSpeed, "standard");
  assert.equal(getSessionFastMode("web-conv_test"), false);
  await assert.rejects(() => applyNativeSpeedSelection("turbo", { userRole: "admin", sessionKey: "web-conv_test" }), /Speed 값은/);
});

test("switching to a non-OpenAI model disables Speed and forces Standard", async () => {
  setSessionFastMode("web-conv_test", true);
  await applyNativeModelSelection("llamacpp/Qwen3.6-27B-MTP", { userRole: "admin", sessionKey: "web-conv_test" });

  const menu = await getNativeModelMenu({ userRole: "admin", sessionKey: "web-conv_test" });
  assert.equal(menu.speedSupported, false);
  assert.equal(menu.currentSpeed, "standard");
  assert.equal(getSessionFastMode("web-conv_test"), false);
  await assert.rejects(() => applyNativeSpeedSelection("fast", { userRole: "admin", sessionKey: "web-conv_test" }), /OpenAI 모델에서만/);

  await applyNativeModelSelection("default", { userRole: "admin", sessionKey: "web-conv_test" });
});

test("ensureSessionEntry does not create explicit-session aliases", () => {
  const sessionKey = "web-conv_precreated";
  ensureSessionEntry(sessionKey);

  let store = JSON.parse(readFileSync(process.env.OPENCLAW_SESSION_STORE_PATH!, "utf8")) as Record<string, { thinkingLevel?: string }>;
  assert.ok(store[sessionKey]);
  assert.equal(store[`agent:main:explicit:${sessionKey}`], undefined);

  setSessionThinkingOverride(sessionKey, "medium");
  store = JSON.parse(readFileSync(process.env.OPENCLAW_SESSION_STORE_PATH!, "utf8")) as Record<string, { thinkingLevel?: string }>;
  assert.equal(store[sessionKey]?.thinkingLevel, "medium");
  assert.equal(getSessionThinkingOverride(sessionKey), "medium");
});

test("new PWA sessions initialize Speed to Standard", () => {
  const sessionKey = "pwa-webchat:conv_speed_default";
  ensureSessionEntry(sessionKey);
  assert.equal(ensureSessionStandardSpeed(sessionKey), false);

  const store = JSON.parse(readFileSync(process.env.OPENCLAW_SESSION_STORE_PATH!, "utf8")) as Record<string, { fastMode?: boolean }>;
  assert.equal(store[sessionKey]?.fastMode, false);
});
