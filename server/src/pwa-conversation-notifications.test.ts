import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error public browser module intentionally has no TypeScript declaration.
const notifications = await import("../public/modules/conversation-notifications.js");

test("uses only the final response timestamp as the cross-conversation notification version", () => {
  assert.equal(notifications.conversationFinalNotificationVersion({
    created_at: "2026-07-20T00:00:00.000Z",
    updated_at: "2026-07-20T00:02:00.000Z",
  }), "");
  assert.equal(notifications.conversationFinalNotificationVersion({
    updated_at: "2026-07-20T00:04:00.000Z",
    final_response_at: "2026-07-20T00:03:00.000Z",
  }), "2026-07-20T00:03:00.000Z");
});
