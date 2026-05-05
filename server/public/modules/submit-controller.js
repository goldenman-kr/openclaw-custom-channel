export async function handleSubmitFlow(event, deps) {
  const {
    elements,
    selectedAttachments,
    setSelectedAttachments,
    canUseApi,
    activeConversation,
    isConversationArchived,
    submitValidationMessage,
    appendMessage,
    openSettingsPanel,
    updateComposerAvailability,
    setSending,
    setStatus,
    ensureActiveConversation,
    outgoingMessageForSubmit,
    shouldIncludeLocationForMessage,
    settings,
    slashCommandUsesCurrentLocation,
    getCurrentLocationMetadata,
    buildAttachmentsPayload,
    attachmentSummary,
    resetComposerAfterSubmit,
    clearComposerDraft,
    autoResizeTextarea,
    renderAttachmentTray,
    sendMessage,
    refreshConversations,
    savePendingJob,
    isActiveConversation,
    resetLastHistoryVersion,
    refreshHistoryIfChanged,
    ensurePendingJobBubble,
    waitForJob,
    isTerminalJobState,
    applyStreamingToken,
    renderHistory,
    notifyJobResult,
    notifyReplyReady,
    schedulePostSubmitRefresh,
    isJobResolvedInHistory,
    clearPendingJob,
    restoreComposerAfterSubmitFailure,
    saveComposerDraft,
    isMobileLikeInput,
  } = deps;

  event.preventDefault();
  const rawMessage = elements.messageInput.value.trim();
  const validation = submitValidationMessage({
    rawMessage,
    attachmentCount: selectedAttachments().length,
    canUseApi: canUseApi(),
    hasActiveConversation: Boolean(activeConversation()?.id),
    archived: isConversationArchived(activeConversation()),
  });
  if (!validation.ok) {
    if (!validation.silent) {
      appendMessage('system', validation.message, { persist: false });
    }
    if (validation.openSettings) {
      openSettingsPanel();
    }
    if (validation.updateComposerAvailability) {
      updateComposerAvailability();
    }
    return;
  }

  setSending(true);
  setStatus('메시지를 준비하는 중입니다...');

  try {
    const conversation = await ensureActiveConversation();
    const outgoingMessage = outgoingMessageForSubmit(rawMessage, selectedAttachments().length > 0);
    const shouldIncludeLocation = shouldIncludeLocationForMessage({
      rawMessage,
      includeLocationChecked: elements.includeLocationInput.checked,
      autoLocationOnHere: settings().autoLocationOnHere,
      slashCommandUsesCurrentLocation,
    });
    let metadata;
    if (shouldIncludeLocation) {
      setStatus('현재 위치를 가져오는 중입니다...');
      metadata = { location: await getCurrentLocationMetadata() };
    }

    setStatus('첨부 파일을 준비하는 중입니다...');
    const attachedFiles = [...selectedAttachments()];
    const attachments = await buildAttachmentsPayload();
    const displayedUserText = `${outgoingMessage}${attachmentSummary(attachedFiles)}`;
    appendMessage('user', displayedUserText, { files: attachedFiles, savedAt: new Date().toISOString() });
    resetComposerAfterSubmit({ elements, conversationId: conversation.id, clearComposerDraft, autoResizeTextarea });
    setSelectedAttachments([]);
    renderAttachmentTray();
    setStatus('OpenClaw 응답을 기다리는 중입니다...');

    let activeJobId = null;
    try {
      const response = await sendMessage(outgoingMessage, attachments, metadata);
      await refreshConversations().catch(() => {});
      if (response.job_id) {
        activeJobId = response.job_id;
        const conversationId = response.conversation_id || conversation.id;
        savePendingJob({ job_id: response.job_id, startedAt: Date.now() }, conversationId);
        setSending(false);
        if (isActiveConversation(conversationId)) {
          setStatus('서버에서 응답을 처리 중입니다. 앱을 닫아도 작업은 계속됩니다.');
        }
        resetLastHistoryVersion();
        await refreshHistoryIfChanged();
        ensurePendingJobBubble(response.job_id, conversationId);
        let receivedStreamingToken = false;
        const job = await waitForJob(response.job_id, (jobUpdate) => {
          if (!isActiveConversation(conversationId)) {
            return;
          }
          if (!receivedStreamingToken || isTerminalJobState(jobUpdate.state)) {
            refreshHistoryIfChanged();
          }
        }, conversationId, (token) => {
          receivedStreamingToken = true;
          applyStreamingToken(response.job_id, token, conversationId);
        });
        if (isActiveConversation(conversationId)) {
          await renderHistory({ scrollToLatest: true });
        }
        await refreshConversations().catch(() => {});
        notifyJobResult(job, notifyReplyReady);
      } else {
        appendMessage('assistant', response.reply || '(빈 응답)', { force: true, savedAt: new Date().toISOString() });
      }
      setStatus('');
      schedulePostSubmitRefresh({ refreshHistoryIfChanged, refreshConversations });
    } catch (error) {
      if (activeJobId && await isJobResolvedInHistory(activeJobId, conversation.id)) {
        clearPendingJob();
        setStatus('');
        notifyReplyReady();
        return;
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (activeJobId) {
        setStatus('응답 상태 확인이 일시적으로 끊겼습니다. 대화 기록을 새로고침하면 이어서 확인합니다.');
        window.setTimeout(refreshHistoryIfChanged, 800);
        return;
      }
      restoreComposerAfterSubmitFailure({ elements, rawMessage, conversationId: conversation.id, saveComposerDraft, autoResizeTextarea });
      appendMessage('system', errorMessage, { persist: false });
      setStatus('');
    }
  } catch (error) {
    appendMessage('system', error instanceof Error ? error.message : String(error));
    setStatus('');
  } finally {
    setSending(false);
    if (!isMobileLikeInput()) {
      elements.messageInput.focus();
    }
  }
}
