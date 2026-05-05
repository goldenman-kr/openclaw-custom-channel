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

export async function waitForJobPolling({
  jobId,
  conversationId,
  fetchJob,
  delay,
  isTerminalJobState,
  isJobResolvedInHistory,
  ensurePendingJobBubble,
  clearStreamingState,
  clearPendingJob,
  onTick = () => {},
  maxAttempts = 240,
}) {
  let transientFailures = 0;
  let lastError = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await delay(attempt < 10 ? 1000 : 3000);
    try {
      const job = await fetchJob(jobId, conversationId);
      transientFailures = 0;
      lastError = null;
      if (!isTerminalJobState(job.state)) {
        ensurePendingJobBubble(jobId, conversationId);
      }
      onTick(job);
      if (isTerminalJobState(job.state)) {
        clearStreamingState(jobId);
        clearPendingJob(conversationId);
        return job;
      }
    } catch (error) {
      lastError = error;
      transientFailures += 1;
      if (await isJobResolvedInHistory(jobId, conversationId)) {
        clearStreamingState(jobId);
        clearPendingJob(conversationId);
        return { id: jobId, state: 'completed' };
      }
      if (error?.status === 404) {
        clearStreamingState(jobId);
        clearPendingJob(conversationId);
        return { id: jobId, state: 'expired' };
      }
      if (transientFailures >= 5) {
        throw lastError;
      }
    }
  }
  throw new Error('응답 작업 확인 시간이 초과되었습니다. 잠시 후 대화 기록을 새로고침해주세요.');
}
