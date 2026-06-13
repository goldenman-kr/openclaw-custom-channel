import { randomUUID } from "node:crypto";
import { defineChannelPluginEntry } from "/home/orbsian/.npm-global/lib/node_modules/openclaw/dist/plugin-sdk/channel-core.js";
import { buildChannelInboundEventContext } from "/home/orbsian/.npm-global/lib/node_modules/openclaw/dist/plugin-sdk/channel-inbound.js";
import {
  createMessageReceiptFromOutboundResults,
  defineChannelMessageAdapter,
} from "/home/orbsian/.npm-global/lib/node_modules/openclaw/dist/plugin-sdk/channel-outbound.js";

const CHANNEL_ID = "pwa-webchat";
const LEGACY_CHANNEL_ID = "webchat";
let runtime;

const PWA_DELIVERY_SYSTEM_PROMPT = [
  "PWA WebChat delivery rule:",
  "- User-visible output for this channel is delivered through `message(action=send)`.",
  "- When the user asks for step-by-step progress, intermediate answers, streaming checkpoints, or tool-before/tool-after separation, send each requested visible step as its own separate `message(action=send)` call in the requested order.",
  "- Do not combine multiple requested visible numbered steps into one `message(action=send)` call.",
  "- Tool invocations and tool outputs are not user-visible chat messages by themselves. If the user asks for a visible tool-call step, send that step as a normal `message(action=send)` message at the appropriate point around the actual tool call.",
  "- Keep normal final assistant text private unless the visible answer has already been sent through `message(action=send)`.",
].join("\n");

function getChannelConfig(cfg) {
  return cfg?.channels?.[CHANNEL_ID] ?? cfg?.channels?.[LEGACY_CHANNEL_ID] ?? {};
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

function diffToken(previous, next) {
  const prior = String(previous || "");
  const current = String(next || "");
  if (!current) {
    return "";
  }
  if (!prior) {
    return current;
  }
  if (current.startsWith(prior)) {
    return current.slice(prior.length);
  }

  let index = 0;
  const max = Math.min(prior.length, current.length);
  while (index < max && prior.charCodeAt(index) === current.charCodeAt(index)) {
    index += 1;
  }
  return current.slice(index);
}

function truncateText(text, maxChars = 1200) {
  const value = String(text || "").trim();
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n...`;
}

function toolNameFromPayload(payload) {
  const name = payload?.name || payload?.toolName || payload?.tool || payload?.command || payload?.cmd;
  return typeof name === "string" && name.trim() ? name.trim() : "tool";
}

function textFromPayload(payload) {
  const candidates = [
    payload?.text,
    payload?.message,
    payload?.content,
    payload?.progressText,
    payload?.summary,
    payload?.title,
    payload?.output,
    payload?.stdout,
    payload?.stderr,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return "";
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

function isWebchatTarget(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return false;
  }
  if (raw.startsWith("conversation-job:")) {
    const target = parseTarget(raw);
    return Boolean(target.conversationId && target.jobId);
  }
  if (raw.startsWith("conversation:")) {
    return Boolean(parseTarget(raw).conversationId);
  }
  return /^conv_[A-Za-z0-9-]+$/.test(raw);
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
    text: async (ctx) => sendWebchatText(ctx, parseTarget(ctx.to).jobId ? "event" : "final"),
  },
});

const plugin = {
  id: CHANNEL_ID,
  meta: {
    id: CHANNEL_ID,
    label: "PWA WebChat",
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
      const target = parseTarget(ctx.to);
      const result = await sendWebchatText(ctx, target.jobId ? "event" : "final");
      return {
        channel: CHANNEL_ID,
        messageId: result.messageId,
        conversationId: target.conversationId,
        receipt: result.receipt,
      };
    },
  },
  messaging: {
    normalizeTarget(raw) {
      const value = String(raw || "").trim();
      return isWebchatTarget(value) ? value : undefined;
    },
    inferTargetChatType({ to }) {
      return isWebchatTarget(to) ? "direct" : undefined;
    },
    targetResolver: {
      hint: "Use conversation:<conversation_id> or conversation-job:<conversation_id>:job:<job_id>.",
      looksLikeId: (raw, normalized) => isWebchatTarget(raw) || isWebchatTarget(normalized),
      resolveTarget: ({ input, normalized }) => {
        const target = isWebchatTarget(input) ? input : normalized;
        if (!isWebchatTarget(target)) {
          return null;
        }
        return {
          to: target,
          kind: "user",
          display: parseTarget(target).conversationId,
          source: "normalized",
        };
      },
    },
    resolveOutboundSessionRoute({ cfg, agentId, to, accountId }) {
      const target = parseTarget(to);
      const sessionKey = `${CHANNEL_ID}:${target.conversationId}`;
      return {
        channel: CHANNEL_ID,
        accountId: accountId ?? "default",
        agentId,
        sessionKey,
        parentSessionKey: `agent:${agentId}`,
        peer: { kind: "direct", id: target.conversationId },
        chatType: "direct",
        from: CHANNEL_ID,
        to,
        cfg,
      };
    },
  },
  agentPrompt: {
    messageToolHints: () => [
      "- PWA WebChat visible output is delivered through `message(action=send)`. When the user asks for step-by-step progress, intermediate answers, streaming checkpoints, or tool-before/tool-after separation, send each requested visible step as its own separate `message(action=send)` call.",
      "- For tool workflows, send the visible pre-tool step before invoking the tool. After the tool result, send each requested follow-up step as separate `message(action=send)` calls instead of combining multiple numbered steps in one message.",
    ],
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
  const routeSessionKey = `${CHANNEL_ID}:${conversationId}`;
  const target = jobId ? `conversation-job:${conversationId}:job:${jobId}` : `conversation:${conversationId}`;
  const sourceReplyDeliveryMode = "message_tool_only";
  const messageToolOwnsVisibleDelivery = sourceReplyDeliveryMode === "message_tool_only";
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
  let lastPartialText = "";
  let partialCount = 0;
  let toolStarted = false;
  const visibleEventIds = new Map();
  const visibleEventTexts = new Map();

  const postVisibleEvent = async (key, text) => {
    const body = truncateText(text);
    if (!body) {
      return;
    }
    if (visibleEventTexts.get(key) === body) {
      return;
    }
    visibleEventTexts.set(key, body);
    const messageId = visibleEventIds.get(key) || `oc_${randomUUID()}`;
    visibleEventIds.set(key, messageId);
    await flushBoundary();
    await postDelivery(api.config, {
      phase: "event",
      conversationId,
      jobId,
      messageId,
      text: body,
      createdAt: new Date().toISOString(),
    }).catch((err) => {
      api.logger.warn(`webchat event delivery failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  };

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
    deliverySignals.boundary += 1;
    currentPreviewId = undefined;
    lastPartialText = "";
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
      extraSystemPrompt: PWA_DELIVERY_SYSTEM_PROMPT,
      sourceReplyDeliveryMode,
      commentaryProgressEnabled: true,
      allowProgressCallbacksWhenSourceDeliverySuppressed: true,
      suppressDefaultToolProgressMessages: true,
      onAssistantMessageStart: async () => {
        await flushBoundary();
      },
      onReasoningEnd: async () => {
        await flushBoundary();
      },
      onBlockReplyQueued: async (payload) => {
        if (messageToolOwnsVisibleDelivery) {
          return;
        }
        const text = textFromPayload(payload);
        if (!toolStarted && partialCount === 0 && text) {
          await postVisibleEvent("block", text);
        }
      },
      onItemEvent: async (payload) => {
        if (messageToolOwnsVisibleDelivery) {
          return;
        }
        const kind = typeof payload?.kind === "string" ? payload.kind : "";
        const text = textFromPayload(payload);
        if (!toolStarted && partialCount === 0 && kind === "preamble" && text) {
          await postVisibleEvent("preamble", text);
        }
      },
      onToolStart: async (payload) => {
        if (messageToolOwnsVisibleDelivery) {
          return;
        }
        toolStarted = true;
        await postVisibleEvent("tool-start", `**툴 호출**\n\n\`${toolNameFromPayload(payload)}\` 도구를 호출합니다.`);
      },
      onCommandOutput: async (payload) => {
        if (messageToolOwnsVisibleDelivery) {
          return;
        }
        const output = textFromPayload(payload);
        if (!output) {
          return;
        }
        await postVisibleEvent("tool-output", `**툴 결과**\n\n\`\`\`text\n${truncateText(output, 900)}\n\`\`\``);
      },
      onPartialReply: async (payload) => {
        if (messageToolOwnsVisibleDelivery) {
          return;
        }
        const text = typeof payload?.text === "string" ? payload.text : "";
        if (!text.trim()) {
          return;
        }
        if (!currentPreviewId) {
          currentPreviewId = `oc_${randomUUID()}`;
        }
        partialCount += 1;
        deliverySignals.partial += 1;
        const token = diffToken(lastPartialText, text);
        lastPartialText = text;
        await postDelivery(api.config, {
          phase: "partial",
          conversationId,
          jobId,
          messageId: currentPreviewId,
          text,
          token,
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
  name: "PWA WebChat",
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
