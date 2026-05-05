export function appendAttachmentPreview(parent, files, createAttachmentPreview, formatBytes) {
  const preview = createAttachmentPreview(files, { formatBytes });
  if (preview) {
    parent.append(preview);
  }
}

export function createMessageNode({ role, text, options = {}, renderMessageNode, appendAttachmentPreview, persistMessage, appendTo }) {
  const node = document.createElement('article');
  if (options.id) {
    node.dataset.messageId = options.id;
  }
  const timestamp = options.pending ? '' : options.formatTimestamp?.(options.completedAt || options.savedAt);
  if (timestamp && (role === 'user' || role === 'assistant')) {
    node.dataset.messageTime = timestamp;
  }
  node._mediaRefs = options.mediaRefs || [];
  renderMessageNode(node, role, text, options);
  appendAttachmentPreview(node, options.files || []);
  if (options.pending) {
    node.classList.add('pending');
  }
  appendTo.append(node);
  if (options.persist !== false) {
    persistMessage(role, text);
  }
  return node;
}
