import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { test } from "node:test";
import { handleJobRoute } from "./jobRoutes.js";

function request(method: string): IncomingMessage {
  return { method, headers: {} } as IncomingMessage;
}

function response(): ServerResponse {
  return {} as ServerResponse;
}

function deps(discardResult: "deleted" | "not-queued" | "not-found") {
  let sent: { status: number; body: unknown } | undefined;
  return {
    value: {
      isAuthorized: () => true,
      sendJson: (_response: ServerResponse, status: number, body: unknown) => { sent = { status, body }; },
      makeErrorResponse: (_code: unknown, message: string) => ({ error: { message } }),
      getJob: () => null,
      cancelJob: () => null,
      discardQueuedJob: () => discardResult,
      eventPublisher: {} as never,
    },
    sent: () => sent,
  };
}

test("deletes a queued job through the job endpoint", () => {
  const route = deps("deleted");
  assert.equal(handleJobRoute(request("DELETE"), response(), new URL("http://localhost/v1/jobs/job_test?conversation_id=conv_test"), route.value as never), true);
  assert.equal(route.sent()?.status, 200);
  assert.deepEqual(route.sent()?.body, { ok: true, id: "job_test", state: "cancelled", deleted: true });
});

test("rejects queued deletion after processing starts", () => {
  const route = deps("not-queued");
  handleJobRoute(request("DELETE"), response(), new URL("http://localhost/v1/jobs/job_test?conversation_id=conv_test"), route.value as never);
  assert.equal(route.sent()?.status, 409);
});
