export function sidebarConversationCountText({ showingArchived, count }) {
  return showingArchived ? `보관함 ${count}개` : `대화 ${count}개`;
}

export function updateSidebarSummary({ ownerTitle, countNode, canUseApi, ownerName, count, showingArchived }) {
  if (!ownerTitle || !countNode) {
    return;
  }
  if (!canUseApi) {
    ownerTitle.textContent = '대화';
    countNode.textContent = '로그인이 필요합니다';
    return;
  }
  ownerTitle.textContent = `${ownerName}님의 대화`;
  countNode.textContent = sidebarConversationCountText({ showingArchived, count });
}

export function updateArchiveToggleButton(button, showingArchived) {
  if (!button) {
    return;
  }
  const label = button.querySelector('.sidebar-button-label');
  if (label) {
    label.textContent = showingArchived ? '나가기' : '보관함';
  }
  button.setAttribute('aria-pressed', showingArchived ? 'true' : 'false');
}

export function conversationListEmptyMessage({ query, showingArchived }) {
  if (query) {
    return '검색 결과가 없습니다.';
  }
  return showingArchived ? '보관된 대화가 없습니다.' : '대화가 없습니다.';
}

export function createConversationListEmptyState(message) {
  const empty = document.createElement('p');
  empty.className = 'conversation-empty';
  empty.textContent = message;
  return empty;
}
