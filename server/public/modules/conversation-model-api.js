export async function fetchConversationModelMenu({ apiFetch, apiHeaders, conversationId }) {
  const response = await apiFetch(`/v1/conversations/${encodeURIComponent(conversationId)}/model`, {
    headers: await apiHeaders(),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error?.message || `모델 목록을 불러오지 못했습니다: HTTP ${response.status}`);
  }
  return body;
}

export async function patchConversationModel({ apiFetch, apiHeaders, conversationId, model }) {
  const response = await apiFetch(`/v1/conversations/${encodeURIComponent(conversationId)}/model`, {
    method: 'PATCH',
    headers: await apiHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ model }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error?.message || `모델 변경을 실패했습니다: HTTP ${response.status}`);
  }
  return body;
}

export async function patchConversationThinking({ apiFetch, apiHeaders, conversationId, thinking }) {
  const response = await apiFetch(`/v1/conversations/${encodeURIComponent(conversationId)}/model`, {
    method: 'PATCH',
    headers: await apiHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ thinking }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error?.message || `Think level 변경을 실패했습니다: HTTP ${response.status}`);
  }
  return body;
}
