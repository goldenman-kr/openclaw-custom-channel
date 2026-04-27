import { AgentOpenClawClient } from "./AgentOpenClawClient.js";
import { CliOpenClawClient } from "./CliOpenClawClient.js";
import { MockOpenClawClient } from "./MockOpenClawClient.js";
import type { OpenClawClient } from "./OpenClawClient.js";

export function createOpenClawClient(): OpenClawClient {
  const transport = process.env.OPENCLAW_TRANSPORT ?? "agent";
  if (transport === "mock") {
    return new MockOpenClawClient();
  }

  if (transport === "cli-message") {
    return new CliOpenClawClient();
  }

  return new AgentOpenClawClient();
}
