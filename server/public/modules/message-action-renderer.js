import { extractMediaRefs } from './media.js';
import { createCancelJobButton, createCopyButton, createRetryButton, ensureMessageActions, isPendingAssistantJobMessage, setCancelJobButtonBusy } from './message-actions.js';

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

export function appendCopyAction(node, role, text, options = {}, copyTextToClipboard) {
  if (options.pending || !['user', 'assistant', 'system'].includes(role)) {
    return;
  }
  const copyText = extractMediaRefs(text).text.trim();
  if (!copyText) {
    return;
  }
  node.append(createCopyButton(copyText, copyTextToClipboard));
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
