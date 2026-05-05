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
