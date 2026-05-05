function createConversationSelectButton(conversation, deps) {
  const selectButton = document.createElement('button');
  selectButton.type = 'button';
  selectButton.className = 'conversation-select-button';
  selectButton.addEventListener('click', () => deps.onSelect(conversation.id));

  const title = document.createElement('span');
  title.className = 'conversation-title';
  title.textContent = deps.conversationTitle(conversation);

  const meta = document.createElement('span');
  meta.className = 'conversation-meta';
  meta.textContent = deps.formatConversationDate(conversation.updated_at || conversation.created_at);

  selectButton.append(title, meta);
  return selectButton;
}

function createConversationMenuButton(conversation, deps) {
  const menuButton = document.createElement('button');
  menuButton.type = 'button';
  menuButton.className = 'conversation-menu-button ghost-button';
  menuButton.setAttribute('aria-label', `${deps.conversationTitle(conversation)} 메뉴`);
  menuButton.setAttribute('aria-expanded', deps.openMenuId === conversation.id ? 'true' : 'false');
  menuButton.textContent = '⋯';
  menuButton.addEventListener('click', (event) => {
    event.stopPropagation();
    deps.onToggleMenu(conversation.id);
  });
  return menuButton;
}

function createConversationMenuAction(label, action, options = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  if (options.danger) {
    button.className = 'danger-menu-item';
  }
  button.addEventListener('click', async (event) => {
    event.stopPropagation();
    await action();
  });
  return button;
}

function createConversationMenu(conversation, deps) {
  const menu = document.createElement('div');
  menu.className = `conversation-menu${deps.openMenuId === conversation.id ? '' : ' hidden'}`;
  menu.append(
    createConversationMenuAction(conversation.pinned ? '상단고정 해제' : '상단고정', () => deps.onTogglePinned(conversation.id)),
    createConversationMenuAction(deps.isArchived(conversation) ? '아카이브 해제' : '아카이브', () => deps.onToggleArchived(conversation.id)),
    createConversationMenuAction('이름 변경', () => deps.onRename(conversation.id)),
    createConversationMenuAction('삭제', () => deps.onDelete(conversation.id), { danger: true }),
  );
  return menu;
}

function createConversationMenuWrap(conversation, deps) {
  const menuWrap = document.createElement('div');
  menuWrap.className = 'conversation-menu-wrap';
  if (conversation.pinned) {
    const pin = document.createElement('span');
    pin.className = 'conversation-pin-icon';
    pin.setAttribute('aria-label', '상단 고정됨');
    pin.textContent = '📌';
    menuWrap.append(pin);
  }
  menuWrap.append(createConversationMenuButton(conversation, deps), createConversationMenu(conversation, deps));
  return menuWrap;
}

export function createConversationListItem(conversation, deps) {
  const menuOpen = deps.openMenuId === conversation.id;
  const item = document.createElement('div');
  item.className = `conversation-item${conversation.id === deps.activeId ? ' active' : ''}${menuOpen ? ' menu-open' : ''}`;
  item.dataset.conversationId = conversation.id;
  item.append(createConversationSelectButton(conversation, deps), createConversationMenuWrap(conversation, deps));
  return item;
}
