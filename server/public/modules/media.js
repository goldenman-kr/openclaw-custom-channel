export function isImageRef(ref) {
  return /\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(ref);
}

export function isPlaceholderMediaRef(ref) {
  return !ref || ref === '/파일경로' || ref === '파일경로' || ref.includes('/파일경로');
}

export function shortenFileName(name, maxLength = 34) {
  if (!name || name.length <= maxLength) {
    return name;
  }
  const dotIndex = name.lastIndexOf('.');
  const extension = dotIndex > 0 && name.length - dotIndex <= 10 ? name.slice(dotIndex) : '';
  const base = extension ? name.slice(0, dotIndex) : name;
  const headLength = Math.max(8, Math.floor((maxLength - extension.length - 1) * 0.55));
  const tailLength = Math.max(6, maxLength - extension.length - headLength - 1);
  return `${base.slice(0, headLength)}…${base.slice(-tailLength)}${extension}`;
}

export function normalizeMediaRefPath(ref) {
  if (typeof ref !== 'string') {
    return '';
  }
  if (ref.startsWith('file://')) {
    try {
      return decodeURIComponent(new URL(ref).pathname);
    } catch {
      return ref;
    }
  }
  return ref;
}

export function canonicalMediaRefKey(ref) {
  return normalizeMediaRefPath(ref).trim().replace(/\/+$/, '');
}


export function extractMediaRefs(text) {
  const refs = [];
  const visibleLines = [];
  let inCodeBlock = false;

  for (const line of String(text || '').split('\n')) {
    const fenceMatch = line.match(/^\s*```/);
    if (fenceMatch) {
      inCodeBlock = !inCodeBlock;
      visibleLines.push(line);
      continue;
    }

    if (!inCodeBlock) {
      const mediaMatch = line.match(/^\s*MEDIA:\s*(.+?)\s*$/);
      if (mediaMatch) {
        refs.push(mediaMatch[1].trim());
        continue;
      }
    }

    visibleLines.push(line);
  }

  const visibleText = visibleLines.join('\n').trim();
  return { text: visibleText || (refs.length > 0 ? '' : String(text || '')), refs };
}

export function mediaRefsFromHistoryAttachments(attachments) {
  if (!Array.isArray(attachments)) {
    return [];
  }
  return attachments
    .filter((attachment) => typeof attachment?.path === 'string')
    .map((attachment) => ({
      path: attachment.path,
      name: attachment.name,
      type: attachment.mime_type,
      size: attachment.size,
    }));
}
