import type { OpenClawClient } from "./OpenClawClient.js";

export class MockOpenClawClient implements OpenClawClient {
  async sendMessage(input: Parameters<OpenClawClient["sendMessage"]>[0]) {
    const attachmentCount = input.attachments?.length ?? 0;
    const attachmentNote = attachmentCount > 0 ? ` (${attachmentCount} attachment(s))` : "";

    return {
      reply: `[mock:${input.sessionId}] ${input.message}${attachmentNote}`,
      raw: {
        transport: "mock",
      },
    };
  }
}
