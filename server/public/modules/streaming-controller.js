import { nextPartialSegmentId, streamingNodeText } from './streaming-ui.js';

export function createStreamingController({
  messagesRoot,
  appendMessage,
  renderMessageNode,
  messageText,
  isPlaceholderPendingText,
  isActiveConversation,
  minCheckpointChars = 12,
  windowRef = window,
  documentRef = document,
}) {
  const idleTimers = new Map();
  const textByJob = new Map();

  function nodeText(node) {
    return streamingNodeText(node, {
      streamingTextByJob: textByJob,
      messageText,
      isPlaceholderPendingText,
    });
  }

  function clear(jobId) {
    if (!jobId) {
      return;
    }
    windowRef.clearTimeout(idleTimers.get(jobId));
    idleTimers.delete(jobId);
    textByJob.delete(jobId);
  }

  function nextSegmentId(jobId) {
    return nextPartialSegmentId(messagesRoot, jobId);
  }

  function scheduleIdleCheckpoint(jobId) {
    windowRef.clearTimeout(idleTimers.get(jobId));
    idleTimers.delete(jobId);
  }

  function applyToken(jobId, token, conversationId) {
    if (!token || !isActiveConversation(conversationId)) {
      return;
    }

    let node = messagesRoot.querySelector(`[data-message-id="${jobId}"]`);
    if (!node) {
      node = appendMessage('assistant', '', { id: jobId, persist: false, pending: true });
    }

    const visibleText = messageText(node);
    const currentText = textByJob.get(jobId) || node._streamingText || (isPlaceholderPendingText(visibleText) ? '' : visibleText);
    const nextText = `${currentText}${token}`;
    textByJob.set(jobId, nextText);
    node._streamingText = nextText;
    renderMessageNode(node, 'assistant', nextText, { pending: true });
    scheduleIdleCheckpoint(jobId, conversationId);
  }

  function flushCheckpointNow(jobId, conversationId) {
    windowRef.clearTimeout(idleTimers.get(jobId));
    idleTimers.delete(jobId);
    if (!isActiveConversation(conversationId)) {
      return;
    }
    const node = messagesRoot.querySelector(`[data-message-id="${jobId}"]`);
    const text = nodeText(node);
    if (!node) {
      return;
    }
    if (!text.trim()) {
      renderMessageNode(node, 'assistant', '응답을 처리 중입니다…', { pending: true, autoScroll: false, suppressScrollButton: true });
      return;
    }
    if (text.trim().length < minCheckpointChars) {
      textByJob.set(jobId, '');
      node._streamingText = '';
      renderMessageNode(node, 'assistant', '응답을 처리 중입니다…', { pending: true, autoScroll: false, suppressScrollButton: true });
      return;
    }

    const checkpoint = documentRef.createElement('article');
    checkpoint.dataset.messageId = nextSegmentId(jobId);
    node.before(checkpoint);
    renderMessageNode(checkpoint, 'assistant', text, { autoScroll: false, suppressScrollButton: true });
    textByJob.set(jobId, '');
    node._streamingText = '';
    renderMessageNode(node, 'assistant', '응답을 처리 중입니다…', { pending: true, autoScroll: false, suppressScrollButton: true });
  }

  return {
    applyToken,
    nodeText,
    clear,
    nextSegmentId,
    flushCheckpointNow,
    scheduleIdleCheckpoint,
  };
}
