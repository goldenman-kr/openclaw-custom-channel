import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqliteChatStore } from "./SqliteChatStore.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "openclaw-chat-store-"));
}

test("creates conversations, messages, attachments, and jobs in SQLite", () => {
  const dir = tempDir();
  const store = new SqliteChatStore(join(dir, "chat.sqlite"));
  try {
    const conversation = store.createConversation({
      title: "테스트 대화",
      openclawSessionId: "web-conv-test",
      now: "2026-04-29T00:00:00.000Z",
    });

    assert.equal(conversation.title, "테스트 대화");
    assert.equal(conversation.openclawSessionId, "web-conv-test");
    assert.equal(conversation.pinned, false);

    const message = store.addMessage({
      conversationId: conversation.id,
      role: "user",
      text: "hello",
      createdAt: "2026-04-29T00:01:00.000Z",
      attachments: [
        {
          name: "note.txt",
          mime_type: "text/plain",
          type: "file",
          path: "/tmp/note.txt",
          size: 5,
        },
      ],
    });

    const messages = store.listMessages(conversation.id);
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.id, message.id);
    assert.equal(messages[0]?.attachments?.[0]?.name, "note.txt");

    const job = store.createJob({ conversationId: conversation.id, now: "2026-04-29T00:02:00.000Z" });
    const updatedJob = store.updateJob(job.id, {
      state: "completed",
      now: "2026-04-29T00:03:00.000Z",
    });
    assert.equal(updatedJob?.state, "completed");

    const cleared = store.clearMessages(conversation.id, { now: "2026-04-29T00:04:00.000Z" });
    assert.equal(cleared, 1);
    assert.equal(store.listMessages(conversation.id).length, 0);
    assert.equal(store.getJob(job.id), null);
    assert.equal(store.deleteConversation(conversation.id), true);
    assert.equal(store.getConversation(conversation.id), null);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});


test("orders user messages before assistant placeholders with identical timestamps", () => {
  const dir = tempDir();
  const store = new SqliteChatStore(join(dir, "chat.sqlite"));
  try {
    const conversation = store.createConversation({
      title: "정렬 테스트",
      openclawSessionId: "web-order-test",
      now: "2026-04-29T00:00:00.000Z",
    });
    const timestamp = "2026-04-29T00:01:00.000Z";
    store.addMessage({
      id: "msg_same_time",
      conversationId: conversation.id,
      role: "user",
      text: "질문",
      createdAt: timestamp,
    });
    store.addMessage({
      id: "job_same_time",
      conversationId: conversation.id,
      role: "assistant",
      text: "응답 대기 중입니다…",
      jobId: "job_same_time",
      createdAt: timestamp,
    });

    const messages = store.listMessages(conversation.id);
    assert.equal(messages.map((message) => message.id).join(","), "msg_same_time,job_same_time");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});


test("updates conversation version without moving message order", () => {
  const dir = tempDir();
  const store = new SqliteChatStore(join(dir, "chat.sqlite"));
  try {
    const conversation = store.createConversation({
      title: "버전 테스트",
      openclawSessionId: "web-version-test",
      now: "2026-04-29T00:00:00.000Z",
    });
    store.addMessage({
      id: "job_version_test",
      conversationId: conversation.id,
      role: "assistant",
      text: "응답 대기 중입니다…",
      createdAt: "2026-04-29T00:01:00.000Z",
    });
    store.updateMessage("job_version_test", { role: "assistant", text: "완료" });

    const message = store.listMessages(conversation.id)[0];
    const updated = store.getConversation(conversation.id);
    assert.equal(message?.createdAt, "2026-04-29T00:01:00.000Z");
    assert.notEqual(updated?.updatedAt, conversation.updatedAt);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
