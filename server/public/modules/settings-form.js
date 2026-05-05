import { normalizeApiKey } from './api-client.js';
import { normalizeFontSize } from './display.js';
import { normalizeHistoryPageSize, randomDeviceId } from './settings.js';

export function applySettingsToFormControls(elements, settings, fallbackOrigin = window.location.origin) {
  if (elements.apiUrlInput) {
    elements.apiUrlInput.value = settings.apiUrl || fallbackOrigin;
  }
  if (elements.apiKeyInput) {
    elements.apiKeyInput.value = settings.apiKey || '';
  }
  if (elements.deviceIdInput) {
    elements.deviceIdInput.value = settings.deviceId || randomDeviceId();
  }
  if (elements.themeModeInput) {
    elements.themeModeInput.value = settings.themeMode || 'dark';
  }
  if (elements.autoLocationOnHereInput) {
    elements.autoLocationOnHereInput.checked = settings.autoLocationOnHere !== false;
  }
  if (elements.historyPageSizeInput) {
    const historyPageSize = normalizeHistoryPageSize(settings.historyPageSize);
    elements.historyPageSizeInput.value = String(historyPageSize);
    return { ...settings, historyPageSize };
  }
  return settings;
}

export function readSettingsFromFormControls(elements, settings, fallbackOrigin = window.location.origin) {
  const apiUrl = elements.apiUrlInput?.value.trim().replace(/\/+$/, '') || fallbackOrigin;
  const apiKey = elements.apiKeyInput ? normalizeApiKey(elements.apiKeyInput.value) : settings.apiKey;
  const deviceId = elements.deviceIdInput?.value.trim() || settings.deviceId || randomDeviceId();
  const themeMode = elements.themeModeInput?.value || settings.themeMode || 'dark';
  const fontSize = normalizeFontSize(elements.fontSizeInput?.value || settings.fontSize);
  const autoLocationOnHere = elements.autoLocationOnHereInput ? elements.autoLocationOnHereInput.checked : settings.autoLocationOnHere !== false;
  const historyPageSize = normalizeHistoryPageSize(elements.historyPageSizeInput?.value || settings.historyPageSize);
  return { ...settings, apiUrl, apiKey, deviceId, themeMode, fontSize, autoLocationOnHere, historyPageSize };
}
