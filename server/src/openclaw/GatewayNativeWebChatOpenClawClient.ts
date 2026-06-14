import type { MessageAttachment } from "../contracts/apiContractV1.js";
import type {
  OpenClawClient,
  OpenClawClientInput,
  OpenClawClientResult,
  OpenClawConversationSessionInput,
  OpenClawConversationSessionResult,
} from "./OpenClawClient.js";
import { activeGatewayModel, getSessionThinkingOverride } from "./modelOverride.js";

interface GatewayRpcResponse {
  ok?: boolean;
  result?: {
    reply?: string;
    deliveryHandled?: boolean;
    partialCount?: number;
  };
  error?: {
    message?: string;
  };
}

interface GatewaySessionEnsureResponse {
  ok?: boolean;
  result?: {
    conversationId?: string;
    sessionKey?: string;
    scopedSessionKey?: string;
  };
  error?: {
    message?: string;
  };
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: NodeJS.Timeout;
}

type GatewayAuthMode = "auto" | "token" | "password";

function normalizeGatewayAuthMode(value: string | undefined): GatewayAuthMode {
  const normalized = value?.trim().toLowerCase();
  return normalized === "token" || normalized === "password" ? normalized : "auto";
}

export class GatewayNativeWebChatOpenClawClient implements OpenClawClient {
  constructor(
    private readonly baseUrl = process.env.OPENCLAW_GATEWAY_URL ?? "http://127.0.0.1:18789",
    private readonly token = process.env.OPENCLAW_GATEWAY_TOKEN,
    private readonly password = process.env.OPENCLAW_GATEWAY_PASSWORD,
    private readonly timeoutMs = Number(process.env.OPENCLAW_GATEWAY_TIMEOUT_MS ?? process.env.OPENCLAW_TIMEOUT_MS ?? 600_000),
    private readonly agentId = process.env.OPENCLAW_AGENT ?? "main",
    private readonly authMode = process.env.OPENCLAW_GATEWAY_AUTH_MODE,
  ) {}

  async ensureConversationSession(input: OpenClawConversationSessionInput): Promise<OpenClawConversationSessionResult> {
    const conversationId = this.normalizeConversationId(input.conversationId);
    const response = await this.callGateway("webchat.session.ensure", {
      conversationId,
      userId: input.userId,
      userLabel: input.userLabel,
      agentId: this.agentId,
    }, input.abortSignal) as GatewaySessionEnsureResponse;

    if (!response.ok) {
      throw new Error(response.error?.message || "OpenClaw webchat.session.ensure failed.");
    }

    return {
      conversationId: response.result?.conversationId || conversationId,
      sessionKey: response.result?.sessionKey,
      scopedSessionKey: response.result?.scopedSessionKey,
      raw: response.result,
    };
  }

  async sendMessage(input: OpenClawClientInput): Promise<OpenClawClientResult> {
    const conversationId = this.gatewayConversationId(input);
    const sessionKey = this.stableSessionKey(conversationId);
    const jobId = typeof input.metadata?.webchat?.jobId === "string" ? input.metadata.webchat.jobId : undefined;
    const response = await this.callGateway("webchat.send", {
      conversationId,
      jobId,
      message: this.buildMessage(input.message, input.attachments ?? []),
      userId: input.userId,
      userLabel: input.runtimeWorkspace?.displayName ?? input.runtimeWorkspace?.username ?? input.userId,
      agentId: this.agentId,
      model: activeGatewayModel(process.env.OPENCLAW_GATEWAY_MODEL ?? "openclaw"),
      thinking: getSessionThinkingOverride(sessionKey) ?? process.env.OPENCLAW_THINKING,
    }, input.abortSignal) as GatewayRpcResponse;

    if (!response.ok) {
      throw new Error(response.error?.message || "OpenClaw webchat.send failed.");
    }

    return {
      reply: response.result?.reply || "",
      raw: {
        transport: "native-webchat",
        deliveryHandled: response.result?.deliveryHandled === true,
        partialCount: response.result?.partialCount ?? 0,
      },
    };
  }

  private normalizeConversationId(conversationId: string): string {
    const normalized = conversationId.trim();
    if (!/^conv_[A-Za-z0-9][A-Za-z0-9_-]*$/.test(normalized)) {
      throw new Error("conversationId must match conv_<stable-id>.");
    }
    return normalized;
  }

  private stableSessionKey(conversationId: string): string {
    return `pwa-webchat:${conversationId}`;
  }

  private gatewayConversationId(input: OpenClawClientInput): string {
    const metadataConversationId = typeof input.metadata?.webchat?.conversationId === "string"
      ? input.metadata.webchat.conversationId
      : "";
    if (metadataConversationId.trim()) {
      return this.normalizeConversationId(metadataConversationId);
    }

    const sessionId = input.sessionId.trim();
    if (sessionId.startsWith("pwa-webchat:")) {
      return this.normalizeConversationId(sessionId.slice("pwa-webchat:".length));
    }
    if (sessionId.startsWith("webchat:")) {
      return this.normalizeConversationId(sessionId.slice("webchat:".length));
    }
    if (sessionId.startsWith("web-conv_")) {
      return this.normalizeConversationId(`conv_${sessionId.slice("web-conv_".length)}`);
    }
    return this.normalizeConversationId(sessionId);
  }

  private buildMessage(message: string, attachments: MessageAttachment[]): string {
    if (attachments.length === 0) {
      return message;
    }
    const summary = attachments
      .map((attachment) => `- ${attachment.name} (${attachment.mime_type}, ${attachment.type})`)
      .join("\n");
    return `${message}\n\n첨부 파일:\n${summary}`;
  }

  private async callGateway(method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const WebSocketCtor = globalThis.WebSocket;
    if (!WebSocketCtor) {
      throw new Error("WebSocket is not available in this Node runtime.");
    }

    const socket = new WebSocketCtor(this.wsUrl());
    const pending = new Map<string, PendingRequest>();
    let nextRequestId = 0;
    let readyResolve: (() => void) | undefined;
    let readyReject: ((error: Error) => void) | undefined;

    const cleanup = () => {
      for (const request of pending.values()) {
        clearTimeout(request.timeout);
        request.reject(new Error("Gateway websocket closed."));
      }
      pending.clear();
      socket.close();
    };

    const request = (requestMethod: string, requestParams: Record<string, unknown>, requestTimeoutMs = this.timeoutMs) => new Promise<unknown>((resolve, reject) => {
      const id = `pwa-webchat-${++nextRequestId}`;
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Gateway request timed out: ${requestMethod}`));
      }, requestTimeoutMs);
      pending.set(id, { resolve, reject, timeout });
      socket.send(JSON.stringify({ type: "req", id, method: requestMethod, params: requestParams }));
    });

    const abort = () => {
      cleanup();
      readyReject?.(new Error("OpenClaw Gateway request cancelled."));
    };
    if (signal?.aborted) {
      abort();
    } else {
      signal?.addEventListener("abort", abort, { once: true });
    }

    socket.addEventListener("message", async (event) => {
      const text = typeof event.data === "string" ? event.data : Buffer.from(await event.data.arrayBuffer()).toString("utf8");
      const frame = JSON.parse(text) as { type?: string; id?: string; event?: string; ok?: boolean | unknown; payload?: unknown; error?: { message?: string } };
      if (frame.type === "event" && frame.event === "connect.challenge") {
        await request("connect", {
          minProtocol: 4,
          maxProtocol: 4,
          client: {
            id: "gateway-client",
            displayName: "PWA WebChat Native Channel",
            version: "1.0.0",
            platform: process.platform,
            mode: "backend",
          },
          caps: [],
          auth: this.authPayload(),
          role: "operator",
          scopes: ["operator.read", "operator.write"],
        }, 10_000);
        readyResolve?.();
        return;
      }
      if (frame.type !== "res" || !frame.id) {
        return;
      }
      const pendingRequest = pending.get(frame.id);
      if (!pendingRequest) {
        return;
      }
      pending.delete(frame.id);
      clearTimeout(pendingRequest.timeout);
      if (frame.ok) {
        pendingRequest.resolve(typeof frame.ok === "object" ? frame.ok : frame.payload);
      } else {
        pendingRequest.reject(new Error(frame.error?.message || "Gateway request failed."));
      }
    });
    socket.addEventListener("error", () => readyReject?.(new Error("Gateway websocket error.")));
    socket.addEventListener("close", () => readyReject?.(new Error("Gateway websocket closed before ready.")));

    try {
      await new Promise<void>((resolve, reject) => {
        readyResolve = resolve;
        readyReject = reject;
        setTimeout(() => reject(new Error("Gateway websocket connect timeout.")), 10_000);
      });
      const timeout = AbortSignal.timeout(this.timeoutMs);
      const abortPromise = new Promise<never>((_, reject) => {
        timeout.addEventListener("abort", () => reject(new Error("OpenClaw Gateway request timed out.")), { once: true });
      });
      return await Promise.race([request(method, params), abortPromise]);
    } finally {
      signal?.removeEventListener("abort", abort);
      cleanup();
    }
  }

  private wsUrl(): string {
    const url = new URL(this.baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.toString();
  }

  private resolveAuth(): { mode: "token" | "password"; value: string } | null {
    const token = this.token?.trim() || "";
    const password = this.password?.trim() || "";
    const mode = normalizeGatewayAuthMode(this.authMode);
    if (mode === "token") {
      return token ? { mode, value: token } : null;
    }
    if (mode === "password") {
      return password ? { mode, value: password } : null;
    }
    if (token) {
      return { mode: "token", value: token };
    }
    return password ? { mode: "password", value: password } : null;
  }

  private authPayload(): { token?: string; password?: string } | undefined {
    const auth = this.resolveAuth();
    return auth ? { [auth.mode]: auth.value } : undefined;
  }
}
