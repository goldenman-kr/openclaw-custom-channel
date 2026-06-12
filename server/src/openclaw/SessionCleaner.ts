import { existsSync } from "node:fs";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { openClawSessionKeyCandidates, scopedOpenClawSessionKey } from "./sessionKeys.js";

export interface SessionCleanupResult {
  sessionKey: string;
  sessionId?: string;
  removedFiles: string[];
  removedSessionIndex: boolean;
  skipped: boolean;
  error?: string;
}

interface SessionIndexEntry {
  sessionId?: unknown;
  sessionFile?: unknown;
}

export async function deleteOpenClawSession(input: {
  explicitSessionId: string;
  agentId?: string;
  stateDir?: string;
}): Promise<SessionCleanupResult> {
  const agentId = input.agentId || "main";
  const stateDir = resolve(input.stateDir ?? process.env.OPENCLAW_STATE_DIR ?? join(process.env.HOME ?? "", ".openclaw"));
  const sessionsDir = join(stateDir, "agents", agentId, "sessions");
  const sessionsJsonPath = join(sessionsDir, "sessions.json");
  const sessionKey = scopedOpenClawSessionKey(input.explicitSessionId, agentId);
  const result: SessionCleanupResult = {
    sessionKey,
    removedFiles: [],
    removedSessionIndex: false,
    skipped: false,
  };

  if (!existsSync(sessionsJsonPath)) {
    return { ...result, skipped: true };
  }

  try {
    const raw = await readFile(sessionsJsonPath, "utf8");
    const index = JSON.parse(raw) as Record<string, SessionIndexEntry>;
    const candidates = openClawSessionKeyCandidates(input.explicitSessionId, agentId);
    const entries = candidates
      .map((key) => ({ key, entry: index[key] }))
      .filter((item): item is { key: string; entry: SessionIndexEntry } => Boolean(item.entry));
    if (entries.length === 0) {
      return { ...result, skipped: true };
    }

    const primaryEntry = entries[0]?.entry;
    const sessionId = typeof primaryEntry?.sessionId === "string" ? primaryEntry.sessionId : undefined;
    result.sessionId = sessionId;

    for (const { key } of entries) {
      delete index[key];
    }
    await writeFile(sessionsJsonPath, `${JSON.stringify(index, null, 2)}\n`);
    result.removedSessionIndex = true;

    const fileCandidates = new Set<string>();
    for (const { entry } of entries) {
      const entrySessionId = typeof entry.sessionId === "string" ? entry.sessionId : undefined;
      const entrySessionFile = typeof entry.sessionFile === "string" ? entry.sessionFile : entrySessionId ? join(sessionsDir, `${entrySessionId}.jsonl`) : undefined;
      if (entrySessionFile) {
        fileCandidates.add(resolve(entrySessionFile));
      }
      if (!entrySessionId) {
        continue;
      }
      for (const name of await readdir(sessionsDir).catch(() => [])) {
        if (name === `${entrySessionId}.jsonl` || name === `${entrySessionId}.trajectory.jsonl` || name === `${entrySessionId}.trajectory-path.json` || name.startsWith(`${entrySessionId}.checkpoint.`)) {
          fileCandidates.add(join(sessionsDir, name));
        }
      }
    }

    for (const file of fileCandidates) {
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
