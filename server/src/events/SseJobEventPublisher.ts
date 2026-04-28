import type { IncomingMessage, ServerResponse } from "node:http";

export interface JobEventRecord {
  id: string;
  state: string;
}

export interface SseJobEventPublisherDeps {
  corsHeaders: Record<string, string>;
  isAuthorized(request: IncomingMessage): boolean;
  getJob(jobId: string, request: IncomingMessage, url: URL): JobEventRecord | null;
  sendError(response: ServerResponse, statusCode: number, code: string, message: string): void;
  pollIntervalMs?: number;
}

export class SseJobEventPublisher {
  private readonly pollIntervalMs: number;

  constructor(private readonly deps: SseJobEventPublisherDeps) {
    this.pollIntervalMs = deps.pollIntervalMs ?? 2_000;
  }

  serveJobEvents(request: IncomingMessage, response: ServerResponse, url: URL, jobId: string): void {
    if (!this.deps.isAuthorized(request)) {
      this.deps.sendError(response, 401, "AUTH_INVALID_TOKEN", "API key is invalid.");
      return;
    }

    const initialJob = this.deps.getJob(jobId, request, url);
    if (!initialJob) {
      this.deps.sendError(response, 404, "INTERNAL_SERVER_ERROR", "Job not found.");
      return;
    }

    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      ...this.deps.corsHeaders,
    });

    const sendCurrent = (): boolean => {
      const job = this.deps.getJob(jobId, request, url);
      if (!job) {
        this.writeEvent(response, "expired", { id: jobId, state: "expired" });
        return true;
      }
      this.writeEvent(response, "job", job);
      return job.state === "completed" || job.state === "failed";
    };

    if (sendCurrent()) {
      response.end();
      return;
    }

    const interval = setInterval(() => {
      if (sendCurrent()) {
        clearInterval(interval);
        response.end();
      }
    }, this.pollIntervalMs);

    request.on("close", () => clearInterval(interval));
  }

  private writeEvent(response: ServerResponse, event: string, data: unknown): void {
    response.write(`event: ${event}\n`);
    response.write(`data: ${JSON.stringify(data)}\n\n`);
  }
}
