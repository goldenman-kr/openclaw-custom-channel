import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { defineChannelPluginEntry } from "/home/orbsian/.npm-global/lib/node_modules/openclaw/dist/plugin-sdk/channel-core.js";
import { buildChannelInboundEventContext } from "/home/orbsian/.npm-global/lib/node_modules/openclaw/dist/plugin-sdk/channel-inbound.js";
import {
  createMessageReceiptFromOutboundResults,
  defineChannelMessageAdapter,
} from "/home/orbsian/.npm-global/lib/node_modules/openclaw/dist/plugin-sdk/channel-outbound.js";

const CHANNEL_ID = "pwa-webchat";
const LEGACY_CHANNEL_ID = "webchat";
const SESSION_LABEL_CHANNEL_ID = "pwa_webchat";
const CONVERSATION_ID_PATTERN = /^conv_[A-Za-z0-9][A-Za-z0-9_-]*$/;
const JOB_ID_PATTERN = /^job_[A-Za-z0-9][A-Za-z0-9_-]*$/;
const AGENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const RECENT_JOB_DELIVERY_TTL_MS = 10 * 60 * 1000;
let runtime;
const activeAbortEntriesByJob = new Map();
const activeAbortEntriesBySession = new Map();
const recentJobDeliveries = new Map();
const recentJobDeliveryTexts = new Map();

const PWA_DELIVERY_SYSTEM_PROMPT = [
  "PWA WebChat delivery rule:",
  "- User-visible output for this channel is delivered through `message(action=send)`.",
  "- Intermediate assistant commentary is surfaced automatically as temporary PWA chat bubbles. Do not use `message(action=send)` for intermediate progress.",
  "- Send the final user-visible answer once through `message(action=send)`. That final delivery replaces the temporary intermediate bubbles for this turn.",
  "- Keep normal final assistant text private and do not duplicate the visible answer there.",
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

function shouldReturnVerboseDeliveryReceipt(cfg) {
  const configured = getChannelConfig(cfg).verboseDeliveryReceipt;
  if (typeof configured === "boolean") {
    return configured;
  }
  return process.env.OPENCLAW_WEBCHAT_VERBOSE_DELIVERY_RECEIPT === "1";
}

function collectMediaUrls(ctx) {
  const mediaUrls = [];
  const seen = new Set();
  const push = (value) => {
    if (typeof value !== "string") {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    mediaUrls.push(trimmed);
  };
  push(ctx.mediaUrl);
  push(ctx.payload?.mediaUrl);
  if (Array.isArray(ctx.payload?.mediaUrls)) {
    for (const mediaUrl of ctx.payload.mediaUrls) {
      push(mediaUrl);
    }
  }
  return mediaUrls;
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

function textFromAssistantSessionMessage(message) {
  const content = message?.content;
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const parts = [];
  for (const item of content) {
    if (typeof item === "string" && item.trim()) {
      parts.push(item.trim());
      continue;
    }
    if (item?.type === "text" && typeof item.text === "string" && item.text.trim()) {
      parts.push(item.text.trim());
    }
  }
  return parts.join("\n\n").trim();
}

function normalizeTextForComparison(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function isNoReplySentinelText(text) {
  return normalizeTextForComparison(text).toUpperCase() === "NO_REPLY";
}

function isLlamaCppModelRef(model) {
  const normalized = String(model || "").trim().toLowerCase();
  return normalized === "llamacpp" || normalized.startsWith("llamacpp/");
}

function pruneRecentJobDeliveries(now = Date.now()) {
  for (const [key, value] of recentJobDeliveries) {
    if (now - value.at > RECENT_JOB_DELIVERY_TTL_MS) {
      recentJobDeliveries.delete(key);
    }
  }
  for (const [key, value] of recentJobDeliveryTexts) {
    if (now - value.at > RECENT_JOB_DELIVERY_TTL_MS) {
      recentJobDeliveryTexts.delete(key);
    }
  }
}

function jobTextKey(target, text, mediaUrls = []) {
  if (!target?.conversationId || !target?.jobId || mediaUrls.length > 0) {
    return "";
  }
  const normalized = normalizeTextForComparison(text);
  return normalized ? `${target.conversationId}:${target.jobId}:${normalized}` : "";
}

function jobDeliveryKey(target, phase, text, mediaUrls = []) {
  const textKey = jobTextKey(target, text, mediaUrls);
  return textKey ? `${phase}:${textKey}` : "";
}

function rememberJobDelivery(target, phase, text, messageId, mediaUrls = []) {
  const now = Date.now();
  pruneRecentJobDeliveries(now);
  const textKey = jobTextKey(target, text, mediaUrls);
  const phaseKey = jobDeliveryKey(target, phase, text, mediaUrls);
  if (textKey) {
    recentJobDeliveryTexts.set(textKey, { at: now, messageId });
  }
  if (phaseKey) {
    recentJobDeliveries.set(phaseKey, { at: now, messageId });
  }
}

function recentJobDelivery(target, phase, text, mediaUrls = []) {
  const now = Date.now();
  pruneRecentJobDeliveries(now);
  const phaseKey = jobDeliveryKey(target, phase, text, mediaUrls);
  return phaseKey ? recentJobDeliveries.get(phaseKey) : undefined;
}

function hasRecentJobDeliveryText(target, text) {
  const now = Date.now();
  pruneRecentJobDeliveries(now);
  const textKey = jobTextKey(target, text);
  return textKey ? recentJobDeliveryTexts.has(textKey) : false;
}

async function readAssistantTextsFromSessionTranscript(storePath, routeSessionKey, afterMs) {
  const storeRaw = await readFile(storePath, "utf8");
  const store = JSON.parse(storeRaw);
  const sessionRecord = store?.[routeSessionKey];
  if (!sessionRecord || typeof sessionRecord !== "object") {
    return [];
  }
  const sessionFile = typeof sessionRecord.sessionFile === "string" && sessionRecord.sessionFile.trim()
    ? sessionRecord.sessionFile.trim()
    : typeof sessionRecord.sessionId === "string" && sessionRecord.sessionId.trim()
      ? join(dirname(storePath), `${sessionRecord.sessionId.trim()}.jsonl`)
      : "";
  if (!sessionFile) {
    return [];
  }

  const transcriptRaw = await readFile(sessionFile, "utf8");
  const texts = [];
  for (const line of transcriptRaw.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry?.type !== "message" || entry?.message?.role !== "assistant") {
      continue;
    }
    const timestampMs = Number.isFinite(Date.parse(entry.timestamp)) ? Date.parse(entry.timestamp) : Number(entry?.message?.timestamp ?? 0);
    if (afterMs && timestampMs && timestampMs < afterMs) {
      continue;
    }
    const text = textFromAssistantSessionMessage(entry.message);
    if (text && !isNoReplySentinelText(text)) {
      texts.push({ text, timestampMs: timestampMs || 0 });
    }
  }
  return texts;
}

function parseTarget(to) {
  const raw = String(to || "").trim();
  if (raw.startsWith("conversation:")) {
    return normalizeParsedTarget({ conversationId: raw.slice("conversation:".length).trim(), jobId: undefined });
  }
  if (raw.startsWith("conversation-job:")) {
    const value = raw.slice("conversation-job:".length);
    const [conversationId, jobId] = value.split(":job:");
    return normalizeParsedTarget({ conversationId, jobId });
  }
  return normalizeParsedTarget({ conversationId: raw, jobId: undefined });
}

function normalizeParsedTarget(target) {
  const conversationId = normalizeConversationId(target.conversationId);
  const jobId = normalizeJobId(target.jobId);
  return {
    conversationId: conversationId || "",
    jobId,
  };
}

function normalizeConversationId(value) {
  const id = String(value || "").trim();
  return CONVERSATION_ID_PATTERN.test(id) ? id : "";
}

function normalizeJobId(value) {
  const id = String(value || "").trim();
  return !id || JOB_ID_PATTERN.test(id) ? id || undefined : "";
}

function normalizeAgentId(value) {
  const id = String(value || "").trim() || "main";
  if (!AGENT_ID_PATTERN.test(id)) {
    throw new Error("agentId must be a stable id.");
  }
  return id;
}

function stableSessionKey(conversationId) {
  const id = normalizeConversationId(conversationId);
  return id ? `${CHANNEL_ID}:${id}` : "";
}

function scopedStableSessionKey(agentId, conversationId) {
  const sessionKey = stableSessionKey(conversationId);
  return sessionKey ? `agent:${normalizeAgentId(agentId)}:${sessionKey}` : "";
}

function sessionAbortSet(sessionKey) {
  let entries = activeAbortEntriesBySession.get(sessionKey);
  if (!entries) {
    entries = new Set();
    activeAbortEntriesBySession.set(sessionKey, entries);
  }
  return entries;
}

function createActiveAbortEntry({ jobId, routeSessionKey }) {
  return {
    controller: new AbortController(),
    jobId,
    routeSessionKey,
  };
}

function registerActiveAbortEntry(entry) {
  sessionAbortSet(entry.routeSessionKey).add(entry);
  if (entry.jobId) {
    activeAbortEntriesByJob.set(entry.jobId, entry);
  }
}

function unregisterActiveAbortEntry(entry) {
  const entries = activeAbortEntriesBySession.get(entry.routeSessionKey);
  if (entries) {
    entries.delete(entry);
    if (entries.size === 0) {
      activeAbortEntriesBySession.delete(entry.routeSessionKey);
    }
  }
  if (entry.jobId && activeAbortEntriesByJob.get(entry.jobId) === entry) {
    activeAbortEntriesByJob.delete(entry.jobId);
  }
}

function findActiveAbortEntries({ jobId, routeSessionKey }) {
  if (jobId) {
    const entry = activeAbortEntriesByJob.get(jobId);
    return entry ? [entry] : [];
  }
  return [...(activeAbortEntriesBySession.get(routeSessionKey) ?? [])];
}

function abortActiveEntries(entries) {
  const abortedEntries = [];
  for (const entry of entries) {
    if (!entry.controller.signal.aborted) {
      entry.controller.abort(new Error("PWA webchat request cancelled."));
      abortedEntries.push(entry);
    }
  }
  return abortedEntries;
}

function isAbortSignalLike(value) {
  return Boolean(value && typeof value === "object" && typeof value.aborted === "boolean" && typeof value.addEventListener === "function");
}

function mergedAbortSignal(signals) {
  const activeSignals = signals.filter(isAbortSignalLike);
  if (activeSignals.length === 0) {
    return { signal: undefined, cleanup() {} };
  }
  if (activeSignals.length === 1) {
    return { signal: activeSignals[0], cleanup() {} };
  }
  const controller = new AbortController();
  const listeners = [];
  const abortFrom = (signal) => {
    if (!controller.signal.aborted) {
      controller.abort(signal.reason ?? new Error("PWA webchat request aborted."));
    }
  };
  for (const signal of activeSignals) {
    if (signal.aborted) {
      abortFrom(signal);
      continue;
    }
    const listener = () => abortFrom(signal);
    signal.addEventListener("abort", listener, { once: true });
    listeners.push([signal, listener]);
  }
  return {
    signal: controller.signal,
    cleanup() {
      for (const [signal, listener] of listeners) {
        signal.removeEventListener("abort", listener);
      }
    },
  };
}

function stableSessionLabel(conversationId) {
  const id = normalizeConversationId(conversationId);
  return id ? `${SESSION_LABEL_CHANNEL_ID}:${id}` : SESSION_LABEL_CHANNEL_ID;
}

function normalizeWebchatTarget(value) {
  const target = parseTarget(value);
  if (!target.conversationId) {
    return undefined;
  }
  if (String(value || "").trim().startsWith("conversation-job:") && !target.jobId) {
    return undefined;
  }
  return target;
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
  if (!target.conversationId) {
    throw new Error("PWA webchat target must include a stable conv_<id> conversation id.");
  }
  const mediaUrls = collectMediaUrls(ctx);
  if (mediaUrls.length === 0 && isNoReplySentinelText(ctx.text)) {
    return {
      ok: true,
      channel: CHANNEL_ID,
      messageId: messageId || "",
      silent: true,
    };
  }
  const duplicate = recentJobDelivery(target, phase, ctx.text, mediaUrls);
  if (!messageId && duplicate) {
    return {
      ok: true,
      channel: CHANNEL_ID,
      messageId: duplicate.messageId,
      duplicate: true,
    };
  }
  const resolvedMessageId = messageId || `oc_${randomUUID()}`;
  await postDelivery(ctx.cfg, {
    phase,
    conversationId: target.conversationId,
    jobId: target.jobId,
    messageId: resolvedMessageId,
    text: ctx.text,
    ...(mediaUrls.length > 0 ? { mediaUrls } : {}),
    createdAt: new Date().toISOString(),
  });
  rememberJobDelivery(target, phase, ctx.text, resolvedMessageId, mediaUrls);
  const result = {
    ok: true,
    channel: CHANNEL_ID,
    messageId: resolvedMessageId,
  };
  if (shouldReturnVerboseDeliveryReceipt(ctx.cfg)) {
    result.receipt = createMessageReceiptFromOutboundResults({
      results: [{
      channel: CHANNEL_ID,
      messageId: resolvedMessageId,
      conversationId: target.conversationId,
      }],
      kind: phase === "partial" ? "preview" : "text",
      replyToId: ctx.replyToId ?? undefined,
      threadId: ctx.threadId == null ? undefined : String(ctx.threadId),
    });
  }
  return result;
}

const messageAdapter = defineChannelMessageAdapter({
  id: CHANNEL_ID,
  durableFinal: {
    capabilities: {
      text: true,
      media: true,
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
    media: async (ctx) => sendWebchatText(ctx, "final"),
    payload: async (ctx) => sendWebchatText(ctx, "final"),
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
        media: true,
        replyTo: true,
        thread: true,
      },
    },
    sendText: async (ctx) => {
      const target = parseTarget(ctx.to);
      const result = await sendWebchatText(ctx, "final");
      const response = {
        ok: true,
        channel: CHANNEL_ID,
        messageId: result.messageId,
      };
      if (shouldReturnVerboseDeliveryReceipt(ctx.cfg)) {
        response.conversationId = target.conversationId;
        response.receipt = result.receipt;
      }
      return response;
    },
    sendMedia: async (ctx) => {
      const target = parseTarget(ctx.to);
      const result = await sendWebchatText(ctx, "final");
      const response = {
        ok: true,
        channel: CHANNEL_ID,
        messageId: result.messageId,
      };
      if (shouldReturnVerboseDeliveryReceipt(ctx.cfg)) {
        response.conversationId = target.conversationId;
        response.receipt = result.receipt;
      }
      return response;
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
    resolveOutboundSessionRoute({ target }) {
      const parsed = normalizeWebchatTarget(target);
      if (!parsed) {
        return null;
      }
      return null;
    },
  },
  agentPrompt: {
    messageToolHints: () => [
      "- Intermediate assistant commentary is shown automatically as temporary PWA bubbles; do not send progress with the message tool.",
      "- Send the final PWA WebChat answer once through `message(action=send)`; it replaces those temporary bubbles.",
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

function buildWebchatInboundContext(params) {
  const normalizedConversationId = normalizeConversationId(params.conversationId);
  if (!normalizedConversationId) {
    throw new Error("conversationId must match conv_<stable-id>.");
  }
  const agentId = normalizeAgentId(params.agentId);
  const sessionKey = stableSessionKey(normalizedConversationId);
  const routeSessionKey = scopedStableSessionKey(agentId, normalizedConversationId);
  const target = params.jobId ? `conversation-job:${normalizedConversationId}:job:${params.jobId}` : `conversation:${normalizedConversationId}`;
  const stableRouteTarget = `conversation:${normalizedConversationId}`;
  const messageId = params.messageId || `web_${randomUUID()}`;
  const userId = params.userId || "webchat-user";
  return {
    normalizedConversationId,
    sessionKey,
    scopedSessionKey: routeSessionKey,
    routeSessionKey,
    target,
    stableRouteTarget,
    messageId,
    ctxPayload: buildChannelInboundEventContext({
      channel: CHANNEL_ID,
      accountId: "default",
      provider: "WebChat",
      surface: "PWA",
      messageId,
      timestamp: Date.now(),
      from: userId,
      sender: {
        id: userId,
        name: params.userLabel || userId,
        isBot: false,
      },
      conversation: {
        id: normalizedConversationId,
        kind: "direct",
        label: stableSessionLabel(normalizedConversationId),
      },
      route: {
        routeSessionKey,
        dispatchSessionKey: routeSessionKey,
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
        rawBody: params.message,
        body: params.message,
        bodyForAgent: params.message,
        commandBody: params.message,
        inboundEventKind: params.inboundEventKind || "user_request",
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
        AgentId: agentId,
      },
    }),
  };
}

async function handleEnsureSession(api, params) {
  const rt = assertRuntime();
  const conversationId = readString(params?.conversationId, "conversationId");
  const agentId = normalizeAgentId(params?.agentId);
  const userId = typeof params?.userId === "string" && params.userId.trim() ? params.userId.trim() : "webchat-user";
  const userLabel = typeof params?.userLabel === "string" && params.userLabel.trim() ? params.userLabel.trim() : userId;
  const { normalizedConversationId, sessionKey, scopedSessionKey, routeSessionKey, stableRouteTarget, ctxPayload } = buildWebchatInboundContext({
    conversationId,
    agentId,
    userId,
    userLabel,
    message: "[PWA WebChat session ensure]",
    inboundEventKind: "session_ensure",
  });
  const storePath = rt.channel.session.resolveStorePath(api.config.session?.store, { agentId });
  await rt.channel.session.recordInboundSession({
    storePath,
    sessionKey: routeSessionKey,
    ctx: ctxPayload,
    createIfMissing: true,
    updateLastRoute: {
      sessionKey: routeSessionKey,
      channel: CHANNEL_ID,
      to: stableRouteTarget,
      accountId: "default",
    },
    onRecordError: (err) => {
      api.logger.warn(`webchat session ensure failed: ${err instanceof Error ? err.message : String(err)}`);
    },
  });
  return {
    ok: true,
    conversationId: normalizedConversationId,
    sessionKey,
    scopedSessionKey,
  };
}

async function handleSend(api, params) {
  const rt = assertRuntime();
  const conversationId = readString(params?.conversationId, "conversationId");
  const rawJobId = typeof params?.jobId === "string" && params.jobId.trim() ? params.jobId.trim() : undefined;
  const jobId = normalizeJobId(rawJobId);
  if (rawJobId && !jobId) {
    throw new Error("jobId must match job_<stable-id>.");
  }
  const message = readString(params?.message, "message");
  const userId = typeof params?.userId === "string" && params.userId.trim() ? params.userId.trim() : "webchat-user";
  const agentId = normalizeAgentId(params?.agentId);
  const messageId = typeof params?.messageId === "string" && params.messageId.trim() ? params.messageId.trim() : `web_${randomUUID()}`;
  const normalizedConversationId = normalizeConversationId(conversationId);
  if (!normalizedConversationId) {
    throw new Error("conversationId must match conv_<stable-id>.");
  }
  const { routeSessionKey, target, stableRouteTarget, ctxPayload } = buildWebchatInboundContext({
    conversationId: normalizedConversationId,
    jobId,
    agentId,
    userId,
    userLabel: typeof params?.userLabel === "string" ? params.userLabel : userId,
    message,
    messageId,
  });
  const sourceReplyDeliveryMode = "message_tool_only";
  const messageToolOwnsVisibleDelivery = sourceReplyDeliveryMode === "message_tool_only";
  const assistantTextFallbackEnabled = isLlamaCppModelRef(params?.model);
  const storePath = rt.channel.session.resolveStorePath(api.config.session?.store, { agentId });

  let currentPreviewId;
  let finalText = "";
  let fallbackFinalText = "";
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
    fallbackFinal: 0,
    transcriptEvent: 0,
    commentaryEvent: 0,
    partial: 0,
    boundary: 0,
    error: 0,
  };

  const rememberFallbackFinalText = (text) => {
    const body = typeof text === "string" ? text.trim() : "";
    if (body && !isNoReplySentinelText(body)) {
      fallbackFinalText = body;
    }
  };
  const abortEntry = createActiveAbortEntry({
    jobId,
    routeSessionKey,
  });
  const replyAbort = mergedAbortSignal([params?.abortSignal, abortEntry.controller.signal]);
  registerActiveAbortEntry(abortEntry);
  let dispatchResult;
  const dispatchStartedAtMs = Date.now();
  try {
    dispatchResult = await rt.channel.inbound.dispatchReply({
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
      abortSignal: replyAbort.signal,
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
          if (assistantTextFallbackEnabled) {
            rememberFallbackFinalText(textFromPayload(payload));
          }
          return;
        }
        const text = textFromPayload(payload);
        if (!toolStarted && partialCount === 0 && text) {
          await postVisibleEvent("block", text);
        }
      },
      onItemEvent: async (payload) => {
        const kind = typeof payload?.kind === "string" ? payload.kind : "";
        const text = textFromPayload(payload);
        if (kind === "preamble" && text) {
          const itemId = typeof payload?.itemId === "string" && payload.itemId.trim() ? payload.itemId.trim() : "current";
          await postVisibleEvent(`commentary:${itemId}`, text);
          deliverySignals.commentaryEvent += 1;
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
          if (assistantTextFallbackEnabled) {
            rememberFallbackFinalText(typeof payload?.text === "string" ? payload.text : "");
          }
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
        to: stableRouteTarget,
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
  } finally {
    unregisterActiveAbortEntry(abortEntry);
    replyAbort.cleanup();
  }
  await flushBoundary();
  const dispatch = summarizeDispatchResult(dispatchResult);
  let transcriptTexts = [];
  if (assistantTextFallbackEnabled) {
    try {
      transcriptTexts = await readAssistantTextsFromSessionTranscript(storePath, routeSessionKey, dispatchStartedAtMs);
      if (transcriptTexts.length > 0) {
        api.logger.info(`webchat transcript texts captured count=${transcriptTexts.length} conversation=${conversationId} model=${params?.model ?? ""}`);
      }
    } catch (err) {
      api.logger.warn(`webchat transcript text read failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    api.logger.info(`webchat assistant text fallback disabled conversation=${conversationId} model=${params?.model ?? ""}`);
  }
  const targetForDelivery = parseTarget(target);
  const seenTranscriptTexts = new Set();
  const undeliveredTranscriptTexts = [];
  for (const entry of transcriptTexts) {
    const normalized = normalizeTextForComparison(entry.text);
    if (!normalized || seenTranscriptTexts.has(normalized) || hasRecentJobDeliveryText(targetForDelivery, entry.text)) {
      continue;
    }
    seenTranscriptTexts.add(normalized);
    undeliveredTranscriptTexts.push(entry);
  }
  if (undeliveredTranscriptTexts.length > 0) {
    for (let index = 0; index < undeliveredTranscriptTexts.length; index += 1) {
      const text = undeliveredTranscriptTexts[index].text;
      const isLast = index === undeliveredTranscriptTexts.length - 1;
      const phase = isLast && deliverySignals.final === 0 ? "final" : "event";
      const result = await sendWebchatText({ cfg: api.config, to: target, text }, phase);
      if (phase === "final") {
        finalText = text;
        fallbackFinalText = text;
        deliverySignals.final += 1;
        deliverySignals.fallbackFinal += 1;
        api.logger.info(`webchat transcript final delivered messageId=${result.messageId} textChars=${text.length} conversation=${conversationId}`);
      } else {
        deliverySignals.transcriptEvent += 1;
        api.logger.info(`webchat transcript event delivered messageId=${result.messageId} textChars=${text.length} conversation=${conversationId}`);
      }
    }
  }
  if (deliverySignals.final === 0 && fallbackFinalText && hasRecentJobDeliveryText(targetForDelivery, fallbackFinalText)) {
    api.logger.info(`webchat fallback final skipped because same text was already delivered conversation=${conversationId}`);
    fallbackFinalText = "";
  }
  if (deliverySignals.final === 0 && fallbackFinalText) {
    finalText = fallbackFinalText;
    const result = await sendWebchatText({ cfg: api.config, to: target, text: fallbackFinalText }, "final");
    deliverySignals.final += 1;
    deliverySignals.fallbackFinal += 1;
    api.logger.info(`webchat transcript final delivered messageId=${result.messageId} textChars=${fallbackFinalText.length} conversation=${conversationId}`);
  }
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

async function handleAbort(api, params) {
  const conversationId = readString(params?.conversationId, "conversationId");
  const normalizedConversationId = normalizeConversationId(conversationId);
  if (!normalizedConversationId) {
    throw new Error("conversationId must match conv_<stable-id>.");
  }
  const rawJobId = typeof params?.jobId === "string" && params.jobId.trim() ? params.jobId.trim() : undefined;
  const jobId = normalizeJobId(rawJobId);
  if (rawJobId && !jobId) {
    throw new Error("jobId must match job_<stable-id>.");
  }
  const agentId = normalizeAgentId(params?.agentId);
  const routeSessionKey = scopedStableSessionKey(agentId, normalizedConversationId);
  const entries = findActiveAbortEntries({ jobId, routeSessionKey });
  const abortedEntries = abortActiveEntries(entries);
  api.logger.info(`webchat abort conversation=${normalizedConversationId} job=${jobId ?? ""} session=${routeSessionKey} matched=${entries.length} aborted=${abortedEntries.length}`);
  return {
    ok: true,
    aborted: abortedEntries.length > 0,
    runIds: abortedEntries.map((entry) => entry.jobId).filter(Boolean),
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
    api.registerGatewayMethod("webchat.session.ensure", async ({ params, respond }) => {
      try {
        respond({ ok: true, result: await handleEnsureSession(api, params ?? {}) });
      } catch (error) {
        respond({
          ok: false,
          error: {
            code: "WEBCHAT_SESSION_ENSURE_FAILED",
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }, { scope: "operator.write" });
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
    api.registerGatewayMethod("webchat.abort", async ({ params, respond }) => {
      try {
        respond({ ok: true, result: await handleAbort(api, params ?? {}) });
      } catch (error) {
        respond({
          ok: false,
          error: {
            code: "WEBCHAT_ABORT_FAILED",
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }, { scope: "operator.write" });
  },
});
