import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import WsSocket from "ws";
import type { MessageAttachment, MessageRequestMetadata } from "../contracts/apiContractV1.js";
import { getSessionThinkingOverride } from "./modelOverride.js";
import type { OpenClawClient, OpenClawClientInput, OpenClawClientResult, RuntimeWorkspaceScope } from "./OpenClawClient.js";

type GatewayFrame =
  | { type: "event"; event: string; payload?: Record<string, unknown> }
  | { type: "res"; id: string; ok: true; payload?: Record<string, unknown> }
  | { type: "res"; id: string; ok: false; error?: { code?: string; message?: string; details?: unknown } };

export class GatewayNativeOpenClawClient implements OpenClawClient {
  constructor(
    private readonly baseUrl = process.env.OPENCLAW_GATEWAY_URL ?? "http://127.0.0.1:18789",
    private readonly token = process.env.OPENCLAW_GATEWAY_TOKEN,
    private readonly timeoutMs = Number(process.env.OPENCLAW_GATEWAY_TIMEOUT_MS ?? process.env.OPENCLAW_TIMEOUT_MS ?? 600_000),
    private readonly agentId = process.env.OPENCLAW_AGENT ?? "main",
  ) {}

  async sendMessage(input: OpenClawClientInput): Promise<OpenClawClientResult> {
    const runId = randomUUID();
    const message = this.buildMessage(input.message, input.metadata, input.runtimeWorkspace);
    const gateway = await GatewayRpcConnection.connect({
      url: this.wsUrl(),
      token: this.token,
      password: this.gatewayPassword(),
      timeoutMs: Math.min(30_000, this.timeoutMs),
    });
    const timeout = setTimeout(() => {
      gateway.close();
    }, this.timeoutMs);
    const onExternalAbort = () => gateway.close();
    input.abortSignal?.addEventListener("abort", onExternalAbort, { once: true });

    try {
      const finalReply = gateway.waitForChatFinal(runId, input.sessionId, input.callbacks?.onAgentEvent, input.callbacks?.onToken);
      await gateway.request("chat.send", {
        sessionKey: input.sessionId,
        message,
        thinking: getSessionThinkingOverride(input.sessionId) ?? process.env.OPENCLAW_THINKING,
        deliver: false,
        timeoutMs: this.timeoutMs,
        idempotencyKey: runId,
        attachments: this.rpcAttachments(input.attachments ?? []),
      });
      const { reply, streamedText } = await finalReply;
      if (reply && !streamedText) {
        await input.callbacks?.onToken?.(reply);
      }
      return {
        reply: reply || "응답 출력에 문제가 있습니다. 다시 답변을 요청해보세요. 이 오류가 반복되면 새 대화를 열어 세션을 다시 시작해주세요.",
        raw: {
          transport: "gateway-native",
          endpoint: this.wsUrl(),
          sessionId: input.sessionId,
          runId,
        },
      };
    } finally {
      clearTimeout(timeout);
      input.abortSignal?.removeEventListener("abort", onExternalAbort);
      gateway.close();
    }
  }

  private wsUrl(): string {
    const url = new URL(this.baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/";
    url.search = "";
    return url.toString();
  }

  private gatewayPassword(): string | undefined {
    const envPassword = process.env.OPENCLAW_GATEWAY_PASSWORD?.trim();
    if (envPassword) {
      return envPassword;
    }
    try {
      const config = JSON.parse(readFileSync(`${process.env.HOME ?? ""}/.openclaw/openclaw.json`, "utf8")) as {
        gateway?: { auth?: { password?: unknown } };
      };
      const password = config.gateway?.auth?.password;
      return typeof password === "string" && password.trim() ? password.trim() : undefined;
    } catch {
      return undefined;
    }
  }

  private rpcAttachments(attachments: MessageAttachment[]): Array<Record<string, unknown>> {
    return attachments.map((attachment) => ({
      type: attachment.type,
      mimeType: attachment.mime_type,
      fileName: attachment.name,
      content: attachment.content_base64,
    }));
  }

  private buildMessage(message: string, metadata?: MessageRequestMetadata, runtimeWorkspace?: RuntimeWorkspaceScope): string {
    const sections = [message];
    if (runtimeWorkspace) {
      sections.push(this.runtimeWorkspaceText(runtimeWorkspace));
    }
    const location = metadata?.location;
    if (location) {
      const accuracyText = Number.isFinite(location.accuracy) ? `, accuracy_m=${Math.round(location.accuracy ?? 0)}` : "";
      const capturedAtText = location.captured_at ? `, captured_at=${location.captured_at}` : "";
      sections.push(
        `비공개 클라이언트 metadata: 사용자의 현재 위치가 제공되었습니다. 답변에 필요할 때만 참고하고, 좌표 자체는 사용자가 요청하지 않는 한 그대로 노출하지 마세요.\n- latitude=${location.latitude}, longitude=${location.longitude}${accuracyText}${capturedAtText}`,
      );
    }
    return sections.join("\n\n");
  }

  private runtimeWorkspaceText(runtimeWorkspace: RuntimeWorkspaceScope): string {
    const displayName = runtimeWorkspace.displayName?.trim() || runtimeWorkspace.username?.trim() || runtimeWorkspace.userId;
    return [
      "비공개 런타임 workspace metadata:",
      `- current_webchat_user_id=${runtimeWorkspace.userId}`,
      `- current_webchat_username=${runtimeWorkspace.username ?? ""}`,
      `- current_webchat_display_name=${displayName}`,
      `- workspace_root=${runtimeWorkspace.workspaceRoot}`,
      `- user_dir=${runtimeWorkspace.userDir}`,
      `- common_dir=${runtimeWorkspace.commonDir}`,
      `- common_writable=${runtimeWorkspace.commonWritable ? "true" : "false"}`,
      runtimeWorkspace.identityFile ? `- identity_file=${runtimeWorkspace.identityFile}` : "",
      "이 사용자는 현재 Web/PWA 개인 workspace 안에서 작업 중입니다. 파일 작업이 필요하면 user_dir와 common_dir 범위만 사용하세요.",
      displayName.toLowerCase() === "eddy"
        ? "현재 webchat 사용자는 Eddy입니다."
        : "현재 webchat 사용자는 Eddy가 아닙니다. 사용자를 Eddy로 부르지 마세요.",
    ].filter(Boolean).join("\n");
  }
}

class GatewayRpcConnection {
  private nextRequestId = 0;
  private readonly pending = new Map<string, {
    resolve(value: Record<string, unknown> | undefined): void;
    reject(error: Error): void;
  }>();
  private readonly chatFinalWaiters = new Map<string, {
    sessionKey: string;
    streamedText: string;
    resolve(value: { reply: string; streamedText: string }): void;
    reject(error: Error): void;
    onAgentEvent?: (event: Record<string, unknown>) => void | Promise<void>;
    onToken?: (token: string) => void | Promise<void>;
  }>();

  private constructor(private readonly ws: InstanceType<typeof WsSocket>) {}

  static async connect(input: { url: string; token?: string; password?: string; timeoutMs: number }): Promise<GatewayRpcConnection> {
    const ws = new WsSocket(input.url);
    const connection = new GatewayRpcConnection(ws);
    await connection.handshake(input);
    return connection;
  }

  request(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
    const id = `pwa_${Date.now()}_${this.nextRequestId++}`;
    const promise = new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.ws.send(JSON.stringify({ type: "req", id, method, params: params ?? {} }));
    return promise;
  }

  waitForChatFinal(
    runId: string,
    sessionKey: string,
    onAgentEvent?: (event: Record<string, unknown>) => void | Promise<void>,
    onToken?: (token: string) => void | Promise<void>,
  ): Promise<{ reply: string; streamedText: string }> {
    return new Promise((resolve, reject) => {
      this.chatFinalWaiters.set(runId, { sessionKey, streamedText: "", resolve, reject, onAgentEvent, onToken });
    });
  }

  close(): void {
    for (const pending of this.pending.values()) {
      pending.reject(new Error("OpenClaw Gateway connection closed."));
    }
    this.pending.clear();
    for (const waiter of this.chatFinalWaiters.values()) {
      waiter.reject(new Error("OpenClaw Gateway connection closed before final reply."));
    }
    this.chatFinalWaiters.clear();
    if (this.ws.readyState === WsSocket.OPEN) {
      this.ws.close();
    } else {
      this.ws.terminate();
    }
  }

  private handshake(input: { token?: string; password?: string; timeoutMs: number }): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("OpenClaw Gateway handshake timed out.")), input.timeoutMs);
      const connectId = `connect_${Date.now()}`;
      const cleanup = () => clearTimeout(timeout);

      this.ws.on("message", (data: unknown) => {
        const frame = parseGatewayFrame(data);
        if (!frame) {
          return;
        }
        if (frame.type === "event" && frame.event === "connect.challenge") {
          this.ws.send(JSON.stringify({
            type: "req",
            id: connectId,
            method: "connect",
            params: {
              minProtocol: 3,
              maxProtocol: 4,
              client: {
                id: "gateway-client",
                version: "pwa-custom-channel",
                platform: "node",
                mode: "backend",
              },
              role: "operator",
              scopes: ["operator.read", "operator.write", "operator.admin", "operator.approvals", "operator.pairing", "operator.talk.secrets"],
              caps: ["tool-events"],
              commands: [],
              permissions: {},
              auth: input.password ? { password: input.password } : { token: input.token },
              locale: "ko-KR",
              userAgent: "openclaw-custom-channel/pwa",
            },
          }));
          return;
        }
        if (frame.type === "res" && frame.id === connectId) {
          cleanup();
          if (frame.ok) {
            this.ws.on("message", (message: unknown) => this.handleFrame(parseGatewayFrame(message)));
            resolve();
          } else {
            reject(new Error(frame.error?.message ?? "OpenClaw Gateway handshake failed."));
          }
        }
      });
      this.ws.on("error", (error: Error) => {
        cleanup();
        reject(error);
      });
      this.ws.on("close", (_code: number, reason: Buffer) => {
        cleanup();
        reject(new Error(reason.toString() || "OpenClaw Gateway connection closed."));
      });
    });
  }

  private handleFrame(frame: GatewayFrame | null): void {
    if (!frame) {
      return;
    }
    if (frame.type === "res") {
      const pending = this.pending.get(frame.id);
      if (!pending) {
        return;
      }
      this.pending.delete(frame.id);
      if (frame.ok) {
        pending.resolve(frame.payload);
      } else {
        pending.reject(new Error(frame.error?.message ?? "OpenClaw Gateway request failed."));
      }
      return;
    }
    if (frame.type !== "event") {
      return;
    }
    const payload = frame.payload ?? {};
    const runId = typeof payload.runId === "string" ? payload.runId : "";
    const waiter = runId ? this.chatFinalWaiters.get(runId) : undefined;
    if (!waiter) {
      return;
    }
    void waiter.onAgentEvent?.({ stream: frame.event, data: payload, ...payload });
    if (frame.event === "chat" && payload.state === "delta") {
      const delta = extractGatewayChatDelta(payload, waiter.streamedText);
      if (delta) {
        waiter.streamedText = delta.text;
        void waiter.onToken?.(delta.token);
      }
    }
    if (frame.event === "chat" && payload.state === "final") {
      this.chatFinalWaiters.delete(runId);
      waiter.resolve({
        reply: extractGatewayChatMessageText(payload.message),
        streamedText: waiter.streamedText,
      });
    }
    if (frame.event === "chat.error" || payload.state === "error") {
      this.chatFinalWaiters.delete(runId);
      waiter.reject(new Error(extractGatewayChatMessageText(payload.message) || "OpenClaw Gateway chat failed."));
    }
  }
}

export function extractGatewayChatDelta(payload: Record<string, unknown>, previousText = ""): { token: string; text: string } | null {
  if (payload.state !== "delta") {
    return null;
  }

  const deltaText = typeof payload.deltaText === "string" ? payload.deltaText : "";
  const messageText = extractGatewayChatMessageText(payload.message, { trim: false });
  if (payload.replace === true) {
    if (messageText && messageText.startsWith(previousText)) {
      const token = messageText.slice(previousText.length);
      return token ? { token, text: messageText } : null;
    }
    if (!previousText && messageText) {
      return { token: messageText, text: messageText };
    }
    return null;
  }

  if (deltaText) {
    return {
      token: deltaText,
      text: messageText || `${previousText}${deltaText}`,
    };
  }

  if (messageText && messageText.startsWith(previousText)) {
    const token = messageText.slice(previousText.length);
    return token ? { token, text: messageText } : null;
  }

  return null;
}

function parseGatewayFrame(data: unknown): GatewayFrame | null {
  try {
    const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
    return JSON.parse(text) as GatewayFrame;
  } catch {
    return null;
  }
}

function extractGatewayChatMessageText(message: unknown, options: { trim?: boolean } = {}): string {
  if (!message || typeof message !== "object") {
    return "";
  }
  const normalize = (text: string) => options.trim === false ? text : text.trim();
  const record = message as { text?: unknown; content?: unknown };
  if (typeof record.text === "string" && record.text) {
    return normalize(record.text);
  }
  if (Array.isArray(record.content)) {
    const text = record.content
      .map((part) => {
        if (!part || typeof part !== "object") {
          return "";
        }
        const text = (part as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      })
      .filter(Boolean)
      .join("\n");
    return normalize(text);
  }
  return "";
}
