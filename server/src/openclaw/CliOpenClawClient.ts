import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { OpenClawClient } from "./OpenClawClient.js";

const execFileAsync = promisify(execFile);

export class CliOpenClawClient implements OpenClawClient {
  constructor(
    private readonly command = process.env.OPENCLAW_BIN ?? "openclaw",
    private readonly timeoutMs = Number(process.env.OPENCLAW_TIMEOUT_MS ?? 30_000),
  ) {}

  async sendMessage(input: Parameters<OpenClawClient["sendMessage"]>[0]) {
    const args = [
      "message",
      "send",
      "--channel",
      "mobile",
      "--session",
      input.sessionId,
      input.message,
    ];

    const result = await execFileAsync(this.command, args, {
      timeout: this.timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      env: process.env,
    });

    return {
      reply: result.stdout.trim(),
      raw: {
        stdout: result.stdout,
        stderr: result.stderr,
        attachments: input.attachments?.map((attachment) => ({
          type: attachment.type,
          name: attachment.name,
          mime_type: attachment.mime_type,
        })),
      },
    };
  }
}
