import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { MessageAttachment } from "../contracts/apiContractV1.js";
import type { OpenClawClient } from "./OpenClawClient.js";

const execFileAsync = promisify(execFile);

export class CliOpenClawClient implements OpenClawClient {
  constructor(
    private readonly command = process.env.OPENCLAW_BIN ?? "openclaw",
    private readonly timeoutMs = Number(process.env.OPENCLAW_TIMEOUT_MS ?? 30_000),
  ) {}

  async sendMessage(input: Parameters<OpenClawClient["sendMessage"]>[0]) {
    const channel = process.env.OPENCLAW_CHANNEL ?? "telegram";
    const target = process.env.OPENCLAW_TARGET;
    const account = process.env.OPENCLAW_ACCOUNT;

    if (!target) {
      throw new Error("OPENCLAW_TARGET is required for CLI transport.");
    }

    const tempDir = await mkdtemp(join(tmpdir(), "openclaw-bridge-"));
    const mediaPaths = await this.writeAttachments(tempDir, input.attachments ?? []);

    const args = [
      "message",
      "send",
      "--channel",
      channel,
      "--target",
      target,
      "--message",
      input.message,
      "--json",
    ];

    if (account) {
      args.push("--account", account);
    }

    for (const mediaPath of mediaPaths) {
      args.push("--media", mediaPath);
    }

    try {
      const result = await execFileAsync(this.command, args, {
        timeout: this.timeoutMs,
        maxBuffer: 10 * 1024 * 1024,
        env: process.env,
        signal: input.abortSignal,
      });

      return {
        reply: result.stdout.trim() || result.stderr.trim() || "Message sent.",
        raw: {
          stdout: result.stdout,
          stderr: result.stderr,
          args: args.map((arg) => (arg === input.message ? "<message>" : arg)),
          sessionId: input.sessionId,
          attachments: input.attachments?.map((attachment) => ({
            type: attachment.type,
            name: attachment.name,
            mime_type: attachment.mime_type,
          })),
        },
      };
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  }

  private async writeAttachments(
    tempDir: string,
    attachments: MessageAttachment[],
  ): Promise<string[]> {
    const paths: string[] = [];
    for (const attachment of attachments) {
      const filePath = join(tempDir, attachment.name);
      await writeFile(filePath, Buffer.from(attachment.content_base64, "base64"));
      paths.push(filePath);
    }
    return paths;
  }
}
