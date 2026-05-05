export async function fetchCurrentUser(apiFetch) {
  const response = await apiFetch('/v1/auth/me');
  if (!response.ok) {
    return null;
  }
  const body = await response.json().catch(() => null);
  return body?.user || null;
}

export async function loginUser(apiFetch, username, password) {
  const response = await apiFetch('/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error?.message || `로그인 실패: HTTP ${response.status}`);
  }
  return body?.user || null;
}

export async function logoutUser(apiFetch) {
  await apiFetch('/v1/auth/logout', { method: 'POST' }).catch(() => null);
}
