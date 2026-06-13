import assert from "node:assert/strict";
import test from "node:test";
import { GatewayNativeWebChatOpenClawClient } from "./GatewayNativeWebChatOpenClawClient.js";

class FakeWebSocket {
  static sentFrames: Array<Record<string, unknown>> = [];
  private readonly listeners = new Map<string, Array<(event?: unknown) => void>>();

  constructor(_url: string) {
    setTimeout(() => {
      this.dispatch("message", {
        data: JSON.stringify({
          type: "event",
          event: "connect.challenge",
          payload: { nonce: "test-nonce" },
        }),
      });
    }, 0);
  }

  addEventListener(event: string, listener: (event?: unknown) => void): void {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
  }

  send(data: string): void {
    const frame = JSON.parse(data) as Record<string, unknown>;
    FakeWebSocket.sentFrames.push(frame);
    const id = typeof frame.id === "string" ? frame.id : "";
    if (!id) {
      return;
    }

    const payload = frame.method === "webchat.send"
      ? { ok: true, result: { reply: "ok", deliveryHandled: true, partialCount: 0 } }
      : {};

    setTimeout(() => {
      this.dispatch("message", {
        data: JSON.stringify({
          type: "res",
          id,
          ok: true,
          payload,
        }),
      });
    }, 0);
  }

  close(): void {
    this.dispatch("close");
  }

  private dispatch(event: string, payload?: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(payload);
    }
  }
}

async function withFakeWebSocket(testBody: () => Promise<void>): Promise<void> {
  const originalWebSocket = (globalThis as { WebSocket?: unknown }).WebSocket;
  FakeWebSocket.sentFrames = [];
  (globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocket;
  try {
    await testBody();
  } finally {
    (globalThis as { WebSocket?: unknown }).WebSocket = originalWebSocket;
  }
}

test("uses configured Gateway password for native webchat when auth mode is password", async () => {
  await withFakeWebSocket(async () => {
    const client = new GatewayNativeWebChatOpenClawClient(
      "http://127.0.0.1:18789",
      "gateway-token",
      "gateway-password",
      5_000,
      "main",
      "password",
    );
    const result = await client.sendMessage({ sessionId: "session-native-password-test", message: "hello" });

    assert.equal(result.reply, "ok");
    const connectFrame = FakeWebSocket.sentFrames.find((frame) => frame.method === "connect");
    assert.deepEqual((connectFrame?.params as { auth?: unknown })?.auth, { password: "gateway-password" });
  });
});

test("uses configured Gateway token for native webchat when auth mode is token", async () => {
  await withFakeWebSocket(async () => {
    const client = new GatewayNativeWebChatOpenClawClient(
      "http://127.0.0.1:18789",
      "gateway-token",
      "gateway-password",
      5_000,
      "main",
      "token",
    );
    const result = await client.sendMessage({ sessionId: "session-native-token-test", message: "hello" });

    assert.equal(result.reply, "ok");
    const connectFrame = FakeWebSocket.sentFrames.find((frame) => frame.method === "connect");
    assert.deepEqual((connectFrame?.params as { auth?: unknown })?.auth, { token: "gateway-token" });
  });
});
