import assert from "node:assert/strict";
import test from "node:test";

import pluginEntry from "./index.js";
import packageJson from "./package.json" with { type: "json" };

const resolveOutboundSessionRoute = pluginEntry.channelPlugin.messaging.resolveOutboundSessionRoute;

function createGatewayHarness(options = {}) {
  const handlers = new Map();
  const records = [];
  const dispatches = [];
  const api = {
    config: { session: { store: "/tmp/openclaw-webchat-plugin-test-sessions.json" } },
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
  assert.equal(dispatches[0].record.updateLastRoute.sessionKey, "agent:main:pwa-webchat:conv_test");
  assert.equal(records.length, 1);
  assert.equal(records[0].sessionKey, "agent:main:pwa-webchat:conv_test");
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
