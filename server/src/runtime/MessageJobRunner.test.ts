import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    getConversationByOpenClawSessionId() {
      return null;
    },
    listConversations() {
      return [];
    },
    searchConversationMessageText() {
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
    deleteMessage() {
      return false;
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
    hasEarlierRunningJob() {
      return false;
    },
    deleteQueuedJob() {
      return false;
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

test("waits for an earlier durable running job before starting after a server restart", async () => {
  let blocked = true;
  let sendCount = 0;
  const job: MessageJob = {
    id: "job_after_restart_blocker",
    sessionId: "session-after-restart-blocker",
    conversationId: "conv_after_restart_blocker",
    state: "queued",
    createdAt: "2026-07-20T00:01:00.000Z",
    updatedAt: "2026-07-20T00:01:00.000Z",
  };
  const runner = new MessageJobRunner({
    chatRuntime: {
      async sendMessage() {
        sendCount += 1;
        return { reply: "완료" };
      },
    },
    sessionStore: new InMemorySessionStore(),
    validApiKeys: new Set(["test-key"]),
    conversationStore: unusedConversationStore(),
    historyStore: memoryHistoryStore(),
    shouldPersistMessage: () => false,
    updateJob(jobToUpdate, patch) {
      Object.assign(jobToUpdate, patch);
    },
    hasEarlierRunningJob: () => blocked,
    queueTurnPollMs: 5,
  });

  runner.enqueue(job, { authorization: "Bearer test-key" }, { message: "재시작 뒤 대기 요청" });
  await delay(30);

  assert.equal(job.state, "queued");
  assert.equal(sendCount, 0);

  blocked = false;
  await waitUntil(() => job.state === "completed");
  assert.equal(sendCount, 1);
});

test("preserves all payload text and media refs from embedded agent JSON", async () => {
  const runtime: ChatRuntime = {
    async sendMessage() {
      return {
        reply: JSON.stringify({
          payloads: [
            { text: "첫 번째 답변", MediaPaths: ["/home/orbsian/.openclaw/media/report.pdf"] },
            { text: "두 번째 답변", mediaUrl: "/home/orbsian/.openclaw/media/chart.png" },
          ],
        }),
      };
    },
  };
  const historyStore = memoryHistoryStore();
  const job: MessageJob = {
    id: "job_runner_payload_media_test",
    sessionId: "session-runner-payload-media-test",
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
    },
  });

  runner.enqueue(job, { authorization: "Bearer test-key" }, { message: "파일을 만들어줘" });

  await waitUntil(() => job.state === "completed");
  assert.equal(
    (await historyStore.list(job.sessionId))[0]?.text,
    [
      "첫 번째 답변",
      "MEDIA:/home/orbsian/.openclaw/media/report.pdf",
      "두 번째 답변",
      "MEDIA:/home/orbsian/.openclaw/media/chart.png",
    ].join("\n\n"),
  );
});

test("does not auto-append recent generated media files when reply omits MEDIA refs", async () => {
  const mediaDir = await mkdtemp(join(tmpdir(), "openclaw-generated-media-"));
  const nestedMediaDir = join(mediaDir, "tool-image-generation");
  await mkdir(nestedMediaDir);
  const runtime: ChatRuntime = {
    async sendMessage() {
      await writeFile(join(nestedMediaDir, "chart.png"), "png");
      return { reply: "차트를 만들었습니다." };
    },
  };
  const historyStore = memoryHistoryStore();
  const job: MessageJob = {
    id: "job_runner_generated_media_test",
    sessionId: "session-runner-generated-media-test",
    state: "queued",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
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
    },
    generatedMediaDirs: [mediaDir],
  });

  runner.enqueue(job, { authorization: "Bearer test-key" }, { message: "차트 이미지 만들어줘" });

  await waitUntil(() => job.state === "completed");
  assert.equal(
    (await historyStore.list(job.sessionId))[0]?.text,
    "차트를 만들었습니다.",
  );
});

test("stores assistant MEDIA refs as conversation attachments", async () => {
  const mediaDir = await mkdtemp(join(tmpdir(), "openclaw-conversation-media-"));
  const pdfPath = join(mediaDir, "report.pdf");
  const zipPath = join(mediaDir, "openclaw-webview-debug-apk.zip");
  await writeFile(pdfPath, "pdf");
  await writeFile(zipPath, "zip");
  const patches: Array<{ attachments?: unknown[] }> = [];
  const conversationStore = {
    ...unusedConversationStore(),
    updateMessage(_id: string, patch: { attachments?: unknown[] }) {
      patches.push(patch);
      return null;
    },
  };
  const runtime: ChatRuntime = {
    async sendMessage() {
      return { reply: `보고서입니다.\n\nMEDIA:${pdfPath}\n\n\`MEDIA:${zipPath}\`` };
    },
  };
  const job: MessageJob = {
    id: "job_runner_conversation_media_test",
    sessionId: "session-runner-conversation-media-test",
    conversationId: "conv-runner-conversation-media-test",
    state: "queued",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const runner = new MessageJobRunner({
    chatRuntime: runtime,
    sessionStore: new InMemorySessionStore(),
    validApiKeys: new Set(["test-key"]),
    conversationStore,
    historyStore: memoryHistoryStore(),
    shouldPersistMessage: () => true,
    updateJob(jobToUpdate, patch) {
      Object.assign(jobToUpdate, patch);
    },
  });

  runner.enqueue(job, { authorization: "Bearer test-key" }, { message: "보고서 만들어줘" });

  await waitUntil(() => job.state === "completed");
  assert.deepEqual(patches.at(-1)?.attachments, [
    {
      name: "report.pdf",
      mime_type: "application/pdf",
      type: "file",
      path: pdfPath,
      size: 3,
    },
    {
      name: "openclaw-webview-debug-apk.zip",
      mime_type: "application/zip",
      type: "file",
      path: zipPath,
      size: 3,
    },
  ]);
});


test("ignores MEDIA refs inside fenced code blocks", async () => {
  const mediaDir = await mkdtemp(join(tmpdir(), "openclaw-code-fence-media-"));
  const imagePath = join(mediaDir, "cat.png");
  await writeFile(imagePath, "png");
  const patches: Array<{ text?: string; attachments?: unknown[] }> = [];
  const conversationStore = {
    ...unusedConversationStore(),
    updateMessage(_id: string, patch: { text?: string; attachments?: unknown[] }) {
      patches.push(patch);
      return null;
    },
  };
  const runtime: ChatRuntime = {
    async sendMessage() {
      return { reply: `raw 답신입니다.\n\n\`\`\`text\nMEDIA:${imagePath}\n\`\`\`` };
    },
  };
  const job: MessageJob = {
    id: "job_runner_code_fence_media_test",
    sessionId: "session-runner-code-fence-media-test",
    conversationId: "conv-runner-code-fence-media-test",
    state: "queued",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const runner = new MessageJobRunner({
    chatRuntime: runtime,
    sessionStore: new InMemorySessionStore(),
    validApiKeys: new Set(["test-key"]),
    conversationStore,
    historyStore: memoryHistoryStore(),
    shouldPersistMessage: () => true,
    updateJob(jobToUpdate, patch) {
      Object.assign(jobToUpdate, patch);
    },
  });

  runner.enqueue(job, { authorization: "Bearer test-key" }, { message: "raw code 보여줘" });

  await waitUntil(() => job.state === "completed");
  assert.equal(patches.at(-1)?.text, `raw 답신입니다.\n\n\`\`\`text\nMEDIA:${imagePath}\n\`\`\``);
  assert.deepEqual(patches.at(-1)?.attachments, []);
});

test("does not attach mentioned existing document paths without explicit MEDIA refs", async () => {
  const mediaDir = await mkdtemp(join(tmpdir(), "openclaw-mentioned-media-"));
  const actualPath = join(mediaDir, "예수는_나의_힘이요_A4_통일_출력용.pdf");
  await writeFile(actualPath, "pdf");
  const requestedPath = join(mediaDir, "예수는나의힘이요A4통일_출력용.pdf");
  const patches: Array<{ attachments?: unknown[] }> = [];
  const conversationStore = {
    ...unusedConversationStore(),
    updateMessage(_id: string, patch: { attachments?: unknown[] }) {
      patches.push(patch);
      return null;
    },
  };
  const runtime: ChatRuntime = {
    async sendMessage() {
      return { reply: "PDF 문서 첨부 테스트합니다. 아래에 클립 표시와 다운로드 버튼이 보여야 합니다." };
    },
  };
  const job: MessageJob = {
    id: "job_runner_mentioned_document_test",
    sessionId: "session-runner-mentioned-document-test",
    conversationId: "conv-runner-mentioned-document-test",
    state: "queued",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const runner = new MessageJobRunner({
    chatRuntime: runtime,
    sessionStore: new InMemorySessionStore(),
    validApiKeys: new Set(["test-key"]),
    conversationStore,
    historyStore: memoryHistoryStore(),
    shouldPersistMessage: () => true,
    updateJob(jobToUpdate, patch) {
      Object.assign(jobToUpdate, patch);
    },
  });

  runner.enqueue(job, { authorization: "Bearer test-key" }, { message: `이걸로 보내줘: ${requestedPath}` });

  await waitUntil(() => job.state === "completed");
  assert.deepEqual(patches.at(-1)?.attachments, []);
});

test("shows a clear timeout message instead of unavailable failure", async () => {
  const runtime: ChatRuntime = {
    async sendMessage() {
      throw new Error("OpenClaw Gateway request timed out.");
    },
  };
  const historyStore = memoryHistoryStore();
  const job: MessageJob = {
    id: "job_runner_timeout_test",
    sessionId: "session-runner-timeout-test",
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
    },
  });

  runner.enqueue(job, { authorization: "Bearer test-key" }, { message: "긴 작업" });

  await waitUntil(() => job.state === "failed");
  const message = (await historyStore.list(job.sessionId))[0];
  assert.equal(message?.role, "system");
  assert.match(message?.text ?? "", /처리 시간이 초과되었습니다/);
  assert.doesNotMatch(message?.text ?? "", /OpenClaw is unavailable/);
});

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

test("does not persist streamed numbered sections as separate conversation messages", async () => {
  const addedMessages: Array<{ id: string; role: string; text: string }> = [];
  const updates: Array<{ id: string; patch: { text?: string; completedAt?: string | null } }> = [];
  const conversationStore = {
    ...unusedConversationStore(),
    getConversation(id: string) {
      return {
        id,
        ownerId: "user-stream-sections",
        userId: "user-stream-sections",
        title: "stream sections",
        openclawSessionId: "session-runner-stream-sections-test",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        archivedAt: undefined,
        pinned: false,
      };
    },
    addMessage(message: Parameters<MessageStore["addMessage"]>[0]) {
      const record = {
        id: message.id ?? `message-${addedMessages.length + 1}`,
        conversationId: message.conversationId,
        role: message.role,
        text: message.text,
        jobId: message.jobId,
        createdAt: message.createdAt ?? new Date().toISOString(),
        completedAt: message.completedAt ?? undefined,
        attachments: message.attachments,
      };
      addedMessages.push(record);
      return record;
    },
    updateMessage(id: string, patch: Parameters<MessageStore["updateMessage"]>[1]) {
      updates.push({ id, patch });
      return {
        id,
        conversationId: job.conversationId ?? "conv-runner-stream-sections-test",
        role: patch.role ?? "assistant",
        text: patch.text ?? "",
        createdAt: patch.createdAt ?? new Date().toISOString(),
        completedAt: patch.completedAt ?? undefined,
        attachments: patch.attachments,
      };
    },
  };
  const reply = [
    "1. 요청 이해\n\n첫 단계 설명입니다.",
    "2. 접근 방식 선택\n\n두 번째 단계 설명입니다.",
    "3. 최종 답변\n\n마지막 답변입니다.",
  ].join("\n\n");
  const runtime: ChatRuntime = {
    async sendMessage(input) {
      await input.callbacks?.onToken?.("1. 요청 이해\n\n첫 단계 설명입니다.");
      await input.callbacks?.onToken?.("\n\n2. 접근 방식 선택\n\n두 번째 단계 설명입니다.");
      await input.callbacks?.onToken?.("\n\n3. 최종 답변\n\n마지막 답변입니다.");
      return { reply };
    },
  };
  const job: MessageJob = {
    id: "job_runner_stream_sections_test",
    sessionId: "session-runner-stream-sections-test",
    conversationId: "conv-runner-stream-sections-test",
    state: "queued",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const runner = new MessageJobRunner({
    chatRuntime: runtime,
    sessionStore: new InMemorySessionStore(),
    validApiKeys: new Set(["test-key"]),
    conversationStore,
    historyStore: memoryHistoryStore(),
    shouldPersistMessage: () => true,
    updateJob(jobToUpdate, patch) {
      Object.assign(jobToUpdate, patch);
    },
  });

  runner.enqueue(job, { authorization: "Bearer test-key" }, { message: "stream sections", conversation_id: job.conversationId });

  await waitUntil(() => job.state === "completed");
  assert.deepEqual(addedMessages.map((message) => message.text), []);
  assert.equal(updates.at(-1)?.id, job.id);
  assert.equal(updates.at(-1)?.patch.text, reply);
});
