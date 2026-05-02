import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const settingsPath = resolve(process.env.NATIVE_COMMAND_SETTINGS_PATH ?? "state/native-command-settings.json");

interface NativeCommandSettings {
  modelOverride?: string;
}

function readSettings(): NativeCommandSettings {
  try {
    return JSON.parse(readFileSync(settingsPath, "utf8")) as NativeCommandSettings;
  } catch {
    return {};
  }
}

function writeSettings(settings: NativeCommandSettings): void {
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
}

export function getModelOverride(): string | null {
  const value = readSettings().modelOverride;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function setModelOverride(model: string | null): string | null {
  const settings = readSettings();
  const normalized = model?.trim();
  if (normalized) {
    settings.modelOverride = normalized;
  } else {
    delete settings.modelOverride;
  }
  writeSettings(settings);
  return settings.modelOverride ?? null;
}

export function activeGatewayModel(defaultModel = process.env.OPENCLAW_GATEWAY_MODEL ?? "openclaw"): string {
  return getModelOverride() ?? defaultModel;
}
