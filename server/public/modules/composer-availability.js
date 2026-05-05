export function composerAvailabilityState({ archived, hasConversation, isSendingMessage }) {
  const disabled = Boolean(isSendingMessage || archived || !hasConversation);
  let placeholder = '메시지를 입력하세요';
  if (archived) {
    placeholder = '보관된 대화입니다. 대화를 이어가려면 아카이브를 해제하세요.';
  } else if (!hasConversation) {
    placeholder = '새 대화를 열거나 목록에서 대화를 선택하세요.';
  }
  return {
    disabled,
    sendLabel: isSendingMessage ? '전송 중' : '전송',
    placeholder,
  };
}

export function applyComposerAvailability(elements, state) {
  elements.messageInput.disabled = state.disabled;
  elements.includeLocationInput.disabled = state.disabled;
  elements.attachButton.disabled = state.disabled;
  elements.sendButton.disabled = state.disabled;
  elements.sendButton.setAttribute('aria-label', state.sendLabel);
  elements.sendButton.title = state.sendLabel;
  elements.messageInput.placeholder = state.placeholder;
}
