import assert from "node:assert/strict";
import test from "node:test";
import { createOpenClawClient } from "./createOpenClawClient.js";
import { GatewayNativeOpenClawClient } from "./GatewayNativeOpenClawClient.js";
import { GatewayOpenAiOpenClawClient } from "./GatewayOpenAiOpenClawClient.js";

test("gateway-openai transport defaults to native Gateway chat.send client", () => {
  const previousTransport = process.env.OPENCLAW_TRANSPORT;
  const previousCompat = process.env.OPENCLAW_GATEWAY_COMPAT_OPENAI;
  process.env.OPENCLAW_TRANSPORT = "gateway-openai";
  delete process.env.OPENCLAW_GATEWAY_COMPAT_OPENAI;
  try {
    assert.ok(createOpenClawClient() instanceof GatewayNativeOpenClawClient);
  } finally {
    if (previousTransport === undefined) {
      delete process.env.OPENCLAW_TRANSPORT;
    } else {
      process.env.OPENCLAW_TRANSPORT = previousTransport;
    }
    if (previousCompat === undefined) {
      delete process.env.OPENCLAW_GATEWAY_COMPAT_OPENAI;
    } else {
      process.env.OPENCLAW_GATEWAY_COMPAT_OPENAI = previousCompat;
    }
  }
});

test("gateway-openai compatibility mode keeps OpenAI-compatible HTTP client", () => {
  const previousTransport = process.env.OPENCLAW_TRANSPORT;
  const previousCompat = process.env.OPENCLAW_GATEWAY_COMPAT_OPENAI;
  process.env.OPENCLAW_TRANSPORT = "gateway-openai";
  process.env.OPENCLAW_GATEWAY_COMPAT_OPENAI = "1";
  try {
    assert.ok(createOpenClawClient() instanceof GatewayOpenAiOpenClawClient);
  } finally {
    if (previousTransport === undefined) {
      delete process.env.OPENCLAW_TRANSPORT;
    } else {
      process.env.OPENCLAW_TRANSPORT = previousTransport;
    }
    if (previousCompat === undefined) {
      delete process.env.OPENCLAW_GATEWAY_COMPAT_OPENAI;
    } else {
      process.env.OPENCLAW_GATEWAY_COMPAT_OPENAI = previousCompat;
    }
  }
});
