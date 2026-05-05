export function shouldPollHistory({ canUseApi, documentHidden, activeConversationId }) {
  return canUseApi() && !documentHidden && Boolean(activeConversationId());
}

export async function fetchChangedHistory({ fetchHistoryMeta, fetchHistory, lastHistoryVersion, setLastHistoryVersion }) {
  const meta = await fetchHistoryMeta();
  if (lastHistoryVersion() && meta.version === lastHistoryVersion()) {
    return null;
  }
  const history = await fetchHistory();
  setLastHistoryVersion(meta.version || lastHistoryVersion());
  return history;
}

export function reconcilePendingJobWithHistory({
  history,
  conversationId,
  loadPendingJob,
  clearPendingJob,
  isActiveConversation,
  isRunningJobHistoryMessage,
  setStatus,
  setSending,
  messagesRoot,
}) {
  const pendingJob = loadPendingJob(conversationId);
  if (!pendingJob?.job_id || !Array.isArray(history)) {
    return;
  }
  const matchingMessage = history.find((item) => item?.id === pendingJob.job_id);
  if (!matchingMessage) {
    clearPendingJob(conversationId);
    if (isActiveConversation(conversationId)) {
      setStatus('');
      setSending(false);
      messagesRoot.querySelector(`[data-message-id="${pendingJob.job_id}"]`)?.remove();
    }
    return;
  }
  if (isRunningJobHistoryMessage(matchingMessage)) {
    return;
  }
  clearPendingJob(conversationId);
  if (isActiveConversation(conversationId)) {
    setStatus('');
    setSending(false);
    messagesRoot.querySelector(`[data-message-id="${pendingJob.job_id}"]`)?.classList.remove('pending');
  }
}
