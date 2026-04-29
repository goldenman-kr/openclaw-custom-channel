import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import test from "node:test";
import { SseJobEventPublisher, type JobEventRecord } from "./SseJobEventPublisher.js";

class MockRequest extends EventEmitter {
  headers: IncomingMessage["headers"] = {};
}

class MockResponse {
  statusCode = 0;
  headers: Record<string, string | number | readonly string[]> = {};
  chunks: string[] = [];
  ended = false;

  writeHead(statusCode: number, headers: Record<string, string | number | readonly string[]>): this {
    this.statusCode = statusCode;
    this.headers = headers;
    return this;
  }

  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }

  end(): this {
    this.ended = true;
    return this;
  }

  body(): string {
    return this.chunks.join("");
  }
}

test("publishes job updates to connected SSE subscribers immediately", () => {
  const request = new MockRequest();
  const response = new MockResponse();
  let currentJob: JobEventRecord = { id: "job_test", state: "queued" };

  const publisher = new SseJobEventPublisher({
    corsHeaders: { "access-control-allow-origin": "*" },
    isAuthorized: () => true,
    getJob: () => currentJob,
    sendError: () => assert.fail("sendError should not be called"),
    pollIntervalMs: 60_000,
  });

  publisher.serveJobEvents(
    request as IncomingMessage,
    response as unknown as ServerResponse,
    new URL("http://localhost/v1/jobs/job_test/events"),
    "job_test",
  );

  assert.equal(response.statusCode, 200);
  assert.match(response.body(), /"state":"queued"/);
  assert.equal(response.ended, false);

  currentJob = { id: "job_test", state: "running" };
  publisher.publishJob(currentJob);
  assert.match(response.body(), /"state":"running"/);
  assert.equal(response.ended, false);

  publisher.publishToken({ id: "job_test", token: "partial" });
  assert.match(response.body(), /event: token/);
  assert.match(response.body(), /"token":"partial"/);
  assert.equal(response.ended, false);

  currentJob = { id: "job_test", state: "completed" };
  publisher.publishJob(currentJob);
  assert.match(response.body(), /"state":"completed"/);
  assert.equal(response.ended, true);

  response.chunks = [];
  publisher.publishJob({ id: "job_test", state: "failed" });
  assert.equal(response.body(), "");
});
