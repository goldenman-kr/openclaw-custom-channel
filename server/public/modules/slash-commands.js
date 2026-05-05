export const SLASH_COMMANDS = [
  { command: '/status', title: '상태 확인', description: '현재 세션/모델/토큰/설정 상태를 확인합니다.' },
  { command: '/model ', title: '모델 변경', description: '모델을 지정합니다. 예: /model gpt-5.5' },
  { command: '/think ', title: 'thinking 변경', description: '현재 채팅의 thinking 레벨을 지정합니다. 예: /think high' },
  { command: '/models', title: '모델 목록', description: '사용 가능한 모델 목록을 봅니다.' },
  { command: '/reset', title: '대화 초기화', description: '현재 대화 맥락을 초기화합니다.' },
  { command: '/reasoning', title: '추론 표시 전환', description: 'reasoning 설정을 켜거나 끕니다.' },
  { command: '/help', title: '도움말', description: 'OpenClaw 명령 도움말을 표시합니다.' },
  { command: '/weather', title: '현재 위치 날씨', description: '현재 위치 기준 날씨를 확인합니다.' },
  { command: '/memory', title: '메모리', description: '메모리 관련 명령을 확인하거나 실행합니다.' },
  { command: '/tasks', title: '작업 목록', description: 'TaskFlow/작업 상태를 확인합니다.' },
];

export function slashCommandQuery(value, cursor = value.length) {
  if (cursor !== value.length || !value.startsWith('/')) {
    return null;
  }
  if (value.includes('\n')) {
    return null;
  }
  return value.slice(1).trim().toLowerCase();
}

export function matchingSlashCommands(value, cursor = value.length, commands = SLASH_COMMANDS) {
  const query = slashCommandQuery(value, cursor);
  if (query === null) {
    return [];
  }
  return commands.filter((item) => {
    const haystack = `${item.command} ${item.title} ${item.description}`.toLowerCase();
    return haystack.includes(query);
  });
}

export function clampSlashCommandIndex(index, length) {
  return Math.max(0, Math.min(index, Math.max(0, length - 1)));
}

export function renderSlashCommandPalette(palette, matches, selectedIndex, onSelect) {
  palette.replaceChildren();

  if (matches.length === 0) {
    palette.classList.add('hidden');
    return selectedIndex;
  }

  const nextSelectedIndex = clampSlashCommandIndex(selectedIndex, matches.length);
  for (const [index, item] of matches.entries()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `slash-command-item${index === nextSelectedIndex ? ' selected' : ''}`;
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', index === nextSelectedIndex ? 'true' : 'false');
    button.addEventListener('click', () => onSelect(item.command));

    const command = document.createElement('strong');
    command.textContent = item.command.trim();
    const text = document.createElement('span');
    text.textContent = `${item.title} · ${item.description}`;
    button.append(command, text);
    palette.append(button);
  }

  palette.classList.remove('hidden');
  return nextSelectedIndex;
}
