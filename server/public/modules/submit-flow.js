export function outgoingMessageForSubmit(rawMessage, hasAttachments) {
  return rawMessage || (hasAttachments ? '첨부 파일을 확인하고 사용자의 의도에 맞게 분석해주세요.' : '');
}

export function shouldIncludeLocationForMessage({ rawMessage, includeLocationChecked, autoLocationOnHere, slashCommandUsesCurrentLocation }) {
  const isSlashCommand = rawMessage.startsWith('/');
  return includeLocationChecked
    || slashCommandUsesCurrentLocation(rawMessage)
    || (autoLocationOnHere !== false && !isSlashCommand && rawMessage.includes('여기'));
}

export function resetComposerAfterSubmit({ elements, conversationId, clearComposerDraft, autoResizeTextarea }) {
  elements.messageInput.value = '';
  clearComposerDraft(conversationId);
  autoResizeTextarea();
  elements.attachmentInput.value = '';
  elements.includeLocationInput.checked = false;
}

export function restoreComposerAfterSubmitFailure({ elements, rawMessage, conversationId, saveComposerDraft, autoResizeTextarea }) {
  elements.messageInput.value = rawMessage;
  saveComposerDraft(conversationId);
  autoResizeTextarea();
}

export function submitValidationMessage({ rawMessage, attachmentCount, canUseApi, hasActiveConversation, archived }) {
  if (!rawMessage && attachmentCount === 0) {
    return { ok: false, silent: true };
  }
  if (!canUseApi) {
    return { ok: false, message: '로그인 후 대화를 시작할 수 있습니다.', openSettings: true };
  }
  if (!hasActiveConversation) {
    return { ok: false, message: '새 대화를 열거나 목록에서 대화를 선택한 뒤 메시지를 보내주세요.' };
  }
  if (archived) {
    return { ok: false, message: '보관된 대화입니다. 대화를 이어가려면 아카이브를 해제하세요.', updateComposerAvailability: true };
  }
  return { ok: true };
}

export function notifyJobResult(job, notifyReplyReady) {
  if (job.state === 'failed') {
    notifyReplyReady('OpenClaw 응답 실패', job.error || '응답 작업이 실패했습니다.');
  } else if (job.state === 'completed') {
    notifyReplyReady();
  }
}

export function schedulePostSubmitRefresh({ setTimeoutFn = window.setTimeout.bind(window), refreshHistoryIfChanged, refreshConversations }) {
  setTimeoutFn(refreshHistoryIfChanged, 800);
  setTimeoutFn(() => refreshConversations().catch(() => {}), 900);
}
