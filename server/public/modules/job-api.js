export async function fetchJobById({ apiFetch, historyHeaders, jobId, conversationId }) {
  const response = await apiFetch(`/v1/jobs/${encodeURIComponent(jobId)}`, {
    params: { conversation_id: conversationId },
    headers: await historyHeaders(),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(body?.error?.message || `Job HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

export async function cancelJobById({ apiFetch, historyHeaders, jobId, conversationId }) {
  const response = await apiFetch(`/v1/jobs/${encodeURIComponent(jobId)}/cancel`, {
    params: { conversation_id: conversationId },
    method: 'POST',
    headers: await historyHeaders(),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(body?.error?.message || `Cancel HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

export function isAlreadyFinishedJobError(error) {
  const detail = error instanceof Error ? error.message : String(error);
  return error?.status === 404 || detail.includes('Job not found or already finished.');
}

export async function isJobResolvedInHistory({ jobId, conversationId, isActiveConversation, fetchHistory, fetchConversationHistory, isPendingHistoryMessage }) {
  try {
    const history = isActiveConversation(conversationId) ? await fetchHistory() : await fetchConversationHistory(conversationId);
    return history.some((item) => item.id === jobId && !isPendingHistoryMessage(item));
  } catch {
    return false;
  }
}
