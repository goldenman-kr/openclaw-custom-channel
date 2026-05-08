import assert from "node:assert/strict";
import { test } from "node:test";

// @ts-expect-error public browser module intentionally has no TypeScript declaration.
const notifications = await import("../public/modules/notifications.js");

test("detects iOS Safari needs home screen installation for push", () => {
  const state = notifications.getPushNotificationSupportState({
    hasNotification: true,
    hasServiceWorker: true,
    hasPushManager: true,
    isSecureContext: true,
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
    isSecureContext: true,
    isIos: true,
    isStandalone: true,
  });

  assert.equal(state.supported, true);
});

test("detects unsupported notification API separately from denied permission", () => {
  const state = notifications.getPushNotificationSupportState({
    hasNotification: false,
    hasServiceWorker: true,
    hasPushManager: true,
    isSecureContext: true,
    isIos: false,
    isStandalone: false,
  });

  assert.equal(state.supported, false);
  assert.equal(state.reason, "notification-unsupported");
});

test("detects insecure contexts before checking push APIs", () => {
  const state = notifications.getPushNotificationSupportState({
    hasNotification: true,
    hasServiceWorker: true,
    hasPushManager: true,
    isSecureContext: false,
    isIos: false,
    isStandalone: false,
  });

  assert.equal(state.supported, false);
  assert.equal(state.reason, "secure-context-required");
});

test("detects iPadOS desktop user agent by touch-enabled MacIntel platform", () => {
  assert.equal(notifications.isIosLike("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)", "MacIntel", 5), true);
});
