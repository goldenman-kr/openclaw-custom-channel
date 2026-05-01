import type { MessageAttachment, MessageRequestMetadata } from "../contracts/apiContractV1.js";
import type { OpenClawClient, OpenClawClientInput, OpenClawClientResult } from "./OpenClawClient.js";

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

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: this.headers(input.sessionId),
        body: JSON.stringify({
          model: this.model,
          stream: true,
          messages: [
            {
              role: "user",
              content: this.buildContent(input.message, input.attachments ?? [], input.metadata),
            },
          ],
        }),
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
      });

      return {
        reply: finalText || streamed.join("") || "응답 출력에 문제가 있습니다. 다시 답변을 요청해보세요. 이 오류가 반복되면 새 대화를 열어 세션을 다시 시작해주세요.",
        raw: {
          transport: "gateway-openai",
          endpoint: url.toString(),
          model: this.model,
          sessionId: input.sessionId,
          streamedChunks: streamed.length,
        },
      };
    } finally {
      clearTimeout(timeout);
      input.abortSignal?.removeEventListener("abort", onExternalAbort);
    }
  }

  private headers(sessionId: string): HeadersInit {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "text/event-stream",
      "x-openclaw-session-key": sessionId,
      "x-openclaw-message-channel": "webchat",
    };
    if (this.token) {
      headers.authorization = `Bearer ${this.token}`;
    }
    return headers;
  }

  private buildContent(message: string, attachments: MessageAttachment[], metadata?: MessageRequestMetadata): string | Array<Record<string, unknown>> {
    const text = this.buildText(message, attachments, metadata);
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

  private buildText(message: string, attachments: MessageAttachment[], metadata?: MessageRequestMetadata): string {
    const sections = [message];
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

  private async readOpenAiSse(body: ReadableStream<Uint8Array>, onToken: (token: string) => Promise<void>): Promise<string> {
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
        const token = this.parseSseLine(line);
        if (token) {
          finalText += token;
          await onToken(token);
        }
      }
    }

    buffer += decoder.decode();
    for (const line of buffer.split(/\r?\n/)) {
      const token = this.parseSseLine(line);
      if (token) {
        finalText += token;
        await onToken(token);
      }
    }

    return finalText;
  }

  private parseSseLine(line: string): string | null {
    if (!line.startsWith("data:")) {
      return null;
    }
    const data = line.slice("data:".length).trimStart();
    if (!data || data === "[DONE]") {
      return null;
    }

    try {
      const parsed = JSON.parse(data) as OpenAiChatCompletionChunk;
      return parsed.choices?.map((choice) => choice.delta?.content ?? "").join("") || null;
    } catch {
      return null;
    }
  }
}

interface OpenAiChatCompletionChunk {
  choices?: Array<{
    delta?: {
      content?: string;
    };
  }>;
}
