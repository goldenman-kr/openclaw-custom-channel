export function createAttachmentPreview(files, { formatBytes }) {
  if (!files?.length) {
    return null;
  }

  const preview = document.createElement('div');
  preview.className = 'message-attachments';

  for (const file of files) {
    const item = document.createElement('div');
    item.className = 'message-attachment';

    if (file.type?.startsWith('image/')) {
      const image = document.createElement('img');
      image.src = URL.createObjectURL(file);
      image.alt = file.name;
      image.loading = 'lazy';
      image.addEventListener('load', () => URL.revokeObjectURL(image.src), { once: true });
      item.classList.add('image-attachment');
      item.append(image);
    } else {
      const icon = document.createElement('span');
      icon.className = 'attachment-file-icon';
      icon.textContent = '📎';
      item.append(icon);
    }

    const caption = document.createElement('span');
    caption.className = 'attachment-caption';
    caption.textContent = `${file.name} · ${formatBytes(file.size)}`;
    item.append(caption);
    preview.append(item);
  }

  return preview;
}
