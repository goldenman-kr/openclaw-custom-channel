export function createSidebarResizeController({
  elements,
  documentRef = document,
  canResizeSidebar,
  stateFromEvent,
  widthFromState,
  clampWidth,
  saveWidth,
  applyStoredWidth,
}) {
  let resizeState = null;

  function start(event) {
    if (!elements.conversationSidebar || !canResizeSidebar()) {
      return;
    }
    event.preventDefault();
    resizeState = stateFromEvent(event, elements.conversationSidebar);
    elements.sidebarResizeHandle?.setPointerCapture?.(event.pointerId);
    documentRef.body.classList.add('sidebar-resizing');
  }

  function move(event) {
    if (!resizeState || event.pointerId !== resizeState.pointerId) {
      return;
    }
    const nextWidth = widthFromState(resizeState, event.clientX);
    documentRef.documentElement.style.setProperty('--sidebar-width', `${clampWidth(nextWidth)}px`);
  }

  function finish(event) {
    if (!resizeState || event.pointerId !== resizeState.pointerId) {
      return;
    }
    const nextWidth = widthFromState(resizeState, event.clientX);
    saveWidth(nextWidth);
    elements.sidebarResizeHandle?.releasePointerCapture?.(event.pointerId);
    resizeState = null;
    documentRef.body.classList.remove('sidebar-resizing');
  }

  function cancel() {
    if (!resizeState) {
      return;
    }
    resizeState = null;
    documentRef.body.classList.remove('sidebar-resizing');
  }

  function syncToViewport() {
    applyStoredWidth();
  }

  return { start, move, finish, cancel, syncToViewport };
}
