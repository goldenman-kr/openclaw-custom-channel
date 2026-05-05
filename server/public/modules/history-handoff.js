import { conversationTitle } from './conversation-format.js';

export function compactHistoryText(text, maxLength = 700) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

export function buildNewSessionHandoffMessage(sourceConversation, history) {
  const meaningful = history
    .filter((item) => ['user', 'assistant'].includes(item.role) && typeof item.text === 'string' && item.text.trim())
    .slice(-12);
  const lines = meaningful.map((item) => {
    const speaker = item.role === 'user' ? '사용자' : 'assistant';
    return `- ${speaker}: ${compactHistoryText(item.text)}`;
  });
  const historyText = lines.length > 0 ? lines.join('\n') : '- 이전 대화 기록이 비어 있습니다.';
  return [
    '새 OpenClaw 세션으로 이어가기 위한 인수인계입니다.',
    '',
    `이전 대화 제목: ${conversationTitle(sourceConversation)}`,
    '',
    '아래는 이전 대화의 최근 핵심 맥락입니다. 이 맥락을 참고해서 이후 질문에 이어서 답해주세요. 불확실한 내용은 추정하지 말고 확인 질문을 해주세요.',
    '',
    historyText,
    '',
    '이 인수인계를 이해했다면 아주 짧게 확인만 해주세요.',
  ].join('\n');
}
