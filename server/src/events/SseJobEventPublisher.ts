import type { IncomingMessage, ServerResponse } from "node:http";

export interface JobEventRecord {
  id: string;
  state: string;
}

export interface JobTokenEventRecord {
  id: string;
  token: string;
}

export interface SseJobEventPublisherDeps {
  corsHeaders: Record<string, string>;
  isAuthorized(request: IncomingMessage): boolean;
  getJob(jobId: string, request: IncomingMessage, url: URL): JobEventRecord | null;
  sendError(response: ServerResponse, statusCode: number, code: string, message: string): void;
  pollIntervalMs?: number;
}

interface JobEventSubscriber {
  response: ServerResponse;
  interval?: NodeJS.Timeout;
}

export class SseJobEventPublisher {
  private readonly pollIntervalMs: number;
  private readonly subscribers = new Map<string, Set<JobEventSubscriber>>();

  constructor(private readonly deps: SseJobEventPublisherDeps) {
    this.pollIntervalMs = deps.pollIntervalMs ?? 2_000;
  }

  publishJob(job: JobEventRecord): void {
    const subscribers = this.publish(job.id, "job", job);
    if (!subscribers?.size) {
      return;
    }

    if (this.isTerminal(job)) {
      for (const subscriber of [...subscribers]) {
        this.removeSubscriber(job.id, subscriber);
        subscriber.response.end();
      }
    }
  }

  publishToken(event: JobTokenEventRecord): void {
    this.publish(event.id, "token", event);
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
      return this.isTerminal(job);
    };

    if (sendCurrent()) {
      response.end();
      return;
    }

    const subscriber: JobEventSubscriber = { response };
    this.addSubscriber(jobId, subscriber);
    subscriber.interval = setInterval(() => {
      if (sendCurrent()) {
        this.removeSubscriber(jobId, subscriber);
        response.end();
      }
    }, this.pollIntervalMs);

    request.on("close", () => {
      this.removeSubscriber(jobId, subscriber);
    });
  }

  private publish(jobId: string, event: string, data: unknown): Set<JobEventSubscriber> | null {
    const subscribers = this.subscribers.get(jobId);
    if (!subscribers?.size) {
      return null;
    }

    for (const subscriber of [...subscribers]) {
      this.writeEvent(subscriber.response, event, data);
    }

    return subscribers;
  }

  private addSubscriber(jobId: string, subscriber: JobEventSubscriber): void {
    const subscribers = this.subscribers.get(jobId) ?? new Set<JobEventSubscriber>();
    subscribers.add(subscriber);
    this.subscribers.set(jobId, subscribers);
  }

  private removeSubscriber(jobId: string, subscriber: JobEventSubscriber): void {
    if (subscriber.interval) {
      clearInterval(subscriber.interval);
      subscriber.interval = undefined;
    }

    const subscribers = this.subscribers.get(jobId);
    if (!subscribers) {
      return;
    }
    subscribers.delete(subscriber);
    if (subscribers.size === 0) {
      this.subscribers.delete(jobId);
    }
  }

  private isTerminal(job: JobEventRecord): boolean {
    return job.state === "completed" || job.state === "failed";
  }

  private writeEvent(response: ServerResponse, event: string, data: unknown): void {
    response.write(`event: ${event}\n`);
    response.write(`data: ${JSON.stringify(data)}\n\n`);
  }
}
