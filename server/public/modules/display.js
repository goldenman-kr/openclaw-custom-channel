export function resolvedThemeMode(themeMode) {
  if (themeMode === 'light' || themeMode === 'dark') {
    return themeMode;
  }
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function syncNativeTheme(themeMode) {
  const resolved = resolvedThemeMode(themeMode);
  const themeColor = resolved === 'light' ? '#e2e8f0' : '#151515';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor);
  window.OpenClawAndroid?.setThemeMode?.(resolved);
  window.webkit?.messageHandlers?.openClawTheme?.postMessage?.({ mode: resolved, color: themeColor });
}

export function applyTheme(themeMode) {
  document.documentElement.dataset.theme = ['light', 'dark'].includes(themeMode) ? themeMode : 'system';
  syncNativeTheme(themeMode);
}

export function normalizeFontSize(value) {
  const size = Number(value);
  if (!Number.isFinite(size)) {
    return 16;
  }
  return Math.min(20, Math.max(12, Math.round(size)));
}

export function applyDisplaySettings(settings, elements) {
  const fontSize = normalizeFontSize(settings.fontSize);
  settings.fontSize = fontSize;
  document.documentElement.style.setProperty('--app-font-size', `${fontSize}px`);
  if (elements.fontSizeInput) {
    elements.fontSizeInput.value = String(fontSize);
  }
  if (elements.fontSizeValue) {
    elements.fontSizeValue.value = `${fontSize}px`;
    elements.fontSizeValue.textContent = `${fontSize}px`;
  }
}
