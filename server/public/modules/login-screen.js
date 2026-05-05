export function showLoginScreen({ screen, statusText }, message = '') {
  screen?.classList.remove('hidden');
  document.body.classList.add('auth-required');
  if (statusText) {
    statusText.textContent = message;
  }
}

export function hideLoginScreen({ screen, passwordInput }) {
  screen?.classList.add('hidden');
  document.body.classList.remove('auth-required');
  if (passwordInput) {
    passwordInput.value = '';
  }
}
