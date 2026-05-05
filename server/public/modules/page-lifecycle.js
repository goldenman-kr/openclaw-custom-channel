export function startIntervalIfNeeded(currentTimer, callback, intervalMs, canStart = true) {
  if (currentTimer || !canStart) {
    return currentTimer;
  }
  return window.setInterval(callback, intervalMs);
}

export function stopIntervalIfNeeded(currentTimer) {
  if (currentTimer) {
    window.clearInterval(currentTimer);
  }
  return null;
}
