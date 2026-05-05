export function ensureMediaAttachmentPreview(parent, refKey) {
  const preview = parent.querySelector('.message-attachments') || document.createElement('div');
  preview.className = 'message-attachments';
  preview._mediaRefKeys ||= new Set([...preview.querySelectorAll('[data-media-ref-key]')].map((item) => item.dataset.mediaRefKey));
  if (preview._mediaRefKeys.has(refKey)) {
    return null;
  }
  preview._mediaRefKeys.add(refKey);
  if (!preview.parentElement) {
    parent.append(preview);
  }
  return preview;
}

export function createMediaAttachmentItem({ refKey, fileName, captionText, image = false }) {
  const item = document.createElement('div');
  item.className = 'message-attachment';
  item.dataset.mediaRefKey = refKey;

  let imageNode = null;
  if (image) {
    imageNode = document.createElement('img');
    imageNode.alt = fileName;
    imageNode.loading = 'lazy';
    item.classList.add('image-attachment');
    item.append(imageNode);
  } else {
    const icon = document.createElement('span');
    icon.className = 'attachment-file-icon';
    icon.textContent = '📎';
    item.append(icon);
  }

  const caption = document.createElement('a');
  caption.className = 'attachment-caption';
  caption.textContent = captionText;
  caption.target = '_blank';
  caption.rel = 'noopener noreferrer';
  caption.download = fileName;
  item.append(caption);

  const downloadLink = imageNode ? null : document.createElement('a');
  if (downloadLink) {
    downloadLink.className = 'attachment-download-button';
    downloadLink.textContent = '다운로드';
    downloadLink.download = fileName;
    downloadLink.target = '_blank';
    downloadLink.rel = 'noopener noreferrer';
    downloadLink.setAttribute('aria-disabled', 'true');
    item.append(downloadLink);
  }

  return { item, image: imageNode, caption, downloadLink };
}

export function replaceMediaAttachmentWithWarning(item, caption) {
  item.replaceChildren();
  const icon = document.createElement('span');
  icon.className = 'attachment-file-icon';
  icon.textContent = '⚠️';
  item.append(icon, caption);
}
