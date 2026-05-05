export const STORAGE_KEY = 'openclaw-web-channel-settings-v1';
export const HISTORY_PAGE_SIZE_OPTIONS = [100, 200, 300, 400, 500];

export function randomDeviceId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `web-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function normalizeHistoryPageSize(value) {
  const size = Number(value);
  if (!Number.isFinite(size)) {
    return 300;
  }
  const rounded = Math.round(size / 100) * 100;
  return HISTORY_PAGE_SIZE_OPTIONS.includes(rounded) ? rounded : 300;
}

export function loadSettings() {
  const fallback = {
    apiUrl: window.location.origin,
    apiKey: '',
    deviceId: randomDeviceId(),
    themeMode: 'dark',
    fontSize: 16,
    notificationsEnabled: false,
    sessionNonce: '',
    lastActiveConversationId: '',
    autoLocationOnHere: true,
    historyPageSize: 300,
  };

  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') };
  } catch {
    return fallback;
  }
}

export function saveSettings(settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
