import type { MessageAttachment, MessageRequestMetadata } from "../contracts/apiContractV1.js";
import { GatewayAgentEventSubscriber } from "./GatewayAgentEventSubscriber.js";
import { activeGatewayModel } from "./modelOverride.js";
import type { OpenClawClient, OpenClawClientInput, OpenClawClientResult, RuntimeWorkspaceScope } from "./OpenClawClient.js";

export class GatewayOpenAiOpenClawClient implements OpenClawClient {
  constructor(
    private readonly baseUrl = process.env.OPENCLAW_GATEWAY_URL ?? "http://127.0.0.1:18789",
    private readonly token = process.env.OPENCLAW_GATEWAY_TOKEN,
    private readonly model = process.env.OPENCLAW_GATEWAY_MODEL ?? "openclaw",
    private readonly timeoutMs = Number(process.env.OPENCLAW_GATEWAY_TIMEOUT_MS ?? process.env.OPENCLAW_TIMEOUT_MS ?? 600_000),
  ) {}

  async sendMessage(input: OpenClawClientInput): Promise<OpenClawClientResult> {
    const url = new URL("/v1/chat/completions", this.baseUrl);
    const abortController = new AbortController();
    const onExternalAbort = () => abortController.abort(input.abortSignal?.reason ?? new Error("OpenClaw Gateway request cancelled."));
    if (input.abortSignal?.aborted) {
      onExternalAbort();
    } else {
      input.abortSignal?.addEventListener("abort", onExternalAbort, { once: true });
    }
    const timeout = setTimeout(() => abortController.abort(new Error("OpenClaw Gateway request timed out.")), this.timeoutMs);
    const streamed: string[] = [];
    const rawStreamEvents: string[] = [];
    const agentEventSubscriber = input.callbacks?.onAgentEvent
      ? new GatewayAgentEventSubscriber({
          baseUrl: this.baseUrl,
          token: this.token,
          sessionKey: input.sessionId,
          onEvent: (event) => {
            input.callbacks?.onAgentEvent?.(event);
          },
        })
      : null;
    let agentEventSubscriberReady = false;
    if (agentEventSubscriber) {
      await agentEventSubscriber.start()
        .then(() => {
          agentEventSubscriberReady = true;
        })
        .catch(() => {
          agentEventSubscriberReady = false;
        });
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: this.headers(input, true),
        body: JSON.stringify(this.requestBody(input, true)),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`OpenClaw Gateway returned ${response.status}: ${body.slice(0, 500)}`);
      }

      if (!response.body) {
        throw new Error("OpenClaw Gateway returned an empty streaming body.");
      }

      const finalText = await this.readOpenAiSse(response.body, async (token) => {
        streamed.push(token);
        await input.callbacks?.onToken?.(token);
      }, rawStreamEvents);
      const streamReply = finalText || streamed.join("");
      const fallbackReply = streamReply ? "" : await this.fetchNonStreamingReply(input, abortController.signal).catch(() => "");

      return {
        reply: streamReply || fallbackReply || "응답 출력에 문제가 있습니다. 다시 답변을 요청해보세요. 이 오류가 반복되면 새 대화를 열어 세션을 다시 시작해주세요.",
        raw: {
          transport: "gateway-openai",
          endpoint: url.toString(),
          model: this.activeModel(),
          sessionId: input.sessionId,
          streamedChunks: streamed.length,
          rawStreamEvents: rawStreamEvents.slice(-5),
          usedNonStreamFallback: !streamReply && Boolean(fallbackReply),
          agentEventSubscriberReady,
        },
      };
    } finally {
      agentEventSubscriber?.stop();
      clearTimeout(timeout);
      input.abortSignal?.removeEventListener("abort", onExternalAbort);
    }
  }

  private activeModel(): string {
    return activeGatewayModel(this.model);
  }

  private headers(input: OpenClawClientInput, stream: boolean): HeadersInit {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: stream ? "text/event-stream" : "application/json",
      "x-openclaw-session-key": input.sessionId,
      "x-openclaw-message-channel": "webchat",
    };
    if (input.runtimeWorkspace) {
      headers["x-openclaw-runtime-workspace-root"] = input.runtimeWorkspace.workspaceRoot;
      headers["x-openclaw-runtime-user-dir"] = input.runtimeWorkspace.userDir;
      headers["x-openclaw-runtime-common-dir"] = input.runtimeWorkspace.commonDir;
      headers["x-openclaw-runtime-common-writable"] = input.runtimeWorkspace.commonWritable ? "1" : "0";
      headers["x-openclaw-runtime-user-id"] = input.runtimeWorkspace.userId;
      if (input.runtimeWorkspace.username) {
        headers["x-openclaw-runtime-username"] = input.runtimeWorkspace.username;
      }
      if (input.runtimeWorkspace.identityFile) {
        headers["x-openclaw-runtime-identity-file"] = input.runtimeWorkspace.identityFile;
      }
    }
    if (this.token) {
      headers.authorization = `Bearer ${this.token}`;
    }
    return headers;
  }

  private requestBody(input: OpenClawClientInput, stream: boolean): Record<string, unknown> {
    return {
      model: this.activeModel(),
      stream,
      messages: [
        {
          role: "user",
          content: this.buildContent(input.message, input.attachments ?? [], input.metadata, input.runtimeWorkspace),
        },
      ],
    };
  }

  private async fetchNonStreamingReply(input: OpenClawClientInput, signal: AbortSignal): Promise<string> {
    const url = new URL("/v1/chat/completions", this.baseUrl);
    const response = await fetch(url, {
      method: "POST",
      headers: this.headers(input, false),
      body: JSON.stringify(this.requestBody(input, false)),
      signal,
    });
    if (!response.ok) {
      return "";
    }
    const text = await response.text().catch(() => "");
    if (!text.trim()) {
      return "";
    }
    try {
      return extractVisibleText(JSON.parse(text)) ?? "";
    } catch {
      return text.trim();
    }
  }

  private buildContent(message: string, attachments: MessageAttachment[], metadata?: MessageRequestMetadata, runtimeWorkspace?: RuntimeWorkspaceScope): string | Array<Record<string, unknown>> {
    const text = this.buildText(message, attachments, metadata, runtimeWorkspace);
    const imageParts = attachments
      .filter((attachment) => attachment.type === "image" && attachment.content_base64)
      .map((attachment) => ({
        type: "image_url",
        image_url: {
          url: `data:${attachment.mime_type};base64,${attachment.content_base64}`,
        },
      }));

    if (imageParts.length === 0) {
      return text;
    }

    return [
      { type: "text", text },
      ...imageParts,
    ];
  }

  private buildText(message: string, attachments: MessageAttachment[], metadata?: MessageRequestMetadata, runtimeWorkspace?: RuntimeWorkspaceScope): string {
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

    const nonImageAttachments = attachments.filter((attachment) => attachment.type !== "image");
    if (nonImageAttachments.length > 0) {
      sections.push(
        `첨부 파일이 제공되었습니다. 아래 파일 metadata와, 텍스트로 추출 가능한 파일은 원문을 함께 제공합니다.\n${nonImageAttachments
          .map((attachment) => `- ${attachment.name} (${attachment.mime_type}, ${attachment.type})`)
          .join("\n")}`,
      );

      for (const attachment of nonImageAttachments) {
        const text = this.extractTextAttachment(attachment);
        if (text) {
          sections.push(
            `첨부 파일 원문: ${attachment.name}\n\`\`\`\n${text}\n\`\`\``,
          );
        }
      }
    }

    return sections.join("\n\n");
  }

  private runtimeWorkspaceText(scope: RuntimeWorkspaceScope): string {
    const username = scope.username?.trim() || scope.userId;
    const displayName = scope.displayName?.trim() || username;
    return [
      "비공개 runtime workspace metadata: 이 요청은 사용자별 workspace 범위 안에서 처리되어야 합니다.",
      `- current_webchat_user_id=${scope.userId}`,
      `- current_webchat_username=${username}`,
      `- current_webchat_display_name=${displayName}`,
      `- user_identity_file=${scope.identityFile ?? `${scope.userDir}/WEBCHAT_USER.md`}`,
      `- user_dir=${scope.userDir}`,
      `- common_dir=${scope.commonDir}`,
      `- common_writable=${scope.commonWritable ? "true" : "false"}`,
      "이 사용자는 username/display name이 Eddy라고 명시되지 않는 한 Eddy가 아닙니다. Eddy 관련 기억, 선호, 개인정보, 호칭을 이 사용자에게 적용하지 마세요.",
      "파일 작업이 필요하면 user_dir 안에서 작업하고, common_dir는 명시적으로 필요한 읽기 참고자료로만 사용하세요.",
    ].join("\n");
  }

  private extractTextAttachment(attachment: MessageAttachment): string | null {
    const textMimeTypes = new Set(["text/plain", "text/csv", "application/csv"]);
    const lowerName = attachment.name.toLowerCase();
    const looksText = textMimeTypes.has(attachment.mime_type) || lowerName.endsWith(".txt") || lowerName.endsWith(".csv");
    if (!looksText || !attachment.content_base64) {
      return null;
    }

    try {
      const text = Buffer.from(attachment.content_base64, "base64").toString("utf8");
      const maxChars = 120_000;
      if (text.length <= maxChars) {
        return text;
      }
      return `${text.slice(0, maxChars)}\n\n[첨부 원문이 길어서 ${maxChars.toLocaleString()}자까지만 포함했습니다.]`;
    } catch {
      return null;
    }
  }

  private async readOpenAiSse(body: ReadableStream<Uint8Array>, onToken: (token: string) => Promise<void>, rawEvents: string[] = []): Promise<string> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const token = this.parseSseLine(line, rawEvents);
        if (token) {
          finalText += token;
          await onToken(token);
        }
      }
    }

    buffer += decoder.decode();
    for (const line of buffer.split(/\r?\n/)) {
      const token = this.parseSseLine(line, rawEvents);
      if (token) {
        finalText += token;
        await onToken(token);
      }
    }

    return finalText;
  }

  private parseSseLine(line: string, rawEvents: string[]): string | null {
    if (!line.startsWith("data:")) {
      return null;
    }
    const data = line.slice("data:".length).trimStart();
    if (!data || data === "[DONE]") {
      return null;
    }

    rawEvents.push(data.slice(0, 2_000));
    if (rawEvents.length > 20) {
      rawEvents.splice(0, rawEvents.length - 20);
    }

    try {
      return extractVisibleText(JSON.parse(data)) ?? null;
    } catch {
      return null;
    }
  }
}

interface OpenAiChatCompletionChunk {
  choices?: Array<{
    delta?: {
      content?: string | Array<unknown>;
    };
    message?: {
      content?: string | Array<unknown>;
    };
    text?: string;
  }>;
  payloads?: unknown[];
  result?: unknown;
  meta?: unknown;
  text?: string;
  reply?: string;
  message?: string;
  output?: string;
  content?: string | Array<unknown>;
}

function extractVisibleText(value: unknown): string | null {
  const parsed = asRecord(value) as OpenAiChatCompletionChunk | null;
  if (!parsed) {
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }

  const choiceText = parsed.choices
    ?.map((choice) => textFromContent(choice.delta?.content) ?? textFromContent(choice.message?.content) ?? asString(choice.text) ?? "")
    .join("");
  if (choiceText && choiceText.trim()) {
    return choiceText;
  }

  const payloadText = payloadsText(parsed.payloads);
  if (payloadText) {
    return payloadText;
  }

  const result = asRecord(parsed.result);
  const resultText = result ? extractVisibleText(result) : null;
  if (resultText) {
    return resultText;
  }

  const meta = asRecord(parsed.meta) ?? asRecord(result?.meta);
  const finalAssistantRawText = asString(meta?.finalAssistantRawText);
  if (finalAssistantRawText && containsMediaDirective(finalAssistantRawText)) {
    return finalAssistantRawText;
  }
  const finalAssistantVisibleText = asString(meta?.finalAssistantVisibleText);
  if (finalAssistantVisibleText) {
    return finalAssistantVisibleText;
  }
  if (finalAssistantRawText) {
    return finalAssistantRawText;
  }

  for (const key of ["reply", "message", "text", "output", "content"] as const) {
    const text = textFromContent(parsed[key]);
    if (text) {
      return text;
    }
  }

  return null;
}

function payloadsText(payloads: unknown[] | undefined): string | null {
  const parts = payloads
    ?.flatMap((payload) => {
      const record = asRecord(payload);
      if (!record) {
        return [];
      }
      const text = asString(record.text);
      const media = [record.mediaUrls, record.MediaUrls, record.MediaPaths]
        .flatMap((entry) => (Array.isArray(entry) ? entry : []))
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        .map((entry) => `MEDIA:${entry.trim()}`);
      const singles = [record.mediaUrl, record.MediaUrl, record.MediaPath]
        .map(asString)
        .filter((entry): entry is string => Boolean(entry))
        .map((entry) => `MEDIA:${entry}`);
      return [text, ...media, ...singles].filter((entry): entry is string => Boolean(entry));
    })
    .filter(Boolean) ?? [];
  return parts.length > 0 ? parts.join("\n\n") : null;
}

function textFromContent(content: unknown): string | null {
  if (typeof content === "string") {
    return content.length > 0 ? content : null;
  }
  if (!Array.isArray(content)) {
    return null;
  }
  const text = content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }
      const record = asRecord(part);
      return textFromContent(record?.text) ?? textFromContent(record?.content);
    })
    .filter(Boolean)
    .join("");
  return text.length > 0 ? text : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function containsMediaDirective(text: string): boolean {
  return /^\s*MEDIA:/m.test(text);
}
