export function canResizeSidebar({ matchMedia = window.matchMedia.bind(window), mediaQuery, body = document.body } = {}) {
  return matchMedia(mediaQuery).matches && !body.classList.contains('sidebar-collapsed');
}

export function sidebarResizeStateFromEvent(event, sidebar) {
  return {
    pointerId: event.pointerId,
    startX: event.clientX,
    startWidth: sidebar.getBoundingClientRect().width,
  };
}

export function sidebarResizeWidth(state, clientX) {
  return state.startWidth + clientX - state.startX;
}
