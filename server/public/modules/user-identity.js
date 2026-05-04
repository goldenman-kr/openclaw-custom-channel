export async function hashText(text) {
  if (window.crypto?.subtle) {
    const bytes = new TextEncoder().encode(text);
    const digest = await window.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 32);
  }

  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (Math.imul(31, hash) + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

export async function sharedUserId({ apiKey, sessionNonce }) {
  const baseId = `web-api-key-${await hashText(apiKey || 'anonymous')}`;
  return sessionNonce ? `${baseId}-${sessionNonce}` : baseId;
}

export function currentUserDisplayName(user) {
  const name = user?.display_name || user?.displayName || user?.username || user?.id || '';
  return String(name).trim() || '사용자';
}
