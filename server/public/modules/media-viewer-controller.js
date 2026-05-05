import {
  initialMediaViewerTransform,
  mediaViewerGestureStartFromPointers,
  mediaViewerTransformFromGesture,
  mediaViewerTransformStyle,
  mediaViewerWheelTransform,
  toggledMediaViewerZoomTransform,
} from './media-viewer-geometry.js';
import {
  applyMediaViewerTransform as applyMediaViewerTransformView,
  closeMediaViewerView,
  isMediaViewerHidden,
  openMediaViewerView,
} from './media-viewer-view.js';

export function createMediaViewerController({ elements, windowRef = window }) {
  let currentUrl = '';
  let currentName = 'openclaw-image.png';
  let transform = initialMediaViewerTransform();
  const pointers = new Map();
  let gestureStart = null;
  let historyActive = false;

  function isHidden() {
    return isMediaViewerHidden(elements.mediaViewer);
  }

  function applyTransform() {
    applyMediaViewerTransformView(
      elements.mediaViewerImage,
      mediaViewerTransformStyle(transform),
      transform.scale > 1.01,
    );
  }

  function resetZoom() {
    transform = initialMediaViewerTransform();
    pointers.clear();
    gestureStart = null;
    applyTransform();
  }

  function beginGesture() {
    gestureStart = mediaViewerGestureStartFromPointers([...pointers.values()], transform);
  }

  function updateGesture() {
    const nextTransform = mediaViewerTransformFromGesture([...pointers.values()], gestureStart, transform);
    if (nextTransform !== transform) {
      transform = nextTransform;
      applyTransform();
    }
  }

  function handlePointerDown(event) {
    if (isHidden()) {
      return;
    }
    event.preventDefault();
    elements.mediaViewer.classList.add('gesturing');
    elements.mediaViewerImage.setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, event);
    beginGesture();
  }

  function handlePointerMove(event) {
    if (!pointers.has(event.pointerId)) {
      return;
    }
    event.preventDefault();
    pointers.set(event.pointerId, event);
    updateGesture();
  }

  function handlePointerEnd(event) {
    if (!pointers.has(event.pointerId)) {
      return;
    }
    pointers.delete(event.pointerId);
    elements.mediaViewerImage.releasePointerCapture?.(event.pointerId);
    if (pointers.size === 0) {
      elements.mediaViewer.classList.remove('gesturing');
    }
    beginGesture();
  }

  function handleWheel(event) {
    if (isHidden()) {
      return;
    }
    event.preventDefault();
    transform = mediaViewerWheelTransform(transform, event.deltaY);
    applyTransform();
  }

  function toggleZoom() {
    if (isHidden()) {
      return;
    }
    transform = toggledMediaViewerZoomTransform(transform);
    applyTransform();
  }

  function open(url, fileName = 'openclaw-image.png') {
    currentUrl = url;
    currentName = fileName || 'openclaw-image.png';
    resetZoom();
    openMediaViewerView({ viewer: elements.mediaViewer, image: elements.mediaViewerImage, download: elements.mediaViewerDownload }, {
      url,
      fileName: currentName,
    });
    if (!historyActive) {
      windowRef.history.pushState({ openclawMediaViewer: true }, '');
      historyActive = true;
    }
  }

  function close(options = {}) {
    const { syncHistory = true } = options;
    if (syncHistory && historyActive) {
      windowRef.history.back();
      return;
    }
    closeMediaViewerView({ viewer: elements.mediaViewer, image: elements.mediaViewerImage, download: elements.mediaViewerDownload });
    currentUrl = '';
    historyActive = false;
    resetZoom();
  }

  return {
    applyTransform,
    resetZoom,
    beginGesture,
    updateGesture,
    handlePointerDown,
    handlePointerMove,
    handlePointerEnd,
    handleWheel,
    toggleZoom,
    open,
    close,
    isHidden,
    isHistoryActive: () => historyActive,
    currentUrl: () => currentUrl,
    currentName: () => currentName,
  };
}
