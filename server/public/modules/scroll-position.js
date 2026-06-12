export function captureScrollPosition(element) {
  if (!element) {
    return null;
  }
  return {
    left: element.scrollLeft || 0,
    top: element.scrollTop || 0,
  };
}

export function restoreScrollPosition(element, position) {
  if (!element || !position) {
    return;
  }
  element.scrollLeft = position.left;
  element.scrollTop = position.top;
}
