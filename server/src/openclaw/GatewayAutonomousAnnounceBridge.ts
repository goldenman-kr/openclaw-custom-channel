import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { HistoryAttachment } from "../session/HistoryStore.js";
import type { ConversationRecord, MessageStore } from "../session/SqliteChatStore.js";

export interface AutonomousAnnouncementRecord {
  id: string;
  conversationId: string;
  text: string;
  attachments: HistoryAttachment[];
  createdAt: string;
}

export interface GatewayAutonomousAnnounceBridgeOptions {
  baseUrl?: string;
  token?: string;
  agentId?: string;
  sessionsDir?: string;
  getConversationByOpenClawSessionId(openclawSessionId: string): ConversationRecord | null;
  messageStore: MessageStore;
  attachmentsFromMediaRefs(text: string): Promise<HistoryAttachment[]>;
  onAnnouncement?(announcement: AutonomousAnnouncementRecord): void;
  reconnectMs?: number;
  settleMs?: number;
}

interface GatewayFrame {
  type?: string;
  event?: string;
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

interface SessionsChangedPayload {
  sessionKey?: string;
  sessionId?: string;
  status?: string;
  endedAt?: number | string;
  [key: string]: unknown;
}

interface ModelCompletedRecord {
  type?: string;
  runId?: string;
  ts?: string;
  data?: {
    assistantTexts?: unknown;
    finalPromptText?: unknown;
  };
}

const DEFAULT_GATEWAY_URL = "http://127.0.0.1:18789";
const DEFAULT_SESSIONS_DIR = "/home/orbsian/.openclaw/agents/main/sessions";

export class GatewayAutonomousAnnounceBridge {
  private socket: unknown;
  private stopped = false;
  private reconnectTimer?: NodeJS.Timeout;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly seenRunIds = new Set<string>();
  private readonly pendingSessionIds = new Map<string, NodeJS.Timeout>();

  constructor(private readonly options: GatewayAutonomousAnnounceBridgeOptions) {}

  start(): void {
    this.stopped = false;
    this.connect().catch((error) => {
      console.warn("Gateway autonomous announce bridge failed to start:", error instanceof Error ? error.message : String(error));
      this.scheduleReconnect();
    });
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    for (const timer of this.pendingSessionIds.values()) {
      clearTimeout(timer);
    }
    this.pendingSessionIds.clear();
    for (const pending of this.pending.values()) {
      if (pending.timeout) {
        clearTimeout(pending.timeout);
      }
      pending.reject(new Error("Gateway autonomous announce bridge stopped."));
    }
    this.pending.clear();
    try {
      (this.socket as { close?: () => void } | undefined)?.close?.();
    } catch {
      // ignore
    }
    this.socket = undefined;
  }

  private async connect(): Promise<void> {
    const WebSocketCtor = (globalThis as { WebSocket?: new (url: string) => unknown }).WebSocket;
    if (!WebSocketCtor) {
      throw new Error("WebSocket is not available in this Node.js runtime.");
    }
    const socket = new WebSocketCtor(this.wsUrl());
    this.socket = socket;
    this.addEventListener(socket, "message", (event) => this.handleRawMessage(this.readMessageData(event)).catch((error) => {
      console.warn("Gateway autonomous announce bridge event failed:", error instanceof Error ? error.message : String(error));
    }));
    this.addEventListener(socket, "close", () => {
      if (!this.stopped) {
        this.scheduleReconnect();
      }
    });
    this.addEventListener(socket, "error", () => {
      if (!this.stopped) {
        this.scheduleReconnect();
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect().catch(() => this.scheduleReconnect());
    }, this.options.reconnectMs ?? 5_000);
    this.reconnectTimer.unref?.();
  }

  private async handleRawMessage(raw: unknown): Promise<void> {
    const text = typeof raw === "string" ? raw : raw instanceof Buffer ? raw.toString("utf8") : String(raw ?? "");
    if (!text.trim()) {
      return;
    }
    let parsed: GatewayFrame;
    try {
      parsed = JSON.parse(text) as GatewayFrame;
    } catch {
      return;
    }
    if (parsed.type === "res" && parsed.id) {
      const pending = this.pending.get(parsed.id);
      if (!pending) {
        return;
      }
      this.pending.delete(parsed.id);
      if (pending.timeout) {
        clearTimeout(pending.timeout);
      }
      if (parsed.ok) {
        pending.resolve(parsed.payload);
      } else {
        pending.reject(new Error(parsed.error?.message || "Gateway request failed."));
      }
      return;
    }

    if (parsed.type === "event" && parsed.event === "connect.challenge") {
      const nonce = typeof (parsed.payload as { nonce?: unknown } | null)?.nonce === "string" ? (parsed.payload as { nonce: string }).nonce : "";
      if (nonce) {
        await this.request("connect", {
          minProtocol: 3,
          maxProtocol: 3,
          client: { id: "gateway-client", displayName: "PWA autonomous announce bridge", version: "1.0.0", platform: process.platform, mode: "backend" },
          caps: [],
          auth: this.options.token ? { token: this.options.token } : undefined,
          role: "operator",
          scopes: ["operator.read"],
        });
        await this.request("sessions.subscribe", {});
      }
      return;
    }
    if (parsed.type === "event" && parsed.event === "sessions.changed") {
      this.handleSessionsChanged(parsed.payload as SessionsChangedPayload | null);
    }
  }

  private handleSessionsChanged(payload: SessionsChangedPayload | null): void {
    const sessionKey = typeof payload?.sessionKey === "string" ? payload.sessionKey : "";
    const sessionId = typeof payload?.sessionId === "string" ? payload.sessionId : "";
    const openclawSessionId = this.openclawSessionIdFromGatewayKey(sessionKey);
    if (!openclawSessionId || !sessionId) {
      return;
    }
    if (!payload?.endedAt && payload?.status !== "idle") {
      return;
    }
    const conversation = this.options.getConversationByOpenClawSessionId(openclawSessionId);
    if (!conversation) {
      return;
    }
    this.scheduleTranscriptScan(sessionId, conversation.id);
  }

  private scheduleTranscriptScan(sessionId: string, conversationId: string): void {
    const existing = this.pendingSessionIds.get(sessionId);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      this.pendingSessionIds.delete(sessionId);
      this.scanTranscript(sessionId, conversationId).catch((error) => {
        console.warn("Gateway autonomous announce bridge scan failed:", error instanceof Error ? error.message : String(error));
      });
    }, this.options.settleMs ?? 1_000);
    timer.unref?.();
    this.pendingSessionIds.set(sessionId, timer);
  }

  private async scanTranscript(sessionId: string, conversationId: string): Promise<void> {
    const path = join(this.options.sessionsDir ?? DEFAULT_SESSIONS_DIR, `${sessionId}.trajectory.jsonl`);
    const content = await readFile(path, "utf8").catch(() => "");
    if (!content.trim()) {
      return;
    }
    for (const line of content.split(/\r?\n/)) {
      if (!line.includes('"model.completed"') || !line.includes('"announce:v1:')) {
        continue;
      }
      let record: ModelCompletedRecord;
      try {
        record = JSON.parse(line) as ModelCompletedRecord;
      } catch {
        continue;
      }
      if (record.type !== "model.completed" || !record.runId?.startsWith("announce:v1:")) {
        continue;
      }
      if (this.seenRunIds.has(record.runId)) {
        continue;
      }
      const text = this.announcementText(record).trim();
      if (!text) {
        continue;
      }
      const id = `msg_announce_${createHash("sha256").update(record.runId).digest("hex").slice(0, 24)}`;
      const createdAt = record.ts ?? new Date().toISOString();
      const attachments = await this.options.attachmentsFromMediaRefs(text);
      try {
        this.options.messageStore.addMessage({
          id,
          conversationId,
          role: "assistant",
          text,
          createdAt,
          completedAt: createdAt,
          attachments,
        });
      } catch (error) {
        if (error instanceof Error && /UNIQUE|constraint/i.test(error.message)) {
          this.seenRunIds.add(record.runId);
          continue;
        }
        throw error;
      }
      this.seenRunIds.add(record.runId);
      this.options.onAnnouncement?.({ id, conversationId, text, attachments, createdAt });
    }
  }

  private announcementText(record: ModelCompletedRecord): string {
    const childResult = this.childResultText(record);
    if (childResult) {
      return this.withMediaLines(childResult);
    }
    return this.assistantText(record);
  }

  private assistantText(record: ModelCompletedRecord): string {
    const texts = record.data?.assistantTexts;
    if (!Array.isArray(texts)) {
      return "";
    }
    return texts.filter((value): value is string => typeof value === "string" && value.trim().length > 0).join("\n\n");
  }

  private childResultText(record: ModelCompletedRecord): string | null {
    const prompt = typeof record.data?.finalPromptText === "string" ? record.data.finalPromptText : "";
    const match = prompt.match(/<<<BEGIN_UNTRUSTED_CHILD_RESULT>>>\s*([\s\S]*?)\s*<<<END_UNTRUSTED_CHILD_RESULT>>>/);
    const text = match?.[1]?.trim();
    return text || null;
  }

  private withMediaLines(text: string): string {
    const existing = new Set([...text.matchAll(/^\s*MEDIA:\s*(.+?)\s*$/gim)].map((match) => match[1]?.trim()).filter(Boolean));
    const mediaPaths = [...text.matchAll(/`(\/home\/[^`\n]+?\.(?:xlsx|xls|pdf|csv|zip|png|jpe?g|webp))`/gi)]
      .map((match) => match[1]?.trim())
      .filter((value): value is string => Boolean(value) && value.includes("/.openclaw/media/outbound/"));
    const additions: string[] = [];
    for (const mediaPath of mediaPaths) {
      if (!existing.has(mediaPath)) {
        existing.add(mediaPath);
        additions.push(`MEDIA:${mediaPath}`);
      }
    }
    return additions.length > 0 ? `${text}\n\n${additions.join("\n\n")}` : text;
  }

  private openclawSessionIdFromGatewayKey(sessionKey: string): string | null {
    const prefix = `agent:${this.options.agentId ?? "main"}:`;
    if (sessionKey.startsWith(prefix)) {
      return sessionKey.slice(prefix.length);
    }
    return sessionKey.startsWith("web-conv_") ? sessionKey : null;
  }

  private wsUrl(): string {
    const url = new URL(this.options.baseUrl ?? DEFAULT_GATEWAY_URL);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.toString();
  }

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const socket = this.socket as { send?: (data: string) => void } | undefined;
    if (!socket?.send) {
      return Promise.reject(new Error("Gateway WebSocket is not connected."));
    }
    const id = randomUUID();
    const promise = new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Gateway request timeout for ${method}.`));
      }, 5_000);
      timeout.unref?.();
      this.pending.set(id, { resolve, reject, timeout });
    });
    socket.send(JSON.stringify({ type: "req", id, method, params }));
    return promise;
  }

  private addEventListener(socket: unknown, event: string, listener: (event?: unknown) => void): void {
    const target = socket as { addEventListener?: (event: string, listener: (event?: unknown) => void) => void; on?: (event: string, listener: (event?: unknown) => void) => void };
    if (target.addEventListener) {
      target.addEventListener(event, listener);
      return;
    }
    target.on?.(event, listener);
  }

  private readMessageData(event: unknown): unknown {
    return event && typeof event === "object" && "data" in event ? (event as { data: unknown }).data : event;
  }
}
