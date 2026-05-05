export async function fetchConversations({ apiFetch, historyHeaders }) {
  const response = await apiFetch('/v1/conversations', {
    params: { include_archived: 1 },
    headers: await historyHeaders(),
  });
  if (!response.ok) {
    throw new Error(`대화 목록을 불러오지 못했습니다: HTTP ${response.status}`);
  }
  const body = await response.json();
  return Array.isArray(body.conversations) ? body.conversations : [];
}

export async function createConversation({ apiFetch, apiHeaders, title = '새 대화' }) {
  const response = await apiFetch('/v1/conversations', {
    method: 'POST',
    headers: await apiHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ title }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error?.message || `대화 생성을 실패했습니다: HTTP ${response.status}`);
  }
  return body.conversation;
}

export async function patchConversation({ apiFetch, apiHeaders, conversationId, patch }) {
  const response = await apiFetch(`/v1/conversations/${encodeURIComponent(conversationId)}`, {
    method: 'PATCH',
    headers: await apiHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify(patch),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error?.message || `대화 수정을 실패했습니다: HTTP ${response.status}`);
  }
  return body.conversation;
}

export async function updateConversationTitle(input) {
  try {
    return await patchConversation({ ...input, patch: { title: input.title } });
  } catch (error) {
    throw new Error(error instanceof Error ? error.message.replace('대화 수정을', '대화 이름 변경을') : String(error));
  }
}

export async function destroyConversation({ apiFetch, apiHeaders, conversationId }) {
  const response = await apiFetch(`/v1/conversations/${encodeURIComponent(conversationId)}`, {
    method: 'DELETE',
    headers: await apiHeaders(),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error?.message || `대화 삭제를 실패했습니다: HTTP ${response.status}`);
  }
  return body;
}
