export function collectBlobUrlsInUse({ mediaViewerUrl = '', messagesRoot } = {}) {
  const urls = new Set();
  if (mediaViewerUrl) {
    urls.add(mediaViewerUrl);
  }
  for (const node of messagesRoot?.querySelectorAll?.('[src^="blob:"], [href^="blob:"]') || []) {
    const url = node.getAttribute('src') || node.getAttribute('href');
    if (url) {
      urls.add(url);
    }
  }
  return urls;
}

export function revokeCachedMediaUrl(cache, ref, url) {
  if (cache.get(ref) !== url) {
    return;
  }
  cache.delete(ref);
  try {
    URL.revokeObjectURL(url);
  } catch {
    // ignore revoke failures
  }
}

export function pruneMediaUrlCache(cache, { limit, force = false, urlsInUse = new Set() } = {}) {
  if (cache.size <= limit && !force) {
    return;
  }
  for (const [ref, url] of cache) {
    if (!force && cache.size <= limit) {
      break;
    }
    if (urlsInUse.has(url)) {
      continue;
    }
    revokeCachedMediaUrl(cache, ref, url);
  }
}
