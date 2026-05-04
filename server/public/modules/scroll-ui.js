function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function isNearBottom(messages, threshold = 120) {
  return messages.scrollHeight - messages.scrollTop - messages.clientHeight < threshold;
}

export function showScrollToLatestButton(button) {
  button?.classList.remove('hidden');
}

export function hideScrollToLatestButton(button) {
  button?.classList.add('hidden');
}

export function updateMessagesScrollIndicator(messages, indicator) {
  if (!indicator) {
    return;
  }
  const { scrollHeight, clientHeight, scrollTop } = messages;
  if (scrollHeight <= clientHeight + 1) {
    indicator.classList.remove('visible');
    return;
  }
  const trackHeight = clientHeight;
  const thumbHeight = clamp((clientHeight / scrollHeight) * trackHeight, 36, Math.max(36, trackHeight));
  const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
  const maxScrollTop = Math.max(1, scrollHeight - clientHeight);
  const thumbTop = (scrollTop / maxScrollTop) * maxThumbTop;
  const messagesRect = messages.getBoundingClientRect();
  indicator.style.top = `${messagesRect.top}px`;
  indicator.style.height = `${thumbHeight}px`;
  indicator.style.transform = `translateY(${thumbTop}px)`;
  indicator.classList.add('visible');
}

export function hideMessagesScrollIndicator(messages, indicator) {
  messages.classList.remove('is-scrolling');
  indicator?.classList.remove('visible');
}
