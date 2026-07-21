import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error public browser module intentionally has no TypeScript declaration.
const pendingJobs = await import("../public/modules/pending-job-storage.js");

test("finishing an older job does not clear a newer queued job from local pending state", () => {
  const stored = { job_id: "job_newer_queued" };

  assert.equal(pendingJobs.pendingJobMatches(stored, "job_older_finished"), false);
  assert.equal(pendingJobs.pendingJobMatches(stored, "job_newer_queued"), true);
});
