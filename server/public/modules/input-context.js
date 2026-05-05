export function isMobileLikeInput({ matchMedia = window.matchMedia.bind(window), userAgent = navigator.userAgent } = {}) {
  return matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod/i.test(userAgent);
}

export function slashCommandUsesCurrentLocation(message) {
  const trimmed = String(message || '').trimStart();
  const [command, ...args] = trimmed.split(/\s+/);
  if (!['/weather', '/route'].includes((command || '').toLowerCase())) {
    return false;
  }
  return args.join(' ').includes('여기');
}
