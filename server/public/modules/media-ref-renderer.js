import { formatBytes } from './attachments.js';
import { canonicalMediaRefKey, isImageRef, isPlaceholderMediaRef, normalizeMediaRefPath, shortenFileName } from './media.js';
import { createMediaAttachmentItem, ensureMediaAttachmentPreview, replaceMediaAttachmentWithWarning } from './media-attachment-view.js';

export function appendMediaRef(parent, rawRef, deps) {
  const refInfo = typeof rawRef === 'string' ? { path: rawRef } : rawRef;
  const ref = normalizeMediaRefPath(refInfo?.path);
  if (!ref || isPlaceholderMediaRef(ref)) {
    return;
  }
  const refKey = canonicalMediaRefKey(ref);
  if (!refKey) {
    return;
  }

  const preview = ensureMediaAttachmentPreview(parent, refKey);
  if (!preview) {
    return;
  }

  const isRemote = /^https?:\/\//i.test(ref);
  const fileName = refInfo.name || ref.split('/').pop() || ref;
  const displayName = shortenFileName(fileName);
  const captionText = refInfo.size ? `${displayName} · ${formatBytes(refInfo.size)}` : displayName;
  const { item, image, caption, downloadLink } = createMediaAttachmentItem({
    refKey,
    fileName,
    captionText,
    image: isImageRef(ref) || refInfo.type?.startsWith('image/'),
  });
  preview.append(item);

  const wireImageViewer = (url) => {
    if (!image) {
      return;
    }
    const open = (event) => {
      event.preventDefault();
      deps.openMediaViewer(url, fileName);
    };
    image.addEventListener('click', open);
    caption.addEventListener('click', open);
  };

  const wireDownload = (url) => {
    if (!downloadLink) {
      return;
    }
    downloadLink.href = url;
    downloadLink.removeAttribute('aria-disabled');
    downloadLink.addEventListener('click', (event) => {
      deps.downloadUrlThroughClient(url, fileName, downloadLink, event);
    }, { once: false });
  };

  if (isRemote) {
    caption.href = ref;
    wireDownload(ref);
    if (image) {
      image.src = ref;
      wireImageViewer(ref);
    }
    return;
  }

  const cachedUrl = deps.getCachedMediaUrl(ref);
  if (cachedUrl) {
    caption.href = cachedUrl;
    caption.textContent = captionText;
    wireDownload(cachedUrl);
    if (image) {
      image.src = cachedUrl;
      wireImageViewer(cachedUrl);
    }
    return;
  }

  caption.removeAttribute('href');
  caption.textContent = `${captionText} · 불러오는 중`;
  deps.getAuthorizedMediaUrl(ref)
    .then((url) => {
      caption.href = url;
      caption.textContent = captionText;
      wireDownload(url);
      if (image) {
        image.src = url;
        wireImageViewer(url);
      }
    })
    .catch(() => {
      caption.textContent = `${captionText} · 불러오기 실패`;
      if (image) {
        replaceMediaAttachmentWithWarning(item, caption);
      }
    });
}
