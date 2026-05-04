const COMPOSER_DRAFT_KEY_PREFIX = 'openclaw-web-channel-composer-draft-v1';

export function composerDraftStorageKey(conversationId) {
  return conversationId ? `${COMPOSER_DRAFT_KEY_PREFIX}:${conversationId}` : '';
}

export function saveComposerDraft(conversationId, value) {
  const key = composerDraftStorageKey(conversationId);
  if (!key) {
    return;
  }
  if (value) {
    localStorage.setItem(key, value);
  } else {
    localStorage.removeItem(key);
  }
}

export function clearComposerDraft(conversationId) {
  const key = composerDraftStorageKey(conversationId);
  if (key) {
    localStorage.removeItem(key);
  }
}

export function loadComposerDraft(conversationId) {
  const key = composerDraftStorageKey(conversationId);
  return key ? localStorage.getItem(key) || '' : '';
}
