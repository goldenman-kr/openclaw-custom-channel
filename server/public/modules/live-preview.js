const TOOL_LABELS = new Map([
  ['bash', '명령'],
  ['exec', '명령'],
  ['exec_command', '명령'],
  ['shell', '명령'],
  ['read', '파일 읽기'],
  ['write', '파일 쓰기'],
  ['edit', '파일 수정'],
  ['apply_patch', '파일 수정'],
  ['web_search', '검색'],
  ['web_fetch', '자료 확인'],
]);

function textValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toolLabel(name) {
  const normalized = textValue(name).toLowerCase();
  if (!normalized) {
    return '작업';
  }
  return TOOL_LABELS.get(normalized) || textValue(name) || '작업';
}

function phaseValue(value) {
  return textValue(value).toLowerCase();
}

function isStartPhase(phase) {
  return phase === 'start' || phase === 'started' || phase === 'running';
}

function isDonePhase(phase) {
  return phase === 'end' || phase === 'completed' || phase === 'result' || phase === 'finished';
}

function isErrorPhase(phase, data) {
  return phase === 'error' || data?.isError === true || textValue(data?.status).toLowerCase() === 'failed';
}

function itemKind(data) {
  return textValue(data?.kind || data?.type).toLowerCase();
}

function previewTextForItem(stream, data) {
  const phase = phaseValue(data?.phase);
  const kind = itemKind(data);
  const name = data?.name || data?.title;
  const label = toolLabel(name);

  if (stream === 'codex_app_server.item') {
    if (kind === 'agentmessage') {
      if (isStartPhase(phase)) {
        return '답변을 정리하는 중입니다…';
      }
      if (isDonePhase(phase)) {
        return '답변 정리를 마쳤습니다…';
      }
    }
    if (kind === 'commandexecution') {
      if (isStartPhase(phase)) {
        return '명령을 실행하는 중입니다…';
      }
      if (isDonePhase(phase)) {
        return '명령 실행을 마쳤습니다…';
      }
    }
    return null;
  }

  if (kind === 'command') {
    if (isErrorPhase(phase, data)) {
      return `${label} 실행에 문제가 생겼습니다…`;
    }
    if (isStartPhase(phase)) {
      return `${label} 실행 중입니다…`;
    }
    if (isDonePhase(phase)) {
      return `${label} 실행을 마쳤습니다…`;
    }
  }

  return null;
}

function previewTextForTool(data) {
  const phase = phaseValue(data?.phase);
  const label = toolLabel(data?.name || data?.toolName || data?.title);
  if (isErrorPhase(phase, data)) {
    return `${label} 처리에 문제가 생겼습니다…`;
  }
  if (isStartPhase(phase)) {
    return `${label} 처리 중입니다…`;
  }
  if (isDonePhase(phase)) {
    return `${label} 처리를 마쳤습니다…`;
  }
  return null;
}

function previewTextForLifecycle(stream, data) {
  const phase = phaseValue(data?.phase);
  if (stream === 'lifecycle' && phase === 'start') {
    return '응답 생성을 시작했습니다…';
  }
  if (stream === 'codex_app_server.lifecycle') {
    if (phase === 'startup') {
      return 'OpenClaw 세션을 준비하는 중입니다…';
    }
    if (phase === 'thread_ready') {
      return '작업 세션을 준비했습니다…';
    }
    if (phase === 'turn_starting') {
      return '요청 처리를 시작하는 중입니다…';
    }
  }
  return null;
}

export function formatAgentLivePreview(event) {
  const stream = textValue(event?.stream);
  const data = event?.data && typeof event.data === 'object' ? event.data : {};

  if (stream === 'assistant' || stream === 'chat') {
    return null;
  }

  const text = stream === 'tool'
    ? previewTextForTool(data)
    : previewTextForItem(stream, data) || previewTextForLifecycle(stream, data);

  return text ? { text, stream } : null;
}
