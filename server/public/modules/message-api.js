export async function sendMessage({ apiFetch, historyHeaders, conversationId, message, attachments = [], metadata }) {
  const response = await apiFetch('/v1/message', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(await historyHeaders()),
    },
    body: JSON.stringify({ conversation_id: conversationId, message, attachments, ...(metadata ? { metadata } : {}) }),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = body?.error?.message || `HTTP ${response.status}`;
    throw new Error(detail);
  }
  return body;
}
