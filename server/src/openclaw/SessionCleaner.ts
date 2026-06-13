import { existsSync } from "node:fs";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export interface SessionCleanupResult {
  sessionKey: string;
  sessionKeys: string[];
  sessionId?: string;
  removedFiles: string[];
  removedSessionIndex: boolean;
  removedSessionIndexes: number;
  skipped: boolean;
  error?: string;
}

interface SessionIndexEntry {
  sessionId?: unknown;
  sessionFile?: unknown;
}

export async function deleteOpenClawSession(input: {
  explicitSessionId: string;
  explicitSessionIds?: string[];
  agentId?: string;
  stateDir?: string;
}): Promise<SessionCleanupResult> {
  const agentId = input.agentId || "main";
  const stateDir = resolve(input.stateDir ?? process.env.OPENCLAW_STATE_DIR ?? join(process.env.HOME ?? "", ".openclaw"));
  const sessionsDir = join(stateDir, "agents", agentId, "sessions");
  const sessionsJsonPath = join(sessionsDir, "sessions.json");
  const sessionIds = [...new Set([input.explicitSessionId, ...(input.explicitSessionIds ?? [])].map((value) => value.trim()).filter(Boolean))];
  const sessionKeys = [...new Set(sessionIds.flatMap((sessionId) => sessionKeyCandidates(agentId, sessionId)))];
  const sessionKey = sessionKeys[0] ?? `agent:${agentId}:explicit:${input.explicitSessionId}`;
  const result: SessionCleanupResult = {
    sessionKey,
    sessionKeys,
    removedFiles: [],
    removedSessionIndex: false,
    removedSessionIndexes: 0,
    skipped: false,
  };

  if (!existsSync(sessionsJsonPath)) {
    return { ...result, skipped: true };
  }

  try {
    const raw = await readFile(sessionsJsonPath, "utf8");
    const index = JSON.parse(raw) as Record<string, SessionIndexEntry>;
    const entries = sessionKeys
      .map((key) => ({ key, entry: index[key] }))
      .filter((item): item is { key: string; entry: SessionIndexEntry } => Boolean(item.entry));
    if (entries.length === 0) {
      return { ...result, skipped: true };
    }

    const sessionIdsFromEntries = new Set<string>();
    const candidates = new Set<string>();
    for (const { key, entry } of entries) {
      const sessionId = typeof entry.sessionId === "string" ? entry.sessionId : undefined;
      const sessionFile = typeof entry.sessionFile === "string" ? entry.sessionFile : sessionId ? join(sessionsDir, `${sessionId}.jsonl`) : undefined;
      if (!result.sessionId && sessionId) {
        result.sessionId = sessionId;
      }
      if (sessionId) {
        sessionIdsFromEntries.add(sessionId);
      }
      if (sessionFile) {
        candidates.add(resolve(sessionFile));
      }
      delete index[key];
    }
    await writeFile(sessionsJsonPath, `${JSON.stringify(index, null, 2)}\n`);
    result.removedSessionIndex = true;
    result.removedSessionIndexes = entries.length;

    for (const sessionId of sessionIdsFromEntries) {
      for (const name of await readdir(sessionsDir).catch(() => [])) {
        if (name === `${sessionId}.jsonl` || name === `${sessionId}.trajectory.jsonl` || name === `${sessionId}.trajectory-path.json` || name.startsWith(`${sessionId}.checkpoint.`)) {
          candidates.add(join(sessionsDir, name));
        }
      }
    }

    for (const file of candidates) {
      const resolvedFile = resolve(file);
      if (dirname(resolvedFile) !== sessionsDir) {
        continue;
      }
      await rm(resolvedFile, { force: true });
      result.removedFiles.push(resolvedFile);
    }

    return result;
  } catch (error) {
    return {
      ...result,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function sessionKeyCandidates(agentId: string, explicitSessionId: string): string[] {
  return [
    explicitSessionId,
    `agent:${agentId}:${explicitSessionId}`,
    `agent:${agentId}:explicit:${explicitSessionId}`,
    `agent:${agentId}:legacy:${explicitSessionId}`,
  ];
}
