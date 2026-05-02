import { randomUUID } from "node:crypto";

export interface GatewayAgentEventPayload {
  runId?: string;
  stream?: string;
  sessionKey?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface GatewayAgentEventSubscriberOptions {
  baseUrl?: string;
  token?: string;
  sessionKey: string;
  onEvent(event: GatewayAgentEventPayload): void;
  timeoutMs?: number;
}

interface GatewayEventFrame {
  type?: string;
  event?: string;
  payload?: unknown;
}

interface GatewayResponseFrame {
  type?: string;
  id?: string;
  ok?: boolean;
  payload?: unknown;
  error?: { message?: string };
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout?: NodeJS.Timeout;
}

const DEFAULT_GATEWAY_URL = "http://127.0.0.1:18789";
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;

export class GatewayAgentEventSubscriber {
  private socket: unknown;
  private readonly pending = new Map<string, PendingRequest>();
  private stopped = false;

  constructor(private readonly options: GatewayAgentEventSubscriberOptions) {}

  async start(): Promise<void> {
    const WebSocketCtor = (globalThis as { WebSocket?: new (url: string) => unknown }).WebSocket;
    if (!WebSocketCtor) {
      throw new Error("WebSocket is not available in this Node.js runtime.");
    }

    const socket = new WebSocketCtor(this.wsUrl());
    this.socket = socket;
    await this.waitForOpen(socket);
  }

  stop(): void {
    this.stopped = true;
    for (const pending of this.pending.values()) {
      if (pending.timeout) {
        clearTimeout(pending.timeout);
      }
      pending.reject(new Error("Gateway event subscriber stopped."));
    }
    this.pending.clear();
    const socket = this.socket as { close?: () => void } | undefined;
    try {
      socket?.close?.();
    } catch {
      // ignore close errors
    }
    this.socket = undefined;
  }

  private async waitForOpen(socket: unknown): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Gateway WebSocket open timed out.")), this.options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
      timeout.unref?.();
      this.addEventListener(socket, "open", () => {
        clearTimeout(timeout);
        resolve();
      });
      this.addEventListener(socket, "error", () => {
        clearTimeout(timeout);
        reject(new Error("Gateway WebSocket connection failed."));
      });
      this.addEventListener(socket, "message", (event) => {
        this.handleRawMessage(this.readMessageData(event)).catch(() => {});
      });
      this.addEventListener(socket, "close", () => {
        if (!this.stopped) {
          this.stop();
        }
      });
    });
  }

  private async handleRawMessage(raw: unknown): Promise<void> {
    const text = typeof raw === "string" ? raw : raw instanceof Buffer ? raw.toString("utf8") : String(raw ?? "");
    if (!text.trim()) {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }

    const response = parsed as GatewayResponseFrame;
    if (response.type === "res" && response.id) {
      const pending = this.pending.get(response.id);
      if (!pending) {
        return;
      }
      this.pending.delete(response.id);
      if (pending.timeout) {
        clearTimeout(pending.timeout);
      }
      if (response.ok) {
        pending.resolve(response.payload);
      } else {
        pending.reject(new Error(response.error?.message || "Gateway request failed."));
      }
      return;
    }

    const frame = parsed as GatewayEventFrame;
    if (frame.type !== "event") {
      return;
    }

    if (frame.event === "connect.challenge") {
      const nonce = typeof (frame.payload as { nonce?: unknown } | null)?.nonce === "string" ? (frame.payload as { nonce: string }).nonce : "";
      if (!nonce) {
        throw new Error("Gateway connect challenge missing nonce.");
      }
      await this.connect(nonce);
      await this.request("sessions.subscribe", {});
      return;
    }

    if (frame.event === "agent" || frame.event === "session.tool") {
      const payload = frame.payload as GatewayAgentEventPayload;
      if (payload?.sessionKey === this.options.sessionKey) {
        this.options.onEvent(payload);
      }
    }
  }

  private async connect(nonce: string): Promise<void> {
    const auth = this.options.token ? { token: this.options.token } : undefined;
    await this.request("connect", {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: "openclaw-custom-channel-pwa",
        displayName: "OpenClaw Custom Channel PWA",
        version: "1.0.0",
        platform: process.platform,
        mode: "backend",
      },
      caps: [],
      auth,
      role: "operator",
      scopes: ["operator.read"],
    });
  }

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const socket = this.socket as { send?: (data: string) => void; readyState?: number } | undefined;
    if (!socket?.send) {
      return Promise.reject(new Error("Gateway WebSocket is not connected."));
    }
    const id = randomUUID();
    const frame = { type: "req", id, method, params };
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const promise = new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Gateway request timeout for ${method}.`));
      }, timeoutMs);
      timeout.unref?.();
      this.pending.set(id, { resolve, reject, timeout });
    });
    socket.send(JSON.stringify(frame));
    return promise;
  }

  private wsUrl(): string {
    const url = new URL(this.options.baseUrl ?? DEFAULT_GATEWAY_URL);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.toString();
  }

  private addEventListener(socket: unknown, event: string, listener: (event?: unknown) => void): void {
    const target = socket as { addEventListener?: (event: string, listener: (event?: unknown) => void, options?: unknown) => void; on?: (event: string, listener: (event?: unknown) => void) => void };
    if (target.addEventListener) {
      target.addEventListener(event, listener);
      return;
    }
    target.on?.(event, listener);
  }

  private readMessageData(event: unknown): unknown {
    if (event && typeof event === "object" && "data" in event) {
      return (event as { data: unknown }).data;
    }
    return event;
  }
}
