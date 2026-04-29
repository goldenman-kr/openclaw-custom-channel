import type { IncomingMessage, ServerResponse } from "node:http";
import type { ErrorResponseDto } from "../contracts/apiContractV1.js";
import type { JobEventRecord, SseJobEventPublisher } from "../events/SseJobEventPublisher.js";

export interface JobRouteDeps {
  isAuthorized(request: IncomingMessage): boolean;
  sendJson(response: ServerResponse, statusCode: number, body: unknown): void;
  makeErrorResponse(code: ErrorResponseDto["error"]["code"], message: string, details?: Record<string, unknown>): ErrorResponseDto;
  getJob(jobId: string, request: IncomingMessage, url: URL): JobEventRecord | null;
  eventPublisher: SseJobEventPublisher;
}

export function handleJobRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  deps: JobRouteDeps,
): boolean {
  if (request.method === "GET" && url.pathname.startsWith("/v1/jobs/") && url.pathname.endsWith("/events")) {
    const jobId = decodeURIComponent(url.pathname.slice("/v1/jobs/".length, -"/events".length));
    deps.eventPublisher.serveJobEvents(request, response, url, jobId);
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/v1/jobs/")) {
    if (!deps.isAuthorized(request)) {
      deps.sendJson(response, 401, deps.makeErrorResponse("AUTH_INVALID_TOKEN", "API key is invalid."));
      return true;
    }
    const jobId = decodeURIComponent(url.pathname.slice("/v1/jobs/".length));
    const job = deps.getJob(jobId, request, url);
    if (!job) {
      deps.sendJson(response, 404, deps.makeErrorResponse("INTERNAL_SERVER_ERROR", "Job not found."));
      return true;
    }
    deps.sendJson(response, 200, job);
    return true;
  }

  return false;
}
