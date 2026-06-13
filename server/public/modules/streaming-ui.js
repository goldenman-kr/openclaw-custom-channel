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
