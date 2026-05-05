export async function fetchHistory(input) {
  const conversation = await input.ensureActiveConversation();
  const response = await input.apiFetch('/v1/history', {
    params: { conversation_id: conversation.id, limit: input.limit },
    headers: await input.historyHeaders(),
  });
  if (!response.ok) {
    throw new Error(`대화 기록을 불러오지 못했습니다: HTTP ${response.status}`);
  }
  const body = await response.json();
  return {
    version: body.version,
    hasMore: Boolean(body.hasMore),
    messages: Array.isArray(body.messages) ? body.messages : [],
  };
}

export async function fetchHistoryMeta(input) {
  const conversation = await input.ensureActiveConversation();
  const response = await input.apiFetch('/v1/history', {
    params: { meta: '1', conversation_id: conversation.id, limit: input.limit },
    headers: await input.historyHeaders(),
  });
  if (!response.ok) {
    throw new Error(`대화 기록 상태를 확인하지 못했습니다: HTTP ${response.status}`);
  }
  return response.json();
}

export async function fetchConversationHistory({ apiFetch, historyHeaders, conversationId }) {
  const response = await apiFetch('/v1/history', {
    params: { conversation_id: conversationId },
    headers: await historyHeaders(),
  });
  if (!response.ok) {
    throw new Error(`대화 기록을 불러오지 못했습니다: HTTP ${response.status}`);
  }
  const body = await response.json();
  return Array.isArray(body.messages) ? body.messages : [];
}
