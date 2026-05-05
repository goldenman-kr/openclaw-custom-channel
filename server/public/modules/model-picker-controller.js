export function createModelPickerController({
  elements,
  hasConversation,
  fetchMenu,
  patchModel,
  patchThinking,
  renderModelPicker,
  updateModelPickerButtonState,
  showToast,
}) {
  let expanded = false;
  let loading = false;
  let state = null;
  let activeConversationId = null;

  function render() {
    renderModelPicker(elements, {
      expanded,
      loading,
      canChange: state?.canChange,
      models: state?.models,
      thinkingLevels: state?.thinkingLevels,
      hasConversation: hasConversation(),
    }, (modelRef) => {
      apply(activeConversationId, modelRef).catch((error) => {
        showToast(error instanceof Error ? error.message : String(error), { kind: 'error', durationMs: 3200 });
      });
    }, (thinkingRef) => {
      applyThinking(activeConversationId, thinkingRef).catch((error) => {
        showToast(error instanceof Error ? error.message : String(error), { kind: 'error', durationMs: 3200 });
      });
    });
  }

  function updateButtonState() {
    updateModelPickerButtonState(elements.modelPickerButton, {
      hasConversation: hasConversation(),
      expanded,
    });
  }

  function reset() {
    expanded = false;
    loading = false;
    state = null;
    activeConversationId = null;
    render();
  }

  function setExpanded(nextExpanded) {
    expanded = Boolean(nextExpanded);
    if (!expanded) {
      loading = false;
    }
    render();
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
    }
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
      state = null;
      setExpanded(false);
    } finally {
      loading = false;
      render();
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
      state = null;
      setExpanded(false);
    } finally {
      loading = false;
      render();
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
    apply,
    applyThinking,
    toggle,
  };
}
