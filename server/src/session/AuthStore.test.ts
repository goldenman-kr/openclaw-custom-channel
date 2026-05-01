import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AuthStore } from "./AuthStore.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "openclaw-auth-store-"));
}

test("creates users and verifies password-backed sessions", () => {
  const dir = tempDir();
  const store = new AuthStore(join(dir, "auth.sqlite"));
  try {
    const user = store.createUser({ username: "eddy", displayName: "Eddy", password: "correct horse battery staple", role: "admin" });
    assert.equal(user.username, "eddy");
    assert.equal(user.role, "admin");

    assert.equal(store.verifyPassword("eddy", "wrong password"), null);
    const verified = store.verifyPassword("eddy", "correct horse battery staple");
    assert.equal(verified?.id, user.id);

    const { token } = store.createSession(user.id, { ttlMs: 60_000, now: new Date("2026-05-01T00:00:00.000Z") });
    const session = store.getSessionByToken(token, new Date("2026-05-01T00:00:10.000Z"));
    assert.equal(session?.user.id, user.id);

    assert.equal(store.revokeSessionByToken(token, "2026-05-01T00:00:20.000Z"), true);
    assert.equal(store.getSessionByToken(token, new Date("2026-05-01T00:00:30.000Z")), null);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ensureUser creates or updates an enabled login user", () => {
  const dir = tempDir();
  const store = new AuthStore(join(dir, "auth.sqlite"));
  try {
    const created = store.ensureUser({ username: "admin", displayName: "Admin", password: "first password", role: "admin" });
    assert.equal(created.username, "admin");
    assert.equal(store.verifyPassword("admin", "first password")?.id, created.id);

    store.disableUser("admin", "2026-05-01T00:00:00.000Z");
    assert.equal(store.verifyPassword("admin", "first password"), null);

    const updated = store.ensureUser({ username: "admin", displayName: "Owner", password: "second password", role: "admin" });
    assert.equal(updated.id, created.id);
    assert.equal(updated.displayName, "Owner");
    assert.equal(store.verifyPassword("admin", "first password"), null);
    assert.equal(store.verifyPassword("admin", "second password")?.id, created.id);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
