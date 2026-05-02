import type { OpenClawClient } from "../openclaw/OpenClawClient.js";
import type { ChatRuntime, ChatRuntimeInput } from "./ChatRuntime.js";

export class OpenClawChatRuntime implements ChatRuntime {
  constructor(private readonly openClawClient: OpenClawClient) {}

  sendMessage(input: ChatRuntimeInput) {
    return this.openClawClient.sendMessage(input);
  }
}
