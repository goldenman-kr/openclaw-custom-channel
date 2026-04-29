import assert from "node:assert/strict";
import test from "node:test";
import { MockOpenClawClient } from "./MockOpenClawClient.js";

test("does not emit tokens by default", async () => {
  const previous = process.env.MOCK_OPENCLAW_STREAM_TOKENS;
  delete process.env.MOCK_OPENCLAW_STREAM_TOKENS;
  try {
    const tokens: string[] = [];
    const client = new MockOpenClawClient();
    const result = await client.sendMessage({
      sessionId: "session-test",
      message: "hello world",
      callbacks: {
        onToken(token) {
          tokens.push(token);
        },
      },
    });

    assert.equal(result.reply, "[mock:session-test] hello world");
    assert.deepEqual(tokens, []);
  } finally {
    if (previous === undefined) {
      delete process.env.MOCK_OPENCLAW_STREAM_TOKENS;
    } else {
      process.env.MOCK_OPENCLAW_STREAM_TOKENS = previous;
    }
  }
});

test("emits whitespace-preserving tokens when mock streaming is enabled", async () => {
  const previousStream = process.env.MOCK_OPENCLAW_STREAM_TOKENS;
  const previousDelay = process.env.MOCK_OPENCLAW_TOKEN_DELAY_MS;
  process.env.MOCK_OPENCLAW_STREAM_TOKENS = "1";
  delete process.env.MOCK_OPENCLAW_TOKEN_DELAY_MS;
  try {
    const tokens: string[] = [];
    const client = new MockOpenClawClient();
    const result = await client.sendMessage({
      sessionId: "session-test",
      message: "hello world",
      callbacks: {
        onToken(token) {
          tokens.push(token);
        },
      },
    });

    assert.equal(tokens.join(""), result.reply);
    assert.deepEqual(tokens, ["[mock:session-test]", " ", "hello", " ", "world"]);
  } finally {
    if (previousStream === undefined) {
      delete process.env.MOCK_OPENCLAW_STREAM_TOKENS;
    } else {
      process.env.MOCK_OPENCLAW_STREAM_TOKENS = previousStream;
    }
    if (previousDelay === undefined) {
      delete process.env.MOCK_OPENCLAW_TOKEN_DELAY_MS;
    } else {
      process.env.MOCK_OPENCLAW_TOKEN_DELAY_MS = previousDelay;
    }
  }
});
