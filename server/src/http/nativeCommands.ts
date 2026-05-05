import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { activeGatewayModel, getSessionModelOverride, getSessionThinkingOverride, setSessionModelOverride, setSessionThinkingOverride } from "../openclaw/modelOverride.js";

const execFileAsync = promisify(execFile);

export interface NativeCommandResult {
  reply: string;
}

export interface NativeCommandContext {
  userLabel?: string;
  userRole?: string;
  sessionKey?: string;
}

interface OpenClawDirectStatusResult {
  text?: string;
}

interface OpenClawDirectStatusModule {
  resolveDirectStatusReplyForSession?: (params: {
    sessionKey: string;
    cfg: Record<string, unknown>;
    channel: string;
    senderIsOwner: boolean;
    isAuthorizedSender: boolean;
    senderId?: string;
    isGroup: boolean;
    defaultGroupActivation?: string;
  }) => Promise<OpenClawDirectStatusResult | string | undefined>;
}

let openClawDirectStatusRuntimePromise: Promise<OpenClawDirectStatusModule | null> | null = null;

function commandParts(message: string): string[] {
  return message.trim().split(/\s+/).filter(Boolean);
}

export function isNativeCommand(message: string): boolean {
  const command = commandParts(message)[0]?.toLowerCase();
  return command === "/health" || command === "/status" || command === "/models" || command === "/model" || command === "/think" || command === "/thinking" || command === "/t";
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
      return { reply: await nativeModels(context) };
    case "/model":
      return { reply: await nativeModel(parts.slice(1).join(" "), context) };
    case "/think":
    case "/thinking":
    case "/t":
      return { reply: await nativeThink(parts.slice(1).join(" "), context) };
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
  return await buildOpenClawRuntimeStatus(context) ?? await buildSessionStatusCard(context) ?? await nativeFallbackStatus(context);
}

async function importOpenClawDirectStatusRuntime(): Promise<OpenClawDirectStatusModule | null> {
  openClawDirectStatusRuntimePromise ??= (async () => {
    try {
      const explicitPath = process.env.OPENCLAW_DIRECT_STATUS_RUNTIME_PATH?.trim();
      if (explicitPath) {
        return await import(pathToFileURL(resolve(explicitPath)).href) as OpenClawDirectStatusModule;
      }
      const distDir = openClawDistDir();
      const file = readdirSync(distDir).find((name) => name.startsWith("command-status.runtime-") && name.endsWith(".js"));
      if (!file) return null;
      return await import(pathToFileURL(join(distDir, file)).href) as OpenClawDirectStatusModule;
    } catch {
      return null;
    }
  })();
  return openClawDirectStatusRuntimePromise;
}

async function buildOpenClawRuntimeStatus(context: NativeCommandContext): Promise<string | null> {
  const sessionKey = context.sessionKey?.trim();
  if (!sessionKey) return null;
  const timeoutMs = Number(process.env.NATIVE_STATUS_OPENCLAW_TIMEOUT_MS ?? 3_000);
  try {
    const statusRuntime = await importOpenClawDirectStatusRuntime();
    const resolveDirectStatusReplyForSession = statusRuntime?.resolveDirectStatusReplyForSession;
    if (!resolveDirectStatusReplyForSession) return null;
    const result = await withTimeout(
      resolveDirectStatusReplyForSession({
        sessionKey,
        cfg: {},
        channel: "web",
        senderIsOwner: context.userRole === "admin",
        isAuthorizedSender: true,
        senderId: context.userLabel,
        isGroup: false,
      }),
      Math.max(500, timeoutMs),
      undefined,
    );
    if (typeof result === "string") return result.trim() || null;
    return result?.text?.trim() || null;
  } catch {
    return null;
  }
}

async function nativeFallbackStatus(context: NativeCommandContext): Promise<string> {
  const service = await systemctlIsActive("openclaw-custom-channel.service");
  const selectedModel = await resolveSessionSelectedModel(context.sessionKey);
  const override = getSessionModelOverride(context.sessionKey);
  return [
    "📊 Web/PWA native status",
    `- user: ${context.userLabel || "unknown"}`,
    `- custom channel service: ${service}`,
    `- transport: ${process.env.OPENCLAW_TRANSPORT ?? "agent"}`,
    `- gateway routing model: ${activeGatewayModel()}`,
    `- session model: ${selectedModel}`,
    `- session override: ${override ?? "none"}`,
    `- node env: ${process.env.NODE_ENV ?? "development"}`,
  ].join("\n");
}

interface SessionStoreEntry {
  updatedAt?: number;
  contextTokens?: number;
  providerOverride?: string;
  modelOverride?: string;
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

interface ProviderUsageWindow {
  label: string;
  usedPercent: number;
  resetAt?: number;
}

interface ProviderUsageEntry {
  error?: string;
  windows: ProviderUsageWindow[];
}

interface ProviderUsageModule {
  loadProviderUsageSummary?: (opts: { timeoutMs?: number; providers?: string[]; agentDir?: string }) => Promise<{ providers: ProviderUsageEntry[] }>;
  formatUsageWindowSummary?: (entry: ProviderUsageEntry, opts: { now?: number; maxWindows?: number; includeResets?: boolean }) => string | null;
  resolveUsageProviderId?: (provider?: string) => string | undefined;
  t?: (opts: { timeoutMs?: number; providers?: string[]; agentDir?: string }) => Promise<{ providers: ProviderUsageEntry[] }>;
  i?: (entry: ProviderUsageEntry, opts: { now?: number; maxWindows?: number; includeResets?: boolean }) => string | null;
  o?: (provider?: string) => string | undefined;
}

function openClawDistDir(): string {
  return resolve(process.env.OPENCLAW_DIST_DIR ?? `${homedir()}/.npm-global/lib/node_modules/openclaw/dist`);
}

const PROVIDER_USAGE_TIMEOUT_MS = Number(process.env.NATIVE_STATUS_USAGE_TIMEOUT_MS ?? 1_500);
const PROVIDER_USAGE_CACHE_TTL_MS = Number(process.env.NATIVE_STATUS_USAGE_CACHE_TTL_MS ?? 60_000);
let providerUsageRuntimePromise: Promise<ProviderUsageModule | null> | null = null;
const providerUsageLineCache = new Map<string, { expiresAt: number; line: string | null }>();
const providerUsageLineInflight = new Set<string>();

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(fallback), timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function importProviderUsageRuntime(): Promise<ProviderUsageModule | null> {
  providerUsageRuntimePromise ??= (async () => {
    try {
      const distDir = openClawDistDir();
      const files = readdirSync(distDir).filter((name) => name.startsWith("provider-usage-") && name.endsWith(".js"));
      for (const file of files) {
        const module = await import(pathToFileURL(join(distDir, file)).href) as ProviderUsageModule;
        if (module.loadProviderUsageSummary && module.formatUsageWindowSummary && module.resolveUsageProviderId) {
          return module;
        }
      }
      for (const file of files) {
        const module = await import(pathToFileURL(join(distDir, file)).href) as ProviderUsageModule;
        if (module.t?.name === "loadProviderUsageSummary" && module.i?.name === "formatUsageWindowSummary") {
          const sharedFile = readdirSync(distDir).find((name) => name.startsWith("provider-usage.shared-") && name.endsWith(".js"));
          const shared = sharedFile ? await import(pathToFileURL(join(distDir, sharedFile)).href) as ProviderUsageModule : null;
          return { ...module, resolveUsageProviderId: shared?.o };
        }
      }
    } catch {
      return null;
    }
    return null;
  })();
  return providerUsageRuntimePromise;
}

async function refreshProviderUsageLine(provider: string | undefined, cacheKey: string): Promise<void> {
  if (providerUsageLineInflight.has(cacheKey)) return;
  providerUsageLineInflight.add(cacheKey);
  try {
    const line = await withTimeout((async () => {
      const usage = await importProviderUsageRuntime();
      const resolveUsageProviderId = usage?.resolveUsageProviderId ?? usage?.o;
      const loadProviderUsageSummary = usage?.loadProviderUsageSummary ?? usage?.t;
      const formatUsageWindowSummary = usage?.formatUsageWindowSummary ?? usage?.i;
      const usageProvider = resolveUsageProviderId?.(provider);
      if (!usageProvider || !loadProviderUsageSummary || !formatUsageWindowSummary) return null;

      try {
        const summary = await loadProviderUsageSummary({
          timeoutMs: Math.max(500, PROVIDER_USAGE_TIMEOUT_MS - 250),
          providers: [usageProvider],
          agentDir: resolve(process.env.OPENCLAW_AGENT_DIR ?? `${homedir()}/.openclaw/agents/main`),
        });
        const entry = summary.providers[0];
        if (!entry || entry.error || entry.windows.length === 0) return null;
        const summaryLine = formatUsageWindowSummary(entry, { now: Date.now(), maxWindows: 2, includeResets: true });
        return summaryLine ? `📊 Usage: ${summaryLine}` : null;
      } catch {
        return null;
      }
    })(), Math.max(250, PROVIDER_USAGE_TIMEOUT_MS), null);
    providerUsageLineCache.set(cacheKey, { expiresAt: Date.now() + PROVIDER_USAGE_CACHE_TTL_MS, line });
  } finally {
    providerUsageLineInflight.delete(cacheKey);
  }
}

async function formatProviderUsageLine(provider?: string): Promise<string | null> {
  const cacheKey = provider || "default";
  const cached = providerUsageLineCache.get(cacheKey);
  if (!cached || cached.expiresAt <= Date.now()) {
    void refreshProviderUsageLine(provider, cacheKey);
  }
  return cached?.line ?? null;
}

async function buildSessionStatusCard(context: NativeCommandContext): Promise<string | null> {
  const resolved = readSessionEntry(context.sessionKey);
  if (!resolved) return null;
  const entry = resolved.entry;
  const selected = await resolveSessionSelectedModel(context.sessionKey, entry);
  const provider = selected.split("/")[0] || "unknown";
  const usageLine = await formatProviderUsageLine(provider);
  const lines = [
    openClawVersionLine(),
    `🧠 Model: ${selected}`,
    "🔄 Fallbacks: openai-codex/gpt-5.4, llamacpp/Qwen3.6-35B-A3B",
    usageLine,
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

interface OpenClawConfig {
  models?: { providers?: Record<string, OpenClawConfigProvider> };
  model?: { primary?: string; fallbacks?: string[] };
  agents?: {
    defaults?: {
      models?: Record<string, unknown>;
      model?: { primary?: string; fallbacks?: string[] };
    };
  };
}

async function loadOpenClawConfig(): Promise<OpenClawConfig> {
  const configPath = resolve(process.env.OPENCLAW_CONFIG_PATH ?? `${homedir()}/.openclaw/openclaw.json`);
  const raw = await readFile(configPath, "utf8");
  return JSON.parse(raw) as OpenClawConfig;
}

async function loadConfiguredModels(): Promise<string[]> {
  const config = await loadOpenClawConfig();
  const defaultModels = config.agents?.defaults?.models ?? {};
  const names = Object.keys(defaultModels)
    .map((name) => String(name).trim())
    .filter(Boolean);

  if (names.length > 0) {
    return [...new Set(names)].sort();
  }

  const fallbackNames = [
    config.agents?.defaults?.model?.primary,
    ...(config.agents?.defaults?.model?.fallbacks ?? []),
    config.model?.primary,
    ...(config.model?.fallbacks ?? []),
  ].map((name) => String(name || '').trim()).filter(Boolean);

  return [...new Set(fallbackNames)].sort();
}

async function defaultConfiguredModel(): Promise<string> {
  const config = await loadOpenClawConfig();
  return config.agents?.defaults?.model?.primary?.trim()
    || config.model?.primary?.trim()
    || "openai-codex/gpt-5.4";
}

async function resolveSessionSelectedModel(sessionKey?: string, entry?: SessionStoreEntry): Promise<string> {
  const resolved = entry ? { key: sessionKey ?? "", entry } : readSessionEntry(sessionKey);
  const providerOverride = resolved?.entry.providerOverride?.trim();
  const modelOverride = resolved?.entry.modelOverride?.trim();
  if (providerOverride && modelOverride) {
    return `${providerOverride}/${modelOverride}`;
  }
  const runtimeProvider = resolved?.entry.modelProvider?.trim();
  const runtimeModel = resolved?.entry.model?.trim();
  if (runtimeProvider && runtimeModel) {
    return `${runtimeProvider}/${runtimeModel}`;
  }
  if (runtimeModel?.includes("/")) {
    return runtimeModel;
  }
  return await defaultConfiguredModel().catch(() => "openai-codex/gpt-5.4");
}

export interface NativeModelMenuEntry {
  ref: string;
  label: string;
  selected: boolean;
}

export interface NativeThinkingMenuEntry {
  ref: string;
  label: string;
  selected: boolean;
}

export interface NativeModelMenuState {
  currentModel: string;
  gatewayModel: string;
  currentThinking: string;
  canChange: boolean;
  models: NativeModelMenuEntry[];
  thinkingLevels: NativeThinkingMenuEntry[];
}

function modelLabel(modelRef: string): string {
  const slash = modelRef.indexOf("/");
  return slash >= 0 ? modelRef.slice(slash + 1) : modelRef;
}

export async function getNativeModelMenu(context: NativeCommandContext): Promise<NativeModelMenuState> {
  const currentModel = await resolveSessionSelectedModel(context.sessionKey);
  const currentThinking = resolveSessionThinkingLevel(context.sessionKey);
  const configuredModels = await loadConfiguredModels().catch(() => [] as string[]);
  const refs = [...new Set([...(configuredModels.length > 0 ? configuredModels : []), currentModel].filter(Boolean))];
  const thinkingLevels = ["off", "low", "medium", "high"];
  return {
    currentModel,
    gatewayModel: activeGatewayModel(),
    currentThinking,
    canChange: context.userRole === "admin",
    models: refs.map((ref) => ({
      ref,
      label: modelLabel(ref),
      selected: ref === currentModel,
    })),
    thinkingLevels: thinkingLevels.map((ref) => ({
      ref,
      label: ref,
      selected: ref === currentThinking,
    })),
  };
}

async function nativeModels(context: NativeCommandContext): Promise<string> {
  try {
    const menu = await getNativeModelMenu(context);
    const list = menu.models.length > 0 ? menu.models.map((model) => `${model.selected ? "*" : "-"} ${model.ref}`).join("\n") : "(설정된 모델 목록을 찾지 못했습니다.)";
    return [`🧠 사용 가능 모델`, `현재 채팅 모델: ${menu.currentModel}`, `Gateway routing: ${menu.gatewayModel}`, "", list, "", "변경: `/model provider/model`", "기본값 복귀: `/model default`"].join("\n");
  } catch (error) {
    return [`🧠 사용 가능 모델`, `현재 채팅 모델: ${await resolveSessionSelectedModel(context.sessionKey)}`, `Gateway routing: ${activeGatewayModel()}`, "", `모델 목록을 읽지 못했습니다: ${error instanceof Error ? error.message : String(error)}`, "", "변경: `/model provider/model`"].join("\n");
  }
}

function isSafeModelName(model: string): boolean {
  return /^[A-Za-z0-9._~:+/-]+$/.test(model) && model.includes("/") && model.length <= 160;
}

function resolveSessionThinkingLevel(sessionKey?: string): string {
  return getSessionThinkingOverride(sessionKey) ?? process.env.OPENCLAW_THINKING ?? "medium";
}

function normalizeThinkingLevel(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (["default", "reset", "clear", "auto"].includes(normalized)) {
    return "";
  }
  if (["off", "minimal", "low", "medium", "high", "xhigh", "adaptive", "max"].includes(normalized)) {
    return normalized;
  }
  return null;
}

export interface ApplyNativeModelSelectionResult {
  currentModel: string;
  warning?: string;
  reset: boolean;
}

export interface ApplyNativeThinkingSelectionResult {
  currentThinking: string;
  reset: boolean;
}

export async function applyNativeModelSelection(requestedModel: string, context: NativeCommandContext): Promise<ApplyNativeModelSelectionResult> {
  const requested = requestedModel.trim();
  if (context.userRole !== "admin") {
    throw new Error("❌ 모델 변경은 관리자만 할 수 있습니다. 현재 채팅 모델 확인만 허용됩니다.");
  }

  if (!context.sessionKey?.trim()) {
    throw new Error("❌ 현재 채팅의 세션 키를 확인할 수 없어 모델을 변경할 수 없습니다.");
  }

  if (["default", "reset", "clear"].includes(requested.toLowerCase())) {
    setSessionModelOverride(context.sessionKey, null);
    return {
      currentModel: await resolveSessionSelectedModel(context.sessionKey),
      reset: true,
    };
  }

  if (!isSafeModelName(requested)) {
    throw new Error("❌ 모델명은 `provider/model` 형식이어야 합니다. 예: `/model openai-codex/gpt-5.5`");
  }

  const configuredModels: string[] = await loadConfiguredModels().catch(() => [] as string[]);
  const warning = configuredModels.length > 0 && !configuredModels.includes(requested)
    ? "⚠️ 설정 파일의 모델 목록에는 없는 이름입니다. 그래도 현재 채팅 override로 저장했습니다."
    : "";
  setSessionModelOverride(context.sessionKey, requested);
  return {
    currentModel: await resolveSessionSelectedModel(context.sessionKey),
    warning,
    reset: false,
  };
}

async function nativeModel(arg: string, context: NativeCommandContext): Promise<string> {
  const requested = arg.trim();
  const currentModel = await resolveSessionSelectedModel(context.sessionKey);
  if (!requested) {
    return [
      `현재 채팅 모델: ${currentModel}`,
      `Gateway routing: ${activeGatewayModel()}`,
      context.userRole === "admin" ? "변경하려면 `/model provider/model` 형식으로 입력하세요." : "모델 변경은 관리자만 할 수 있습니다.",
      context.userRole === "admin" ? "기본값으로 되돌리려면 `/model default`를 입력하세요." : "",
    ].filter(Boolean).join("\n");
  }

  try {
    const result = await applyNativeModelSelection(requested, context);
    if (result.reset) {
      return `✅ 현재 채팅의 모델 override를 해제했습니다.\n현재 채팅 모델: ${result.currentModel}`;
    }
    return `✅ 현재 채팅의 모델 override를 변경했습니다.\n현재 채팅 모델: ${result.currentModel}${result.warning ? `\n\n${result.warning}` : ""}`;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export async function applyNativeThinkingSelection(requestedLevel: string, context: NativeCommandContext): Promise<ApplyNativeThinkingSelectionResult> {
  const requested = requestedLevel.trim();
  if (!context.sessionKey?.trim()) {
    throw new Error("❌ 현재 채팅의 세션 키를 확인할 수 없어 thinking을 변경할 수 없습니다.");
  }

  const normalized = normalizeThinkingLevel(requested);
  if (normalized === null) {
    throw new Error("❌ thinking 값은 `off|minimal|low|medium|high|xhigh|adaptive|max` 중 하나여야 합니다. 기본값 복귀는 `/think auto` 또는 `/think default`를 사용하세요.");
  }

  if (normalized) {
    setSessionThinkingOverride(context.sessionKey, normalized);
    return {
      currentThinking: resolveSessionThinkingLevel(context.sessionKey),
      reset: false,
    };
  }

  setSessionThinkingOverride(context.sessionKey, null);
  return {
    currentThinking: resolveSessionThinkingLevel(context.sessionKey),
    reset: true,
  };
}

async function nativeThink(arg: string, context: NativeCommandContext): Promise<string> {
  const requested = arg.trim();
  const currentThinking = resolveSessionThinkingLevel(context.sessionKey);
  if (!requested) {
    return [
      `현재 채팅 thinking: ${currentThinking}`,
      "변경하려면 `/think low|medium|high|xhigh|adaptive|max|off` 형식으로 입력하세요.",
      "기본값으로 되돌리려면 `/think auto`를 입력하세요.",
    ].join("\n");
  }

  try {
    const result = await applyNativeThinkingSelection(requested, context);
    if (result.reset) {
      return `✅ 현재 채팅의 thinking override를 해제했습니다.\n현재 채팅 thinking: ${result.currentThinking}`;
    }
    return `✅ 현재 채팅의 thinking override를 변경했습니다.\n현재 채팅 thinking: ${result.currentThinking}`;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
