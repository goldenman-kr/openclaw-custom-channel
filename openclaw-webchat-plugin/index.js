import { randomUUID } from "node:crypto";
import { defineChannelPluginEntry } from "/home/orbsian/.npm-global/lib/node_modules/openclaw/dist/plugin-sdk/channel-core.js";
import { buildChannelInboundEventContext } from "/home/orbsian/.npm-global/lib/node_modules/openclaw/dist/plugin-sdk/channel-inbound.js";
import {
  createMessageReceiptFromOutboundResults,
  defineChannelMessageAdapter,
} from "/home/orbsian/.npm-global/lib/node_modules/openclaw/dist/plugin-sdk/channel-outbound.js";

const CHANNEL_ID = "webchat";
let runtime;

function getChannelConfig(cfg) {
  return cfg?.channels?.webchat ?? {};
}

function deliveryUrlFromConfig(cfg) {
  return getChannelConfig(cfg).deliveryUrl || process.env.OPENCLAW_WEBCHAT_DELIVERY_URL || "http://127.0.0.1:29999/internal/openclaw/webchat-delivery";
}

function deliverySecretFromConfig(cfg) {
  return getChannelConfig(cfg).deliverySecret || process.env.OPENCLAW_WEBCHAT_DELIVERY_SECRET || process.env.OPENCLAW_GATEWAY_TOKEN || "";
}

async function postDelivery(cfg, payload) {
  const secret = deliverySecretFromConfig(cfg);
  const response = await fetch(deliveryUrlFromConfig(cfg), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret ? { "x-openclaw-webchat-secret": secret } : {}),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(Number(process.env.OPENCLAW_WEBCHAT_DELIVERY_TIMEOUT_MS ?? 15000)),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`webchat delivery failed: ${response.status} ${text.slice(0, 300)}`);
  }
}

function parseTarget(to) {
  const raw = String(to || "");
  if (raw.startsWith("conversation:")) {
    return { conversationId: raw.slice("conversation:".length), jobId: undefined };
  }
  if (raw.startsWith("conversation-job:")) {
    const value = raw.slice("conversation-job:".length);
    const [conversationId, jobId] = value.split(":job:");
    return { conversationId, jobId };
  }
  return { conversationId: raw, jobId: undefined };
}

async function sendWebchatText(ctx, phase = "final", messageId) {
  const target = parseTarget(ctx.to);
  const resolvedMessageId = messageId || `oc_${randomUUID()}`;
  await postDelivery(ctx.cfg, {
    phase,
    conversationId: target.conversationId,
    jobId: target.jobId,
    messageId: resolvedMessageId,
    text: ctx.text,
    createdAt: new Date().toISOString(),
  });
  return {
    receipt: createMessageReceiptFromOutboundResults({
      results: [{
        channel: CHANNEL_ID,
        messageId: resolvedMessageId,
        conversationId: target.conversationId,
      }],
      kind: phase === "partial" ? "preview" : "text",
      replyToId: ctx.replyToId ?? undefined,
      threadId: ctx.threadId == null ? undefined : String(ctx.threadId),
    }),
    messageId: resolvedMessageId,
  };
}

const messageAdapter = defineChannelMessageAdapter({
  id: CHANNEL_ID,
  durableFinal: {
    capabilities: {
      text: true,
      replyTo: true,
      thread: true,
    },
  },
  live: {
    capabilities: {
      draftPreview: true,
      previewFinalization: true,
      progressUpdates: true,
    },
    finalizer: {
      capabilities: {
        finalEdit: true,
        normalFallback: true,
        previewReceipt: true,
        retainOnAmbiguousFailure: true,
      },
    },
  },
  send: {
    text: async (ctx) => sendWebchatText(ctx, "final"),
  },
});

const plugin = {
  id: CHANNEL_ID,
  meta: {
    id: CHANNEL_ID,
    label: "WebChat",
    supportsMarkdown: true,
  },
  capabilities: {
    messages: true,
  },
  config: {
    listAccountIds: () => ["default"],
    defaultAccountId: () => "default",
    resolveAccount: () => ({ accountId: "default" }),
    isEnabled: (_account, cfg) => getChannelConfig(cfg).enabled !== false,
    isConfigured: () => true,
    describeAccount: () => ({
      id: "default",
      label: "PWA WebChat",
      configured: true,
      enabled: true,
      runtime: "ready",
    }),
  },
  message: messageAdapter,
  outbound: {
    deliveryMode: "direct",
    deliveryCapabilities: {
      durableFinal: {
        text: true,
        replyTo: true,
        thread: true,
      },
    },
    sendText: async (ctx) => {
      const result = await sendWebchatText(ctx, "final");
      return {
        channel: CHANNEL_ID,
        messageId: result.messageId,
        conversationId: parseTarget(ctx.to).conversationId,
        receipt: result.receipt,
      };
    },
  },
  messaging: {
    resolveOutboundSessionRoute({ cfg, agentId, to, accountId }) {
      const target = parseTarget(to);
      const sessionKey = `webchat:${target.conversationId}`;
      return {
        channel: CHANNEL_ID,
        accountId: accountId ?? "default",
        agentId,
        sessionKey,
        parentSessionKey: `agent:${agentId}`,
        peer: { kind: "direct", id: target.conversationId },
        chatType: "direct",
        from: "webchat",
        to,
        cfg,
      };
    },
  },
};

function assertRuntime() {
  if (!runtime) {
    throw new Error("webchat runtime is not ready");
  }
  return runtime;
}

function readString(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function summarizeDispatchResult(result) {
  if (!result || typeof result !== "object") {
    return { type: typeof result };
  }
  const dispatchResult = result.dispatchResult && typeof result.dispatchResult === "object"
    ? result.dispatchResult
    : undefined;
  return {
    admission: result.admission?.kind,
    admissionReason: result.admission?.reason,
    dispatched: result.dispatched === true,
    routeSessionKey: result.routeSessionKey,
    dispatch: dispatchResult ? {
      queuedFinal: dispatchResult.queuedFinal,
      observedReplyDelivery: dispatchResult.observedReplyDelivery,
      sourceReplyDeliveryMode: dispatchResult.sourceReplyDeliveryMode,
      sendPolicyDenied: dispatchResult.sendPolicyDenied,
      counts: dispatchResult.counts,
      failedCounts: dispatchResult.failedCounts,
    } : undefined,
  };
}

async function handleSend(api, params) {
  const rt = assertRuntime();
  const conversationId = readString(params?.conversationId, "conversationId");
  const jobId = typeof params?.jobId === "string" && params.jobId.trim() ? params.jobId.trim() : undefined;
  const message = readString(params?.message, "message");
  const userId = typeof params?.userId === "string" && params.userId.trim() ? params.userId.trim() : "webchat-user";
  const agentId = typeof params?.agentId === "string" && params.agentId.trim() ? params.agentId.trim() : "main";
  const messageId = typeof params?.messageId === "string" && params.messageId.trim() ? params.messageId.trim() : `web_${randomUUID()}`;
  const routeSessionKey = `webchat:${conversationId}`;
  const target = jobId ? `conversation-job:${conversationId}:job:${jobId}` : `conversation:${conversationId}`;
  const storePath = rt.channel.session.resolveStorePath(api.config.session?.store, { agentId });
  const ctxPayload = buildChannelInboundEventContext({
    channel: CHANNEL_ID,
    accountId: "default",
    provider: "WebChat",
    surface: "PWA",
    messageId,
    timestamp: Date.now(),
    from: userId,
    sender: {
      id: userId,
      name: typeof params?.userLabel === "string" ? params.userLabel : userId,
      isBot: false,
    },
    conversation: {
      id: conversationId,
      kind: "direct",
      label: "PWA WebChat",
    },
    route: {
      routeSessionKey,
      agentId,
      accountId: "default",
      createIfMissing: true,
    },
    reply: {
      to: target,
      originatingTo: target,
      deliveryTarget: target,
    },
    message: {
      rawBody: message,
      body: message,
      bodyForAgent: message,
      commandBody: message,
      inboundEventKind: "user_request",
    },
    access: {
      dm: { decision: "allow", allowFrom: [] },
      commands: {
        authorized: true,
        useAccessGroups: false,
        allowTextCommands: true,
        authorizers: [],
      },
      event: {
        kind: "message",
        authMode: "inbound",
        mayPair: false,
        authorized: true,
        hasOriginSubject: true,
        originSubjectMatched: true,
      },
    },
    extra: {
      OriginatingChannel: CHANNEL_ID,
      OriginatingTo: target,
      ExplicitDeliverRoute: true,
    },
  });

  let currentPreviewId;
  let finalText = "";
  let partialCount = 0;
  const flushBoundary = async () => {
    if (!currentPreviewId) {
      return;
    }
    await postDelivery(api.config, {
      phase: "boundary",
      conversationId,
      jobId,
      messageId: currentPreviewId,
      createdAt: new Date().toISOString(),
    }).catch(() => {});
    currentPreviewId = undefined;
  };

  const deliverySignals = {
    final: 0,
    partial: 0,
    boundary: 0,
    error: 0,
  };
  const dispatchResult = await rt.channel.inbound.dispatchReply({
    cfg: api.config,
    channel: CHANNEL_ID,
    accountId: "default",
    agentId,
    routeSessionKey,
    storePath,
    ctxPayload,
    recordInboundSession: rt.channel.session.recordInboundSession,
    dispatchReplyWithBufferedBlockDispatcher: rt.channel.reply.dispatchReplyWithBufferedBlockDispatcher,
    delivery: {
      deliver: async (payload, info) => {
        const text = typeof payload?.text === "string" ? payload.text : "";
        deliverySignals.final += 1;
        api.logger.info(`webchat deliver final textChars=${text.length} kind=${info?.kind ?? "unknown"} conversation=${conversationId}`);
        if (text) {
          finalText = text;
        }
        const result = await sendWebchatText({ cfg: api.config, to: target, text }, "final", currentPreviewId);
        currentPreviewId = undefined;
        return {
          messageIds: result.messageId ? [result.messageId] : [],
          receipt: result.receipt,
          visibleReplySent: Boolean(text),
        };
      },
      onError: (err) => {
        api.logger.error(`webchat delivery error: ${err instanceof Error ? err.message : String(err)}`);
      },
    },
    dispatcherOptions: {
      beforeDeliver: flushBoundary,
    },
    replyOptions: {
      abortSignal: params?.abortSignal,
      sourceReplyDeliveryMode: "automatic",
      onAssistantMessageStart: async () => {
        await flushBoundary();
      },
      onReasoningEnd: async () => {
        await flushBoundary();
      },
      onPartialReply: async (payload) => {
        const text = typeof payload?.text === "string" ? payload.text : "";
        if (!text.trim()) {
          return;
        }
        if (!currentPreviewId) {
          currentPreviewId = `oc_${randomUUID()}`;
        }
        partialCount += 1;
        deliverySignals.partial += 1;
        await postDelivery(api.config, {
          phase: "partial",
          conversationId,
          jobId,
          messageId: currentPreviewId,
          text,
          index: partialCount,
          createdAt: new Date().toISOString(),
        }).catch((err) => {
          api.logger.warn(`webchat partial delivery failed: ${err instanceof Error ? err.message : String(err)}`);
        });
      },
    },
    record: {
      createIfMissing: true,
      updateLastRoute: {
        sessionKey: routeSessionKey,
        channel: CHANNEL_ID,
        to: target,
        accountId: "default",
      },
      onRecordError: (err) => {
        api.logger.warn(`webchat session record failed: ${err instanceof Error ? err.message : String(err)}`);
      },
    },
    log: (event) => {
      api.logger.info(`webchat turn ${event.stage}:${event.event} session=${event.sessionKey ?? routeSessionKey} admission=${event.admission ?? ""} reason=${event.reason ?? ""}`);
    },
    messageId,
  });
  await flushBoundary();
  const dispatch = summarizeDispatchResult(dispatchResult);
  api.logger.info(`webchat dispatch completed conversation=${conversationId} summary=${JSON.stringify(dispatch)} delivery=${JSON.stringify(deliverySignals)}`);
  return {
    ok: true,
    reply: finalText,
    partialCount,
    deliveryHandled: true,
    dispatch,
    deliverySignals,
  };
}

export default defineChannelPluginEntry({
  id: CHANNEL_ID,
  name: "WebChat",
  description: "Native OpenClaw channel bridge for the PWA web chat service",
  plugin,
  setRuntime(nextRuntime) {
    runtime = nextRuntime;
  },
  registerFull(api) {
    api.registerGatewayMethod("webchat.send", async ({ params, respond }) => {
      try {
        respond({ ok: true, result: await handleSend(api, params ?? {}) });
      } catch (error) {
        respond({
          ok: false,
          error: {
            code: "WEBCHAT_SEND_FAILED",
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }, { scope: "operator.write" });
  },
});
