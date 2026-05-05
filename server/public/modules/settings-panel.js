export function openSettingsPanel(panel) {
  if (!panel || !panel.classList.contains('hidden')) {
    return false;
  }
  panel.classList.remove('hidden');
  document.body.classList.add('settings-open');
  return true;
}

export function closeSettingsPanel(panel) {
  if (!panel || panel.classList.contains('hidden')) {
    document.body.classList.remove('settings-open');
    return false;
  }
  panel.classList.add('hidden');
  document.body.classList.remove('settings-open');
  return true;
}
