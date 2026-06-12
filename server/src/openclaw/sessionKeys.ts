export function scopedOpenClawSessionKey(sessionKey: string, agentId = process.env.OPENCLAW_AGENT ?? "main"): string {
  const trimmed = sessionKey.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed === "global" || trimmed.startsWith("agent:")) {
    return trimmed;
  }
  return `agent:${agentId}:${trimmed}`;
}

export function openClawSessionKeyCandidates(sessionKey: string, agentId = process.env.OPENCLAW_AGENT ?? "main"): string[] {
  const trimmed = sessionKey.trim();
  if (!trimmed) {
    return [];
  }
  const candidates = [
    scopedOpenClawSessionKey(trimmed, agentId),
    trimmed,
    `agent:${agentId}:explicit:${trimmed}`,
    `agent:${agentId}:legacy:${trimmed}`,
  ];
  return [...new Set(candidates.filter(Boolean))];
}

export function pwaConversationSessionIdFromGatewayKey(sessionKey: string, agentId = process.env.OPENCLAW_AGENT ?? "main"): string | null {
  const trimmed = sessionKey.trim();
  const prefix = `agent:${agentId}:`;
  const unscoped = trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed;
  const normalized = unscoped.startsWith("explicit:") || unscoped.startsWith("legacy:")
    ? unscoped.slice(unscoped.indexOf(":") + 1)
    : unscoped;
  return normalized.startsWith("web-conv_") ? normalized : null;
}
