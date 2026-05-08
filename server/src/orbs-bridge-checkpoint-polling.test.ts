import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

import { pollOrbsBridgeCheckpoints } from './http/orbsBridgePluginRoutes.js';
import { OrbsBridgeStore } from './session/OrbsBridgeStore.js';
import { SqliteChatStore } from './session/SqliteChatStore.js';

const tempDirs: string[] = [];

afterEach(() => {
  delete (globalThis as Record<string, unknown>).fetch;
  while (tempDirs.length) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function createStores() {
  const dir = mkdtempSync(join(tmpdir(), 'orbs-bridge-polling-'));
  tempDirs.push(dir);
  const dbPath = join(dir, 'chat.sqlite');
  return {
    chatStore: new SqliteChatStore(dbPath),
    orbsBridgeStore: new OrbsBridgeStore(dbPath),
  };
}

test('pollOrbsBridgeCheckpoints checks pending Polygon withdraws and notifies the originating PWA conversation', async () => {
  const { chatStore, orbsBridgeStore } = createStores();
  const conversation = chatStore.createConversation({ ownerId: 'owner-1', title: 'PWA bridge chat' });
  const record = orbsBridgeStore.upsert({
    ownerId: 'owner-1',
    conversationId: conversation.id,
    account: '0xe0d612f482e43bfdc25e0c1c36a4728ad3b7ca43',
    direction: 'polygon-to-ethereum',
    amount: '2845406611740000000000',
    sourceChainId: 137,
    sourceTxHash: '0xabc123',
    sourceBlockNumber: '86574888',
    state: 'source-confirmed',
  });
  const published: Array<{ conversationId: string; messageId: string }> = [];
  const fetchUrls: string[] = [];
  (globalThis as Record<string, unknown>).fetch = async (url: string) => {
    fetchUrls.push(String(url));
    if (String(url).includes('/block-included/86574888')) {
      return { ok: true, json: async () => ({ message: 'success' }) };
    }
    if (String(url).includes('/exit-payload/0xabc123')) {
      return { ok: true, json: async () => ({ result: '0xfeedface' }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  await pollOrbsBridgeCheckpoints({
    conversationStore: chatStore,
    orbsBridgeStore,
    getAuthContext: () => null,
    isConversationVisibleToAuth: () => false,
    sendJson: () => undefined,
    readJsonBody: async () => ({}),
    publishConversationEvent: (event) => published.push({ conversationId: event.conversationId, messageId: event.messageId }),
  });

  const updated = orbsBridgeStore.get(record.id);
  assert.equal(updated?.state, 'checkpoint-ready');
  assert.equal(updated?.exitPayload, '0xfeedface');
  assert.ok(fetchUrls.some((url) => url.includes('/block-included/86574888')));
  assert.ok(fetchUrls.some((url) => url.includes('/exit-payload/0xabc123')));
  assert.equal(published.length, 1);
  assert.equal(published[0].conversationId, conversation.id);
  const messages = chatStore.listMessages(conversation.id);
  assert.equal(messages.length, 1);
  assert.match(messages[0].text, /체크포인트 준비 완료/);
  assert.match(messages[0].text, /Ethereum exit 실행/);
});
