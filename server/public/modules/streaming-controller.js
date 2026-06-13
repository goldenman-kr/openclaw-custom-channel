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
  const previewByJob = new Map();
  const previewSequenceByJob = new Map();

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
    previewByJob.delete(jobId);
    previewSequenceByJob.delete(jobId);
    const node = messagesRoot.querySelector(`[data-message-id="${jobId}"]`);
    if (node) {
      delete node._livePreviewText;
      delete node.dataset.livePreview;
      delete node.dataset.historyText;
    }
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
    const livePreviewText = previewByJob.get(jobId) || node._livePreviewText || '';
    const currentText = textByJob.get(jobId)
      || node._streamingText
      || (isPlaceholderPendingText(visibleText) || visibleText === livePreviewText ? '' : visibleText);
    const nextText = `${currentText}${token}`;
    textByJob.set(jobId, nextText);
    node._streamingText = nextText;
    previewByJob.delete(jobId);
    previewSequenceByJob.delete(jobId);
    delete node._livePreviewText;
    delete node.dataset.livePreview;
    delete node.dataset.historyText;
    renderMessageNode(node, 'assistant', nextText, { pending: true });
    scheduleIdleCheckpoint(jobId, conversationId);
  }

  function applyPreview(jobId, preview, conversationId) {
    const text = typeof preview === 'string' ? preview : preview?.text;
    const sequence = typeof preview === 'object' && Number.isFinite(preview?.sequence) ? preview.sequence : undefined;
    if (!jobId || !text || !isActiveConversation(conversationId)) {
      return;
    }
    const previousSequence = previewSequenceByJob.get(jobId);
    if (sequence !== undefined && previousSequence !== undefined && sequence < previousSequence) {
      return;
    }
    if (textByJob.get(jobId)) {
      return;
    }

    let node = messagesRoot.querySelector(`[data-message-id="${jobId}"]`);
    if (!node) {
      node = appendMessage('assistant', '', { id: jobId, persist: false, pending: true });
    }
    if (node._streamingText) {
      return;
    }

    const visibleText = messageText(node).trim();
    if (!node.dataset.historyText) {
      node.dataset.historyText = isPlaceholderPendingText(visibleText) ? visibleText : '응답을 처리 중입니다…';
    }
    previewByJob.set(jobId, text);
    if (sequence !== undefined) {
      previewSequenceByJob.set(jobId, sequence);
    }
    node._livePreviewText = text;
    node.dataset.livePreview = '1';
    renderMessageNode(node, 'assistant', text, { pending: true, autoScroll: false, suppressScrollButton: true });
  }

  function previewText(jobId) {
    return previewByJob.get(jobId) || '';
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
    applyPreview,
    previewText,
    nodeText,
    clear,
    nextSegmentId,
    flushCheckpointNow,
    scheduleIdleCheckpoint,
  };
}
