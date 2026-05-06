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
    pin.innerHTML = `
      <svg viewBox="0 0 156 156" aria-hidden="true" focusable="false">
        <path d="M90 0 L84 1 L76 12 L69 27 L69 38 L47 60 L26 64 L18 67 L17 73 L46 102 L0 148 L6 155 L53 109 L82 138 L88 137 L91 129 L95 108 L117 86 L127 86 L136 82 L139 82 L140 80 L154 71 L155 65 Z M88 13 L142 67 L128 75 L125 74 L126 75 L125 76 L120 76 L118 74 L113 75 L86 102 L83 118 L81 122 L33 74 L37 72 L53 69 L80 42 L81 37 L79 35 L79 30 Z" fill="currentColor" fill-rule="evenodd" />
      </svg>
    `;
    menuWrap.append(pin);
  }
  menuWrap.append(createConversationMenuButton(conversation, deps), createConversationMenu(conversation, deps));
  return menuWrap;
}

export function createConversationListItem(conversation, deps) {
  const menuOpen = deps.openMenuId === conversation.id;
  const unread = Boolean(deps.isUnread?.(conversation.id)) && conversation.id !== deps.activeId;
  const item = document.createElement('div');
  item.className = `conversation-item${conversation.id === deps.activeId ? ' active' : ''}${menuOpen ? ' menu-open' : ''}${unread ? ' has-unread' : ''}`;
  item.dataset.conversationId = conversation.id;
  item.append(createConversationSelectButton(conversation, deps), createConversationMenuWrap(conversation, deps));
  return item;
}
