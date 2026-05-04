const SIDEBAR_WIDTH_KEY = 'openclaw-web-channel-sidebar-width-v1';
const SIDEBAR_WIDTH_MIN = 240;
const SIDEBAR_WIDTH_MAX = 560;

export const SIDEBAR_RESIZE_MEDIA = '(min-width: 900px) and (pointer: fine)';

export function clampSidebarWidth(width) {
  const viewportMax = Math.max(SIDEBAR_WIDTH_MIN, Math.min(SIDEBAR_WIDTH_MAX, Math.round(window.innerWidth * 0.45)));
  return Math.min(viewportMax, Math.max(SIDEBAR_WIDTH_MIN, Math.round(width)));
}

export function applyStoredSidebarWidth() {
  const storedWidth = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
  if (!Number.isFinite(storedWidth) || storedWidth <= 0) {
    return;
  }
  document.documentElement.style.setProperty('--sidebar-width', `${clampSidebarWidth(storedWidth)}px`);
}

export function saveSidebarWidth(width) {
  const clamped = clampSidebarWidth(width);
  localStorage.setItem(SIDEBAR_WIDTH_KEY, String(clamped));
  document.documentElement.style.setProperty('--sidebar-width', `${clamped}px`);
}
