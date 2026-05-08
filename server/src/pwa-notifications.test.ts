import assert from "node:assert/strict";
import { test } from "node:test";

// @ts-expect-error public browser module intentionally has no TypeScript declaration.
const notifications = await import("../public/modules/notifications.js");

test("detects iOS Safari needs home screen installation for push", () => {
  const state = notifications.getPushNotificationSupportState({
    hasNotification: true,
    hasServiceWorker: true,
    hasPushManager: true,
    isIos: true,
    isStandalone: false,
  });

  assert.equal(state.supported, false);
  assert.equal(state.reason, "ios-install-required");
  assert.match(state.message, /홈 화면/);
});

test("allows push when iOS PWA is running standalone", () => {
  const state = notifications.getPushNotificationSupportState({
    hasNotification: true,
    hasServiceWorker: true,
    hasPushManager: true,
    isIos: true,
    isStandalone: true,
  });

  assert.equal(state.supported, true);
});

test("detects iPadOS desktop user agent by touch-enabled MacIntel platform", () => {
  assert.equal(notifications.isIosLike("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)", "MacIntel", 5), true);
});
