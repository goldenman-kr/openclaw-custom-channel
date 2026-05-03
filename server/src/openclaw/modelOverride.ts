import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

interface SessionStoreEntry {
  updatedAt?: number;
  providerOverride?: string;
  modelOverride?: string;
  modelOverrideSource?: string;
  modelProvider?: string;
  model?: string;
  contextTokens?: number;
  liveModelSwitchPending?: boolean;
  fallbackNoticeSelectedModel?: string;
  fallbackNoticeActiveModel?: string;
  fallbackNoticeReason?: string;
  [key: string]: unknown;
}

function sessionStorePath(): string {
  const agentId = process.env.OPENCLAW_AGENT ?? "main";
  return resolve(process.env.OPENCLAW_SESSION_STORE_PATH ?? `${process.env.HOME ?? ""}/.openclaw/agents/${agentId}/sessions/sessions.json`);
}

function readSessionStore(): Record<string, SessionStoreEntry> {
  try {
    return JSON.parse(readFileSync(sessionStorePath(), "utf8")) as Record<string, SessionStoreEntry>;
  } catch {
    return {};
  }
}

function writeSessionStore(store: Record<string, SessionStoreEntry>): void {
  const path = sessionStorePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`);
}

function sessionKeyCandidates(sessionKey: string): string[] {
  const trimmed = sessionKey.trim();
  const agentId = process.env.OPENCLAW_AGENT ?? "main";
  return [
    trimmed,
    `agent:${agentId}:${trimmed}`,
    `agent:${agentId}:explicit:${trimmed}`,
    `agent:${agentId}:legacy:${trimmed}`,
  ];
}

export function getSessionModelOverride(sessionKey?: string): string | null {
  if (!sessionKey?.trim()) return null;
  const store = readSessionStore();
  for (const key of sessionKeyCandidates(sessionKey)) {
    const entry = store[key];
    if (!entry) continue;
    const provider = typeof entry.providerOverride === "string" ? entry.providerOverride.trim() : "";
    const model = typeof entry.modelOverride === "string" ? entry.modelOverride.trim() : "";
    if (provider && model) {
      return `${provider}/${model}`;
    }
  }
  return null;
}

export function setSessionModelOverride(sessionKey: string, modelRef: string | null): string | null {
  const trimmedSessionKey = sessionKey.trim();
  if (!trimmedSessionKey) {
    throw new Error("sessionKey is required");
  }
  const store = readSessionStore();
  const targetKey = sessionKeyCandidates(trimmedSessionKey).find((key) => store[key]) ?? `agent:${process.env.OPENCLAW_AGENT ?? "main"}:${trimmedSessionKey}`;
  const entry = { ...(store[targetKey] ?? {}) } as SessionStoreEntry;
  const normalized = modelRef?.trim() ?? "";
  if (normalized) {
    const slash = normalized.indexOf("/");
    if (slash <= 0 || slash === normalized.length - 1) {
      throw new Error(`Invalid model ref: ${normalized}`);
    }
    entry.providerOverride = normalized.slice(0, slash);
    entry.modelOverride = normalized.slice(slash + 1);
    entry.modelOverrideSource = "user";
    entry.liveModelSwitchPending = true;
  } else {
    delete entry.providerOverride;
    delete entry.modelOverride;
    delete entry.modelOverrideSource;
    delete entry.liveModelSwitchPending;
  }
  delete entry.model;
  delete entry.modelProvider;
  delete entry.contextTokens;
  delete entry.fallbackNoticeSelectedModel;
  delete entry.fallbackNoticeActiveModel;
  delete entry.fallbackNoticeReason;
  entry.updatedAt = Date.now();
  store[targetKey] = entry;
  writeSessionStore(store);
  return entry.providerOverride && entry.modelOverride ? `${entry.providerOverride}/${entry.modelOverride}` : null;
}

export function activeGatewayModel(defaultModel = process.env.OPENCLAW_GATEWAY_MODEL ?? "openclaw"): string {
  return defaultModel;
}
