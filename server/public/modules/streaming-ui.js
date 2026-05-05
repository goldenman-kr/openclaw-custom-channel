export function streamingNodeText(node, { streamingTextByJob, messageText, isPlaceholderPendingText }) {
  if (!node) {
    return '';
  }
  const visibleText = messageText(node);
  const bufferedText = streamingTextByJob.get(node.dataset.messageId || '') || (typeof node._streamingText === 'string' ? node._streamingText : '');
  if (visibleText.length > bufferedText.length && !isPlaceholderPendingText(visibleText)) {
    return visibleText;
  }
  return bufferedText;
}

export function nextPartialSegmentId(messagesRoot, jobId) {
  const nodes = [...messagesRoot.querySelectorAll(`[data-message-id^="${jobId}:partial:"]`)];
  let maxIndex = 0;
  for (const node of nodes) {
    const rawId = node.dataset.messageId || '';
    const index = Number(rawId.split(':').pop());
    if (Number.isFinite(index)) {
      maxIndex = Math.max(maxIndex, index);
    }
  }
  return `${jobId}:partial:${maxIndex + 1}`;
}
