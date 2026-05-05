export function showToast(message, options = {}) {
  const container = document.querySelector('.toast-container') || (() => {
    const node = document.createElement('div');
    node.className = 'toast-container';
    document.body.append(node);
    return node;
  })();
  const toast = document.createElement('div');
  toast.className = `toast toast--${options.kind || 'info'}`;
  toast.textContent = message;
  container.append(toast);
  window.setTimeout(() => toast.classList.add('toast--visible'), 20);
  window.setTimeout(() => {
    toast.classList.remove('toast--visible');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    window.setTimeout(() => toast.remove(), 500);
  }, options.durationMs || 2400);
}
