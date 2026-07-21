import { extractMediaRefs } from './media.js';
import { createCancelJobButton, createCopyButton, createDeleteQueuedMessageButton, createRetryButton, ensureMessageActions, isPendingAssistantJobMessage, isQueuedUserJobMessage, setCancelJobButtonBusy, setDeleteQueuedMessageButtonBusy } from './message-actions.js?v=pwa-client-2026-07-21-speed-mode-008';

export function retryTextForNode(node, messageTextWithoutAttachmentPreview) {
  let current = node.previousElementSibling;
  while (current) {
    if (current.classList?.contains('user')) {
      return messageTextWithoutAttachmentPreview(current).replace(/\n\n첨부 파일:\n[\s\S]*$/, '').trim();
    }
    current = current.previousElementSibling;
  }
  return '';
}

export function appendCopyAction(node, role, text, options = {}, copyTextToClipboard, showToast = null) {
  if (options.pending || !['user', 'assistant', 'system'].includes(role)) {
    return;
  }
  const copyText = extractMediaRefs(text).text.trim();
  if (!copyText) {
    return;
  }
  node.append(createCopyButton(copyText, async (value) => {
    try {
      await copyTextToClipboard(value);
      showToast?.('복사했어요.', { kind: 'success', durationMs: 1600 });
    } catch (error) {
      showToast?.('복사하지 못했습니다.', { kind: 'error', durationMs: 2200 });
      throw error;
    }
  }));
}

export function appendRetryAction(node, role, text, deps) {
  if (role !== 'system' || !text.startsWith('전송 실패:')) {
    return;
  }
  const retryText = retryTextForNode(node, deps.messageTextWithoutAttachmentPreview);
  if (!retryText) {
    return;
  }
  ensureMessageActions(node).append(createRetryButton(() => {
    deps.messageInput.value = retryText;
    deps.saveComposerDraft();
    deps.autoResizeTextarea();
    deps.messageInput.focus();
  }));
}

export function appendCancelJobAction(node, role, text, options = {}, deps) {
  const jobId = node.dataset.messageId;
  if (!isPendingAssistantJobMessage({ role, text, pending: options.pending, jobId })) {
    return;
  }
  const button = createCancelJobButton(async () => {
    const conversationId = deps.activeConversationId();
    setCancelJobButtonBusy(button, true);
    deps.setStatus('응답을 중지하는 중입니다...');
    try {
      await deps.cancelJob(jobId, conversationId);
      deps.clearPendingJob(conversationId);
      await deps.refreshHistoryIfChanged();
      await deps.refreshConversations().catch(() => {});
      deps.showToast('응답을 중지했습니다.', { kind: 'success' });
      deps.setStatus('');
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (deps.isAlreadyFinishedJobError(error)) {
        deps.clearPendingJob(conversationId);
        node.remove();
        await deps.refreshHistoryIfChanged().catch(() => {});
        await deps.refreshConversations().catch(() => {});
        deps.showToast('이미 끝난 작업이라 남아 있던 처리중 표시를 정리했습니다.', { kind: 'success' });
        deps.setStatus('');
        return;
      }
      setCancelJobButtonBusy(button, false);
      deps.appendMessage('system', detail, { persist: false });
      deps.setStatus('');
    }
  });
  node.append(button);
}

export function appendDeleteQueuedMessageAction(node, role, options = {}, deps) {
  const jobId = options.jobId;
  if (!isQueuedUserJobMessage({ role, jobId, jobState: options.jobState })) {
    return;
  }
  const button = createDeleteQueuedMessageButton(async () => {
    if (!window.confirm('대기 중인 요청을 취소/삭제할까요?')) {
      return;
    }
    const conversationId = deps.activeConversationId();
    setDeleteQueuedMessageButtonBusy(button, true);
    try {
      await deps.deleteQueuedJob(jobId, conversationId);
      if (deps.loadPendingJob(conversationId)?.job_id === jobId) {
        deps.clearPendingJob(conversationId);
      }
      node.remove();
      deps.messagesRoot.querySelector(`[data-message-id="${jobId}"]`)?.remove();
      await deps.refreshHistoryIfChanged().catch(() => {});
      await deps.refreshConversations().catch(() => {});
      deps.showToast('대기 중인 요청을 삭제했습니다.', { kind: 'success' });
    } catch (error) {
      setDeleteQueuedMessageButtonBusy(button, false);
      await deps.refreshHistoryIfChanged().catch(() => {});
      deps.showToast(error instanceof Error ? error.message : String(error), { kind: 'error', durationMs: 3200 });
    }
  });
  node.append(button);
}
