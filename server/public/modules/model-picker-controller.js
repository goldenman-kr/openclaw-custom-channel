export function createModelPickerController({
  elements,
  hasConversation,
  fetchMenu,
  patchModel,
  renderModelPicker,
  updateModelPickerButtonState,
  showToast,
}) {
  let expanded = false;
  let loading = false;
  let state = null;

  function render() {
    renderModelPicker(elements, {
      expanded,
      loading,
      canChange: state?.canChange,
      models: state?.models,
      hasConversation: hasConversation(),
    }, (modelRef) => {
      apply(modelRef).catch((error) => {
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
      showToast(`모델을 ${String(result.current_model || modelRef).split('/').pop()}로 변경했습니다.`, { kind: 'success' });
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
    toggle,
  };
}
