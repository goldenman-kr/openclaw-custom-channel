export function conversationTitle(conversation) {
  const title = typeof conversation?.title === 'string' ? conversation.title.trim() : '';
  return title || '새 대화';
}

export function formatConversationDate(value) {
  const time = Date.parse(value || '');
  if (!Number.isFinite(time)) {
    return '';
  }
  const date = new Date(time);
  return date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
}

export function formatMessageTimestamp(value) {
  const time = Date.parse(value || '');
  if (!Number.isFinite(time)) {
    return '';
  }
  const date = new Date(time);
  const pad = (number) => String(number).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}월${pad(date.getDate())}일 ${pad(date.getHours())}시${pad(date.getMinutes())}분${pad(date.getSeconds())}초`;
}
