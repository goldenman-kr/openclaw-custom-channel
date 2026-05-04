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

function readSessionEntry(sessionKey?: string): { targetKey: string; entry: SessionStoreEntry; store: Record<string, SessionStoreEntry> } | null {
  if (!sessionKey?.trim()) return null;
  const trimmedSessionKey = sessionKey.trim();
  const store = readSessionStore();
  const targetKey = sessionKeyCandidates(trimmedSessionKey).find((key) => store[key]) ?? `agent:${process.env.OPENCLAW_AGENT ?? "main"}:${trimmedSessionKey}`;
  return { targetKey, entry: { ...(store[targetKey] ?? {}) }, store };
}

export function getSessionModelOverride(sessionKey?: string): string | null {
  const resolved = readSessionEntry(sessionKey);
  if (!resolved) return null;
  const provider = typeof resolved.entry.providerOverride === "string" ? resolved.entry.providerOverride.trim() : "";
  const model = typeof resolved.entry.modelOverride === "string" ? resolved.entry.modelOverride.trim() : "";
  return provider && model ? `${provider}/${model}` : null;
}

export function getSessionThinkingOverride(sessionKey?: string): string | null {
  const resolved = readSessionEntry(sessionKey);
  if (!resolved) return null;
  const thinking = typeof resolved.entry.thinkingLevel === "string" ? resolved.entry.thinkingLevel.trim() : "";
  return thinking || null;
}

export function setSessionModelOverride(sessionKey: string, modelRef: string | null): string | null {
  const resolved = readSessionEntry(sessionKey);
  if (!resolved) {
    throw new Error("sessionKey is required");
  }
  const { targetKey, entry, store } = resolved;
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

export function setSessionThinkingOverride(sessionKey: string, level: string | null): string | null {
  const resolved = readSessionEntry(sessionKey);
  if (!resolved) {
    throw new Error("sessionKey is required");
  }
  const { targetKey, entry, store } = resolved;
  const normalized = level?.trim() ?? "";
  if (normalized) {
    entry.thinkingLevel = normalized;
  } else {
    delete entry.thinkingLevel;
  }
  entry.updatedAt = Date.now();
  store[targetKey] = entry;
  writeSessionStore(store);
  return typeof entry.thinkingLevel === "string" && entry.thinkingLevel.trim() ? entry.thinkingLevel.trim() : null;
}

export function activeGatewayModel(defaultModel = process.env.OPENCLAW_GATEWAY_MODEL ?? "openclaw"): string {
  return defaultModel;
}
