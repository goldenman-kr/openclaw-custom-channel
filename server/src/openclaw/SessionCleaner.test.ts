import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { deleteOpenClawSession } from "./SessionCleaner.js";

test("deletes Gateway-scoped PWA session entries and transcript files", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "pwa-session-cleaner-"));
  const sessionsDir = join(stateDir, "agents", "main", "sessions");
  mkdirSync(sessionsDir, { recursive: true });
  const sessionFile = join(sessionsDir, "session-1.jsonl");
  const trajectoryFile = join(sessionsDir, "session-1.trajectory.jsonl");
  writeFileSync(sessionFile, "{}\n");
  writeFileSync(trajectoryFile, "{}\n");
  await writeFile(join(sessionsDir, "sessions.json"), `${JSON.stringify({
    "agent:main:web-conv_delete": {
      sessionId: "session-1",
      sessionFile,
    },
  }, null, 2)}\n`);

  const result = await deleteOpenClawSession({
    explicitSessionId: "web-conv_delete",
    agentId: "main",
    stateDir,
  });

  assert.equal(result.sessionKey, "agent:main:web-conv_delete");
  assert.equal(result.removedSessionIndex, true);
  assert.equal(result.skipped, false);
  assert.equal(result.removedFiles.includes(sessionFile), true);
  assert.equal(result.removedFiles.includes(trajectoryFile), true);

  const store = JSON.parse(await readFile(join(sessionsDir, "sessions.json"), "utf8")) as Record<string, unknown>;
  assert.equal(store["agent:main:web-conv_delete"], undefined);
});
