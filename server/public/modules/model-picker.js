export function updateModelPickerButtonState(button, { hasConversation, expanded }) {
  if (!button) {
    return;
  }
  button.disabled = !hasConversation;
  button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  button.title = hasConversation ? 'AI 모델 선택' : '대화를 먼저 선택하세요';
}

export function renderModelPicker(elements, state, onSelectModel) {
  if (!elements.modelPickerPanel || !elements.modelPickerStatus || !elements.modelPickerList) {
    return;
  }
  elements.modelPickerPanel.classList.toggle('hidden', !state.expanded);
  elements.modelPickerButton?.setAttribute('aria-expanded', state.expanded ? 'true' : 'false');
  elements.modelPickerList.replaceChildren();

  if (!state.expanded) {
    return;
  }

  const canChange = Boolean(state.canChange);
  const models = Array.isArray(state.models) ? state.models : [];
  elements.modelPickerStatus.textContent = state.loading
    ? '모델 목록을 불러오는 중입니다…'
    : (!state.hasConversation
      ? '대화를 먼저 선택하세요.'
      : (canChange ? '이 대화에서 사용할 모델을 선택하세요.' : '현재 모델만 확인할 수 있습니다.'));
  elements.modelPickerStatus.classList.toggle('hidden', !state.loading && models.length > 0);

  for (const model of models) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `model-picker-item${model.selected ? ' is-selected' : ''}`;
    button.setAttribute('role', 'menuitemradio');
    button.setAttribute('aria-checked', model.selected ? 'true' : 'false');
    button.disabled = !canChange || state.loading;
    button.dataset.modelRef = model.ref;

    const check = document.createElement('span');
    check.className = 'model-picker-check';
    check.textContent = model.selected ? '✓' : '';

    const label = document.createElement('span');
    label.className = 'model-picker-item-label';
    label.textContent = model.label;

    button.append(check, label);
    button.addEventListener('click', () => onSelectModel(model.ref));
    elements.modelPickerList.append(button);
  }
}
