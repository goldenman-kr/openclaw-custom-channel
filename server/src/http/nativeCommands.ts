import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { activeGatewayModel, getModelOverride, setModelOverride } from "../openclaw/modelOverride.js";

const execFileAsync = promisify(execFile);

export interface NativeCommandResult {
  reply: string;
}

interface NativeCommandContext {
  userLabel?: string;
}

function commandParts(message: string): string[] {
  return message.trim().split(/\s+/).filter(Boolean);
}

export function isNativeCommand(message: string): boolean {
  const command = commandParts(message)[0]?.toLowerCase();
  return command === "/health" || command === "/status" || command === "/models" || command === "/model";
}

export async function executeNativeCommand(message: string, context: NativeCommandContext = {}): Promise<NativeCommandResult | null> {
  const parts = commandParts(message);
  const command = parts[0]?.toLowerCase();
  if (!command) {
    return null;
  }

  switch (command) {
    case "/health":
      return { reply: await nativeHealth() };
    case "/status":
      return { reply: await nativeStatus(context) };
    case "/models":
      return { reply: await nativeModels() };
    case "/model":
      return { reply: await nativeModel(parts.slice(1).join(" ")) };
    default:
      return null;
  }
}

async function systemctlIsActive(service: string): Promise<string> {
  try {
    const result = await execFileAsync("systemctl", ["--user", "is-active", service], { timeout: 2_000 });
    return result.stdout.trim() || "unknown";
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    const stdout = (error as { stdout?: string }).stdout?.trim();
    return stdout || stderr || "unknown";
  }
}

async function nativeHealth(): Promise<string> {
  const service = await systemctlIsActive("openclaw-custom-channel.service");
  return [
    "✅ Web/PWA native health",
    `- custom channel: ${service}`,
    `- transport: ${process.env.OPENCLAW_TRANSPORT ?? "agent"}`,
    `- active model: ${activeGatewayModel()}`,
    `- gateway url: ${process.env.OPENCLAW_GATEWAY_URL ?? "http://127.0.0.1:18789"}`,
  ].join("\n");
}

async function nativeStatus(context: NativeCommandContext): Promise<string> {
  const service = await systemctlIsActive("openclaw-custom-channel.service");
  const override = getModelOverride();
  return [
    "📊 Web/PWA native status",
    `- user: ${context.userLabel || "unknown"}`,
    `- custom channel service: ${service}`,
    `- transport: ${process.env.OPENCLAW_TRANSPORT ?? "agent"}`,
    `- active model: ${activeGatewayModel()}`,
    `- model override: ${override ?? "none"}`,
    `- node env: ${process.env.NODE_ENV ?? "development"}`,
  ].join("\n");
}

interface OpenClawConfigModel {
  id?: string;
  name?: string;
  label?: string;
}

interface OpenClawConfigProvider {
  models?: OpenClawConfigModel[];
}

async function loadConfiguredModels(): Promise<string[]> {
  const configPath = resolve(process.env.OPENCLAW_CONFIG_PATH ?? `${homedir()}/.openclaw/openclaw.json`);
  const raw = await readFile(configPath, "utf8");
  const config = JSON.parse(raw) as { models?: { providers?: Record<string, OpenClawConfigProvider> } };
  const providers = config.models?.providers ?? {};
  const names: string[] = [];
  for (const [providerId, provider] of Object.entries(providers)) {
    for (const model of provider.models ?? []) {
      const modelId = model.id ?? model.name ?? model.label;
      if (modelId) {
        names.push(`${providerId}/${modelId}`);
      }
    }
  }
  return [...new Set(names)].sort();
}

async function nativeModels(): Promise<string> {
  try {
    const models = await loadConfiguredModels();
    const active = activeGatewayModel();
    const list = models.length > 0 ? models.map((model) => `${model === active ? "*" : "-"} ${model}`).join("\n") : "(설정된 모델 목록을 찾지 못했습니다.)";
    return [`🧠 사용 가능 모델`, `현재: ${active}`, "", list, "", "변경: `/model provider/model`", "기본값 복귀: `/model default`"].join("\n");
  } catch (error) {
    return [`🧠 사용 가능 모델`, `현재: ${activeGatewayModel()}`, "", `모델 목록을 읽지 못했습니다: ${error instanceof Error ? error.message : String(error)}`, "", "변경: `/model provider/model`"].join("\n");
  }
}

function isSafeModelName(model: string): boolean {
  return /^[A-Za-z0-9._~:+/-]+$/.test(model) && model.includes("/") && model.length <= 160;
}

async function nativeModel(arg: string): Promise<string> {
  const requested = arg.trim();
  if (!requested) {
    return [`현재 모델: ${activeGatewayModel()}`, "변경하려면 `/model provider/model` 형식으로 입력하세요.", "기본값으로 되돌리려면 `/model default`를 입력하세요."].join("\n");
  }

  if (["default", "reset", "clear"].includes(requested.toLowerCase())) {
    setModelOverride(null);
    return `✅ 모델 override를 해제했습니다. 현재 모델: ${activeGatewayModel()}`;
  }

  if (!isSafeModelName(requested)) {
    return "❌ 모델명은 `provider/model` 형식이어야 합니다. 예: `/model openai-codex/gpt-5.5`";
  }

  const configuredModels: string[] = await loadConfiguredModels().catch(() => [] as string[]);
  const warning = configuredModels.length > 0 && !configuredModels.includes(requested)
    ? "\n\n⚠️ 설정 파일의 모델 목록에는 없는 이름입니다. 그래도 emergency override로 저장했습니다."
    : "";
  setModelOverride(requested);
  return `✅ 모델을 변경했습니다.\n현재 모델: ${activeGatewayModel()}${warning}`;
}
