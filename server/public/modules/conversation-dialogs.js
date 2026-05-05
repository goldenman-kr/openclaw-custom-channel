export function closeDialog(dialog) {
  if (!dialog) {
    return;
  }
  if (typeof dialog.close === 'function' && dialog.open) {
    dialog.close();
  }
}

export function openRenameDialog(elements, currentTitle) {
  const dialog = elements.conversationRenameDialog;
  const input = elements.conversationRenameInput;
  if (!dialog || !input) {
    const fallback = window.prompt('새 대화 이름을 입력하세요.', currentTitle);
    return Promise.resolve(fallback === null ? null : fallback.trim());
  }
  input.value = currentTitle;
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      closeDialog(dialog);
      resolve(value);
    };
    const cleanup = () => {
      elements.conversationRenameConfirm?.removeEventListener('click', onConfirm);
      elements.conversationRenameCancel?.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onInputKeydown);
      dialog.removeEventListener('cancel', onCancel);
      dialog.removeEventListener('close', onClose);
    };
    const onConfirm = () => settle(input.value.trim());
    const onCancel = () => settle(null);
    const onClose = () => settle(null);
    const onInputKeydown = (event) => {
      if (event.isComposing || event.keyCode === 229) {
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        onConfirm();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }
    };
    elements.conversationRenameConfirm?.addEventListener('click', onConfirm);
    elements.conversationRenameCancel?.addEventListener('click', onCancel);
    input.addEventListener('keydown', onInputKeydown);
    dialog.addEventListener('cancel', onCancel);
    dialog.addEventListener('close', onClose);
    dialog.showModal?.();
    input.focus();
    input.select();
  });
}

export function openDeleteDialog(elements, title) {
  const dialog = elements.conversationDeleteDialog;
  if (!dialog) {
    return Promise.resolve(window.confirm(`“${title}” 대화를 삭제할까요? 이 작업은 되돌릴 수 없습니다.`));
  }
  if (elements.conversationDeleteText) {
    elements.conversationDeleteText.textContent = `“${title}” 대화를 삭제할까요?`;
  }
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      closeDialog(dialog);
      resolve(value);
    };
    const cleanup = () => {
      elements.conversationDeleteConfirm?.removeEventListener('click', onConfirm);
      elements.conversationDeleteCancel?.removeEventListener('click', onCancel);
      dialog.removeEventListener('cancel', onCancel);
      dialog.removeEventListener('close', onClose);
    };
    const onConfirm = () => settle(true);
    const onCancel = () => settle(false);
    const onClose = () => settle(false);
    elements.conversationDeleteConfirm?.addEventListener('click', onConfirm);
    elements.conversationDeleteCancel?.addEventListener('click', onCancel);
    dialog.addEventListener('cancel', onCancel);
    dialog.addEventListener('close', onClose);
    dialog.showModal?.();
  });
}
