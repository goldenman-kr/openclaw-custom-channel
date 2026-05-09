import { blobToBase64 } from './blob-utils.js';

export async function clearBrowserCaches({ unregisterServiceWorkers = true, clearAndroidWebCache = true } = {}) {
  if (unregisterServiceWorkers && navigator.serviceWorker?.getRegistrations) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  }
  if (window.caches?.keys) {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }
  if (clearAndroidWebCache && window.OpenClawAndroid?.clearWebCache) {
    window.OpenClawAndroid.clearWebCache();
    return { androidCacheCleared: true };
  }
  return { androidCacheCleared: false };
}

export async function downloadUrlThroughAndroidClient(url, fileName) {
  if (!url || !window.OpenClawAndroid?.downloadBlob) {
    return false;
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const blob = await response.blob();
  const base64 = await blobToBase64(blob);
  window.OpenClawAndroid.downloadBlob(fileName, blob.type || 'application/octet-stream', base64);
  return true;
}

export async function clearAppCacheAndReload({ setStatus, pruneMediaUrlCache, clearBrowserCaches: clearCaches = clearBrowserCaches, reload = () => window.location.reload(), setTimeoutFn = window.setTimeout.bind(window) }) {
  setStatus('캐시를 삭제하는 중입니다...');
  pruneMediaUrlCache({ force: true, limit: 0 });
  const result = await clearCaches();
  if (result.androidCacheCleared) {
    setTimeoutFn(() => reload(), 350);
    return;
  }
  reload();
}

export async function resetLocalAppStateAndReload({ setStatus, pruneMediaUrlCache, clearBrowserCaches: clearCaches = clearBrowserCaches, reload = () => window.location.reload(), setTimeoutFn = window.setTimeout.bind(window), localStorageRef = window.localStorage, sessionStorageRef = window.sessionStorage } = {}) {
  setStatus('앱 로컬 데이터를 초기화하는 중입니다...');
  pruneMediaUrlCache?.({ force: true, limit: 0 });
  try {
    localStorageRef?.clear?.();
  } catch {
    // Ignore storage access failures in restricted browser modes.
  }
  try {
    sessionStorageRef?.clear?.();
  } catch {
    // Ignore storage access failures in restricted browser modes.
  }
  const result = await clearCaches();
  if (result.androidCacheCleared) {
    setTimeoutFn(() => reload(), 350);
    return;
  }
  reload();
}

export async function runConnectionHealthCheck({ settings, sharedUserId, apiFetch, assertValidApiKey }) {
  assertValidApiKey(settings.apiKey);
  const healthResponse = await fetch(`${settings.apiUrl}/health`);
  if (!healthResponse.ok) {
    throw new Error(`서버 상태 확인 실패: HTTP ${healthResponse.status}`);
  }
  const healthBody = await healthResponse.json();

  const authResponse = settings.apiKey
    ? await fetch(`${settings.apiUrl}/v1/message`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${settings.apiKey}`,
        'x-user-id': `${await sharedUserId()}-connection-test`,
        'x-openclaw-sync': '1',
      },
      body: JSON.stringify({ message: '연결 테스트입니다. OK만 답해주세요.' }),
    })
    : await apiFetch('/v1/auth/me');
  const authBody = await authResponse.json().catch(() => null);
  if (!authResponse.ok) {
    throw new Error(authBody?.error?.message || `인증 테스트 실패: HTTP ${authResponse.status}`);
  }

  return healthBody;
}

export async function runHealthCheckAndReport({ settings, readSettingsFromForm, sharedUserId, apiFetch, assertValidApiKey, appendMessage }) {
  const nextSettings = readSettingsFromForm();
  try {
    const healthBody = await runConnectionHealthCheck({ settings: nextSettings, sharedUserId, apiFetch, assertValidApiKey });
    appendMessage('system', `연결 성공: ${healthBody.status} / transport=${healthBody.transport}`);
  } catch (error) {
    appendMessage('system', `연결 실패: ${error instanceof Error ? error.message : String(error)}`);
  }
  return nextSettings;
}
