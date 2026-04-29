import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import type { ChatRuntime } from "./ChatRuntime.js";
import type { MessageJob } from "./MessageJob.js";
import { MessageJobRunner } from "./MessageJobRunner.js";
import type { HistoryStore } from "../session/HistoryStore.js";
import { InMemorySessionStore } from "../session/SessionStore.js";
import type { ConversationStore, JobStore, MessageStore } from "../session/SqliteChatStore.js";

function unusedConversationStore(): ConversationStore & MessageStore & JobStore {
  return {
    createConversation() {
      throw new Error("not implemented");
    },
    getConversation() {
      return null;
    },
    listConversations() {
      return [];
    },
    updateConversation() {
      return null;
    },
    deleteConversation() {
      return false;
    },
    addMessage() {
      throw new Error("not implemented");
    },
    updateMessage() {
      return null;
    },
    listMessages() {
      return [];
    },
    clearMessages() {
      return 0;
    },
    createJob() {
      throw new Error("not implemented");
    },
    getJob() {
      return null;
    },
    updateJob() {
      return null;
    },
  };
}

function memoryHistoryStore(): HistoryStore {
  const messages = new Map<string, Array<{ id?: string; role: "user" | "assistant" | "system"; text: string; savedAt: string }>>();
  return {
    async list(sessionId) {
      return messages.get(sessionId) ?? [];
    },
    async meta(sessionId) {
      return { version: String(messages.get(sessionId)?.length ?? 0), size: messages.get(sessionId)?.length ?? 0, mtimeMs: 0 };
    },
    async append(sessionId, items) {
      messages.set(sessionId, [...(messages.get(sessionId) ?? []), ...items]);
    },
    async replaceById(sessionId, id, message) {
      const current = messages.get(sessionId) ?? [];
      const next = current.map((item) => (item.id === id ? { ...message, id } : item));
      if (!next.some((item) => item.id === id)) {
        next.push({ ...message, id });
      }
      messages.set(sessionId, next);
    },
    async clear(sessionId) {
      messages.set(sessionId, []);
    },
  };
}

async function waitUntil(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for predicate.");
    }
    await delay(10);
  }
}

test("publishes runtime tokens for queued message jobs", async () => {
  const tokens: string[] = [];
  const states: string[] = [];
  const runtime: ChatRuntime = {
    async sendMessage(input) {
      await input.callbacks?.onToken?.("hello");
      await input.callbacks?.onToken?.(" world");
      return { reply: "hello world" };
    },
  };
  const historyStore = memoryHistoryStore();
  const job: MessageJob = {
    id: "job_runner_token_test",
    sessionId: "session-runner-token-test",
    state: "queued",
    createdAt: "2026-04-29T00:00:00.000Z",
    updatedAt: "2026-04-29T00:00:00.000Z",
  };

  await historyStore.append(job.sessionId, [
    {
      id: job.id,
      role: "assistant",
      text: "응답 대기 중입니다…",
      savedAt: job.createdAt,
    },
  ]);

  const runner = new MessageJobRunner({
    chatRuntime: runtime,
    sessionStore: new InMemorySessionStore(),
    validApiKeys: new Set(["test-key"]),
    conversationStore: unusedConversationStore(),
    historyStore,
    shouldPersistMessage: () => true,
    updateJob(jobToUpdate, patch) {
      Object.assign(jobToUpdate, patch);
      if (patch.state) {
        states.push(patch.state);
      }
    },
    publishToken(jobToPublish, token) {
      assert.equal(jobToPublish.id, job.id);
      tokens.push(token);
    },
  });

  runner.enqueue(job, { authorization: "Bearer test-key" }, { message: "hello" });

  await waitUntil(() => job.state === "completed");
  assert.deepEqual(tokens, ["hello", " world"]);
  assert.deepEqual(states, ["running", "completed"]);
  assert.equal((await historyStore.list(job.sessionId))[0]?.text, "hello world");
});
