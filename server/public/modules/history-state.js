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

export function pendingJobPlaceholdersAfterJobMessages(history) {
  if (!Array.isArray(history) || history.length === 0) {
    return history;
  }

  const pendingByJobId = new Map();
  for (const item of history) {
    if (isPendingHistoryMessage(item)) {
      pendingByJobId.set(item.id, item);
    }
  }
  if (pendingByJobId.size === 0) {
    return history;
  }

  const lastMessageIndexByJobId = new Map();
  history.forEach((item, index) => {
    const jobId = typeof item?.jobId === 'string' ? item.jobId : '';
    if (jobId && pendingByJobId.has(jobId) && !isPendingHistoryMessage(item)) {
      lastMessageIndexByJobId.set(jobId, index);
    }
  });
  if (lastMessageIndexByJobId.size === 0) {
    return history;
  }

  const movedPendingJobIds = new Set();
  const result = [];
  history.forEach((item, index) => {
    if (isPendingHistoryMessage(item) && lastMessageIndexByJobId.has(item.id)) {
      return;
    }
    result.push(item);
    for (const [jobId, lastIndex] of lastMessageIndexByJobId.entries()) {
      if (lastIndex === index) {
        result.push(pendingByJobId.get(jobId));
        movedPendingJobIds.add(jobId);
      }
    }
  });

  for (const [jobId, item] of pendingByJobId.entries()) {
    if (!movedPendingJobIds.has(jobId) && !result.includes(item)) {
      result.push(item);
    }
  }

  return result;
}

export function historySignature(history) {
  return history.map((item) => `${item.id || ''}:${item.role}:${item.text}:${item.jobId || ''}:${item.completedAt || ''}`).join('\n---\n');
}

export function shouldRerenderHistory(history, renderedSignature) {
  return history.length > 0 && historySignature(history) !== renderedSignature;
}
