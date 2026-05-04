import type { IncomingMessage, ServerResponse } from "node:http";

export interface ConversationEventRecord {
  id: string;
  type: "message" | "changed";
  messageId?: string;
  conversationId: string;
  createdAt: string;
}

export interface ConversationEventPublisherDeps {
  corsHeaders: Record<string, string>;
  isAuthorized(request: IncomingMessage): boolean;
  isVisible(conversationId: string, request: IncomingMessage): boolean;
  sendError(response: ServerResponse, statusCode: number, code: string, message: string): void;
  keepAliveMs?: number;
}

interface Subscriber {
  response: ServerResponse;
  keepAlive?: NodeJS.Timeout;
}

export class ConversationEventPublisher {
  private readonly keepAliveMs: number;
  private readonly subscribers = new Map<string, Set<Subscriber>>();

  constructor(private readonly deps: ConversationEventPublisherDeps) {
    this.keepAliveMs = deps.keepAliveMs ?? 25_000;
  }

  publish(event: ConversationEventRecord): void {
    const subscribers = this.subscribers.get(event.conversationId);
    if (!subscribers?.size) {
      return;
    }
    for (const subscriber of [...subscribers]) {
      this.writeEvent(subscriber.response, "conversation", event);
    }
  }

  serve(request: IncomingMessage, response: ServerResponse, conversationId: string): void {
    if (!this.deps.isAuthorized(request)) {
      this.deps.sendError(response, 401, "AUTH_INVALID_TOKEN", "API key is invalid.");
      return;
    }
    if (!this.deps.isVisible(conversationId, request)) {
      this.deps.sendError(response, 404, "CONVERSATION_NOT_FOUND", "Conversation not found.");
      return;
    }

    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      ...this.deps.corsHeaders,
    });
    this.writeEvent(response, "ready", { conversationId, ts: Date.now() });

    const subscriber: Subscriber = { response };
    subscriber.keepAlive = setInterval(() => {
      response.write(`: keep-alive ${Date.now()}\n\n`);
    }, this.keepAliveMs);
    subscriber.keepAlive.unref?.();
    this.addSubscriber(conversationId, subscriber);

    request.on("close", () => this.removeSubscriber(conversationId, subscriber));
  }

  private addSubscriber(conversationId: string, subscriber: Subscriber): void {
    const subscribers = this.subscribers.get(conversationId) ?? new Set<Subscriber>();
    subscribers.add(subscriber);
    this.subscribers.set(conversationId, subscribers);
  }

  private removeSubscriber(conversationId: string, subscriber: Subscriber): void {
    if (subscriber.keepAlive) {
      clearInterval(subscriber.keepAlive);
    }
    const subscribers = this.subscribers.get(conversationId);
    if (!subscribers) {
      return;
    }
    subscribers.delete(subscriber);
    if (subscribers.size === 0) {
      this.subscribers.delete(conversationId);
    }
  }

  private writeEvent(response: ServerResponse, event: string, data: unknown): void {
    response.write(`event: ${event}\n`);
    response.write(`data: ${JSON.stringify(data)}\n\n`);
  }
}
