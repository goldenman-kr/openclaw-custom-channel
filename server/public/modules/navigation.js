export function conversationIdFromPath(pathname = window.location.pathname) {
  const match = pathname.match(/^\/chat\/([^/?#]+)/);
  if (!match) {
    return '';
  }
  try {
    return decodeURIComponent(match[1]) || '';
  } catch {
    return '';
  }
}

export function conversationPath(conversationId) {
  return `/chat/${encodeURIComponent(conversationId)}`;
}

export function syncConversationUrl(conversationId, options = {}) {
  if (!window.history?.pushState || !window.history?.replaceState) {
    return;
  }
  const targetPath = conversationId ? conversationPath(conversationId) : '/';
  const currentPath = window.location.pathname || '/';
  if (currentPath === targetPath) {
    return;
  }
  const url = new URL(window.location.href);
  url.pathname = targetPath;
  url.search = '';
  url.hash = '';
  const method = options.replace ? 'replaceState' : 'pushState';
  window.history[method]({ conversationId: conversationId || '' }, '', url);
}
