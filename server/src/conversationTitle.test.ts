import assert from "node:assert/strict";
import test from "node:test";
import { titleFromMessage } from "./conversationTitle.js";

test("uses the first message content as the conversation title", () => {
  assert.equal(titleFromMessage("이거 좀 해줘. 중요한 내용입니다."), "이거 좀 해줘. 중요한 내용입니다.");
});

test("normalizes whitespace and limits conversation titles to the first 40 characters", () => {
  const message = "첫 줄입니다.\n두 번째 줄입니다.\t공백도 정리합니다. 12345678901234567890";
  const normalized = "첫 줄입니다. 두 번째 줄입니다. 공백도 정리합니다. 12345678901234567890";
  assert.equal(titleFromMessage(message), normalized.slice(0, 40));
  assert.equal(titleFromMessage(message).length, 40);
});

test("falls back to default title for blank first messages", () => {
  assert.equal(titleFromMessage(" \n\t "), "새 대화");
});
