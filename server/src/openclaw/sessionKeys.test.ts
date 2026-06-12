import assert from "node:assert/strict";
import test from "node:test";
import {
  openClawSessionKeyCandidates,
  pwaConversationSessionIdFromGatewayKey,
  scopedOpenClawSessionKey,
} from "./sessionKeys.js";

test("scopes raw PWA session keys like Gateway ingress", () => {
  assert.equal(scopedOpenClawSessionKey("web-conv_123", "main"), "agent:main:web-conv_123");
  assert.equal(scopedOpenClawSessionKey("agent:main:web-conv_123", "main"), "agent:main:web-conv_123");
});

test("includes legacy candidates for existing session state", () => {
  assert.deepEqual(openClawSessionKeyCandidates("web-conv_123", "main"), [
    "agent:main:web-conv_123",
    "web-conv_123",
    "agent:main:explicit:web-conv_123",
    "agent:main:legacy:web-conv_123",
  ]);
});

test("maps Gateway session keys back to PWA conversation session ids", () => {
  assert.equal(pwaConversationSessionIdFromGatewayKey("agent:main:web-conv_123", "main"), "web-conv_123");
  assert.equal(pwaConversationSessionIdFromGatewayKey("agent:main:explicit:web-conv_123", "main"), "web-conv_123");
  assert.equal(pwaConversationSessionIdFromGatewayKey("web-conv_123", "main"), "web-conv_123");
  assert.equal(pwaConversationSessionIdFromGatewayKey("telegram:187230017", "main"), null);
});
