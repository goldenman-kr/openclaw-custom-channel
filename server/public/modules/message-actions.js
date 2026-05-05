export function ensureMessageActions(node) {
  let actions = node.querySelector(':scope > .message-actions');
  if (!actions) {
    actions = document.createElement('div');
    actions.className = 'message-actions';
    node.append(actions);
  }
  return actions;
}

export function createCopyButton(copyText, onCopy) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'message-copy-button';
  button.setAttribute('aria-label', '메시지 원문 복사');
  button.title = '메시지 원문 복사';
  button.innerHTML = '<svg class="message-copy-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 7.5V5.75A2.75 2.75 0 0 1 10.75 3h6.5A2.75 2.75 0 0 1 20 5.75v8.5A2.75 2.75 0 0 1 17.25 17H15.5"/><path d="M3.75 7h7.5A2.75 2.75 0 0 1 14 9.75v8.5A2.75 2.75 0 0 1 11.25 21h-7.5A2.75 2.75 0 0 1 1 18.25v-8.5A2.75 2.75 0 0 1 3.75 7Z"/></svg>';
  button.addEventListener('click', async () => {
    try {
      await onCopy(copyText);
      button.classList.add('copied');
      window.setTimeout(() => { button.classList.remove('copied'); }, 900);
    } catch {
      button.classList.add('copy-failed');
      window.setTimeout(() => { button.classList.remove('copy-failed'); }, 900);
    }
  });
  return button;
}

export function createRetryButton(onRetry) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'message-action-button';
  button.textContent = '다시 시도';
  button.addEventListener('click', onRetry);
  return button;
}

export function createCancelJobButton(onCancel) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'message-cancel-button';
  button.title = '이 응답 작업 중지';
  button.setAttribute('aria-label', '이 응답 작업 중지');
  button.addEventListener('click', onCancel);
  return button;
}

export function setCancelJobButtonBusy(button, busy) {
  button.disabled = busy;
  button.setAttribute('aria-label', busy ? '응답 작업 중지 중' : '이 응답 작업 중지');
}

export function isPendingAssistantJobMessage({ role, text, pending, jobId }) {
  const normalizedRole = String(role || '').split(/\s+/)[0];
  const rawText = typeof text === 'string' ? text.trim() : '';
  const looksPending = pending || rawText === '응답 대기 중입니다…' || rawText === '응답을 처리 중입니다…' || /^응답을 처리 중입니다\s*\(\d+초\)$/.test(rawText);
  return looksPending && normalizedRole === 'assistant' && String(jobId || '').startsWith('job_');
}

export function mergeMediaRefs(primaryRefs = [], fallbackRefs = [], keyForRef = (ref) => ref) {
  const mediaRefs = [];
  const seenMediaRefs = new Set();
  for (const ref of [...primaryRefs, ...fallbackRefs]) {
    const refPath = typeof ref === 'string' ? ref : ref?.path;
    const refKey = keyForRef(refPath);
    if (!refKey || seenMediaRefs.has(refKey)) {
      continue;
    }
    seenMediaRefs.add(refKey);
    mediaRefs.push(ref);
  }
  return mediaRefs;
}
