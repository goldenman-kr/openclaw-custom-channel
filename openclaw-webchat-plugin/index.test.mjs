import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";

import pluginEntry from "./index.js";
import packageJson from "./package.json" with { type: "json" };

const resolveOutboundSessionRoute = pluginEntry.channelPlugin.messaging.resolveOutboundSessionRoute;

function createGatewayHarness(options = {}) {
  const handlers = new Map();
  const records = [];
  const dispatches = [];
  const api = {
    config: { session: { store: options.storePath ?? "/tmp/openclaw-webchat-plugin-test-sessions.json" } },
    logger: {
      info() {},
      warn() {},
      error() {},
    },
    registerGatewayMethod(name, handler) {
      handlers.set(name, handler);
    },
    registerChannel() {},
    registrationMode: "full",
    runtime: undefined,
  };
  const fakeRuntime = {
    channel: {
      session: {
        resolveStorePath: () => api.config.session.store,
        recordInboundSession: async (record) => {
          records.push(record);
        },
      },
      reply: {
        dispatchReplyWithBufferedBlockDispatcher: async () => ({}),
      },
      inbound: {
        dispatchReply: options.dispatchReply ?? (async (dispatch) => {
          dispatches.push(dispatch);
          await dispatch.recordInboundSession({
            storePath: dispatch.storePath,
            sessionKey: dispatch.routeSessionKey,
            ctx: dispatch.ctxPayload,
            createIfMissing: dispatch.record.createIfMissing,
            updateLastRoute: dispatch.record.updateLastRoute,
          });
          return {
            dispatched: true,
            routeSessionKey: dispatch.routeSessionKey,
            dispatchResult: {
              queuedFinal: false,
              counts: {},
              failedCounts: {},
            },
          };
        }),
      },
    },
  };
  api.runtime = fakeRuntime;
  pluginEntry.setChannelRuntime(fakeRuntime);
  pluginEntry.register(api);
  return { handlers, records, dispatches };
}

async function callGatewayMethod(handler, params) {
  let response;
  await handler({
    params,
    respond(payload) {
      response = payload;
    },
  });
  return response;
}

test("does not create an outbound mirror route for valid PWA targets", () => {
  const route = resolveOutboundSessionRoute({
    cfg: { session: { dmScope: "main" } },
    agentId: "main",
    accountId: "default",
    target: "conversation:conv_test",
  });

  assert.equal(route, null);
});

test("does not create an outbound mirror route for invalid conversation targets", () => {
  assert.equal(resolveOutboundSessionRoute({ cfg: {}, agentId: "main", target: "" }), null);
  assert.equal(resolveOutboundSessionRoute({ cfg: {}, agentId: "main", target: "conversation:" }), null);
  assert.equal(resolveOutboundSessionRoute({ cfg: {}, agentId: "main", target: "conversation-job:conv_test:job:" }), null);
  assert.equal(resolveOutboundSessionRoute({ cfg: {}, agentId: "main", target: "conversation:PWA WebChat" }), null);
  assert.equal(resolveOutboundSessionRoute({ cfg: {}, agentId: "main", target: "conversation:conv_bad value" }), null);
});

test("accepts only stable PWA target ids in target resolution", () => {
  const resolver = pluginEntry.channelPlugin.messaging.targetResolver;

  assert.equal(pluginEntry.channelPlugin.messaging.normalizeTarget("conversation:conv_test-123"), "conversation:conv_test-123");
  assert.equal(pluginEntry.channelPlugin.messaging.normalizeTarget("conversation:PWA WebChat"), undefined);
  assert.equal(pluginEntry.channelPlugin.messaging.normalizeTarget("conversation:conv_bad value"), undefined);
  assert.equal(pluginEntry.channelPlugin.messaging.inferTargetChatType({ to: "conversation:conv_test-123" }), "direct");
  assert.equal(pluginEntry.channelPlugin.messaging.inferTargetChatType({ to: "conversation:conv_bad value" }), undefined);
  assert.deepEqual(resolver.resolveTarget({ input: "conversation:conv_test-123" }), {
    to: "conversation:conv_test-123",
    kind: "user",
    display: "conv_test-123",
    source: "normalized",
  });
});

test("returns compact delivery output by default", async () => {
  const originalFetch = globalThis.fetch;
  const originalVerbose = process.env.OPENCLAW_WEBCHAT_VERBOSE_DELIVERY_RECEIPT;
  delete process.env.OPENCLAW_WEBCHAT_VERBOSE_DELIVERY_RECEIPT;
  globalThis.fetch = async () => ({ ok: true });
  try {
    const result = await pluginEntry.channelPlugin.outbound.sendText({
      cfg: { channels: { "pwa-webchat": { deliveryUrl: "http://127.0.0.1/internal/openclaw/webchat-delivery" } } },
      to: "conversation-job:conv_test:job:job_test",
      text: "hello",
    });

    assert.deepEqual(Object.keys(result).sort(), ["channel", "messageId", "ok"]);
    assert.equal(result.ok, true);
    assert.equal(result.channel, "pwa-webchat");
    assert.match(result.messageId, /^oc_/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalVerbose === undefined) {
      delete process.env.OPENCLAW_WEBCHAT_VERBOSE_DELIVERY_RECEIPT;
    } else {
      process.env.OPENCLAW_WEBCHAT_VERBOSE_DELIVERY_RECEIPT = originalVerbose;
    }
  }
});

test("deduplicates identical message-tool sends within the same PWA job", async () => {
  const originalFetch = globalThis.fetch;
  const deliveries = [];
  globalThis.fetch = async (_url, init) => {
    deliveries.push(JSON.parse(init.body));
    return { ok: true };
  };
  try {
    const params = {
      cfg: { channels: { "pwa-webchat": { deliveryUrl: "http://127.0.0.1/internal/openclaw/webchat-delivery" } } },
      to: "conversation-job:conv_dedupe_test:job:job_dedupe_test",
      text: "same visible text",
    };
    const first = await pluginEntry.channelPlugin.message.send.text(params);
    const second = await pluginEntry.channelPlugin.message.send.text(params);

    assert.equal(deliveries.length, 1);
    assert.equal(first.messageId, second.messageId);
    assert.equal(second.duplicate, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not deliver NO_REPLY sentinel message-tool sends", async () => {
  const originalFetch = globalThis.fetch;
  const deliveries = [];
  globalThis.fetch = async (_url, init) => {
    deliveries.push(JSON.parse(init.body));
    return { ok: true };
  };
  try {
    const result = await pluginEntry.channelPlugin.message.send.text({
      cfg: { channels: { "pwa-webchat": { deliveryUrl: "http://127.0.0.1/internal/openclaw/webchat-delivery" } } },
      to: "conversation-job:conv_no_reply_test:job:job_no_reply_test",
      text: "NO_REPLY",
    });

    assert.equal(result.ok, true);
    assert.equal(result.silent, true);
    assert.equal(deliveries.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("forwards media URLs to the PWA delivery route", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return { ok: true };
  };
  try {
    await pluginEntry.channelPlugin.outbound.sendText({
      cfg: { channels: { "pwa-webchat": { deliveryUrl: "http://127.0.0.1/internal/openclaw/webchat-delivery" } } },
      to: "conversation:conv_test",
      text: "첨부입니다",
      mediaUrl: "/tmp/chart.png",
    });

    assert.deepEqual(requestBody.mediaUrls, ["/tmp/chart.png"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("declares and handles channel message media sends", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return { ok: true };
  };
  try {
    await pluginEntry.channelPlugin.message.send.media({
      cfg: { channels: { "pwa-webchat": { deliveryUrl: "http://127.0.0.1/internal/openclaw/webchat-delivery" } } },
      to: "conversation:conv_test",
      text: "첨부입니다",
      mediaUrl: "/tmp/chart.png",
    });

    assert.equal(pluginEntry.channelPlugin.message.durableFinal.capabilities.media, true);
    assert.deepEqual(requestBody.mediaUrls, ["/tmp/chart.png"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("can return verbose delivery receipt when explicitly enabled", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true });
  try {
    const result = await pluginEntry.channelPlugin.outbound.sendText({
      cfg: {
        channels: {
          "pwa-webchat": {
            deliveryUrl: "http://127.0.0.1/internal/openclaw/webchat-delivery",
            verboseDeliveryReceipt: true,
          },
        },
      },
      to: "conversation:conv_test",
      text: "hello",
    });

    assert.equal(result.ok, true);
    assert.equal(result.channel, "pwa-webchat");
    assert.equal(result.conversationId, "conv_test");
    assert.equal(result.receipt.primaryPlatformMessageId, result.messageId);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("keeps package channel metadata aligned with the plugin id", () => {
  assert.equal(pluginEntry.id, "pwa-webchat");
  assert.equal(packageJson.openclaw.channel.id, "pwa-webchat");
});

test("records PWA session ensure under the scoped OpenClaw session key", async () => {
  const { handlers, records } = createGatewayHarness();

  const response = await callGatewayMethod(handlers.get("webchat.session.ensure"), {
    conversationId: "conv_test",
    agentId: "main",
    userId: "user_test",
  });

  assert.equal(response.ok, true);
  assert.equal(response.result.sessionKey, "pwa-webchat:conv_test");
  assert.equal(response.result.scopedSessionKey, "agent:main:pwa-webchat:conv_test");
  assert.equal(records.length, 1);
  assert.equal(records[0].sessionKey, "agent:main:pwa-webchat:conv_test");
  assert.equal(records[0].ctx.SessionKey, "agent:main:pwa-webchat:conv_test");
  assert.equal(records[0].updateLastRoute.sessionKey, "agent:main:pwa-webchat:conv_test");
  assert.equal(records[0].updateLastRoute.to, "conversation:conv_test");
});

test("dispatches PWA sends with the scoped OpenClaw session key", async () => {
  const { handlers, records, dispatches } = createGatewayHarness();

  const response = await callGatewayMethod(handlers.get("webchat.send"), {
    conversationId: "conv_test",
    jobId: "job_test",
    agentId: "main",
    userId: "user_test",
    message: "hello",
  });

  assert.equal(response.ok, true);
  assert.equal(dispatches.length, 1);
  assert.equal(dispatches[0].routeSessionKey, "agent:main:pwa-webchat:conv_test");
  assert.equal(dispatches[0].ctxPayload.SessionKey, "agent:main:pwa-webchat:conv_test");
  assert.equal(dispatches[0].ctxPayload.OriginatingTo, "conversation-job:conv_test:job:job_test");
  assert.equal(dispatches[0].ctxPayload.To, "conversation-job:conv_test:job:job_test");
  assert.equal(dispatches[0].record.updateLastRoute.sessionKey, "agent:main:pwa-webchat:conv_test");
  assert.equal(dispatches[0].record.updateLastRoute.to, "conversation:conv_test");
  assert.equal(records.length, 1);
  assert.equal(records[0].sessionKey, "agent:main:pwa-webchat:conv_test");
});

test("delivers fallback final text when message-tool delivery is absent", async () => {
  const originalFetch = globalThis.fetch;
  const deliveries = [];
  globalThis.fetch = async (_url, init) => {
    deliveries.push(JSON.parse(init.body));
    return { ok: true };
  };
  try {
    const { handlers } = createGatewayHarness({
      dispatchReply: async (dispatch) => {
        await dispatch.replyOptions.onBlockReplyQueued({ text: "local model final" });
        return {
          dispatched: true,
          routeSessionKey: dispatch.routeSessionKey,
          dispatchResult: {
            queuedFinal: true,
            counts: {},
            failedCounts: {},
          },
        };
      },
    });

    const response = await callGatewayMethod(handlers.get("webchat.send"), {
      conversationId: "conv_test",
      jobId: "job_test",
      agentId: "main",
      userId: "user_test",
      model: "llamacpp/Qwen3.6-27B-MTP",
      message: "hello",
    });

    assert.equal(response.ok, true);
    assert.equal(response.result.reply, "local model final");
    assert.equal(response.result.deliverySignals.final, 1);
    assert.equal(response.result.deliverySignals.fallbackFinal, 1);
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].phase, "final");
    assert.equal(deliveries[0].conversationId, "conv_test");
    assert.equal(deliveries[0].jobId, "job_test");
    assert.equal(deliveries[0].text, "local model final");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("delivers fallback final text from the session transcript when callbacks miss it", async () => {
  const originalFetch = globalThis.fetch;
  const deliveries = [];
  const tempDir = await mkdtemp(join(tmpdir(), "openclaw-webchat-plugin-test-"));
  const storePath = join(tempDir, "sessions.json");
  const sessionFile = join(tempDir, "session_test.jsonl");
  const routeSessionKey = "agent:main:pwa-webchat:conv_test";
  globalThis.fetch = async (_url, init) => {
    deliveries.push(JSON.parse(init.body));
    return { ok: true };
  };
  try {
    await writeFile(storePath, JSON.stringify({
      [routeSessionKey]: {
        sessionId: "session_test",
        sessionFile,
      },
    }));

    const { handlers } = createGatewayHarness({
      storePath,
      dispatchReply: async (dispatch) => {
        await writeFile(sessionFile, [
          JSON.stringify({ type: "session", id: "session_test", timestamp: new Date().toISOString() }),
          JSON.stringify({
            type: "message",
            timestamp: new Date(Date.now() + 5).toISOString(),
            message: {
              role: "assistant",
              content: [{ type: "text", text: "transcript only final" }],
            },
          }),
          "",
        ].join("\n"));
        return {
          dispatched: true,
          routeSessionKey: dispatch.routeSessionKey,
          dispatchResult: {
            queuedFinal: false,
            observedReplyDelivery: false,
            sourceReplyDeliveryMode: "message_tool_only",
            counts: {},
            failedCounts: {},
          },
        };
      },
    });

    const response = await callGatewayMethod(handlers.get("webchat.send"), {
      conversationId: "conv_test",
      jobId: "job_test",
      agentId: "main",
      userId: "user_test",
      model: "llamacpp/Qwen3.6-27B-MTP",
      message: "hello",
    });

    assert.equal(response.ok, true);
    assert.equal(response.result.reply, "transcript only final");
    assert.equal(response.result.deliverySignals.final, 1);
    assert.equal(response.result.deliverySignals.fallbackFinal, 1);
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].phase, "final");
    assert.equal(deliveries[0].text, "transcript only final");
  } finally {
    globalThis.fetch = originalFetch;
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("delivers transcript intermediate assistant text before transcript final fallback", async () => {
  const originalFetch = globalThis.fetch;
  const deliveries = [];
  const tempDir = await mkdtemp(join(tmpdir(), "openclaw-webchat-plugin-test-"));
  const storePath = join(tempDir, "sessions.json");
  const sessionFile = join(tempDir, "session_test.jsonl");
  const routeSessionKey = "agent:main:pwa-webchat:conv_transcript_middle_test";
  globalThis.fetch = async (_url, init) => {
    deliveries.push(JSON.parse(init.body));
    return { ok: true };
  };
  try {
    await writeFile(storePath, JSON.stringify({
      [routeSessionKey]: {
        sessionId: "session_test",
        sessionFile,
      },
    }));

    const { handlers } = createGatewayHarness({
      storePath,
      dispatchReply: async (dispatch) => {
        await writeFile(sessionFile, [
          JSON.stringify({ type: "session", id: "session_test", timestamp: new Date().toISOString() }),
          JSON.stringify({
            type: "message",
            timestamp: new Date(Date.now() + 5).toISOString(),
            message: {
              role: "assistant",
              content: [{ type: "text", text: "중간 상태를 확인했습니다." }],
            },
          }),
          JSON.stringify({
            type: "message",
            timestamp: new Date(Date.now() + 10).toISOString(),
            message: {
              role: "assistant",
              content: [{ type: "text", text: "최종 정리입니다." }],
            },
          }),
          "",
        ].join("\n"));
        return {
          dispatched: true,
          routeSessionKey: dispatch.routeSessionKey,
          dispatchResult: {
            queuedFinal: false,
            observedReplyDelivery: false,
            sourceReplyDeliveryMode: "message_tool_only",
            counts: {},
            failedCounts: {},
          },
        };
      },
    });

    const response = await callGatewayMethod(handlers.get("webchat.send"), {
      conversationId: "conv_transcript_middle_test",
      jobId: "job_transcript_middle_test",
      agentId: "main",
      userId: "user_test",
      model: "llamacpp/Qwen3.6-27B-MTP",
      message: "hello",
    });

    assert.equal(response.ok, true);
    assert.equal(response.result.reply, "최종 정리입니다.");
    assert.equal(response.result.deliverySignals.transcriptEvent, 1);
    assert.equal(response.result.deliverySignals.final, 1);
    assert.deepEqual(deliveries.map((delivery) => [delivery.phase, delivery.text]), [
      ["event", "중간 상태를 확인했습니다."],
      ["final", "최종 정리입니다."],
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("ignores NO_REPLY transcript sentinel when fallback reads assistant text", async () => {
  const originalFetch = globalThis.fetch;
  const deliveries = [];
  const tempDir = await mkdtemp(join(tmpdir(), "openclaw-webchat-plugin-test-"));
  const storePath = join(tempDir, "sessions.json");
  const sessionFile = join(tempDir, "session_test.jsonl");
  const routeSessionKey = "agent:main:pwa-webchat:conv_no_reply_transcript_test";
  globalThis.fetch = async (_url, init) => {
    deliveries.push(JSON.parse(init.body));
    return { ok: true };
  };
  try {
    await writeFile(storePath, JSON.stringify({
      [routeSessionKey]: {
        sessionId: "session_test",
        sessionFile,
      },
    }));

    const { handlers } = createGatewayHarness({
      storePath,
      dispatchReply: async (dispatch) => {
        await writeFile(sessionFile, [
          JSON.stringify({ type: "session", id: "session_test", timestamp: new Date().toISOString() }),
          JSON.stringify({
            type: "message",
            timestamp: new Date(Date.now() + 5).toISOString(),
            message: {
              role: "assistant",
              content: [{ type: "text", text: "NO_REPLY" }],
            },
          }),
          "",
        ].join("\n"));
        return {
          dispatched: true,
          routeSessionKey: dispatch.routeSessionKey,
          dispatchResult: {
            queuedFinal: false,
            observedReplyDelivery: false,
            sourceReplyDeliveryMode: "message_tool_only",
            counts: {},
            failedCounts: {},
          },
        };
      },
    });

    const response = await callGatewayMethod(handlers.get("webchat.send"), {
      conversationId: "conv_no_reply_transcript_test",
      jobId: "job_no_reply_transcript_test",
      agentId: "main",
      userId: "user_test",
      model: "llamacpp/Qwen3.6-27B-MTP",
      message: "hello",
    });

    assert.equal(response.ok, true);
    assert.equal(response.result.reply, "");
    assert.equal(response.result.deliverySignals.final, 0);
    assert.equal(response.result.deliverySignals.fallbackFinal, 0);
    assert.equal(deliveries.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("delivers transcript final text even when message-tool delivery was observed", async () => {
  const originalFetch = globalThis.fetch;
  const deliveries = [];
  const tempDir = await mkdtemp(join(tmpdir(), "openclaw-webchat-plugin-test-"));
  const storePath = join(tempDir, "sessions.json");
  const sessionFile = join(tempDir, "session_test.jsonl");
  const routeSessionKey = "agent:main:pwa-webchat:conv_test";
  globalThis.fetch = async (_url, init) => {
    deliveries.push(JSON.parse(init.body));
    return { ok: true };
  };
  try {
    await writeFile(storePath, JSON.stringify({
      [routeSessionKey]: {
        sessionId: "session_test",
        sessionFile,
      },
    }));

    const { handlers } = createGatewayHarness({
      storePath,
      dispatchReply: async (dispatch) => {
        await writeFile(sessionFile, [
          JSON.stringify({ type: "session", id: "session_test", timestamp: new Date().toISOString() }),
          JSON.stringify({
            type: "message",
            timestamp: new Date(Date.now() + 5).toISOString(),
            message: {
              role: "assistant",
              content: [{ type: "text", text: "message tool was sent, but this final text should also show" }],
            },
          }),
          "",
        ].join("\n"));
        return {
          dispatched: true,
          routeSessionKey: dispatch.routeSessionKey,
          dispatchResult: {
            queuedFinal: false,
            observedReplyDelivery: true,
            sourceReplyDeliveryMode: "message_tool_only",
            counts: {},
            failedCounts: {},
          },
        };
      },
    });

    const response = await callGatewayMethod(handlers.get("webchat.send"), {
      conversationId: "conv_test",
      jobId: "job_test",
      agentId: "main",
      userId: "user_test",
      model: "llamacpp/Qwen3.6-27B-MTP",
      message: "hello",
    });

    assert.equal(response.ok, true);
    assert.equal(response.result.reply, "message tool was sent, but this final text should also show");
    assert.equal(response.result.deliverySignals.final, 1);
    assert.equal(response.result.deliverySignals.fallbackFinal, 1);
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].phase, "final");
    assert.equal(deliveries[0].text, "message tool was sent, but this final text should also show");
  } finally {
    globalThis.fetch = originalFetch;
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("does not deliver assistant text fallback for non-llamacpp models", async () => {
  const originalFetch = globalThis.fetch;
  const deliveries = [];
  const tempDir = await mkdtemp(join(tmpdir(), "openclaw-webchat-plugin-test-"));
  const storePath = join(tempDir, "sessions.json");
  const sessionFile = join(tempDir, "session_test.jsonl");
  const routeSessionKey = "agent:main:pwa-webchat:conv_non_llamacpp_test";
  globalThis.fetch = async (_url, init) => {
    deliveries.push(JSON.parse(init.body));
    return { ok: true };
  };
  try {
    await writeFile(storePath, JSON.stringify({
      [routeSessionKey]: {
        sessionId: "session_test",
        sessionFile,
      },
    }));

    const { handlers } = createGatewayHarness({
      storePath,
      dispatchReply: async (dispatch) => {
        await dispatch.replyOptions.onBlockReplyQueued({ text: "callback final should not fallback" });
        await writeFile(sessionFile, [
          JSON.stringify({ type: "session", id: "session_test", timestamp: new Date().toISOString() }),
          JSON.stringify({
            type: "message",
            timestamp: new Date(Date.now() + 5).toISOString(),
            message: {
              role: "assistant",
              content: [{ type: "text", text: "transcript final should not fallback" }],
            },
          }),
          "",
        ].join("\n"));
        return {
          dispatched: true,
          routeSessionKey: dispatch.routeSessionKey,
          dispatchResult: {
            queuedFinal: false,
            observedReplyDelivery: false,
            sourceReplyDeliveryMode: "message_tool_only",
            counts: {},
            failedCounts: {},
          },
        };
      },
    });

    const response = await callGatewayMethod(handlers.get("webchat.send"), {
      conversationId: "conv_non_llamacpp_test",
      jobId: "job_non_llamacpp_test",
      agentId: "main",
      userId: "user_test",
      model: "openai-codex/gpt-5.5",
      message: "hello",
    });

    assert.equal(response.ok, true);
    assert.equal(response.result.reply, "");
    assert.equal(response.result.deliverySignals.final, 0);
    assert.equal(response.result.deliverySignals.fallbackFinal, 0);
    assert.equal(response.result.deliverySignals.transcriptEvent, 0);
    assert.equal(deliveries.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("aborts an active PWA send by job id", async () => {
  let abortObserved;
  const abortPromise = new Promise((resolve) => {
    abortObserved = resolve;
  });
  const { handlers } = createGatewayHarness({
    dispatchReply: async (dispatch) => {
      dispatch.replyOptions.abortSignal.addEventListener("abort", () => abortObserved(true), { once: true });
      await abortPromise;
      return {
        dispatched: true,
        routeSessionKey: dispatch.routeSessionKey,
        dispatchResult: {
          queuedFinal: false,
          counts: {},
          failedCounts: {},
        },
      };
    },
  });

  const sendPromise = callGatewayMethod(handlers.get("webchat.send"), {
    conversationId: "conv_test",
    jobId: "job_test",
    agentId: "main",
    userId: "user_test",
    message: "hello",
  });
  await Promise.resolve();

  const abortResponse = await callGatewayMethod(handlers.get("webchat.abort"), {
    conversationId: "conv_test",
    jobId: "job_test",
    agentId: "main",
  });
  const sendResponse = await sendPromise;

  assert.equal(abortResponse.ok, true);
  assert.equal(abortResponse.result.aborted, true);
  assert.deepEqual(abortResponse.result.runIds, ["job_test"]);
  assert.equal(sendResponse.ok, true);
});

test("returns not aborted when no active PWA send matches", async () => {
  const { handlers } = createGatewayHarness();

  const response = await callGatewayMethod(handlers.get("webchat.abort"), {
    conversationId: "conv_test",
    jobId: "job_missing",
    agentId: "main",
  });

  assert.equal(response.ok, true);
  assert.equal(response.result.aborted, false);
  assert.deepEqual(response.result.runIds, []);
});
