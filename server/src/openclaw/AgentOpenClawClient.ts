import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { MessageAttachment, MessageRequestMetadata } from "../contracts/apiContractV1.js";
import type { OpenClawClient } from "./OpenClawClient.js";

const execFileAsync = promisify(execFile);

export class AgentOpenClawClient implements OpenClawClient {
  constructor(
    private readonly command = process.env.OPENCLAW_BIN ?? "openclaw",
    private readonly timeoutMs = Number(process.env.OPENCLAW_TIMEOUT_MS ?? 600_000),
    private readonly uploadDir = resolve(process.env.UPLOAD_DIR ?? join(process.cwd(), "state", "uploads")),
  ) {}

  async sendMessage(input: Parameters<OpenClawClient["sendMessage"]>[0]) {
    const savedAttachments = await this.saveAttachments(input.sessionId, input.attachments ?? []);
    const message = this.buildMessage(input.message, savedAttachments, input.metadata);
    const args = [
      "agent",
      "--session-id",
      input.sessionId,
      "--message",
      message,
      "--json",
    ];
    if (process.env.OPENCLAW_AGENT) {
      args.push("--agent", process.env.OPENCLAW_AGENT);
    }

    if (process.env.OPENCLAW_THINKING) {
      args.push("--thinking", process.env.OPENCLAW_THINKING);
    }

    if (process.env.OPENCLAW_AGENT_TIMEOUT_SECONDS) {
      args.push("--timeout", process.env.OPENCLAW_AGENT_TIMEOUT_SECONDS);
    }

    const result = await execFileAsync(this.command, args, {
      timeout: this.timeoutMs,
      maxBuffer: 20 * 1024 * 1024,
      env: process.env,
    });

    return {
      reply: extractReply(result.stdout) || extractReply(result.stderr) || "응답은 완료됐지만 출력 형식을 해석하지 못했습니다.",
      raw: {
        stdout: result.stdout,
        stderr: result.stderr,
        args: args.map((arg) => (arg === message ? "<message>" : arg)),
        sessionId: input.sessionId,
      },
    };
  }

  private async saveAttachments(sessionId: string, attachments: MessageAttachment[]): Promise<SavedAttachment[]> {
    if (attachments.length === 0) {
      return [];
    }

    const safeSessionId = sessionId.replace(/[^a-zA-Z0-9_.-]/g, "_");
    const targetDir = join(this.uploadDir, safeSessionId, randomUUID());
    await mkdir(targetDir, { recursive: true });

    return Promise.all(
      attachments.map(async (attachment, index) => {
        const safeName = basename(attachment.name).replace(/[^a-zA-Z0-9가-힣._ -]/g, "_") || `attachment-${index + 1}`;
        const filePath = join(targetDir, `${index + 1}-${safeName}`);
        await writeFile(filePath, Buffer.from(attachment.content_base64, "base64"));
        return { ...attachment, filePath };
      }),
    );
  }

  private buildMessage(message: string, attachments: SavedAttachment[], metadata?: MessageRequestMetadata): string {
    const sections = [message];

    const location = metadata?.location;
    if (location) {
      const accuracyText = Number.isFinite(location.accuracy) ? `, accuracy_m=${Math.round(location.accuracy ?? 0)}` : "";
      const capturedAtText = location.captured_at ? `, captured_at=${location.captured_at}` : "";
      sections.push(
        `비공개 클라이언트 metadata: 사용자의 현재 위치가 제공되었습니다. 답변에 필요할 때만 참고하고, 좌표 자체는 사용자가 요청하지 않는 한 그대로 노출하지 마세요.\n- latitude=${location.latitude}, longitude=${location.longitude}${accuracyText}${capturedAtText}`,
      );
    }

    if (attachments.length > 0) {
      const attachmentSummary = attachments
        .map(
          (attachment) =>
            `- ${attachment.name} (${attachment.mime_type}, ${attachment.type})\n  저장 경로: ${attachment.filePath}`,
        )
        .join("\n");
      sections.push(`첨부 파일이 서버에 저장되어 있습니다. 필요한 경우 도구로 아래 경로의 파일을 직접 읽거나 분석하세요.\n${attachmentSummary}`);
    }

    return sections.join("\n\n");
  }
}

interface SavedAttachment extends MessageAttachment {
  filePath: string;
}

function extractReply(stdout: string): string | null {
  const parsed = parseAgentJson(stdout);
  if (!parsed) {
    return null;
  }

  const nestedText = pickNestedText(parsed);
  if (nestedText) {
    return nestedText;
  }

  for (const key of ["reply", "message", "text", "output", "content"]) {
    const value = parsed[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function parseAgentJson(stdout: string): Record<string, unknown> | null {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    // OpenClaw can print a human-readable fallback notice before the JSON result
    // when the Gateway restarts mid-turn. In that case, recover the trailing JSON
    // instead of saving the entire mixed stdout blob as the assistant reply.
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    return null;
  }

  try {
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function pickNestedText(parsed: Record<string, unknown>): string | null {
  const directPayloadText = pickPayloadText(parsed);
  if (directPayloadText) {
    return directPayloadText;
  }

  const result = asRecord(parsed.result);
  if (result) {
    const resultPayloadText = pickPayloadText(result);
    if (resultPayloadText) {
      return resultPayloadText;
    }
  }

  const meta = asRecord(result?.meta) ?? asRecord(parsed.meta);
  const finalAssistantVisibleText = asString(meta?.finalAssistantVisibleText);
  if (finalAssistantVisibleText) {
    return finalAssistantVisibleText;
  }

  const finalAssistantRawText = asString(meta?.finalAssistantRawText);
  if (finalAssistantRawText) {
    return finalAssistantRawText;
  }

  return null;
}

function pickPayloadText(parsed: Record<string, unknown>): string | null {
  const payloads = asArray(parsed.payloads);
  const firstPayload = asRecord(payloads?.[0]);
  return asString(firstPayload?.text);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
