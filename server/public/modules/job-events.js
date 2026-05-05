export function ensureJobEventStreamSupport() {
  if (!window.ReadableStream || !window.TextDecoder || !window.AbortController) {
    throw new Error('이 브라우저는 SSE fetch stream을 지원하지 않습니다.');
  }
}

export async function waitForJobEventStream({
  jobId,
  conversationId,
  apiFetch,
  historyHeaders,
  parseSseBlock,
  isTerminalJobState,
  onTick = () => {},
  onToken = () => {},
  onExpired = () => {},
  onToolStart = () => {},
  onTerminal = () => {},
  timeoutMs = 720_000,
}) {
  ensureJobEventStreamSupport();

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await apiFetch(`/v1/jobs/${encodeURIComponent(jobId)}/events`, {
      params: { conversation_id: conversationId },
      headers: await historyHeaders(),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      const body = await response.json().catch(() => null);
      const error = new Error(body?.error?.message || `SSE HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

      let separatorIndex;
      while ((separatorIndex = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const block = buffer.slice(0, separatorIndex);
        const match = buffer.slice(separatorIndex).match(/^\r?\n\r?\n/);
        buffer = buffer.slice(separatorIndex + (match ? match[0].length : 2));
        const message = parseSseBlock(block);
        if (message.event === 'expired') {
          onExpired();
          return { id: jobId, state: 'expired' };
        }
        if (message.event === 'token' && message.data?.token) {
          onToken(String(message.data.token));
          continue;
        }
        if (message.event === 'agent' && message.data?.stream === 'tool' && message.data?.data?.phase === 'start') {
          onToolStart();
          continue;
        }
        if (message.event === 'job' && message.data) {
          const job = message.data;
          onTick(job);
          if (isTerminalJobState(job.state)) {
            onTerminal(job);
            return job;
          }
        }
      }

      if (done) {
        break;
      }
    }
  } finally {
    window.clearTimeout(timeout);
  }

  throw new Error('SSE 응답이 완료 상태 없이 종료되었습니다.');
}
