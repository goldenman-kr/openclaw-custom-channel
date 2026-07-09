import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { GatewayNativeWebChatOpenClawClient } from "./GatewayNativeWebChatOpenClawClient.js";

class FakeWebSocket {
  static sentFrames: Array<Record<string, unknown>> = [];
  static webchatAbortPayload: Record<string, unknown> = { ok: true, result: { aborted: true, runIds: ["job_test"] } };
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
      : frame.method === "webchat.session.ensure"
        ? { ok: true, result: { conversationId: "conv_test", sessionKey: "pwa-webchat:conv_test", scopedSessionKey: "agent:main:pwa-webchat:conv_test" } }
        : frame.method === "webchat.abort"
          ? FakeWebSocket.webchatAbortPayload
        : frame.method === "chat.abort"
          ? { ok: true, result: { aborted: true, runIds: ["run_test"] } }
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
  FakeWebSocket.webchatAbortPayload = { ok: true, result: { aborted: true, runIds: ["job_test"] } };
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
    const result = await client.sendMessage({ sessionId: "conv_native_password_test", message: "hello" });

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
    const result = await client.sendMessage({ sessionId: "conv_native_token_test", message: "hello" });

    assert.equal(result.reply, "ok");
    const connectFrame = FakeWebSocket.sentFrames.find((frame) => frame.method === "connect");
    assert.deepEqual((connectFrame?.params as { auth?: unknown })?.auth, { token: "gateway-token" });
  });
});

test("uses conversation id as the native PWA Gateway conversation contract", async () => {
  await withFakeWebSocket(async () => {
    const client = new GatewayNativeWebChatOpenClawClient(
      "http://127.0.0.1:18789",
      "gateway-token",
      "gateway-password",
      5_000,
      "main",
      "token",
    );
    await client.sendMessage({
      sessionId: "conv_canonical",
      message: "hello",
      metadata: {
        webchat: {
          conversationId: "conv_canonical",
          jobId: "job_test",
        },
      },
    });

    const sendFrame = FakeWebSocket.sentFrames.find((frame) => frame.method === "webchat.send");
    const params = sendFrame?.params as Record<string, unknown>;
    assert.equal(params.conversationId, "conv_canonical");
    assert.equal(params.sessionKey, undefined);
    assert.equal(params.jobId, "job_test");
    assert.equal(params.message, "hello");
    assert.equal(params.agentId, "main");
  });
});

test("passes the active PWA session model override to webchat.send", async (t) => {
  const sessionDir = await mkdtemp(join(tmpdir(), "openclaw-native-webchat-session-store-"));
  const sessionStorePath = join(sessionDir, "sessions.json");
  const originalStorePath = process.env.OPENCLAW_SESSION_STORE_PATH;
  process.env.OPENCLAW_SESSION_STORE_PATH = sessionStorePath;
  t.after(() => {
    if (originalStorePath === undefined) {
      delete process.env.OPENCLAW_SESSION_STORE_PATH;
    } else {
      process.env.OPENCLAW_SESSION_STORE_PATH = originalStorePath;
    }
    void rm(sessionDir, { recursive: true, force: true });
  });

  await writeFile(sessionStorePath, JSON.stringify({
    "pwa-webchat:conv_model_override": {
      providerOverride: "llamacpp",
      modelOverride: "Qwen3.6-27B-MTP",
    },
  }));

  await withFakeWebSocket(async () => {
    const client = new GatewayNativeWebChatOpenClawClient(
      "http://127.0.0.1:18789",
      "gateway-token",
      "gateway-password",
      5_000,
      "main",
      "token",
    );
    await client.sendMessage({
      sessionId: "conv_model_override",
      message: "hello",
      metadata: {
        webchat: {
          conversationId: "conv_model_override",
          jobId: "job_test",
        },
      },
    });

    const sendFrame = FakeWebSocket.sentFrames.find((frame) => frame.method === "webchat.send");
    const params = sendFrame?.params as Record<string, unknown>;
    assert.equal(params.model, "llamacpp/Qwen3.6-27B-MTP");
  });
});

test("materializes native webchat attachments and includes local paths in the Gateway message", async (t) => {
  const uploadDir = await mkdtemp(join(tmpdir(), "openclaw-native-webchat-attachments-"));
  t.after(() => {
    void rm(uploadDir, { recursive: true, force: true });
  });

  await withFakeWebSocket(async () => {
    const client = new GatewayNativeWebChatOpenClawClient(
      "http://127.0.0.1:18789",
      "gateway-token",
      "gateway-password",
      5_000,
      "main",
      "token",
      uploadDir,
    );
    await client.sendMessage({
      sessionId: "conv_attachment_test",
      message: "첨부를 처리해줘",
      attachments: [
        {
          type: "image",
          name: "image.png",
          mime_type: "image/png",
          content_base64: Buffer.from("fake image bytes").toString("base64"),
        },
      ],
    });

    const sendFrame = FakeWebSocket.sentFrames.find((frame) => frame.method === "webchat.send");
    const message = (sendFrame?.params as { message?: string })?.message ?? "";
    assert.match(message, /첨부 파일이 서버에 저장되어 있습니다/);
    assert.match(message, /image\.png \(image\/png, image\)/);
    assert.match(message, /저장 경로: /);

    const filePath = message.match(/저장 경로: (.+)$/m)?.[1];
    assert.ok(filePath);
    assert.equal(await readFile(filePath, "utf8"), "fake image bytes");
  });
});

test("maps legacy PWA DB session ids onto the canonical native PWA Gateway session key", async () => {
  await withFakeWebSocket(async () => {
    const client = new GatewayNativeWebChatOpenClawClient(
      "http://127.0.0.1:18789",
      "gateway-token",
      "gateway-password",
      5_000,
      "main",
      "token",
    );
    await client.sendMessage({ sessionId: "web-conv_abc-123", message: "hello" });

    const sendFrame = FakeWebSocket.sentFrames.find((frame) => frame.method === "webchat.send");
    assert.equal((sendFrame?.params as { conversationId?: unknown })?.conversationId, "conv_abc-123");
    assert.equal((sendFrame?.params as { sessionKey?: unknown })?.sessionKey, undefined);
  });
});

test("ensures PWA conversation sessions through the Gateway protocol", async () => {
  await withFakeWebSocket(async () => {
    const client = new GatewayNativeWebChatOpenClawClient(
      "http://127.0.0.1:18789",
      "gateway-token",
      "gateway-password",
      5_000,
      "main",
      "token",
    );
    const result = await client.ensureConversationSession({ conversationId: "conv_test", userId: "usr_test" });

    assert.equal(result.conversationId, "conv_test");
    assert.equal(result.sessionKey, "pwa-webchat:conv_test");
    const ensureFrame = FakeWebSocket.sentFrames.find((frame) => frame.method === "webchat.session.ensure");
    assert.equal((ensureFrame?.params as { conversationId?: unknown })?.conversationId, "conv_test");
    assert.equal((ensureFrame?.params as { sessionKey?: unknown })?.sessionKey, undefined);
  });
});

test("aborts the active native PWA Gateway webchat job", async () => {
  await withFakeWebSocket(async () => {
    const client = new GatewayNativeWebChatOpenClawClient(
      "http://127.0.0.1:18789",
      "gateway-token",
      "gateway-password",
      5_000,
      "main",
      "token",
    );

    const result = await client.abortActive({ conversationId: "conv_test", jobId: "job_test" });

    assert.equal(result.aborted, true);
    assert.deepEqual(result.runIds, ["job_test"]);
    const abortFrame = FakeWebSocket.sentFrames.find((frame) => frame.method === "webchat.abort");
    assert.equal((abortFrame?.params as { conversationId?: unknown })?.conversationId, "conv_test");
    assert.equal((abortFrame?.params as { jobId?: unknown })?.jobId, "job_test");
    assert.equal((abortFrame?.params as { sessionKey?: unknown })?.sessionKey, undefined);
    assert.equal((abortFrame?.params as { agentId?: unknown })?.agentId, "main");
  });
});

test("falls back to core chat abort when native PWA abort has no active entry", async () => {
  await withFakeWebSocket(async () => {
    FakeWebSocket.webchatAbortPayload = { ok: true, result: { aborted: false, runIds: [] } };
    const client = new GatewayNativeWebChatOpenClawClient(
      "http://127.0.0.1:18789",
      "gateway-token",
      "gateway-password",
      5_000,
      "main",
      "token",
    );

    const result = await client.abortActive({ conversationId: "conv_test", jobId: "job_test" });

    assert.equal(result.aborted, true);
    assert.deepEqual(result.runIds, ["run_test"]);
    const fallbackFrame = FakeWebSocket.sentFrames.find((frame) => frame.method === "chat.abort");
    assert.equal((fallbackFrame?.params as { sessionKey?: unknown })?.sessionKey, "agent:main:pwa-webchat:conv_test");
    assert.equal((fallbackFrame?.params as { agentId?: unknown })?.agentId, "main");
  });
});
