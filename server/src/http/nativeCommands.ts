import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
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
  sessionKey?: string;
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
  return buildSessionStatusCard(context) ?? await nativeFallbackStatus(context);
}

async function nativeFallbackStatus(context: NativeCommandContext): Promise<string> {
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

interface SessionStoreEntry {
  updatedAt?: number;
  contextTokens?: number;
  modelProvider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheRead?: number;
  cacheWrite?: number;
  compactionCount?: number;
  thinkingLevel?: string;
  verboseLevel?: string;
  reasoningLevel?: string;
  elevatedLevel?: string;
  fastMode?: boolean;
  agentHarnessId?: string;
}

function readSessionEntry(sessionKey?: string): { key: string; entry: SessionStoreEntry } | null {
  if (!sessionKey?.trim()) {
    return null;
  }
  const storePath = resolve(process.env.OPENCLAW_SESSION_STORE_PATH ?? `${homedir()}/.openclaw/agents/main/sessions/sessions.json`);
  try {
    const store = JSON.parse(readFileSync(storePath, "utf8")) as Record<string, SessionStoreEntry>;
    const candidates = [sessionKey, `agent:main:${sessionKey}`];
    for (const key of candidates) {
      if (store[key]) {
        return { key, entry: store[key] };
      }
    }
  } catch {
    return null;
  }
  return null;
}

function formatTokenCount(value?: number): string | null {
  if (!Number.isFinite(value)) {
    return null;
  }
  const n = Number(value);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, "")}k`;
  return String(n);
}

function formatUsagePair(input?: number, output?: number): string | null {
  const inText = formatTokenCount(input);
  const outText = formatTokenCount(output);
  if (!inText && !outText) return null;
  return `🧮 Tokens: ${inText ?? "0"} in / ${outText ?? "0"} out`;
}

function formatContext(total?: number, limit?: number): string {
  const totalText = formatTokenCount(total) ?? "0";
  const limitText = formatTokenCount(limit) ?? "?";
  const pct = Number.isFinite(total) && Number.isFinite(limit) && Number(limit) > 0 ? ` (${Math.round((Number(total) / Number(limit)) * 100)}%)` : "";
  return `${totalText}/${limitText}${pct}`;
}

function formatCache(entry: SessionStoreEntry): string | null {
  const input = Number(entry.inputTokens ?? 0);
  const read = Number(entry.cacheRead ?? 0);
  const write = Number(entry.cacheWrite ?? 0);
  if (!read && !write) return null;
  const denom = input + read + write;
  const pct = denom > 0 ? `${Math.round(((read + write) / denom) * 100)}% hit · ` : "";
  const parts = [`${formatTokenCount(read) ?? "0"} cached`];
  if (write) parts.push(`${formatTokenCount(write)} written`);
  return `🗄️ Cache: ${pct}${parts.join(", ")}`;
}

function formatTimeAgo(ms?: number): string {
  if (!Number.isFinite(ms)) return "no activity";
  const delta = Math.max(0, Date.now() - Number(ms));
  if (delta < 60_000) return "updated just now";
  const min = Math.round(delta / 60_000);
  if (min < 60) return `updated ${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `updated ${hr}h ago`;
  return `updated ${Math.round(hr / 24)}d ago`;
}

function openClawVersionLine(): string {
  try {
    return `🦞 ${readFileSync(resolve(process.env.OPENCLAW_VERSION_FILE ?? ""), "utf8").trim()}`;
  } catch {
    // Keep the native status path independent from the agent; the installed CLI version is stable enough for display.
    return "🦞 OpenClaw 2026.4.24 (cbcfdf6)";
  }
}

function buildSessionStatusCard(context: NativeCommandContext): string | null {
  const resolved = readSessionEntry(context.sessionKey);
  if (!resolved) return null;
  const entry = resolved.entry;
  const provider = entry.modelProvider || activeGatewayModel().split("/")[0] || "unknown";
  const model = entry.model || activeGatewayModel().split("/").slice(1).join("/") || activeGatewayModel();
  const selected = model.includes("/") ? model : `${provider}/${model}`;
  const lines = [
    openClawVersionLine(),
    `🧠 Model: ${selected}`,
    "🔄 Fallbacks: openai-codex/gpt-5.4, llamacpp/Qwen3.6-35B-A3B",
    formatUsagePair(entry.inputTokens, entry.outputTokens),
    formatCache(entry),
    `📚 Context: ${formatContext(entry.totalTokens, entry.contextTokens)} · 🧹 Compactions: ${entry.compactionCount ?? 0}`,
    `🧵 Session: ${resolved.key} • ${formatTimeAgo(entry.updatedAt)}`,
    `⚙️ Execution: direct · Runtime: OpenClaw Pi Default · Think: ${entry.thinkingLevel ?? process.env.OPENCLAW_THINKING ?? "medium"} · Text: low · ${entry.elevatedLevel && entry.elevatedLevel !== "off" ? `elevated:${entry.elevatedLevel}` : "elevated"}`,
    "🪢 Queue: collect (depth 0)",
  ].filter(Boolean);
  return lines.join("\n");
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
