import {
  clearPendingJobFromStorage,
  loadPendingJobFromStorage,
  pendingJobStorageKey,
  pendingJobStoragePrefix,
  pendingJobStorageScope,
  prunePendingJobStorage,
  savePendingJobToStorage,
} from './pending-job-storage.js';

export function createPendingJobController({
  storage,
  storageKey,
  settings,
  authUser,
  activeConversationId,
  isActiveConversation,
  messagesRoot,
  messageText,
  renderMessageNode,
  updateComposerAvailability,
  fetchJob,
  isTerminalJobState,
  setSending,
  setStatus,
  cancelJob,
  refreshHistoryIfChanged,
  refreshConversations,
  showToast,
  appendMessage,
  isAlreadyFinishedJobError,
}) {
  function scope() {
    const currentSettings = settings();
    return pendingJobStorageScope({
      storageKey,
      apiUrl: currentSettings.apiUrl,
      apiKey: currentSettings.apiKey,
      authUserId: authUser()?.id,
    });
  }

  function key(conversationId = activeConversationId()) {
    return pendingJobStorageKey(scope(), conversationId);
  }

  function prefix() {
    return pendingJobStoragePrefix(scope());
  }

  function ensureBubble(jobId, conversationId = activeConversationId()) {
    if (!jobId || !isActiveConversation(conversationId)) {
      return null;
    }

    const node = messagesRoot.querySelector(`[data-message-id="${jobId}"]`);
    if (!node) {
      return null;
    }

    if (!node.querySelector(':scope > .message-cancel-button')) {
      const text = messageText(node).trim() || '응답 대기 중입니다…';
      renderMessageNode(node, 'assistant', text, { pending: true, autoScroll: false, suppressScrollButton: true });
    }
    return node;
  }

  function save(job, conversationId = activeConversationId()) {
    savePendingJobToStorage(storage, key(conversationId), job);
    if (isActiveConversation(conversationId)) {
      ensureBubble(job.job_id, conversationId);
      updateComposerAvailability();
    }
  }

  function load(conversationId = activeConversationId()) {
    return loadPendingJobFromStorage(storage, key(conversationId));
  }

  function clear(conversationId = activeConversationId()) {
    clearPendingJobFromStorage(storage, key(conversationId));
    if (isActiveConversation(conversationId)) {
      updateComposerAvailability();
    }
  }

  async function prune(conversationList = []) {
    await prunePendingJobStorage({
      storage,
      prefix: prefix(),
      conversationIds: new Set((conversationList || []).map((conversation) => conversation?.id).filter(Boolean)),
      fetchJob,
      isTerminalJobState,
    });
  }

  async function cancelActive() {
    const conversationId = activeConversationId();
    const pendingJob = load(conversationId);
    if (!pendingJob?.job_id) {
      return false;
    }
    setSending(true);
    setStatus('응답을 중지하는 중입니다...');
    try {
      await cancelJob(pendingJob.job_id, conversationId);
      clear(conversationId);
      await refreshHistoryIfChanged();
      await refreshConversations().catch(() => {});
      showToast('응답을 중지했습니다.', { kind: 'success' });
      setStatus('');
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (isAlreadyFinishedJobError(error)) {
        clear(conversationId);
        await refreshHistoryIfChanged().catch(() => {});
        await refreshConversations().catch(() => {});
        showToast('이미 끝난 작업이라 남아 있던 처리중 표시를 정리했습니다.', { kind: 'success' });
        setStatus('');
        return true;
      }
      appendMessage('system', detail, { persist: false });
      setStatus('');
    } finally {
      setSending(false);
    }
    return true;
  }

  return { scope, key, prefix, save, ensureBubble, load, clear, prune, cancelActive };
}
