export function normalizeApiKey(value) {
  return value.trim().replace(/[\s\u200B-\u200D\uFEFF]/g, '');
}

export function assertValidApiKey(apiKey) {
  if (!apiKey) {
    return;
  }
  if (!/^[A-Za-z0-9._~+-]+$/.test(apiKey)) {
    throw new Error('API Key에 사용할 수 없는 문자가 포함되어 있습니다. 키만 다시 복사해서 붙여넣어 주세요.');
  }
}

export function apiUrl(baseUrl, path, params = {}) {
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value).trim()) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}
