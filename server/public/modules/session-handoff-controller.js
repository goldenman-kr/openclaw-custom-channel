export async function continueInNewSessionFlow(deps) {
  const {
    setFloatingActionsExpanded,
    isSendingMessage,
    canUseApi,
    appendMessage,
    openSettingsPanel,
    ensureActiveConversation,
    saveComposerDraft,
    setSending,
    setStatus,
    fetchConversationHistory,
    buildNewSessionHandoffMessage,
    conversationTitle,
    createConversation,
    activateConversation,
    resetAfterConversationSwitch,
    renderConversationList,
    restoreComposerDraft,
    closeMobileDrawer,
    sendMessage,
    savePendingJob,
    refreshHistoryIfChanged,
    ensurePendingJobBubble,
    waitForJob,
    isActiveConversation,
    isTerminalJobState,
    applyStreamingToken,
    renderHistory,
    refreshConversations,
    isMobileLikeInput,
    focusMessageInput,
  } = deps;

  setFloatingActionsExpanded(false);
  if (isSendingMessage()) {
    return;
  }
  if (!canUseApi()) {
    appendMessage('system', '로그인 후 대화를 시작할 수 있습니다.', { persist: false });
    openSettingsPanel();
    return;
  }

  const sourceConversation = await ensureActiveConversation();
  saveComposerDraft(sourceConversation.id);
  setSending(true);
  setStatus('새 세션 인수인계를 준비하는 중입니다...');

  try {
    const sourceHistory = await fetchConversationHistory(sourceConversation.id);
    const handoffMessage = buildNewSessionHandoffMessage(sourceConversation, sourceHistory);
    const nextTitleBase = conversationTitle(sourceConversation).replace(/^이어가기 -\s*/, '');
    const nextConversation = await createConversation(`이어가기 - ${nextTitleBase}`.slice(0, 120));
    activateConversation(nextConversation);
    resetAfterConversationSwitch(nextConversation.id);
    renderConversationList();
    restoreComposerDraft(nextConversation.id);
    closeMobileDrawer();

    appendMessage('system', '새 OpenClaw 세션을 만들고 최근 대화 맥락을 전달합니다.', { persist: false });
    setStatus('새 세션에 인수인계 메시지를 보내는 중입니다...');
    const response = await sendMessage(handoffMessage);
    const conversationId = response.conversation_id || nextConversation.id;
    if (response.job_id) {
      savePendingJob({ job_id: response.job_id, startedAt: Date.now() }, conversationId);
      setSending(false);
      setStatus('새 세션을 초기화하는 중입니다...');
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
      if (job.state === 'failed') {
        setStatus(job.error || '새 세션 초기화 응답이 실패했습니다.');
      } else if (job.state === 'cancelled') {
        setStatus('새 세션 초기화 요청이 취소되었습니다.');
      } else {
        setStatus('새 세션으로 이어갈 준비가 됐습니다.');
      }
    } else {
      await refreshHistoryIfChanged();
      setStatus('새 세션으로 이어갈 준비가 됐습니다.');
    }
    await refreshConversations().catch(() => {});
  } catch (error) {
    appendMessage('system', error instanceof Error ? error.message : String(error), { persist: false });
    setStatus('');
  } finally {
    setSending(false);
    if (!isMobileLikeInput()) {
      focusMessageInput();
    }
  }
}
