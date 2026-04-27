import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { MessageAttachment } from "../contracts/apiContractV1.js";
import type { OpenClawClient } from "./OpenClawClient.js";

const execFileAsync = promisify(execFile);

export class AgentOpenClawClient implements OpenClawClient {
  constructor(
    private readonly command = process.env.OPENCLAW_BIN ?? "openclaw",
    private readonly timeoutMs = Number(process.env.OPENCLAW_TIMEOUT_MS ?? 600_000),
  ) {}

  async sendMessage(input: Parameters<OpenClawClient["sendMessage"]>[0]) {
    const args = [
      "agent",
      "--session-id",
      input.sessionId,
      "--message",
      this.buildMessage(input.message, input.attachments ?? []),
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
      reply: extractReply(result.stdout) || result.stdout.trim() || result.stderr.trim() || "Agent turn completed.",
      raw: {
        stdout: result.stdout,
        stderr: result.stderr,
        args: args.map((arg) => (arg === input.message ? "<message>" : arg)),
        sessionId: input.sessionId,
      },
    };
  }

  private buildMessage(message: string, attachments: MessageAttachment[]): string {
    if (attachments.length === 0) {
      return message;
    }

    const attachmentSummary = attachments
      .map((attachment) => `- ${attachment.name} (${attachment.mime_type}, ${attachment.type})`)
      .join("\n");

    return `${message}\n\n첨부 파일:\n${attachmentSummary}`;
  }
}

function extractReply(stdout: string): string | null {
  try {
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    for (const key of ["reply", "message", "text", "output", "content"]) {
      const value = parsed[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  } catch {
    return null;
  }

  return null;
}
