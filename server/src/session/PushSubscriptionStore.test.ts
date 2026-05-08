import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PushSubscriptionStore } from "./PushSubscriptionStore.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "openclaw-push-store-"));
}

test("upserts and scopes active push subscriptions by owner", () => {
  const dir = tempDir();
  const store = new PushSubscriptionStore(join(dir, "chat.sqlite"));
  try {
    const first = store.upsert({
      ownerId: "usr_first",
      deviceId: "device-a",
      endpoint: "https://push.example/1",
      p256dh: "p256dh-1",
      auth: "auth-1",
      userAgent: "Test Browser",
      now: "2026-05-08T00:00:00.000Z",
    });
    store.upsert({
      ownerId: "usr_second",
      deviceId: "device-b",
      endpoint: "https://push.example/2",
      p256dh: "p256dh-2",
      auth: "auth-2",
      now: "2026-05-08T00:01:00.000Z",
    });

    assert.equal(first.ownerId, "usr_first");
    assert.deepEqual(store.listActiveByOwner("usr_first").map((item) => item.endpoint), ["https://push.example/1"]);
    assert.deepEqual(store.listActiveByOwner("usr_second").map((item) => item.endpoint), ["https://push.example/2"]);

    const updated = store.upsert({
      ownerId: "usr_first",
      deviceId: "device-a2",
      endpoint: "https://push.example/1",
      p256dh: "p256dh-updated",
      auth: "auth-updated",
      now: "2026-05-08T00:02:00.000Z",
    });
    assert.equal(updated.id, first.id);
    assert.equal(updated.deviceId, "device-a2");
    assert.equal(updated.p256dh, "p256dh-updated");
    assert.equal(store.listActiveByOwner("usr_first").length, 1);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("disables stale push subscriptions", () => {
  const dir = tempDir();
  const store = new PushSubscriptionStore(join(dir, "chat.sqlite"));
  try {
    const record = store.upsert({
      ownerId: "usr_first",
      deviceId: "device-a",
      endpoint: "https://push.example/1",
      p256dh: "p256dh-1",
      auth: "auth-1",
    });

    assert.equal(store.disableById(record.id), true);
    assert.equal(store.listActiveByOwner("usr_first").length, 0);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
