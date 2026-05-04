export function updateClearMessageInputButton(button, value) {
  button?.classList.toggle('hidden', value.length === 0);
}

export function autoResizeTextarea(textarea, options = {}) {
  textarea.style.height = 'auto';
  const minHeight = Number.parseFloat(getComputedStyle(textarea).minHeight) || options.minHeight || 74;
  const maxHeight = options.maxHeight || 150;
  textarea.style.height = `${Math.max(minHeight, Math.min(textarea.scrollHeight, maxHeight))}px`;
}
