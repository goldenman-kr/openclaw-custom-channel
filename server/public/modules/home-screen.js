export function createHomeScreen({ canUseApi, showingArchived, onOpenSettings, onStartNewConversation }) {
  const home = document.createElement('section');
  home.className = 'home-screen';

  const title = document.createElement('h1');
  title.textContent = 'OpenClaw Web Channel';

  const description = document.createElement('p');
  if (!canUseApi) {
    description.textContent = '로그인 후 대화를 시작할 수 있습니다.';
    const settingsButton = document.createElement('button');
    settingsButton.type = 'button';
    settingsButton.textContent = '설정 열기';
    settingsButton.addEventListener('click', (event) => {
      event.stopPropagation();
      onOpenSettings();
    });
    home.append(title, description, settingsButton);
    return home;
  }

  description.textContent = showingArchived
    ? '보관함입니다. 보관된 대화를 선택해 읽거나, 메뉴에서 아카이브를 해제할 수 있습니다.'
    : '새 대화를 열어 대화를 시작하거나, 목록에서 기존 대화를 선택하세요.';
  const newButton = document.createElement('button');
  newButton.type = 'button';
  newButton.textContent = '새 대화 시작';
  newButton.addEventListener('click', onStartNewConversation);
  home.append(title, description, newButton);
  return home;
}
