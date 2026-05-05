export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function pointerDistance(first, second) {
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
}

export function pointerMidpoint(first, second) {
  return {
    x: (first.clientX + second.clientX) / 2,
    y: (first.clientY + second.clientY) / 2,
  };
}

export function mediaViewerTransformStyle({ scale, x, y }) {
  return `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
}

export function initialMediaViewerTransform() {
  return { scale: 1, x: 0, y: 0 };
}

export function mediaViewerGestureStartFromPointers(pointers, transform) {
  if (pointers.length >= 2) {
    const [first, second] = pointers;
    return {
      mode: 'pinch',
      distance: Math.max(1, pointerDistance(first, second)),
      midpoint: pointerMidpoint(first, second),
      scale: transform.scale,
      x: transform.x,
      y: transform.y,
    };
  }
  if (pointers.length === 1) {
    const [pointer] = pointers;
    return {
      mode: 'pan',
      clientX: pointer.clientX,
      clientY: pointer.clientY,
      x: transform.x,
      y: transform.y,
    };
  }
  return null;
}

export function mediaViewerTransformFromGesture(pointers, gestureStart, transform) {
  if (pointers.length >= 2 && gestureStart?.mode === 'pinch') {
    const [first, second] = pointers;
    const midpoint = pointerMidpoint(first, second);
    const scale = clamp(gestureStart.scale * (pointerDistance(first, second) / gestureStart.distance), 1, 5);
    return {
      scale,
      x: scale <= 1.01 ? 0 : gestureStart.x + midpoint.x - gestureStart.midpoint.x,
      y: scale <= 1.01 ? 0 : gestureStart.y + midpoint.y - gestureStart.midpoint.y,
    };
  }
  if (pointers.length === 1 && gestureStart?.mode === 'pan' && transform.scale > 1.01) {
    const [pointer] = pointers;
    return {
      ...transform,
      x: gestureStart.x + pointer.clientX - gestureStart.clientX,
      y: gestureStart.y + pointer.clientY - gestureStart.clientY,
    };
  }
  return transform;
}

export function mediaViewerWheelTransform(transform, deltaY) {
  const nextScale = clamp(transform.scale + (deltaY < 0 ? 0.25 : -0.25), 1, 5);
  return {
    scale: nextScale,
    x: nextScale <= 1.01 ? 0 : transform.x,
    y: nextScale <= 1.01 ? 0 : transform.y,
  };
}

export function toggledMediaViewerZoomTransform(transform) {
  return {
    scale: transform.scale > 1.01 ? 1 : 2.5,
    x: 0,
    y: 0,
  };
}
