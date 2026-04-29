import type { OpenClawClient } from "./OpenClawClient.js";

export class MockOpenClawClient implements OpenClawClient {
  async sendMessage(input: Parameters<OpenClawClient["sendMessage"]>[0]) {
    const attachmentCount = input.attachments?.length ?? 0;
    const attachmentNote = attachmentCount > 0 ? ` (${attachmentCount} attachment(s))` : "";
    const reply = `[mock:${input.sessionId}] ${input.message}${attachmentNote}`;

    if (process.env.MOCK_OPENCLAW_STREAM_TOKENS === "1") {
      const delayMs = Number(process.env.MOCK_OPENCLAW_TOKEN_DELAY_MS ?? 0);
      for (const token of chunkText(reply)) {
        if (delayMs > 0) {
          await delay(delayMs);
        }
        await input.callbacks?.onToken?.(token);
      }
    }

    return {
      reply,
      raw: {
        transport: "mock",
      },
    };
  }
}

function chunkText(text: string): string[] {
  const words = text.split(/(\s+)/).filter(Boolean);
  return words.length > 0 ? words : [text];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
