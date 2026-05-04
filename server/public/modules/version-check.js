const VERSION_CHECK_DISMISSED_KEY = 'openclaw-web-channel-version-dismissed-v1';

export function showVersionMismatchAlert(reason, details = {}, deps = {}) {
  const latestVersion = details.latestVersion || details.minVersion || 'unknown';
  const currentVersion = details.currentVersion || deps.clientAssetVersion;
  const dismissKey = `${reason}:${currentVersion}:${latestVersion}`;
  if (localStorage.getItem(VERSION_CHECK_DISMISSED_KEY) === dismissKey || document.querySelector('.version-alert')) {
    return;
  }

  const isApiMismatch = reason === 'api';
  const alert = document.createElement('section');
  alert.className = 'version-alert';
  alert.setAttribute('role', 'alert');
  alert.innerHTML = `
    <div class="version-alert__text">
      <strong>${isApiMismatch ? '웹앱 호환성 업데이트가 필요합니다.' : '웹앱 업데이트가 필요합니다.'}</strong>
      <span>${isApiMismatch ? '서버 API와 현재 웹앱이 호환되지 않습니다. 강력 새로고침 후에도 반복되면 서버 재시작이 필요합니다.' : '새 웹앱 파일이 배포되었습니다. 강력 새로고침을 하면 적용됩니다.'}</span>
    </div>
    <div class="version-alert__actions">
      <button class="ghost-button version-alert__dismiss" type="button">나중에</button>
      <button class="version-alert__refresh" type="button">강력 새로고침</button>
    </div>
  `;
  alert.querySelector('.version-alert__refresh')?.addEventListener('click', () => deps.clearAppCacheAndReload?.());
  alert.querySelector('.version-alert__dismiss')?.addEventListener('click', () => {
    localStorage.setItem(VERSION_CHECK_DISMISSED_KEY, dismissKey);
    alert.remove();
  });
  document.body.append(alert);
}

export async function checkClientAssetVersion(deps) {
  try {
    const response = await fetch(`${deps.apiUrl}/client-version.json?ts=${Date.now()}`, {
      cache: 'no-store',
    });
    if (!response.ok) {
      return;
    }
    const body = await response.json();
    const latestAssetVersion = String(body?.client_asset_version || '');
    if (latestAssetVersion && latestAssetVersion !== deps.clientAssetVersion) {
      showVersionMismatchAlert('asset', {
        currentVersion: deps.clientAssetVersion,
        latestVersion: latestAssetVersion,
      }, deps);
    }
  } catch {
    // Version checks are best-effort only.
  }
}

export async function checkServerApiCompatibility(deps) {
  try {
    const response = await fetch(`${deps.apiUrl}/v1/version`, {
      cache: 'no-store',
      headers: await deps.apiHeaders(),
    });
    if (!response.ok) {
      return;
    }
    const body = await response.json();
    const minClientApiVersion = Number(body?.min_client_api_version || 1);
    if (Number.isFinite(minClientApiVersion) && deps.clientApiVersion < minClientApiVersion) {
      showVersionMismatchAlert('api', {
        currentVersion: String(deps.clientApiVersion),
        minVersion: String(minClientApiVersion),
      }, deps);
    }
  } catch {
    // Version checks are best-effort only.
  }
}

export async function checkClientServerVersion(deps) {
  await checkClientAssetVersion(deps);
  await checkServerApiCompatibility(deps);
}
