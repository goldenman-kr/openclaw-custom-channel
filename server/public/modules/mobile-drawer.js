export function isDesktopLayout() {
  return window.matchMedia('(min-width: 900px)').matches;
}

export function isDrawerOpen() {
  return document.body.classList.contains('drawer-open');
}

export function openDrawer(button) {
  const wasOpen = isDrawerOpen();
  document.body.classList.add('drawer-open');
  button?.setAttribute('aria-expanded', 'true');
  return wasOpen;
}

export function closeDrawer(button) {
  const wasOpen = isDrawerOpen();
  document.body.classList.remove('drawer-open');
  button?.setAttribute('aria-expanded', 'false');
  return wasOpen;
}

export function toggleDesktopSidebar(button) {
  document.body.classList.toggle('sidebar-collapsed');
  button?.setAttribute('aria-expanded', document.body.classList.contains('sidebar-collapsed') ? 'false' : 'true');
}

export function shouldIgnoreDrawerSwipe(target) {
  return Boolean(target?.closest?.('input, textarea, button, a, select, dialog, .composer, .settings-panel, .media-viewer, .floating-action-menu, .markdown-table-wrapper, .code-block pre'));
}

export function drawerSwipeGesture(start, touch) {
  if (!start || !touch) {
    return null;
  }
  const deltaX = touch.clientX - start.x;
  const deltaY = touch.clientY - start.y;
  const elapsed = Date.now() - start.time;
  if (Math.abs(deltaX) < 90 || Math.abs(deltaY) > 70 || elapsed > 800) {
    return null;
  }
  return deltaX > 0 ? 'open-menu' : 'open-settings';
}
