import assert from "node:assert/strict";
import { test } from "node:test";

// @ts-expect-error public browser module intentionally has no TypeScript declaration.
const messageActions = await import("../public/modules/message-actions.js");

test("shows queued-request delete only for queued user messages with a job id", () => {
  assert.equal(messageActions.isQueuedUserJobMessage({ role: "user", jobId: "job_test", jobState: "queued" }), true);
  assert.equal(messageActions.isQueuedUserJobMessage({ role: "user", jobId: "job_test", jobState: "running" }), false);
  assert.equal(messageActions.isQueuedUserJobMessage({ role: "assistant", jobId: "job_test", jobState: "queued" }), false);
  assert.equal(messageActions.isQueuedUserJobMessage({ role: "user", jobId: "msg_test", jobState: "queued" }), false);
});
