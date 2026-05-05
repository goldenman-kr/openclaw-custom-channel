export function isPlaceholderPendingText(text) {
  const normalized = typeof text === 'string' ? text.trim() : '';
  return normalized === '응답 대기 중입니다…' || normalized === '응답을 처리 중입니다…' || /^응답을 처리 중입니다\s*\(\d+초\)$/.test(normalized);
}

export function isRunningJobHistoryMessage(item) {
  return typeof item?.id === 'string'
    && item.id.startsWith('job_')
    && item.role === 'assistant'
    && !item.completedAt
    && (isPlaceholderPendingText(item.text) || item.jobState === 'queued' || item.jobState === 'running');
}

export function isPendingHistoryMessage(item) {
  return isRunningJobHistoryMessage(item) && isPlaceholderPendingText(item.text);
}

export function historySignature(history) {
  return history.map((item) => `${item.id || ''}:${item.role}:${item.text}:${item.jobId || ''}:${item.completedAt || ''}`).join('\n---\n');
}

export function shouldRerenderHistory(history, renderedSignature) {
  return history.length > 0 && historySignature(history) !== renderedSignature;
}
