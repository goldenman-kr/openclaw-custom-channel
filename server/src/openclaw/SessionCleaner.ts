import { existsSync } from "node:fs";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

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
  const sessionKey = `agent:${agentId}:explicit:${input.explicitSessionId}`;
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
    const entry = index[sessionKey];
    if (!entry) {
      return { ...result, skipped: true };
    }

    const sessionId = typeof entry.sessionId === "string" ? entry.sessionId : undefined;
    const sessionFile = typeof entry.sessionFile === "string" ? entry.sessionFile : sessionId ? join(sessionsDir, `${sessionId}.jsonl`) : undefined;
    result.sessionId = sessionId;

    delete index[sessionKey];
    await writeFile(sessionsJsonPath, `${JSON.stringify(index, null, 2)}\n`);
    result.removedSessionIndex = true;

    const candidates = new Set<string>();
    if (sessionFile) {
      candidates.add(resolve(sessionFile));
    }
    if (sessionId) {
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
