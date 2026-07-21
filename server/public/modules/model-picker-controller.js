export function createModelPickerController({
  elements,
  hasConversation,
  fetchMenu,
  patchModel,
  patchThinking,
  patchSpeed,
  renderModelPicker,
  updateModelPickerButtonState,
  showToast,
}) {
  let expanded = false;
  let loading = false;
  let state = null;
  let activeConversationId = null;

  function shortModelLabel(modelRef = '') {
    const value = String(modelRef || '').trim();
    const slash = value.lastIndexOf('/');
    return slash >= 0 ? value.slice(slash + 1) : value;
  }

  function selectedModelLabel() {
    const selected = state?.models?.find((entry) => entry.selected);
    return selected?.label || shortModelLabel(state?.currentModel);
  }

  function selectedThinkingLabel() {
    const selected = state?.thinkingLevels?.find((entry) => entry.selected);
    return selected?.label || state?.currentThinking || '';
  }

  function selectedSpeed() {
    const selected = state?.speedModes?.find((entry) => entry.selected);
    return selected?.ref || state?.currentSpeed || 'standard';
  }

  function isOpenAiSpeedModel(modelRef = '') {
    const provider = String(modelRef || '').trim().split('/', 1)[0]?.toLowerCase();
    return provider === 'openai' || provider === 'openai-codex';
  }

  function currentSummary() {
    const model = selectedModelLabel();
    const thinking = selectedThinkingLabel();
    const fast = Boolean(state?.speedSupported && selectedSpeed() === 'fast');
    if (!model && !thinking) {
      return '';
    }
    return thinking ? `${model || 'AI'}\n${thinking}${fast ? ' ⚡' : ''}` : `${model}${fast ? '\n⚡' : ''}`;
  }

  function withSelectedModel(nextModel) {
    if (!state) {
      return null;
    }
    const model = String(nextModel || '');
    const speedSupported = isOpenAiSpeedModel(model);
    const currentSpeed = speedSupported ? selectedSpeed() : 'standard';
    return {
      ...state,
      currentModel: model,
      currentSpeed,
      speedSupported,
      models: (state.models || []).map((entry) => ({
        ...entry,
        selected: entry.ref === model,
      })),
      speedModes: (state.speedModes || []).map((entry) => ({
        ...entry,
        selected: entry.ref === currentSpeed,
      })),
    };
  }

  function withSelectedThinking(nextThinking) {
    if (!state) {
      return null;
    }
    const thinking = String(nextThinking || '');
    return {
      ...state,
      currentThinking: thinking,
      thinkingLevels: (state.thinkingLevels || []).map((entry) => ({
        ...entry,
        selected: entry.ref === thinking,
      })),
    };
  }

  function withSelectedSpeed(nextSpeed) {
    if (!state) {
      return null;
    }
    const speed = String(nextSpeed || '').toLowerCase() === 'fast' ? 'fast' : 'standard';
    return {
      ...state,
      currentSpeed: speed,
      speedModes: (state.speedModes || []).map((entry) => ({
        ...entry,
        selected: entry.ref === speed,
      })),
    };
  }

  function render() {
    renderModelPicker(elements, {
      expanded,
      loading,
      canChange: state?.canChange,
      models: state?.models,
      thinkingLevels: state?.thinkingLevels,
      speedModes: state?.speedModes,
      speedSupported: state?.speedSupported,
      hasConversation: hasConversation(),
    }, (modelRef) => {
      apply(activeConversationId, modelRef).catch((error) => {
        showToast(error instanceof Error ? error.message : String(error), { kind: 'error', durationMs: 3200 });
      });
    }, (thinkingRef) => {
      applyThinking(activeConversationId, thinkingRef).catch((error) => {
        showToast(error instanceof Error ? error.message : String(error), { kind: 'error', durationMs: 3200 });
      });
    }, (speedRef) => {
      applySpeed(activeConversationId, speedRef).catch((error) => {
        showToast(error instanceof Error ? error.message : String(error), { kind: 'error', durationMs: 3200 });
      });
    });
  }

  function updateButtonState() {
    updateModelPickerButtonState(elements.modelPickerButton, {
      hasConversation: hasConversation(),
      expanded,
      summary: currentSummary(),
    });
  }

  function reset() {
    expanded = false;
    loading = false;
    state = null;
    activeConversationId = null;
    render();
    updateButtonState();
  }

  function setExpanded(nextExpanded) {
    expanded = Boolean(nextExpanded);
    if (!expanded) {
      loading = false;
    }
    render();
    updateButtonState();
  }

  async function open(conversationId) {
    if (!conversationId || loading) {
      return;
    }
    activeConversationId = conversationId;
    expanded = true;
    loading = true;
    state = null;
    render();
    try {
      state = await fetchMenu(conversationId);
    } finally {
      loading = false;
      render();
      updateButtonState();
    }
  }

  async function refresh(conversationId) {
    if (!conversationId || loading) {
      updateButtonState();
      return;
    }
    activeConversationId = conversationId;
    const nextState = await fetchMenu(conversationId);
    if (activeConversationId !== conversationId) {
      return;
    }
    state = nextState;
    render();
    updateButtonState();
  }

  async function apply(conversationId, modelRef) {
    if (!conversationId || loading) {
      return;
    }
    if (state?.models?.find((entry) => entry.ref === modelRef)?.selected) {
      setExpanded(false);
      return;
    }
    loading = true;
    render();
    try {
      const result = await patchModel(conversationId, modelRef);
      showToast(`모델 변경 완료: ${String(result.current_model || modelRef).split('/').pop()}`, { kind: 'success' });
      if (result.warning) {
        showToast(result.warning, { kind: 'info', durationMs: 3200 });
      }
      state = withSelectedModel(result.current_model || modelRef);
      setExpanded(false);
    } finally {
      loading = false;
      render();
      updateButtonState();
    }
  }

  async function applyThinking(conversationId, thinkingRef) {
    if (!conversationId || loading) {
      return;
    }
    if (state?.thinkingLevels?.find((entry) => entry.ref === thinkingRef)?.selected) {
      setExpanded(false);
      return;
    }
    loading = true;
    render();
    try {
      const result = await patchThinking(conversationId, thinkingRef);
      showToast(`Think level 변경 완료: ${result.current_thinking || thinkingRef}`, { kind: 'success' });
      state = withSelectedThinking(result.current_thinking || thinkingRef);
      setExpanded(false);
    } finally {
      loading = false;
      render();
      updateButtonState();
    }
  }

  async function applySpeed(conversationId, speedRef) {
    if (!conversationId || loading || !state?.speedSupported) {
      return;
    }
    if (state?.speedModes?.find((entry) => entry.ref === speedRef)?.selected) {
      setExpanded(false);
      return;
    }
    loading = true;
    render();
    try {
      const result = await patchSpeed(conversationId, speedRef);
      const currentSpeed = result.current_speed || speedRef;
      showToast(`Speed 변경 완료: ${currentSpeed === 'fast' ? 'Fast' : 'Standard'}`, { kind: 'success' });
      state = withSelectedSpeed(currentSpeed);
      setExpanded(false);
    } finally {
      loading = false;
      render();
      updateButtonState();
    }
  }

  async function toggle(conversationId) {
    if (expanded) {
      setExpanded(false);
      return;
    }
    try {
      await open(conversationId);
    } catch (error) {
      loading = false;
      setExpanded(false);
      showToast(error instanceof Error ? error.message : String(error), { kind: 'error', durationMs: 3200 });
    }
  }

  return {
    isExpanded: () => expanded,
    isLoading: () => loading,
    reset,
    render,
    updateButtonState,
    setExpanded,
    open,
    refresh,
    apply,
    applyThinking,
    applySpeed,
    toggle,
  };
}
