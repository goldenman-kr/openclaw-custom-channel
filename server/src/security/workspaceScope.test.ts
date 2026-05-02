import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveAllowedWorkspacePath } from "./workspaceScope.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "openclaw-workspace-scope-"));
}

test("allows reads in user and common workspace dirs only", async () => {
  const dir = tempDir();
  try {
    const workspaceRoot = join(dir, "workspace");
    const userDir = join(workspaceRoot, "users", "alice");
    const commonDir = join(workspaceRoot, "common");
    const otherDir = join(workspaceRoot, "users", "bob");
    await mkdir(userDir, { recursive: true });
    await mkdir(commonDir, { recursive: true });
    await mkdir(otherDir, { recursive: true });
    const ownFile = join(userDir, "own.txt");
    const commonFile = join(commonDir, "common.txt");
    const otherFile = join(otherDir, "other.txt");
    writeFileSync(ownFile, "own");
    writeFileSync(commonFile, "common");
    writeFileSync(otherFile, "other");

    const scope = { userId: "usr_alice", workspaceRoot, userDir, commonDir, commonWritable: false };
    assert.equal(await resolveAllowedWorkspacePath(ownFile, scope, "read"), ownFile);
    assert.equal(await resolveAllowedWorkspacePath(commonFile, scope, "read"), commonFile);
    assert.equal(await resolveAllowedWorkspacePath(otherFile, scope, "read"), null);
    assert.equal(await resolveAllowedWorkspacePath(commonFile, scope, "write"), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
