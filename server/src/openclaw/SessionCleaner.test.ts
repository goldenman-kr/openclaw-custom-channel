import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { deleteOpenClawSession } from "./SessionCleaner.js";

function tempStateDir(): string {
  return mkdtempSync(join(tmpdir(), "openclaw-session-cleaner-"));
}

test("deletes legacy and native PWA session key candidates for a conversation", async () => {
  const stateDir = tempStateDir();
  const sessionsDir = join(stateDir, "agents", "main", "sessions");
  await mkdir(sessionsDir, { recursive: true });
  const sessionsJsonPath = join(sessionsDir, "sessions.json");
  const legacySessionFile = join(sessionsDir, "legacy-session.jsonl");
  const nativeSessionFile = join(sessionsDir, "native-session.jsonl");
  await writeFile(legacySessionFile, "legacy");
  await writeFile(nativeSessionFile, "native");
  await writeFile(join(sessionsDir, "native-session.trajectory.jsonl"), "trajectory");
  writeFileSync(
    sessionsJsonPath,
    JSON.stringify(
      {
        "agent:main:web-conv_test": { sessionId: "legacy-session", sessionFile: legacySessionFile },
        "agent:main:pwa-webchat:conv_test": { sessionId: "native-session", sessionFile: nativeSessionFile },
        "agent:main:telegram:chat-test": { sessionId: "telegram-session" },
      },
      null,
      2,
    ),
  );

  const result = await deleteOpenClawSession({
    explicitSessionId: "web-conv_test",
    explicitSessionIds: ["pwa-webchat:conv_test"],
    stateDir,
  });

  const remaining = JSON.parse(readFileSync(sessionsJsonPath, "utf8")) as Record<string, unknown>;
  assert.equal(result.removedSessionIndex, true);
  assert.equal(result.removedSessionIndexes, 2);
  assert.equal(remaining["agent:main:web-conv_test"], undefined);
  assert.equal(remaining["agent:main:pwa-webchat:conv_test"], undefined);
  assert.ok(remaining["agent:main:telegram:chat-test"]);
  assert.equal(existsSync(legacySessionFile), false);
  assert.equal(existsSync(nativeSessionFile), false);
  assert.equal(existsSync(join(sessionsDir, "native-session.trajectory.jsonl")), false);

  rmSync(stateDir, { recursive: true, force: true });
});
