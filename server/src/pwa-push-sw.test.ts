import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("service worker handles web push notifications and clicks", async () => {
  const swSource = await readFile("public/sw.js", "utf8");

  assert.match(swSource, /addEventListener\('push'/);
  assert.match(swSource, /showNotification\(title, options\)/);
  assert.match(swSource, /addEventListener\('notificationclick'/);
  assert.match(swSource, /clients\.openWindow\(targetUrl\)/);
  assert.match(swSource, /openclaw-reply-ready-/);
});
