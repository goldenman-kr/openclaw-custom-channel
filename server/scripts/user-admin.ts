#!/usr/bin/env tsx
import { randomBytes } from "node:crypto";
import { resolve, join } from "node:path";
import { AuthStore, type UserRole } from "../src/session/AuthStore.js";

interface CliOptions {
  command: string;
  username?: string;
  displayName?: string;
  password?: string;
  role?: UserRole;
  dbPath: string;
}

function parseArgs(argv: string[]): CliOptions {
  const [command, ...rest] = argv;
  const options: CliOptions = {
    command: command ?? "help",
    dbPath: resolve(process.env.CHAT_DB_PATH ?? join(process.cwd(), "state", "chat.sqlite")),
  };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = rest[index + 1];
    if (arg === "--display-name") {
      options.displayName = requireValue(arg, next);
      index += 1;
    } else if (arg === "--password") {
      options.password = requireValue(arg, next);
      index += 1;
    } else if (arg === "--role") {
      const role = requireValue(arg, next);
      if (role !== "admin" && role !== "user") {
        throw new Error("--role must be admin or user.");
      }
      options.role = role;
      index += 1;
    } else if (arg === "--db") {
      options.dbPath = resolve(requireValue(arg, next));
      index += 1;
    } else if (!options.username && !arg.startsWith("--")) {
      options.username = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function requireValue(name: string, value: string | undefined): string {
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function generatedPassword(): string {
  return randomBytes(18).toString("base64url");
}

function printHelp(): void {
  console.log(`Usage:
  npm run user:list
  npm run user:create -- <username> [--display-name <name>] [--role user|admin] [--password <password>]
  npm run user:reset-password -- <username> [--password <password>]
  npm run user:disable -- <username>
  npm run user:enable -- <username>

Options:
  --db <path>             SQLite DB path. Default: CHAT_DB_PATH or ./state/chat.sqlite
  --password <password>   If omitted for create/reset, a strong password is generated and printed once.
`);
}

function printUser(user: { id: string; username: string; displayName: string; role: string }, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ user, ...extra }, null, 2));
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === "help" || options.command === "--help" || options.command === "-h") {
    printHelp();
    return;
  }

  const store = new AuthStore(options.dbPath);
  try {
    switch (options.command) {
      case "list": {
        console.table(store.listUsers());
        break;
      }
      case "create": {
        if (!options.username) {
          throw new Error("username is required.");
        }
        const password = options.password ?? generatedPassword();
        const user = store.createUser({
          username: options.username,
          displayName: options.displayName,
          password,
          role: options.role ?? "user",
        });
        printUser(user, options.password ? {} : { generated_password: password });
        break;
      }
      case "reset-password": {
        if (!options.username) {
          throw new Error("username is required.");
        }
        const password = options.password ?? generatedPassword();
        const ok = store.resetPassword(options.username, password);
        if (!ok) {
          throw new Error(`User not found: ${options.username}`);
        }
        const user = store.getUserByUsername(options.username);
        printUser(user ? { id: user.id, username: user.username, displayName: user.displayName, role: user.role } : { id: "", username: options.username, displayName: options.username, role: "user" }, options.password ? {} : { generated_password: password });
        break;
      }
      case "disable": {
        if (!options.username) {
          throw new Error("username is required.");
        }
        const ok = store.disableUser(options.username);
        if (!ok) {
          throw new Error(`User not found: ${options.username}`);
        }
        console.log(JSON.stringify({ ok: true, username: options.username, disabled: true }, null, 2));
        break;
      }
      case "enable": {
        if (!options.username) {
          throw new Error("username is required.");
        }
        const ok = store.enableUser(options.username);
        if (!ok) {
          throw new Error(`User not found: ${options.username}`);
        }
        console.log(JSON.stringify({ ok: true, username: options.username, disabled: false }, null, 2));
        break;
      }
      default:
        throw new Error(`Unknown command: ${options.command}`);
    }
  } finally {
    store.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
