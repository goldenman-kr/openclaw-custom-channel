import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

const moduleUrl = pathToFileURL(resolve('public/modules/live-preview.js')).href;
const { formatAgentLivePreview } = await import(moduleUrl) as {
  formatAgentLivePreview: (event: unknown) => { text: string; stream: string } | null;
};

test('formats tool start and completion events as live preview text', () => {
  assert.deepEqual(formatAgentLivePreview({
    stream: 'tool',
    data: { phase: 'start', name: 'bash' },
  }), {
    text: '명령 처리 중입니다…',
    stream: 'tool',
  });

  assert.deepEqual(formatAgentLivePreview({
    stream: 'tool',
    data: { phase: 'result', name: 'bash', status: 'completed' },
  }), {
    text: '명령 처리를 마쳤습니다…',
    stream: 'tool',
  });

  assert.deepEqual(formatAgentLivePreview({
    stream: 'session.tool',
    data: { phase: 'start', name: 'exec' },
  }), {
    text: '명령 처리 중입니다…',
    stream: 'session.tool',
  });
});

test('formats Codex lifecycle and item events without exposing assistant text', () => {
  assert.deepEqual(formatAgentLivePreview({
    stream: 'codex_app_server.lifecycle',
    data: { phase: 'turn_starting' },
  }), {
    text: '요청 처리를 시작하는 중입니다…',
    stream: 'codex_app_server.lifecycle',
  });

  assert.deepEqual(formatAgentLivePreview({
    stream: 'codex_app_server.item',
    data: { phase: 'started', type: 'agentMessage' },
  }), {
    text: '답변을 정리하는 중입니다…',
    stream: 'codex_app_server.item',
  });

  assert.equal(formatAgentLivePreview({
    stream: 'assistant',
    data: { text: 'final answer body' },
  }), null);
});
