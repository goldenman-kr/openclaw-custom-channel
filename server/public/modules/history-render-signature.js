export function messageTextWithoutAttachmentPreview(node) {
  const clone = node.cloneNode(true);
  clone.querySelectorAll('.message-attachments, .message-actions, .code-block-header').forEach((preview) => preview.remove());
  return clone.textContent || '';
}

export function renderedHistorySignature(messagesRoot) {
  return [...messagesRoot.querySelectorAll('.message')]
    .map((node) => `${[...node.classList].find((className) => className !== 'message') || ''}:${messageTextWithoutAttachmentPreview(node)}`)
    .join('\n---\n');
}
