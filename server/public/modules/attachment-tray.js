export function renderAttachmentTray(container, attachments, { formatBytes, onRemove } = {}) {
  container.replaceChildren();
  container.classList.toggle('hidden', attachments.length === 0);

  for (const [index, file] of attachments.entries()) {
    const item = document.createElement('div');
    item.className = 'attachment-chip';
    const label = document.createElement('span');
    label.textContent = `${file.name} · ${formatBytes(file.size)}`;
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'attachment-remove';
    removeButton.setAttribute('aria-label', `${file.name} 첨부 제거`);
    removeButton.textContent = '×';
    removeButton.addEventListener('click', () => onRemove?.(index));
    item.append(label, removeButton);
    container.append(item);
  }
}
