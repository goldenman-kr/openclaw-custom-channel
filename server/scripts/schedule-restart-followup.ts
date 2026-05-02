#!/usr/bin/env tsx
import { join, resolve } from "node:path";
import { RestartFollowupStore, safeConversationIdFromSessionKey } from "../src/session/RestartFollowupStore.js";

interface Options {
  conversationId?: string;
  sessionKey?: string;
  serviceName: string;
  healthUrl: string;
  delayMs: number;
  stateDir: string;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    serviceName: "openclaw-custom-channel.service",
    healthUrl: "http://127.0.0.1:29999/health",
    delayMs: 30_000,
    stateDir: resolve(process.env.CHANNEL_STATE_DIR ?? join(process.cwd(), "state")),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--conversation-id") {
      options.conversationId = requireValue(arg, next);
      index += 1;
    } else if (arg === "--session-key") {
      options.sessionKey = requireValue(arg, next);
      index += 1;
    } else if (arg === "--service") {
      options.serviceName = requireValue(arg, next);
      index += 1;
    } else if (arg === "--health-url") {
      options.healthUrl = requireValue(arg, next);
      index += 1;
    } else if (arg === "--delay-ms") {
      options.delayMs = Number(requireValue(arg, next));
      index += 1;
    } else if (arg === "--delay-seconds") {
      options.delayMs = Number(requireValue(arg, next)) * 1000;
      index += 1;
    } else if (arg === "--state-dir") {
      options.stateDir = resolve(requireValue(arg, next));
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(options.delayMs) || options.delayMs < 0) {
    throw new Error("delay must be a non-negative number.");
  }
  return options;
}

function requireValue(name: string, value: string | undefined): string {
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function printHelp(): void {
  console.log(`Usage:
  npm run restart-followup:schedule -- --conversation-id conv_xxx [--delay-seconds 30]
  npm run restart-followup:schedule -- --session-key web-conv_xxx [--delay-seconds 30]

Options:
  --service <name>       systemd user service name. Default: openclaw-custom-channel.service
  --health-url <url>     Health URL. Default: http://127.0.0.1:29999/health
  --state-dir <path>     State directory. Default: CHANNEL_STATE_DIR or ./state
`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const conversationId = options.conversationId ?? (options.sessionKey ? safeConversationIdFromSessionKey(options.sessionKey) : null);
  if (!conversationId) {
    throw new Error("--conversation-id or a web-conv_* --session-key is required.");
  }
  const store = new RestartFollowupStore(resolve(options.stateDir, "restart-followups"));
  const record = await store.create({
    conversationId,
    serviceName: options.serviceName,
    healthUrl: options.healthUrl,
    delayMs: options.delayMs,
    createdBy: "schedule-restart-followup.ts",
  });
  console.log(JSON.stringify(record, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
