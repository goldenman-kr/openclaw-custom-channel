export function updateModelPickerButtonState(button, { hasConversation, expanded }) {
  if (!button) {
    return;
  }
  button.disabled = !hasConversation;
  button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  button.title = hasConversation ? 'AI 모델 선택' : '대화를 먼저 선택하세요';
}

export function renderModelPicker(elements, state, onSelectModel, onSelectThinking) {
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
  const thinkingLevels = Array.isArray(state.thinkingLevels) ? state.thinkingLevels : [];
  elements.modelPickerStatus.textContent = state.loading
    ? '모델 목록을 불러오는 중입니다…'
    : (!state.hasConversation
      ? '대화를 먼저 선택하세요.'
      : (canChange ? '이 대화에서 사용할 모델과 Think level을 선택하세요.' : '현재 모델과 Think level만 확인할 수 있습니다.'));
  elements.modelPickerStatus.classList.toggle('hidden', !state.loading && (models.length > 0 || thinkingLevels.length > 0));

  appendPickerSection(elements.modelPickerList, '모델', models, canChange, state.loading, 'modelRef', onSelectModel);
  appendPickerSection(elements.modelPickerList, 'Think level', thinkingLevels, canChange, state.loading, 'thinkingRef', onSelectThinking);
}

function appendPickerSection(root, title, items, canChange, loading, dataKey, onSelect) {
  if (!items.length) {
    return;
  }

  const heading = document.createElement('div');
  heading.className = 'model-picker-section-title';
  heading.textContent = title;
  root.append(heading);

  for (const item of items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `model-picker-item${item.selected ? ' is-selected' : ''}`;
    button.setAttribute('role', 'menuitemradio');
    button.setAttribute('aria-checked', item.selected ? 'true' : 'false');
    button.disabled = !canChange || loading;
    button.dataset[dataKey] = item.ref;

    const check = document.createElement('span');
    check.className = 'model-picker-check';
    check.textContent = item.selected ? '✓' : '';

    const label = document.createElement('span');
    label.className = 'model-picker-item-label';
    label.textContent = item.label;

    button.append(check, label);
    button.addEventListener('click', () => onSelect(item.ref));
    root.append(button);
  }
}
