import { CliOpenClawClient } from "./CliOpenClawClient.js";
import { MockOpenClawClient } from "./MockOpenClawClient.js";
import type { OpenClawClient } from "./OpenClawClient.js";

export function createOpenClawClient(): OpenClawClient {
  const transport = process.env.OPENCLAW_TRANSPORT ?? "cli";
  if (transport === "mock") {
    return new MockOpenClawClient();
  }

  return new CliOpenClawClient();
}
