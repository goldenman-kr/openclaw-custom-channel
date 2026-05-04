import { MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, ALLOWED_ATTACHMENT_TYPES, formatBytes, inferAttachmentMimeType } from './modules/attachments.js';
import { conversationTitle, formatConversationDate, formatMessageTimestamp } from './modules/conversation-format.js';
import { applyDisplaySettings as applyDisplaySettingsToElements, applyTheme, syncNativeTheme } from './modules/display.js';
import { canonicalMediaRefKey, isImageRef, isPlaceholderMediaRef, normalizeMediaRefPath, shortenFileName } from './modules/media.js';
import { loadSettings, normalizeHistoryPageSize, randomDeviceId, saveSettings } from './modules/settings.js';
import { applyStoredSidebarWidth, clampSidebarWidth, saveSidebarWidth, SIDEBAR_RESIZE_MEDIA } from './modules/sidebar-width.js';
import { renderCodeBlockPlugin } from './plugins/plugin-registry.js';
import './plugins/spot-order-card.js';
import './plugins/spot-wallet-intent.js';

const PENDING_JOB_KEY = 'openclaw-web-channel-pending-job-v1';
const COMPOSER_DRAFT_KEY_PREFIX = 'openclaw-web-channel-composer-draft-v1';
const CLIENT_ASSET_VERSION = 'pwa-client-2026-05-04-045';
const CLIENT_API_VERSION = 1;
const VERSION_CHECK_DISMISSED_KEY = 'openclaw-web-channel-version-dismissed-v1';
const elements = {
  loginScreen: document.querySelector('#loginScreen'),
  loginForm: document.querySelector('#loginForm'),
  loginUsernameInput: document.querySelector('#loginUsernameInput'),
  loginPasswordInput: document.querySelector('#loginPasswordInput'),
  loginSubmitButton: document.querySelector('#loginSubmitButton'),
  loginStatusText: document.querySelector('#loginStatusText'),
  logoutButton: document.querySelector('#logoutButton'),
  settingsButton: document.querySelector('#settingsButton'),
  chatPanel: document.querySelector('.chat-panel'),
  floatingActionMenu: document.querySelector('#floatingActionMenu'),
  floatingActionPanel: document.querySelector('#floatingActionPanel'),
  floatingActionToggle: document.querySelector('#floatingActionToggle'),
  floatingSettingsButton: document.querySelector('#floatingSettingsButton'),
  floatingRefreshButton: document.querySelector('#floatingRefreshButton'),
  floatingScrollTopButton: document.querySelector('#floatingScrollTopButton'),
  floatingScrollBottomButton: document.querySelector('#floatingScrollBottomButton'),
  continueNewSessionButton: document.querySelector('#continueNewSessionButton'),
  scrollToLatestButton: document.querySelector('#scrollToLatestButton'),
  sidebarSettingsButton: document.querySelector('#sidebarSettingsButton'),
  archiveToggleButton: document.querySelector('#archiveToggleButton'),
  mobileMenuButton: document.querySelector('#mobileMenuButton'),
  modelPickerButton: document.querySelector('#modelPickerButton'),
  modelPickerPanel: document.querySelector('#modelPickerPanel'),
  modelPickerStatus: document.querySelector('#modelPickerStatus'),
  modelPickerList: document.querySelector('#modelPickerList'),
  chatTitle: document.querySelector('#chatTitle'),
  mobileDrawerBackdrop: document.querySelector('#mobileDrawerBackdrop'),
  conversationSidebar: document.querySelector('#conversationSidebar'),
  sidebarResizeHandle: document.querySelector('#sidebarResizeHandle'),
  newConversationButton: document.querySelector('#newConversationButton'),
  sidebarOwnerTitle: document.querySelector('#sidebarOwnerTitle'),
  sidebarConversationCount: document.querySelector('#sidebarConversationCount'),
  conversationList: document.querySelector('#conversationList'),
  conversationSearchInput: document.querySelector('#conversationSearchInput'),
  clearConversationSearchButton: document.querySelector('#clearConversationSearchButton'),
  conversationRenameDialog: document.querySelector('#conversationRenameDialog'),
  conversationRenameInput: document.querySelector('#conversationRenameInput'),
  conversationRenameCancel: document.querySelector('#conversationRenameCancel'),
  conversationRenameConfirm: document.querySelector('#conversationRenameConfirm'),
  conversationDeleteDialog: document.querySelector('#conversationDeleteDialog'),
  conversationDeleteText: document.querySelector('#conversationDeleteText'),
  conversationDeleteCancel: document.querySelector('#conversationDeleteCancel'),
  conversationDeleteConfirm: document.querySelector('#conversationDeleteConfirm'),
  settingsPanel: document.querySelector('#settingsPanel'),
  apiUrlInput: document.querySelector('#apiUrlInput'),
  apiKeyInput: document.querySelector('#apiKeyInput'),
  deviceIdInput: document.querySelector('#deviceIdInput'),
  themeModeInput: document.querySelector('#themeModeInput'),
  autoLocationOnHereInput: document.querySelector('#autoLocationOnHereInput'),
  fontSizeInput: document.querySelector('#fontSizeInput'),
  fontSizeValue: document.querySelector('#fontSizeValue'),
  historyPageSizeInput: document.querySelector('#historyPageSizeInput'),
  saveSettingsButton: document.querySelector('#saveSettingsButton'),
  healthCheckButton: document.querySelector('#healthCheckButton'),
  resetPasswordButton: document.querySelector('#resetPasswordButton'),
  refreshAppButton: document.querySelector('#refreshAppButton'),
  clearCacheButton: document.querySelector('#clearCacheButton'),
  notificationButton: document.querySelector('#notificationButton'),
  clearHistoryButton: document.querySelector('#clearHistoryButton'),
  messages: document.querySelector('#messages'),
  messagesScrollIndicator: document.querySelector('#messagesScrollIndicator'),
  messageForm: document.querySelector('#messageForm'),
  messageInput: document.querySelector('#messageInput'),
  clearMessageInputButton: document.querySelector('#clearMessageInputButton'),
  includeLocationInput: document.querySelector('#includeLocationInput'),
  attachmentInput: document.querySelector('#attachmentInput'),
  attachButton: document.querySelector('#attachButton'),
  attachmentTray: document.querySelector('#attachmentTray'),
  slashCommandPalette: document.querySelector('#slashCommandPalette'),
  mediaViewer: document.querySelector('#mediaViewer'),
  mediaViewerImage: document.querySelector('#mediaViewerImage'),
  mediaViewerDownload: document.querySelector('#mediaViewerDownload'),
  mediaViewerClose: document.querySelector('#mediaViewerClose'),
  sendButton: document.querySelector('#sendButton'),
  statusText: document.querySelector('#statusText'),
};

function isMobileLikeInput() {
  return window.matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function slashCommandUsesCurrentLocation(message) {
  const trimmed = message.trimStart();
  const [command, ...args] = trimmed.split(/\s+/);
  if (!['/weather', '/route'].includes((command || '').toLowerCase())) {
    return false;
  }
  return args.join(' ').includes('여기');
}

applyStoredSidebarWidth();

let settings = loadSettings();
let historyPollTimer = null;
let versionCheckTimer = null;
let conversationEventSource = null;
let conversationEventConversationId = '';
let conversationEventRefreshTimer = null;
let modelPickerExpanded = false;
let modelPickerLoading = false;
let modelPickerState = null;
const streamingIdleTimers = new Map();
const streamingTextByJob = new Map();
const MIN_STREAMING_CHECKPOINT_CHARS = 12;
let isSendingMessage = false;
let selectedAttachments = [];
let composerDragDepth = 0;
let lastHistoryVersion = null;
let activeHistoryLimit = normalizeHistoryPageSize(settings.historyPageSize);
let lastHistoryHasMore = false;
let loadingOlderHistory = false;
let activeConversation = null;
let openConversationMenuId = null;
let floatingActionsExpanded = false;
let conversations = [];
let showingArchived = false;
let mediaViewerCurrentUrl = '';
let mediaViewerCurrentName = 'openclaw-image.png';
let mediaViewerTransform = { scale: 1, x: 0, y: 0 };
const mediaViewerPointers = new Map();
let mediaViewerGestureStart = null;
let mediaViewerHistoryActive = false;
let messagesScrollIndicatorTimer = null;
let drawerSwipeStart = null;
const mediaUrlCache = new Map();
const MEDIA_URL_CACHE_LIMIT = 64;
const slashCommands = [
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
let selectedSlashCommandIndex = 0;
let conversationSearchQuery = '';
let conversationContentMatches = new Set();
let conversationSearchTimer = null;
let conversationSearchRunId = 0;
let sidebarResizeState = null;
const conversationSearchCache = new Map();
let settingsPanelHistoryActive = false;
let mobileDrawerHistoryActive = false;
let authUser = null;

function conversationIdFromPath(pathname = window.location.pathname) {
  const match = pathname.match(/^\/chat\/([^/?#]+)/);
  if (!match) {
    return '';
  }
  try {
    return decodeURIComponent(match[1]) || '';
  } catch {
    return '';
  }
}

function conversationPath(conversationId) {
  return `/chat/${encodeURIComponent(conversationId)}`;
}

function syncConversationUrl(conversationId, options = {}) {
  if (!window.history?.pushState || !window.history?.replaceState) {
    return;
  }
  const targetPath = conversationId ? conversationPath(conversationId) : '/';
  const currentPath = window.location.pathname || '/';
  if (currentPath === targetPath) {
    return;
  }
  const url = new URL(window.location.href);
  url.pathname = targetPath;
  url.search = '';
  url.hash = '';
  const method = options.replace ? 'replaceState' : 'pushState';
  window.history[method]({ conversationId: conversationId || '' }, '', url);
}


window.matchMedia?.('(prefers-color-scheme: light)').addEventListener?.('change', () => {
  if (!['light', 'dark'].includes(settings.themeMode)) {
    syncNativeTheme(settings.themeMode || 'system');
  }
});

function applyDisplaySettings() {
  applyDisplaySettingsToElements(settings, elements);
}

function applySettingsToForm() {
  if (elements.apiUrlInput) {
    elements.apiUrlInput.value = settings.apiUrl || window.location.origin;
  }
  if (elements.apiKeyInput) {
    elements.apiKeyInput.value = settings.apiKey || '';
  }
  if (elements.deviceIdInput) {
    elements.deviceIdInput.value = settings.deviceId || randomDeviceId();
  }
  if (elements.themeModeInput) {
    elements.themeModeInput.value = settings.themeMode || 'dark';
  }
  if (elements.autoLocationOnHereInput) {
    elements.autoLocationOnHereInput.checked = settings.autoLocationOnHere !== false;
  }
  if (elements.historyPageSizeInput) {
    settings.historyPageSize = normalizeHistoryPageSize(settings.historyPageSize);
    elements.historyPageSizeInput.value = String(settings.historyPageSize);
  }
  updateNotificationButton();
  applyTheme(settings.themeMode || 'dark');
  applyDisplaySettings();
}

function notificationsSupported() {
  return 'Notification' in window;
}

function updateNotificationButton() {
  if (!elements.notificationButton) {
    return;
  }
  if (!notificationsSupported()) {
    elements.notificationButton.textContent = '알림 미지원';
    elements.notificationButton.disabled = true;
    return;
  }
  if (Notification.permission === 'granted' && settings.notificationsEnabled) {
    elements.notificationButton.textContent = '알림 켜짐';
    return;
  }
  if (Notification.permission === 'denied') {
    elements.notificationButton.textContent = '알림 차단됨';
    return;
  }
  elements.notificationButton.textContent = '알림 허용';
}

async function enableNotifications() {
  if (!notificationsSupported()) {
    appendMessage('system', '이 환경은 브라우저 알림을 지원하지 않습니다.', { persist: false });
    return;
  }
  const permission = await Notification.requestPermission();
  settings.notificationsEnabled = permission === 'granted';
  saveSettings(settings);
  updateNotificationButton();
  appendMessage('system', permission === 'granted' ? '응답 도착 알림을 켰습니다.' : '알림 권한이 허용되지 않았습니다.', { persist: false });
}

function notifyReplyReady(title = 'OpenClaw 응답 도착', body = '새 답변이 도착했습니다.') {
  if (!settings.notificationsEnabled || !notificationsSupported() || Notification.permission !== 'granted') {
    return;
  }
  if (!document.hidden && document.hasFocus()) {
    return;
  }
  try {
    const notification = new Notification(title, {
      body,
      tag: 'openclaw-reply-ready',
      renotify: true,
      silent: false,
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch {
    // Some WebView builds expose Notification but do not allow constructing it.
  }
}

function renderAttachmentTray() {
  elements.attachmentTray.replaceChildren();
  elements.attachmentTray.classList.toggle('hidden', selectedAttachments.length === 0);

  for (const [index, file] of selectedAttachments.entries()) {
    const item = document.createElement('div');
    item.className = 'attachment-chip';
    const label = document.createElement('span');
    label.textContent = `${file.name} · ${formatBytes(file.size)}`;
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'attachment-remove';
    removeButton.setAttribute('aria-label', `${file.name} 첨부 제거`);
    removeButton.textContent = '×';
    removeButton.addEventListener('click', () => {
      selectedAttachments = selectedAttachments.filter((_, itemIndex) => itemIndex !== index);
      renderAttachmentTray();
    });
    item.append(label, removeButton);
    elements.attachmentTray.append(item);
  }
}

function validateAttachmentFile(file) {
  const mimeType = inferAttachmentMimeType(file.name, file.type);
  if (!ALLOWED_ATTACHMENT_TYPES.has(mimeType)) {
    throw new Error(`${file.name}: 지원하지 않는 파일 형식입니다.`);
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`${file.name}: 파일은 ${formatBytes(MAX_ATTACHMENT_BYTES)} 이하만 첨부할 수 있습니다.`);
  }
}

function addAttachmentFiles(files) {
  const nextFiles = [...selectedAttachments];
  for (const file of files) {
    validateAttachmentFile(file);
    if (nextFiles.length >= MAX_ATTACHMENTS) {
      throw new Error(`첨부 파일은 최대 ${MAX_ATTACHMENTS}개까지 가능합니다.`);
    }
    nextFiles.push(file);
  }
  selectedAttachments = nextFiles;
  renderAttachmentTray();
}

function addAttachmentFilesSafely(files, sourceLabel = '첨부') {
  const fileList = Array.from(files || []).filter(Boolean);
  if (fileList.length === 0) {
    return false;
  }
  if (isSendingMessage) {
    appendMessage('system', '응답 전송 중에는 첨부 파일을 추가할 수 없습니다.', { persist: false });
    return true;
  }
  if (!activeConversation?.id) {
    appendMessage('system', '새 대화를 열거나 목록에서 대화를 선택한 뒤 파일을 첨부해주세요.', { persist: false });
    return true;
  }
  if (isConversationArchived(activeConversation)) {
    appendMessage('system', '보관된 대화에는 파일을 첨부할 수 없습니다. 대화를 이어가려면 아카이브를 해제하세요.', { persist: false });
    return true;
  }
  try {
    addAttachmentFiles(fileList);
    setStatus(`${sourceLabel}: ${fileList.length}개 파일을 첨부했습니다.`);
  } catch (error) {
    appendMessage('system', error instanceof Error ? error.message : String(error), { persist: false });
  }
  return true;
}

function filesFromDataTransfer(dataTransfer) {
  if (!dataTransfer) {
    return [];
  }
  const itemFiles = Array.from(dataTransfer.items || [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter(Boolean);
  if (itemFiles.length > 0) {
    return itemFiles;
  }
  return Array.from(dataTransfer.files || []);
}

function handleMessagePaste(event) {
  const files = filesFromDataTransfer(event.clipboardData);
  if (files.length === 0) {
    return;
  }
  event.preventDefault();
  addAttachmentFilesSafely(files, '붙여넣기');
}

function setComposerDragOver(active) {
  elements.messageForm.classList.toggle('drag-over', active);
}

function resetComposerDragState() {
  composerDragDepth = 0;
  setComposerDragOver(false);
}

function hasDraggedFiles(event) {
  return Array.from(event.dataTransfer?.types || []).includes('Files');
}

function handleComposerDragEnter(event) {
  if (!hasDraggedFiles(event)) {
    return;
  }
  event.preventDefault();
  composerDragDepth += 1;
  setComposerDragOver(true);
}

function handleComposerDragOver(event) {
  if (!hasDraggedFiles(event)) {
    return;
  }
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy';
  }
  setComposerDragOver(true);
}

function handleComposerDragLeave(event) {
  if (!hasDraggedFiles(event)) {
    return;
  }
  composerDragDepth = Math.max(0, composerDragDepth - 1);
  if (composerDragDepth === 0) {
    setComposerDragOver(false);
  }
}

function handleComposerDrop(event) {
  if (!hasDraggedFiles(event)) {
    return;
  }
  event.preventDefault();
  resetComposerDragState();
  addAttachmentFilesSafely(filesFromDataTransfer(event.dataTransfer), '드래그 앤 드롭');
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      const result = String(reader.result || '');
      resolve(result.includes(',') ? result.split(',').pop() : result);
    });
    reader.addEventListener('error', () => reject(reader.error || new Error('파일을 읽지 못했습니다.')));
    reader.readAsDataURL(file);
  });
}

async function buildAttachmentsPayload() {
  return Promise.all(
    selectedAttachments.map(async (file) => {
      const mimeType = inferAttachmentMimeType(file.name, file.type);
      return {
        type: mimeType.startsWith('image/') ? 'image' : 'file',
        name: file.name,
        mime_type: mimeType,
        content_base64: await fileToBase64(file),
      };
    }),
  );
}

function attachmentSummary(files = selectedAttachments) {
  if (files.length === 0) {
    return '';
  }
  return `\n\n첨부 파일:\n${files.map((file) => `- ${file.name} (${inferAttachmentMimeType(file.name, file.type) || 'unknown'}, ${formatBytes(file.size)})`).join('\n')}`;
}

function normalizeApiKey(value) {
  return value.trim().replace(/[\s\u200B-\u200D\uFEFF]/g, '');
}

function assertValidApiKey(apiKey) {
  if (!apiKey) {
    return;
  }
  if (!/^[A-Za-z0-9._~+-]+$/.test(apiKey)) {
    throw new Error('API Key에 사용할 수 없는 문자가 포함되어 있습니다. 키만 다시 복사해서 붙여넣어 주세요.');
  }
}

function readSettingsFromForm() {
  const apiUrl = elements.apiUrlInput?.value.trim().replace(/\/+$/, '') || window.location.origin;
  const apiKey = elements.apiKeyInput ? normalizeApiKey(elements.apiKeyInput.value) : settings.apiKey;
  const deviceId = elements.deviceIdInput?.value.trim() || settings.deviceId || randomDeviceId();
  const themeMode = elements.themeModeInput?.value || settings.themeMode || 'dark';
  const fontSize = normalizeFontSize(elements.fontSizeInput?.value || settings.fontSize);
  const autoLocationOnHere = elements.autoLocationOnHereInput ? elements.autoLocationOnHereInput.checked : settings.autoLocationOnHere !== false;
  const historyPageSize = normalizeHistoryPageSize(elements.historyPageSizeInput?.value || settings.historyPageSize);
  return { ...settings, apiUrl, apiKey, deviceId, themeMode, fontSize, autoLocationOnHere, historyPageSize };
}

function setStatus(message) {
  elements.statusText.textContent = message || '';
}

function showToast(message, options = {}) {
  const container = document.querySelector('.toast-stack') || (() => {
    const node = document.createElement('div');
    node.className = 'toast-stack';
    node.setAttribute('aria-live', 'polite');
    node.setAttribute('aria-atomic', 'true');
    document.body.append(node);
    return node;
  })();
  const toast = document.createElement('div');
  toast.className = `toast toast--${options.kind || 'info'}`;
  toast.textContent = message;
  container.append(toast);
  window.setTimeout(() => toast.classList.add('toast--visible'), 20);
  window.setTimeout(() => {
    toast.classList.remove('toast--visible');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    window.setTimeout(() => toast.remove(), 500);
  }, options.durationMs || 2400);
}

function showVersionMismatchAlert(reason, details = {}) {
  const latestVersion = details.latestVersion || details.minVersion || 'unknown';
  const currentVersion = details.currentVersion || CLIENT_ASSET_VERSION;
  const dismissKey = `${reason}:${currentVersion}:${latestVersion}`;
  if (localStorage.getItem(VERSION_CHECK_DISMISSED_KEY) === dismissKey || document.querySelector('.version-alert')) {
    return;
  }

  const isApiMismatch = reason === 'api';
  const alert = document.createElement('section');
  alert.className = 'version-alert';
  alert.setAttribute('role', 'alert');
  alert.innerHTML = `
    <div class="version-alert__text">
      <strong>${isApiMismatch ? '웹앱 호환성 업데이트가 필요합니다.' : '웹앱 업데이트가 필요합니다.'}</strong>
      <span>${isApiMismatch ? '서버 API와 현재 웹앱이 호환되지 않습니다. 강력 새로고침 후에도 반복되면 서버 재시작이 필요합니다.' : '새 웹앱 파일이 배포되었습니다. 강력 새로고침을 하면 적용됩니다.'}</span>
    </div>
    <div class="version-alert__actions">
      <button class="ghost-button version-alert__dismiss" type="button">나중에</button>
      <button class="version-alert__refresh" type="button">강력 새로고침</button>
    </div>
  `;
  alert.querySelector('.version-alert__refresh')?.addEventListener('click', () => clearAppCacheAndReload());
  alert.querySelector('.version-alert__dismiss')?.addEventListener('click', () => {
    localStorage.setItem(VERSION_CHECK_DISMISSED_KEY, dismissKey);
    alert.remove();
  });
  document.body.append(alert);
}

async function checkClientAssetVersion() {
  try {
    const response = await fetch(`${settings.apiUrl}/client-version.json?ts=${Date.now()}`, {
      cache: 'no-store',
    });
    if (!response.ok) {
      return;
    }
    const body = await response.json();
    const latestAssetVersion = String(body?.client_asset_version || '');
    if (latestAssetVersion && latestAssetVersion !== CLIENT_ASSET_VERSION) {
      showVersionMismatchAlert('asset', {
        currentVersion: CLIENT_ASSET_VERSION,
        latestVersion: latestAssetVersion,
      });
    }
  } catch {
    // Version checks are best-effort only.
  }
}

async function checkServerApiCompatibility() {
  try {
    const response = await fetch(`${settings.apiUrl}/v1/version`, {
      cache: 'no-store',
      headers: await apiHeaders(),
    });
    if (!response.ok) {
      return;
    }
    const body = await response.json();
    const minClientApiVersion = Number(body?.min_client_api_version || 1);
    if (Number.isFinite(minClientApiVersion) && CLIENT_API_VERSION < minClientApiVersion) {
      showVersionMismatchAlert('api', {
        currentVersion: String(CLIENT_API_VERSION),
        minVersion: String(minClientApiVersion),
      });
    }
  } catch {
    // Version checks are best-effort only.
  }
}

async function checkClientServerVersion() {
  await checkClientAssetVersion();
  await checkServerApiCompatibility();
}

function isNearBottom(threshold = 120) {
  return elements.messages.scrollHeight - elements.messages.scrollTop - elements.messages.clientHeight < threshold;
}

function showScrollToLatestButton() {
  elements.scrollToLatestButton?.classList.remove('hidden');
}

function hideScrollToLatestButton() {
  elements.scrollToLatestButton?.classList.add('hidden');
}

function updateMessagesScrollIndicator() {
  const indicator = elements.messagesScrollIndicator;
  if (!indicator) {
    return;
  }
  const { scrollHeight, clientHeight, scrollTop } = elements.messages;
  if (scrollHeight <= clientHeight + 1) {
    indicator.classList.remove('visible');
    return;
  }
  const trackHeight = clientHeight;
  const thumbHeight = clamp((clientHeight / scrollHeight) * trackHeight, 36, Math.max(36, trackHeight));
  const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
  const maxScrollTop = Math.max(1, scrollHeight - clientHeight);
  const thumbTop = (scrollTop / maxScrollTop) * maxThumbTop;
  const messagesRect = elements.messages.getBoundingClientRect();
  indicator.style.top = `${messagesRect.top}px`;
  indicator.style.height = `${thumbHeight}px`;
  indicator.style.transform = `translateY(${thumbTop}px)`;
  indicator.classList.add('visible');
}

function hideMessagesScrollIndicatorSoon() {
  window.clearTimeout(messagesScrollIndicatorTimer);
  messagesScrollIndicatorTimer = window.setTimeout(() => {
    elements.messages.classList.remove('is-scrolling');
    elements.messagesScrollIndicator?.classList.remove('visible');
  }, 800);
}

function scrollToBottom(options = {}) {
  const { force = false, autoScroll = true, smooth = false } = options;
  if (!autoScroll) {
    return;
  }
  if (!force && !isNearBottom()) {
    showScrollToLatestButton();
    return;
  }
  requestAnimationFrame(() => {
    elements.messages.scrollTo({ top: elements.messages.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    hideScrollToLatestButton();
  });
}

function preserveScrollAfterRender(previousBottomOffset) {
  const restore = () => {
    elements.messages.scrollTop = Math.max(0, elements.messages.scrollHeight - previousBottomOffset);
  };
  restore();
  requestAnimationFrame(restore);
  window.setTimeout(restore, 80);
  window.setTimeout(restore, 250);
}

function isDesktopLayout() {
  return window.matchMedia('(min-width: 900px)').matches;
}

function openMobileDrawer(options = {}) {
  if (isDesktopLayout()) {
    return;
  }
  const wasOpen = document.body.classList.contains('drawer-open');
  document.body.classList.add('drawer-open');
  elements.mobileMenuButton?.setAttribute('aria-expanded', 'true');
  if (!wasOpen && options.pushHistory !== false && window.history?.pushState) {
    window.history.pushState({ ...(window.history.state || {}), mobileDrawerOpen: true }, '', window.location.href);
    mobileDrawerHistoryActive = true;
  }
}

function closeMobileDrawer(options = {}) {
  const wasOpen = document.body.classList.contains('drawer-open');
  document.body.classList.remove('drawer-open');
  elements.mobileMenuButton?.setAttribute('aria-expanded', 'false');
  if (options.syncHistory && wasOpen && mobileDrawerHistoryActive && window.history?.back) {
    mobileDrawerHistoryActive = false;
    window.history.back();
    return;
  }
  if (wasOpen || options.syncHistory === false) {
    mobileDrawerHistoryActive = false;
  }
}

function toggleMobileDrawer() {
  if (isDesktopLayout()) {
    document.body.classList.toggle('sidebar-collapsed');
    elements.mobileMenuButton?.setAttribute('aria-expanded', document.body.classList.contains('sidebar-collapsed') ? 'false' : 'true');
    return;
  }
  if (document.body.classList.contains('drawer-open')) {
    closeMobileDrawer({ syncHistory: true });
  } else {
    openMobileDrawer();
  }
}

function shouldIgnoreDrawerSwipe(target) {
  return Boolean(target?.closest?.('input, textarea, button, a, select, dialog, .composer, .settings-panel, .media-viewer, .floating-action-menu, .markdown-table-wrapper, .code-block pre'));
}

function handleDrawerSwipeStart(event) {
  if (!isMobileLikeInput() || document.body.classList.contains('drawer-open') || !elements.mediaViewer.classList.contains('hidden')) {
    drawerSwipeStart = null;
    return;
  }
  const touch = event.touches?.[0];
  if (!touch || shouldIgnoreDrawerSwipe(event.target)) {
    drawerSwipeStart = null;
    return;
  }
  drawerSwipeStart = {
    x: touch.clientX,
    y: touch.clientY,
    time: Date.now(),
  };
}

function handleDrawerSwipeEnd(event) {
  if (!drawerSwipeStart) {
    return;
  }
  const touch = event.changedTouches?.[0];
  const start = drawerSwipeStart;
  drawerSwipeStart = null;
  if (!touch) {
    return;
  }
  const deltaX = touch.clientX - start.x;
  const deltaY = touch.clientY - start.y;
  const elapsed = Date.now() - start.time;
  if (Math.abs(deltaX) < 90 || Math.abs(deltaY) > 70 || elapsed > 800) {
    return;
  }
  event.preventDefault?.();
  if (deltaX > 0) {
    elements.mobileMenuButton?.click();
  } else {
    openSettingsPanel();
  }
}

async function hashText(text) {
  if (crypto.subtle) {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 24);
  }

  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (Math.imul(31, hash) + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

async function sharedUserId() {
  const baseId = `web-api-key-${await hashText(settings.apiKey || 'anonymous')}`;
  return settings.sessionNonce ? `${baseId}-${settings.sessionNonce}` : baseId;
}

function persistMessage() {
  // Server-side history is authoritative. This hook is intentionally kept as a no-op.
}

function currentMediaUrlsInUse() {
  const urls = new Set();
  if (mediaViewerCurrentUrl) {
    urls.add(mediaViewerCurrentUrl);
  }
  for (const node of elements.messages.querySelectorAll('[src^="blob:"], [href^="blob:"]')) {
    const url = node.getAttribute('src') || node.getAttribute('href');
    if (url) {
      urls.add(url);
    }
  }
  return urls;
}

function revokeCachedMediaUrl(ref, url) {
  if (mediaUrlCache.get(ref) !== url) {
    return;
  }
  mediaUrlCache.delete(ref);
  try {
    URL.revokeObjectURL(url);
  } catch {
    // ignore revoke failures
  }
}

function pruneMediaUrlCache(options = {}) {
  const limit = Number.isFinite(options.limit) ? Number(options.limit) : MEDIA_URL_CACHE_LIMIT;
  if (mediaUrlCache.size <= limit && !options.force) {
    return;
  }
  const inUse = currentMediaUrlsInUse();
  for (const [ref, url] of mediaUrlCache) {
    if (!options.force && mediaUrlCache.size <= limit) {
      break;
    }
    if (inUse.has(url)) {
      continue;
    }
    revokeCachedMediaUrl(ref, url);
  }
}

function clearRenderedMessages() {
  elements.messages.replaceChildren();
  pruneMediaUrlCache();
}

async function historyHeaders() {
  assertValidApiKey(settings.apiKey);
  return {
    ...(settings.apiKey ? { authorization: `Bearer ${settings.apiKey}`, 'x-user-id': await sharedUserId() } : {}),
  };
}

function canUseApi() {
  return Boolean(settings.apiUrl && (authUser || settings.apiKey));
}

function apiUrl(path, params = {}) {
  const url = new URL(path, settings.apiUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value).trim()) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function apiHeaders(extra = {}) {
  return {
    ...(await historyHeaders()),
    ...extra,
  };
}

async function apiFetch(path, options = {}) {
  const response = await fetch(apiUrl(path, options.params || {}), {
    ...options,
    credentials: 'include',
    headers: {
      ...(options.headers || {}),
    },
  });
  if (response.status === 401) {
    authUser = null;
    showLoginScreen();
  }
  return response;
}

function showLoginScreen(message = '') {
  elements.loginScreen?.classList.remove('hidden');
  document.body.classList.add('auth-required');
  if (elements.loginStatusText) {
    elements.loginStatusText.textContent = message;
  }
}

function hideLoginScreen() {
  elements.loginScreen?.classList.add('hidden');
  document.body.classList.remove('auth-required');
  if (elements.loginPasswordInput) {
    elements.loginPasswordInput.value = '';
  }
}

async function loadCurrentUser() {
  const response = await apiFetch('/v1/auth/me');
  if (!response.ok) {
    authUser = null;
    showLoginScreen();
    return null;
  }
  const body = await response.json().catch(() => null);
  authUser = body?.user || null;
  if (authUser) {
    hideLoginScreen();
  }
  return authUser;
}

async function login(username, password) {
  const response = await apiFetch('/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error?.message || `로그인 실패: HTTP ${response.status}`);
  }
  authUser = body?.user || null;
  hideLoginScreen();
  return authUser;
}

async function logout() {
  await apiFetch('/v1/auth/logout', { method: 'POST' }).catch(() => null);
  authUser = null;
  conversations = [];
  activeConversation = null;
  clearPendingJob();
  closeMediaViewer({ syncHistory: false });
  renderHome();
  pruneMediaUrlCache({ force: true, limit: 0 });
  renderConversationList();
  showLoginScreen('로그아웃되었습니다.');
}

function activeConversationId() {
  return activeConversation?.id || '';
}

function composerDraftStorageKey(conversationId = activeConversationId()) {
  return conversationId ? `${COMPOSER_DRAFT_KEY_PREFIX}:${conversationId}` : '';
}

function saveComposerDraft(conversationId = activeConversationId()) {
  const key = composerDraftStorageKey(conversationId);
  if (!key) {
    return;
  }
  const value = elements.messageInput.value;
  if (value) {
    localStorage.setItem(key, value);
  } else {
    localStorage.removeItem(key);
  }
}

function clearComposerDraft(conversationId = activeConversationId()) {
  const key = composerDraftStorageKey(conversationId);
  if (key) {
    localStorage.removeItem(key);
  }
}

function restoreComposerDraft(conversationId = activeConversationId()) {
  const key = composerDraftStorageKey(conversationId);
  elements.messageInput.value = key ? localStorage.getItem(key) || '' : '';
  autoResizeTextarea();
  selectedSlashCommandIndex = 0;
  renderSlashCommandPalette();
}

function updateChatTitle() {
  if (!elements.chatTitle) {
    return;
  }
  elements.chatTitle.textContent = activeConversation?.id ? conversationTitle(activeConversation) : 'OpenClaw';
  updateModelPickerButtonState();
}

function isConversationArchived(conversation) {
  return Boolean(conversation?.archived_at);
}

function normalizedConversationSearchQuery() {
  return conversationSearchQuery.trim().toLocaleLowerCase('ko-KR');
}

function updateConversationSearchClearButton() {
  elements.clearConversationSearchButton?.classList.toggle('hidden', !conversationSearchQuery);
}

function conversationMatchesTitle(conversation, query = normalizedConversationSearchQuery()) {
  return !query || conversationTitle(conversation).toLocaleLowerCase('ko-KR').includes(query);
}

function baseVisibleConversations() {
  return conversations.filter((conversation) => showingArchived ? isConversationArchived(conversation) : !isConversationArchived(conversation));
}

function conversationMatchesSearch(conversation, query = normalizedConversationSearchQuery()) {
  return !query || conversationMatchesTitle(conversation, query) || conversationContentMatches.has(conversation.id);
}

async function fetchConversationHistoryMessages(conversationId) {
  const response = await apiFetch('/v1/history', {
    params: { conversation_id: conversationId },
    headers: await historyHeaders(),
  });
  if (!response.ok) {
    return [];
  }
  const body = await response.json().catch(() => null);
  return Array.isArray(body?.messages) ? body.messages : [];
}

async function searchConversationContentOnServer(query) {
  const response = await apiFetch('/v1/conversations/search', {
    params: {
      query,
      ...(showingArchived ? { include_archived: '1' } : {}),
    },
  });
  if (!response.ok) {
    throw new Error(`Conversation search failed: ${response.status}`);
  }
  const body = await response.json().catch(() => null);
  return new Set(Array.isArray(body?.conversation_ids) ? body.conversation_ids : []);
}

async function searchConversationContentInBrowser(runId, query) {
  const candidates = baseVisibleConversations().filter((conversation) => !conversationMatchesTitle(conversation, query));
  const nextMatches = new Set();
  let index = 0;
  const worker = async () => {
    while (index < candidates.length && runId === conversationSearchRunId) {
      const conversation = candidates[index++];
      const cacheKey = `${conversation.id}:${query}`;
      let matched = conversationSearchCache.get(cacheKey);
      if (matched === undefined) {
        const messages = await fetchConversationHistoryMessages(conversation.id);
        const haystack = messages.map((message) => typeof message?.text === 'string' ? message.text : '').join('\n').toLocaleLowerCase('ko-KR');
        matched = haystack.includes(query);
        conversationSearchCache.set(cacheKey, matched);
      }
      if (matched) {
        nextMatches.add(conversation.id);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, worker));
  return nextMatches;
}

async function runConversationContentSearch(runId, query) {
  if (!query || !canUseApi()) {
    conversationContentMatches = new Set();
    renderConversationList();
    return;
  }
  let nextMatches;
  try {
    nextMatches = await searchConversationContentOnServer(query);
  } catch {
    nextMatches = await searchConversationContentInBrowser(runId, query);
  }
  if (runId !== conversationSearchRunId) {
    return;
  }
  const titleMatches = new Set(baseVisibleConversations().filter((conversation) => conversationMatchesTitle(conversation, query)).map((conversation) => conversation.id));
  conversationContentMatches = new Set([...nextMatches].filter((id) => !titleMatches.has(id)));
  renderConversationList();
}

function scheduleConversationSearch() {
  const query = normalizedConversationSearchQuery();
  conversationSearchRunId += 1;
  const runId = conversationSearchRunId;
  if (conversationSearchTimer) {
    window.clearTimeout(conversationSearchTimer);
  }
  conversationSearchTimer = window.setTimeout(() => {
    runConversationContentSearch(runId, query).catch(() => {});
  }, query ? 260 : 0);
}

function visibleConversations() {
  const query = normalizedConversationSearchQuery();
  return baseVisibleConversations().filter((conversation) => conversationMatchesSearch(conversation, query));
}

function sortConversations(items) {
  return [...items].sort((first, second) => Number(Boolean(second.pinned)) - Number(Boolean(first.pinned)) || Date.parse(second.updated_at || second.created_at || '') - Date.parse(first.updated_at || first.created_at || ''));
}

function currentUserDisplayName() {
  const name = authUser?.display_name || authUser?.displayName || authUser?.username || authUser?.id || '';
  return String(name).trim() || '사용자';
}

function updateSidebarSummary() {
  if (!elements.sidebarOwnerTitle || !elements.sidebarConversationCount) {
    return;
  }
  if (!canUseApi()) {
    elements.sidebarOwnerTitle.textContent = '대화';
    elements.sidebarConversationCount.textContent = '로그인이 필요합니다';
    return;
  }
  const ownerName = currentUserDisplayName();
  const count = baseVisibleConversations().length;
  elements.sidebarOwnerTitle.textContent = `${ownerName}님의 대화`;
  elements.sidebarConversationCount.textContent = showingArchived ? `보관함 ${count}개` : `대화 ${count}개`;
}

function updateArchiveToggleButton() {
  if (!elements.archiveToggleButton) {
    return;
  }
  const label = elements.archiveToggleButton.querySelector('.sidebar-button-label');
  if (label) {
    label.textContent = showingArchived ? '나가기' : '보관함';
  }
  elements.archiveToggleButton.setAttribute('aria-pressed', showingArchived ? 'true' : 'false');
}

function updateComposerAvailability() {
  const archived = isConversationArchived(activeConversation);
  const hasConversation = Boolean(activeConversation?.id);
  const disabled = isSendingMessage || archived || !hasConversation;
  elements.messageInput.disabled = disabled;
  elements.includeLocationInput.disabled = disabled;
  elements.attachButton.disabled = disabled;
  elements.sendButton.disabled = disabled;
  updateModelPickerButtonState();
  elements.sendButton.setAttribute('aria-label', isSendingMessage ? '전송 중' : '전송');
  elements.sendButton.title = isSendingMessage ? '전송 중' : '전송';
  if (archived) {
    elements.messageInput.placeholder = '보관된 대화입니다. 대화를 이어가려면 아카이브를 해제하세요.';
  } else if (!hasConversation) {
    elements.messageInput.placeholder = '새 대화를 열거나 목록에서 대화를 선택하세요.';
  } else {
    elements.messageInput.placeholder = '메시지를 입력하세요';
  }
}

function renderHome() {
  clearRenderedMessages();
  const home = document.createElement('section');
  home.className = 'home-screen';
  const title = document.createElement('h1');
  title.textContent = 'OpenClaw Web Channel';
  const description = document.createElement('p');
  if (!canUseApi()) {
    description.textContent = '로그인 후 대화를 시작할 수 있습니다.';
    const settingsButton = document.createElement('button');
    settingsButton.type = 'button';
    settingsButton.textContent = '설정 열기';
    settingsButton.addEventListener('click', (event) => {
      event.stopPropagation();
      openSettingsPanel();
    });
    home.append(title, description, settingsButton);
  } else {
    description.textContent = showingArchived
      ? '보관함입니다. 보관된 대화를 선택해 읽거나, 메뉴에서 아카이브를 해제할 수 있습니다.'
      : '새 대화를 열어 대화를 시작하거나, 목록에서 기존 대화를 선택하세요.';
    const newButton = document.createElement('button');
    newButton.type = 'button';
    newButton.textContent = '새 대화 시작';
    newButton.addEventListener('click', () => startNewConversation().catch((error) => appendMessage('system', error instanceof Error ? error.message : String(error), { persist: false })));
    home.append(title, description, newButton);
  }
  elements.messages.append(home);
  lastHistoryVersion = null;
  lastHistoryHasMore = false;
  activeHistoryLimit = normalizeHistoryPageSize(settings.historyPageSize);
  updateComposerAvailability();
}

function goHome(options = {}) {
  saveComposerDraft();
  setModelPickerExpanded(false);
  modelPickerState = null;
  activeConversation = null;
  settings.lastActiveConversationId = '';
  saveSettings(settings);
  clearPendingJob('');
  selectedAttachments = [];
  renderAttachmentTray();
  elements.messageInput.value = '';
  autoResizeTextarea();
  renderConversationList();
  stopConversationEvents();
  syncHistoryPolling();
  renderHome();
  updateChatTitle();
  syncConversationUrl('', { replace: options.replaceUrl === true });
}

function renderConversationList() {
  updateSidebarSummary();
  if (!elements.conversationList) {
    return;
  }
  elements.conversationList.replaceChildren();
  if (!canUseApi()) {
    const empty = document.createElement('p');
    empty.className = 'conversation-empty';
    empty.textContent = '로그인하면 대화 목록이 표시됩니다.';
    elements.conversationList.append(empty);
    return;
  }
  updateArchiveToggleButton();
  const list = visibleConversations();
  const query = normalizedConversationSearchQuery();
  if (list.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'conversation-empty';
    empty.textContent = query ? '검색 결과가 없습니다.' : (showingArchived ? '보관된 대화가 없습니다.' : '대화가 없습니다.');
    elements.conversationList.append(empty);
    return;
  }
  const activeId = activeConversationId();
  for (const conversation of list) {
    const menuOpen = openConversationMenuId === conversation.id;
    const item = document.createElement('div');
    item.className = `conversation-item${conversation.id === activeId ? ' active' : ''}${menuOpen ? ' menu-open' : ''}`;
    item.dataset.conversationId = conversation.id;

    const selectButton = document.createElement('button');
    selectButton.type = 'button';
    selectButton.className = 'conversation-select-button';
    selectButton.addEventListener('click', () => selectConversation(conversation.id));

    const title = document.createElement('span');
    title.className = 'conversation-title';
    title.textContent = conversationTitle(conversation);
    const meta = document.createElement('span');
    meta.className = 'conversation-meta';
    meta.textContent = formatConversationDate(conversation.updated_at || conversation.created_at);
    selectButton.append(title, meta);

    const menuWrap = document.createElement('div');
    menuWrap.className = 'conversation-menu-wrap';
    if (conversation.pinned) {
      const pin = document.createElement('span');
      pin.className = 'conversation-pin-icon';
      pin.setAttribute('aria-label', '상단 고정됨');
      pin.textContent = '📌';
      menuWrap.append(pin);
    }
    const menuButton = document.createElement('button');
    menuButton.type = 'button';
    menuButton.className = 'conversation-menu-button ghost-button';
    menuButton.setAttribute('aria-label', `${conversationTitle(conversation)} 메뉴`);
    menuButton.setAttribute('aria-expanded', openConversationMenuId === conversation.id ? 'true' : 'false');
    menuButton.textContent = '⋯';
    menuButton.addEventListener('click', (event) => {
      event.stopPropagation();
      openConversationMenuId = openConversationMenuId === conversation.id ? null : conversation.id;
      renderConversationList();
    });

    const menu = document.createElement('div');
    menu.className = `conversation-menu${openConversationMenuId === conversation.id ? '' : ' hidden'}`;
    const pinButton = document.createElement('button');
    pinButton.type = 'button';
    pinButton.textContent = conversation.pinned ? '상단고정 해제' : '상단고정';
    pinButton.addEventListener('click', async (event) => {
      event.stopPropagation();
      openConversationMenuId = null;
      renderConversationList();
      await toggleConversationPinned(conversation.id);
    });
    const archiveButton = document.createElement('button');
    archiveButton.type = 'button';
    archiveButton.textContent = isConversationArchived(conversation) ? '아카이브 해제' : '아카이브';
    archiveButton.addEventListener('click', async (event) => {
      event.stopPropagation();
      openConversationMenuId = null;
      renderConversationList();
      await toggleConversationArchived(conversation.id);
    });
    const renameButton = document.createElement('button');
    renameButton.type = 'button';
    renameButton.textContent = '이름 변경';
    renameButton.addEventListener('click', async (event) => {
      event.stopPropagation();
      openConversationMenuId = null;
      renderConversationList();
      await renameConversation(conversation.id);
    });
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'danger-menu-item';
    deleteButton.textContent = '삭제';
    deleteButton.addEventListener('click', async (event) => {
      event.stopPropagation();
      openConversationMenuId = null;
      renderConversationList();
      await deleteConversation(conversation.id);
    });
    menu.append(pinButton, archiveButton, renameButton, deleteButton);
    menuWrap.append(menuButton, menu);

    item.append(selectButton, menuWrap);
    elements.conversationList.append(item);
  }
}

function syncActiveConversationFromList() {
  const conversationId = activeConversationId();
  if (!conversationId) {
    return null;
  }
  const latest = conversations.find((conversation) => conversation.id === conversationId) || null;
  if (!latest) {
    return null;
  }
  activeConversation = latest;
  updateChatTitle();
  updateComposerAvailability();
  return latest;
}

async function refreshConversations() {
  if (!canUseApi()) {
    conversations = [];
    renderConversationList();
    return conversations;
  }
  conversations = sortConversations(await fetchConversations());
  syncActiveConversationFromList();
  await pruneStoredPendingJobs(conversations).catch(() => {});
  conversationSearchCache.clear();
  renderConversationList();
  scheduleConversationSearch();
  return conversations;
}

async function selectConversation(conversationId, options = {}) {
  if (!conversationId) {
    return false;
  }
  if (conversationId === activeConversationId()) {
    syncConversationUrl(conversationId, { replace: options.replaceUrl === true });
    return true;
  }
  saveComposerDraft();
  const conversation = conversations.find((item) => item.id === conversationId) || null;
  if (!conversation) {
    return false;
  }
  setModelPickerExpanded(false);
  modelPickerState = null;
  activeConversation = conversation;
  updateChatTitle();
  settings.lastActiveConversationId = conversation.id;
  saveSettings(settings);
  syncConversationUrl(conversation.id, { replace: options.replaceUrl === true });
  lastHistoryVersion = null;
  lastHistoryHasMore = false;
  activeHistoryLimit = normalizeHistoryPageSize(settings.historyPageSize);
  clearPendingJob();
  renderConversationList();
  restoreComposerDraft(conversation.id);
  updateComposerAvailability();
  closeMobileDrawer();
  await renderHistory({ scrollToLatest: true });
  startConversationEvents(conversation.id);
  syncHistoryPolling();
  await resumePendingJobIfNeeded();
  return true;
}

async function fetchConversations() {
  const response = await apiFetch('/v1/conversations', {
    params: { include_archived: 1 },
    headers: await historyHeaders(),
  });
  if (!response.ok) {
    throw new Error(`대화 목록을 불러오지 못했습니다: HTTP ${response.status}`);
  }
  const body = await response.json();
  return Array.isArray(body.conversations) ? body.conversations : [];
}

async function createConversation(title = '새 대화') {
  const response = await apiFetch('/v1/conversations', {
    method: 'POST',
    headers: await apiHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ title }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error?.message || `대화 생성을 실패했습니다: HTTP ${response.status}`);
  }
  return body.conversation;
}

async function patchConversation(conversationId, patch) {
  const response = await apiFetch(`/v1/conversations/${encodeURIComponent(conversationId)}`, {
    method: 'PATCH',
    headers: await apiHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify(patch),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error?.message || `대화 수정을 실패했습니다: HTTP ${response.status}`);
  }
  return body.conversation;
}

async function updateConversationTitle(conversationId, title) {
  try {
    return await patchConversation(conversationId, { title });
  } catch (error) {
    throw new Error(error instanceof Error ? error.message.replace('대화 수정을', '대화 이름 변경을') : String(error));
  }
}

async function destroyConversation(conversationId) {
  const response = await apiFetch(`/v1/conversations/${encodeURIComponent(conversationId)}`, {
    method: 'DELETE',
    headers: await apiHeaders(),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error?.message || `대화 삭제를 실패했습니다: HTTP ${response.status}`);
  }
  return body;
}

function closeDialog(dialog) {
  if (!dialog) {
    return;
  }
  if (typeof dialog.close === 'function' && dialog.open) {
    dialog.close();
    return;
  }
}

function openRenameDialog(currentTitle) {
  const dialog = elements.conversationRenameDialog;
  if (!dialog || !elements.conversationRenameInput) {
    const fallback = window.prompt('새 대화 이름을 입력하세요.', currentTitle);
    return Promise.resolve(fallback === null ? null : fallback.trim());
  }
  elements.conversationRenameInput.value = currentTitle;
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      closeDialog(dialog);
      resolve(value);
    };
    const cleanup = () => {
      elements.conversationRenameConfirm?.removeEventListener('click', onConfirm);
      elements.conversationRenameCancel?.removeEventListener('click', onCancel);
      elements.conversationRenameInput.removeEventListener('keydown', onInputKeydown);
      dialog.removeEventListener('cancel', onCancel);
      dialog.removeEventListener('close', onClose);
    };
    const onConfirm = () => settle(elements.conversationRenameInput.value.trim());
    const onCancel = () => settle(null);
    const onClose = () => settle(null);
    const onInputKeydown = (event) => {
      if (event.isComposing || event.keyCode === 229) {
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        onConfirm();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }
    };
    elements.conversationRenameConfirm?.addEventListener('click', onConfirm);
    elements.conversationRenameCancel?.addEventListener('click', onCancel);
    elements.conversationRenameInput.addEventListener('keydown', onInputKeydown);
    dialog.addEventListener('cancel', onCancel);
    dialog.addEventListener('close', onClose);
    dialog.showModal?.();
    elements.conversationRenameInput.focus();
    elements.conversationRenameInput.select();
  });
}

function openDeleteDialog(title) {
  const dialog = elements.conversationDeleteDialog;
  if (!dialog) {
    return Promise.resolve(window.confirm(`“${title}” 대화를 삭제할까요? 이 작업은 되돌릴 수 없습니다.`));
  }
  if (elements.conversationDeleteText) {
    elements.conversationDeleteText.textContent = `“${title}” 대화를 삭제할까요?`;
  }
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      closeDialog(dialog);
      resolve(value);
    };
    const cleanup = () => {
      elements.conversationDeleteConfirm?.removeEventListener('click', onConfirm);
      elements.conversationDeleteCancel?.removeEventListener('click', onCancel);
      dialog.removeEventListener('cancel', onCancel);
      dialog.removeEventListener('close', onClose);
    };
    const onConfirm = () => settle(true);
    const onCancel = () => settle(false);
    const onClose = () => settle(false);
    elements.conversationDeleteConfirm?.addEventListener('click', onConfirm);
    elements.conversationDeleteCancel?.addEventListener('click', onCancel);
    dialog.addEventListener('cancel', onCancel);
    dialog.addEventListener('close', onClose);
    dialog.showModal?.();
  });
}

async function toggleConversationPinned(conversationId) {
  const conversation = conversations.find((item) => item.id === conversationId);
  if (!conversation) {
    return;
  }
  try {
    const updated = await patchConversation(conversation.id, { pinned: !conversation.pinned });
    conversations = sortConversations(conversations.map((item) => item.id === updated.id ? updated : item));
    if (activeConversation?.id === updated.id) {
      activeConversation = updated;
      updateChatTitle();
    }
    renderConversationList();
    appendMessage('system', updated.pinned ? '대화를 상단에 고정했습니다.' : '대화 상단고정을 해제했습니다.', { persist: false });
  } catch (error) {
    appendMessage('system', error instanceof Error ? error.message : String(error), { persist: false });
  }
}

async function toggleConversationArchived(conversationId) {
  const conversation = conversations.find((item) => item.id === conversationId);
  if (!conversation) {
    return;
  }
  const shouldArchive = !isConversationArchived(conversation);
  try {
    const updated = await patchConversation(conversation.id, { archived: shouldArchive });
    conversations = sortConversations(conversations.map((item) => item.id === updated.id ? updated : item));
    if (activeConversation?.id === updated.id) {
      activeConversation = updated;
      goHome();
      return;
    }
    renderConversationList();
    appendMessage('system', shouldArchive ? '대화를 보관함으로 이동했습니다.' : '대화 아카이브를 해제했습니다.', { persist: false });
  } catch (error) {
    appendMessage('system', error instanceof Error ? error.message : String(error), { persist: false });
  }
}

async function renameConversation(conversationId) {
  const conversation = conversations.find((item) => item.id === conversationId);
  if (!conversation) {
    return;
  }
  const nextTitle = await openRenameDialog(conversationTitle(conversation));
  if (!nextTitle || nextTitle === conversationTitle(conversation)) {
    return;
  }
  try {
    const updated = await updateConversationTitle(conversation.id, nextTitle);
    conversations = conversations.map((item) => item.id === updated.id ? updated : item);
    if (activeConversation?.id === updated.id) {
      activeConversation = updated;
      updateChatTitle();
    }
    renderConversationList();
    appendMessage('system', '대화 이름을 변경했습니다.', { persist: false });
  } catch (error) {
    appendMessage('system', error instanceof Error ? error.message : String(error), { persist: false });
  }
}

async function deleteConversation(conversationId) {
  const conversation = conversations.find((item) => item.id === conversationId);
  if (!conversation) {
    return;
  }
  const confirmed = await openDeleteDialog(conversationTitle(conversation));
  if (!confirmed) {
    return;
  }
  try {
    await destroyConversation(conversation.id);
    clearComposerDraft(conversation.id);
    conversations = conversations.filter((item) => item.id !== conversation.id);
    if (activeConversation?.id === conversation.id) {
      goHome();
      showToast('대화를 삭제했습니다.', { kind: 'success' });
      return;
    }
    renderConversationList();
    showToast('대화를 삭제했습니다.', { kind: 'success' });
  } catch (error) {
    appendMessage('system', error instanceof Error ? error.message : String(error), { persist: false });
  }
}

async function ensureActiveConversation() {
  if (activeConversation?.id) {
    return activeConversation;
  }
  conversations = sortConversations(await fetchConversations());
  activeConversation = await createConversation('새 대화');
  updateChatTitle();
  settings.lastActiveConversationId = activeConversation.id;
  syncConversationUrl(activeConversation.id);
  if (!conversations.some((conversation) => conversation.id === activeConversation.id)) {
    conversations = [activeConversation, ...conversations];
  }
  saveSettings(settings);
  renderConversationList();
  restoreComposerDraft(activeConversation.id);
  return activeConversation;
}

async function startNewConversation() {
  saveComposerDraft();
  showingArchived = false;
  updateArchiveToggleButton();
  setModelPickerExpanded(false);
  modelPickerState = null;
  activeConversation = await createConversation('새 대화');
  updateChatTitle();
  settings.lastActiveConversationId = activeConversation.id;
  syncConversationUrl(activeConversation.id);
  conversations = [activeConversation, ...conversations.filter((conversation) => conversation.id !== activeConversation.id)];
  saveSettings(settings);
  lastHistoryVersion = null;
  lastHistoryHasMore = false;
  activeHistoryLimit = normalizeHistoryPageSize(settings.historyPageSize);
  clearPendingJob();
  clearRenderedMessages();
  renderConversationList();
  restoreComposerDraft(activeConversation.id);
  updateComposerAvailability();
  await renderHistory({ scrollToLatest: true });
  closeMobileDrawer();
  return activeConversation;
}

function setFloatingActionsExpanded(expanded) {
  floatingActionsExpanded = expanded;
  document.body.classList.toggle('floating-actions-open', expanded);
  elements.floatingActionPanel?.classList.toggle('hidden', !expanded);
  if (elements.floatingActionToggle) {
    elements.floatingActionToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    elements.floatingActionToggle.setAttribute('aria-label', expanded ? '빠른 작업 닫기' : '빠른 작업 열기');
    elements.floatingActionToggle.title = expanded ? '빠른 작업 닫기' : '빠른 작업';
  }
}

function toggleFloatingActions() {
  setFloatingActionsExpanded(!floatingActionsExpanded);
}

function updateModelPickerButtonState() {
  if (!elements.modelPickerButton) {
    return;
  }
  const hasConversation = Boolean(activeConversation?.id);
  elements.modelPickerButton.disabled = !hasConversation;
  elements.modelPickerButton.setAttribute('aria-expanded', modelPickerExpanded ? 'true' : 'false');
  elements.modelPickerButton.title = hasConversation ? 'AI 모델 선택' : '대화를 먼저 선택하세요';
}

function renderModelPicker() {
  if (!elements.modelPickerPanel || !elements.modelPickerStatus || !elements.modelPickerList) {
    return;
  }
  elements.modelPickerPanel.classList.toggle('hidden', !modelPickerExpanded);
  elements.modelPickerButton?.setAttribute('aria-expanded', modelPickerExpanded ? 'true' : 'false');
  elements.modelPickerList.replaceChildren();

  if (!modelPickerExpanded) {
    return;
  }

  const canChange = Boolean(modelPickerState?.canChange);
  const models = Array.isArray(modelPickerState?.models) ? modelPickerState.models : [];
  elements.modelPickerStatus.textContent = modelPickerLoading
    ? '모델 목록을 불러오는 중입니다…'
    : (!activeConversation?.id
      ? '대화를 먼저 선택하세요.'
      : (canChange ? '이 대화에서 사용할 모델을 선택하세요.' : '현재 모델만 확인할 수 있습니다.'));
  elements.modelPickerStatus.classList.toggle('hidden', !modelPickerLoading && models.length > 0);

  for (const model of models) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `model-picker-item${model.selected ? ' is-selected' : ''}`;
    button.setAttribute('role', 'menuitemradio');
    button.setAttribute('aria-checked', model.selected ? 'true' : 'false');
    button.disabled = !canChange || modelPickerLoading;
    button.dataset.modelRef = model.ref;

    const check = document.createElement('span');
    check.className = 'model-picker-check';
    check.textContent = model.selected ? '✓' : '';

    const label = document.createElement('span');
    label.className = 'model-picker-item-label';
    label.textContent = model.label;

    button.append(check, label);
    button.addEventListener('click', () => {
      applyConversationModel(model.ref).catch((error) => {
        showToast(error instanceof Error ? error.message : String(error), { kind: 'error', durationMs: 3200 });
      });
    });
    elements.modelPickerList.append(button);
  }
}

function setModelPickerExpanded(expanded) {
  modelPickerExpanded = Boolean(expanded);
  if (!modelPickerExpanded) {
    modelPickerLoading = false;
  }
  renderModelPicker();
}

async function fetchConversationModelMenu(conversationId) {
  const response = await apiFetch(`/v1/conversations/${encodeURIComponent(conversationId)}/model`, {
    headers: await apiHeaders(),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error?.message || `모델 목록을 불러오지 못했습니다: HTTP ${response.status}`);
  }
  return body;
}

async function patchConversationModel(conversationId, model) {
  const response = await apiFetch(`/v1/conversations/${encodeURIComponent(conversationId)}/model`, {
    method: 'PATCH',
    headers: await apiHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ model }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error?.message || `모델 변경을 실패했습니다: HTTP ${response.status}`);
  }
  return body;
}

async function openModelPicker() {
  if (!activeConversation?.id || modelPickerLoading) {
    return;
  }
  modelPickerExpanded = true;
  modelPickerLoading = true;
  modelPickerState = null;
  renderModelPicker();
  try {
    modelPickerState = await fetchConversationModelMenu(activeConversation.id);
  } finally {
    modelPickerLoading = false;
    renderModelPicker();
  }
}

async function applyConversationModel(modelRef) {
  if (!activeConversation?.id || modelPickerLoading) {
    return;
  }
  if (modelPickerState?.models?.find((entry) => entry.ref === modelRef)?.selected) {
    setModelPickerExpanded(false);
    return;
  }
  modelPickerLoading = true;
  renderModelPicker();
  try {
    const result = await patchConversationModel(activeConversation.id, modelRef);
    showToast(`모델을 ${String(result.current_model || modelRef).split('/').pop()}로 변경했습니다.`, { kind: 'success' });
    if (result.warning) {
      showToast(result.warning, { kind: 'info', durationMs: 3200 });
    }
    modelPickerState = null;
    setModelPickerExpanded(false);
  } finally {
    modelPickerLoading = false;
    renderModelPicker();
  }
}

async function toggleModelPicker() {
  if (modelPickerExpanded) {
    setModelPickerExpanded(false);
    return;
  }
  try {
    await openModelPicker();
  } catch (error) {
    modelPickerLoading = false;
    setModelPickerExpanded(false);
    showToast(error instanceof Error ? error.message : String(error), { kind: 'error', durationMs: 3200 });
  }
}

function compactHistoryText(text, maxLength = 700) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function buildNewSessionHandoffMessage(sourceConversation, history) {
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

async function continueInNewSession() {
  setFloatingActionsExpanded(false);
  if (isSendingMessage) {
    return;
  }
  if (!canUseApi()) {
    appendMessage('system', '로그인 후 대화를 시작할 수 있습니다.', { persist: false });
    openSettingsPanel();
    return;
  }

  const sourceConversation = await ensureActiveConversation();
  saveComposerDraft(sourceConversation.id);
  setSending(true);
  setStatus('새 세션 인수인계를 준비하는 중입니다...');

  try {
    const sourceHistory = await fetchConversationHistory(sourceConversation.id);
    const handoffMessage = buildNewSessionHandoffMessage(sourceConversation, sourceHistory);
    const nextTitleBase = conversationTitle(sourceConversation).replace(/^이어가기 -\s*/, '');
    const nextConversation = await createConversation(`이어가기 - ${nextTitleBase}`.slice(0, 120));
    activeConversation = nextConversation;
    settings.lastActiveConversationId = nextConversation.id;
    conversations = [nextConversation, ...conversations.filter((conversation) => conversation.id !== nextConversation.id)];
    saveSettings(settings);
    lastHistoryVersion = null;
    clearPendingJob();
    clearRenderedMessages();
    renderConversationList();
    restoreComposerDraft(nextConversation.id);
    closeMobileDrawer();

    appendMessage('system', '새 OpenClaw 세션을 만들고 최근 대화 맥락을 전달합니다.', { persist: false });
    setStatus('새 세션에 인수인계 메시지를 보내는 중입니다...');
    const response = await sendMessage(handoffMessage);
    const conversationId = response.conversation_id || nextConversation.id;
    if (response.job_id) {
      savePendingJob({ job_id: response.job_id, startedAt: Date.now() }, conversationId);
      setSending(false);
      setStatus('새 세션을 초기화하는 중입니다...');
      lastHistoryVersion = null;
      await refreshHistoryIfChanged();
      ensurePendingJobBubble(response.job_id, conversationId);
      let receivedStreamingToken = false;
      const job = await waitForJob(response.job_id, (jobUpdate) => {
        if (!isActiveConversation(conversationId)) {
          return;
        }
        if (!receivedStreamingToken || isTerminalJobState(jobUpdate.state)) {
          refreshHistoryIfChanged();
        }
      }, conversationId, (token) => {
        receivedStreamingToken = true;
        applyStreamingToken(response.job_id, token, conversationId);
      });
      if (isActiveConversation(conversationId)) {
        await renderHistory({ scrollToLatest: true });
      }
      if (job.state === 'failed') {
        setStatus(job.error || '새 세션 초기화 응답이 실패했습니다.');
      } else if (job.state === 'cancelled') {
        setStatus('새 세션 초기화 요청이 취소되었습니다.');
      } else {
        setStatus('새 세션으로 이어갈 준비가 됐습니다.');
      }
    } else {
      await refreshHistoryIfChanged();
      setStatus('새 세션으로 이어갈 준비가 됐습니다.');
    }
    await refreshConversations().catch(() => {});
  } catch (error) {
    appendMessage('system', error instanceof Error ? error.message : String(error), { persist: false });
    setStatus('');
  } finally {
    setSending(false);
    if (!isMobileLikeInput()) {
      elements.messageInput.focus();
    }
  }
}

async function fetchHistory() {
  const conversation = await ensureActiveConversation();
  const response = await apiFetch('/v1/history', {
    params: { conversation_id: conversation.id, limit: activeHistoryLimit },
    headers: await historyHeaders(),
  });
  if (!response.ok) {
    throw new Error(`대화 기록을 불러오지 못했습니다: HTTP ${response.status}`);
  }
  const body = await response.json();
  lastHistoryVersion = body.version || lastHistoryVersion;
  lastHistoryHasMore = Boolean(body.hasMore);
  return Array.isArray(body.messages) ? body.messages : [];
}

async function fetchHistoryMeta() {
  const conversation = await ensureActiveConversation();
  const response = await apiFetch('/v1/history', {
    params: { meta: '1', conversation_id: conversation.id, limit: activeHistoryLimit },
    headers: await historyHeaders(),
  });
  if (!response.ok) {
    throw new Error(`대화 기록 상태를 확인하지 못했습니다: HTTP ${response.status}`);
  }
  return response.json();
}

function renderHistoryLoadMoreControl() {
  if (!lastHistoryHasMore) {
    return;
  }
  const wrapper = document.createElement('div');
  wrapper.className = 'history-load-more';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ghost-button history-load-more-button';
  button.textContent = loadingOlderHistory ? '이전 대화 불러오는 중…' : '이전 대화 더보기';
  button.disabled = loadingOlderHistory;
  button.addEventListener('click', () => loadOlderHistory().catch((error) => appendMessage('system', error instanceof Error ? error.message : String(error), { persist: false })));
  wrapper.append(button);
  elements.messages.append(wrapper);
}

async function loadOlderHistory() {
  if (loadingOlderHistory || !lastHistoryHasMore) {
    return;
  }
  loadingOlderHistory = true;
  activeHistoryLimit += normalizeHistoryPageSize(settings.historyPageSize);
  try {
    await renderHistory({ preservePosition: true });
  } finally {
    loadingOlderHistory = false;
    const button = elements.messages.querySelector('.history-load-more-button');
    if (button) {
      button.disabled = false;
      button.textContent = '이전 대화 더보기';
    }
  }
}

async function renderHistory(options = {}) {
  if (!activeConversation?.id) {
    renderHome();
    return;
  }
  updateComposerAvailability();
  const { scrollToLatest = false, preservePosition = false } = options;
  const hadRenderedMessages = elements.messages.children.length > 0;
  const shouldFollow = isNearBottom();
  const previousBottomOffset = elements.messages.scrollHeight - elements.messages.scrollTop;
  clearRenderedMessages();
  if (!canUseApi()) {
    appendMessage('system', '로그인하면 대화를 시작할 수 있습니다.', { persist: false });
    return;
  }

  try {
    const history = await fetchHistory();
    if (history.length === 0) {
      appendMessage('system', '📌 TIP: 설정에서 자동 위치 첨부가 켜져 있으면 채팅에 "여기"가 포함될 때 현재 위치가 함께 전달됩니다. 핀 버튼으로도 이번 메시지에만 위치를 첨부할 수 있습니다.', { persist: false });
      return;
    }

    renderHistoryLoadMoreControl();
    for (const item of history) {
      renderHistoryItem(item);
    }
    if (scrollToLatest || shouldFollow) {
      scrollToBottom({ force: true });
      if (scrollToLatest) {
        window.setTimeout(() => scrollToBottom({ force: true }), 250);
      }
    } else if (hadRenderedMessages || preservePosition) {
      preserveScrollAfterRender(previousBottomOffset);
      if (history.some((item) => typeof item?.role === 'string' && item.role !== 'user' && !isPendingHistoryMessage(item))) {
        showScrollToLatestButton();
      }
    }
  } catch (error) {
    appendMessage('system', error instanceof Error ? error.message : String(error), { persist: false });
  }
}

function appendInlineMarkdown(parent, text) {
  const pattern = /(?<strong>(?<![\p{L}\p{N}_*])\*\*(?<strongText>[^*\n]+)\*\*(?!\*))|(?<starEm>(?<![\p{L}\p{N}_*])\*(?<starEmText>[^*\n]+)\*(?![\p{L}\p{N}_*]))|(?<underscoreEm>(?<![\p{L}\p{N}_])_(?<underscoreEmText>[^_\n]+)_(?![\p{L}\p{N}_]))|(?<code>`(?<codeText>[^`\n]+)`)|(?<link>\[(?<linkLabel>[^\]\n]+)\]\((?<linkUrl>https?:\/\/[^\s)]+)\))|(?<url>https?:\/\/[^\s<)]+)/gu;
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parent.append(document.createTextNode(text.slice(lastIndex, match.index)));
    }

    if (match.groups.strongText) {
      const strong = document.createElement('strong');
      strong.textContent = match.groups.strongText;
      parent.append(strong);
    } else if (match.groups.starEmText || match.groups.underscoreEmText) {
      const emphasis = document.createElement('em');
      emphasis.textContent = match.groups.starEmText || match.groups.underscoreEmText;
      parent.append(emphasis);
    } else if (match.groups.codeText) {
      const code = document.createElement('code');
      code.textContent = match.groups.codeText;
      parent.append(code);
    } else {
      const label = match.groups.linkLabel || match.groups.url;
      const url = match.groups.linkUrl || match.groups.url;
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.textContent = label;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      parent.append(anchor);
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    parent.append(document.createTextNode(text.slice(lastIndex)));
  }
}

function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  return copied ? Promise.resolve() : Promise.reject(new Error('복사하지 못했습니다.'));
}

function isMarkdownTableRow(line) {
  const trimmed = line.trim();
  return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.slice(1, -1).includes('|');
}

function isMarkdownTableSeparator(line) {
  if (!isMarkdownTableRow(line)) {
    return false;
  }
  return splitMarkdownTableRow(line).every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function splitMarkdownTableRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function tableAlignments(separatorLine) {
  return splitMarkdownTableRow(separatorLine).map((cell) => {
    const trimmed = cell.trim();
    if (trimmed.startsWith(':') && trimmed.endsWith(':')) {
      return 'center';
    }
    if (trimmed.endsWith(':')) {
      return 'right';
    }
    return '';
  });
}

function appendMarkdownTable(parent, headerCells, separatorLine, bodyRows) {
  const wrapper = document.createElement('div');
  wrapper.className = 'markdown-table-wrapper';
  const table = document.createElement('table');
  const alignments = tableAlignments(separatorLine);

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  for (const [index, cell] of headerCells.entries()) {
    const th = document.createElement('th');
    if (alignments[index]) {
      th.style.textAlign = alignments[index];
    }
    appendInlineMarkdown(th, cell);
    headerRow.append(th);
  }
  thead.append(headerRow);
  table.append(thead);

  const tbody = document.createElement('tbody');
  for (const rowCells of bodyRows) {
    const tr = document.createElement('tr');
    for (let index = 0; index < headerCells.length; index += 1) {
      const td = document.createElement('td');
      if (alignments[index]) {
        td.style.textAlign = alignments[index];
      }
      appendInlineMarkdown(td, rowCells[index] || '');
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(tbody);
  wrapper.append(table);
  parent.append(wrapper);
}

function insertIntoComposer(text) {
  const value = String(text || '');
  if (!value || !elements.messageInput) {
    return;
  }
  const current = elements.messageInput.value;
  const separator = current && !current.endsWith('\n') ? '\n' : '';
  elements.messageInput.value = `${current}${separator}${value}`;
  elements.messageInput.dispatchEvent(new Event('input', { bubbles: true }));
  elements.messageInput.focus();
  saveComposerDraft();
}

async function apiJson(path, options = {}) {
  const response = await apiFetch(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(await historyHeaders()),
      ...(options.headers || {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error?.message || `HTTP ${response.status}`);
  }
  return body;
}

function codeBlockPluginContext() {
  return {
    activeConversationId,
    apiJson,
    copyTextToClipboard,
    insertIntoComposer,
    refreshHistory: () => renderHistory({ scrollToLatest: true }),
    sendPluginMessage: async (message) => {
      const response = await sendMessage(message, [], { source: 'plugin', hiddenFromHistory: true });
      if (response.job_id) {
        const conversationId = response.conversation_id || activeConversationId();
        savePendingJob({ job_id: response.job_id, startedAt: Date.now() }, conversationId);
        ensurePendingJobBubble(response.job_id, conversationId);
        await refreshHistoryIfChanged();
      }
      return response;
    },
    renderFallbackCodeBlock: appendPlainCodeBlock,
  };
}

function appendCodeBlock(parent, codeText, language = '', options = {}) {
  if (!options.skipPlugins && renderCodeBlockPlugin(parent, codeText, language, codeBlockPluginContext())) {
    return;
  }
  appendPlainCodeBlock(parent, codeText, language, options);
}

function appendPlainCodeBlock(parent, codeText, language = '', options = {}) {
  const { showHeader = true, showCopyButton = true } = options;
  const wrapper = document.createElement('div');
  wrapper.className = `code-block${showHeader ? '' : ' compact'}`;

  if (showHeader) {
    const header = document.createElement('div');
    header.className = 'code-block-header';
    const label = document.createElement('span');
    label.textContent = language || 'code';
    header.append(label);

    if (showCopyButton) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'code-copy-button';
      button.textContent = '복사';
      button.addEventListener('click', async () => {
        const originalText = button.textContent;
        try {
          await copyTextToClipboard(codeText);
          button.textContent = '복사됨';
          window.setTimeout(() => { button.textContent = originalText; }, 1200);
        } catch {
          button.textContent = '실패';
          window.setTimeout(() => { button.textContent = originalText; }, 1200);
        }
      });
      header.append(button);
    }

    wrapper.append(header);
  }

  const pre = document.createElement('pre');
  const code = document.createElement('code');
  code.textContent = codeText;
  pre.append(code);
  wrapper.append(pre);
  parent.append(wrapper);
}

function appendBlockquote(parent, lines) {
  const quote = document.createElement('blockquote');
  appendMarkdown(quote, lines.join('\n'));
  parent.append(quote);
}

function countLeadingSpaces(text) {
  const match = String(text || '').match(/^\s*/);
  return match ? match[0].length : 0;
}

function appendMarkdown(parent, text) {
  const lines = text.split('\n');
  let list = null;
  let inCodeBlock = false;
  let codeLanguage = '';
  let codeLines = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const singleLineFence = line.match(/^```([^`\n]+)```\s*$/);
    if (singleLineFence) {
      list = null;
      appendCodeBlock(parent, singleLineFence[1], '', { showHeader: false, showCopyButton: false });
      continue;
    }
    const fence = line.match(/^```\s*([^`]*)\s*$/);
    if (fence) {
      list = null;
      if (inCodeBlock) {
        appendCodeBlock(parent, codeLines.join('\n'), codeLanguage);
        inCodeBlock = false;
        codeLanguage = '';
        codeLines = [];
      } else {
        inCodeBlock = true;
        codeLanguage = fence[1]?.trim() || '';
        codeLines = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    if (isMarkdownTableRow(line) && isMarkdownTableSeparator(lines[index + 1] || '')) {
      list = null;
      const headerCells = splitMarkdownTableRow(line);
      const separatorLine = lines[index + 1];
      const bodyRows = [];
      index += 2;
      while (index < lines.length && isMarkdownTableRow(lines[index])) {
        bodyRows.push(splitMarkdownTableRow(lines[index]));
        index += 1;
      }
      index -= 1;
      appendMarkdownTable(parent, headerCells, separatorLine, bodyRows);
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    const numbered = line.match(/^\s*(\d+)[.)]\s+(.+)$/);
    const quote = line.match(/^>\s?(.*)$/);
    const horizontalRule = line.match(/^\s{0,3}((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})\s*$/);

    if (horizontalRule) {
      list = null;
      parent.append(document.createElement('hr'));
      continue;
    }

    if (quote) {
      list = null;
      const quoteLines = [quote[1]];
      while (index + 1 < lines.length) {
        const nextLine = lines[index + 1];
        if (!nextLine.trim()) {
          break;
        }
        const nextQuote = nextLine.match(/^>\s?(.*)$/);
        if (nextQuote) {
          quoteLines.push(nextQuote[1]);
          index += 1;
          continue;
        }
        if (/^```\s*([^`]*)\s*$/.test(nextLine) || /^(#{1,3})\s+(.+)$/.test(nextLine) || /^\s*[-*]\s+(.+)$/.test(nextLine) || /^\s*(\d+)[.)]\s+(.+)$/.test(nextLine) || (isMarkdownTableRow(nextLine) && isMarkdownTableSeparator(lines[index + 2] || ''))) {
          break;
        }
        quoteLines.push(nextLine);
        index += 1;
      }
      appendBlockquote(parent, quoteLines);
      continue;
    }

    if (heading) {
      list = null;
      const level = String(Math.min(3, heading[1].length + 2));
      const node = document.createElement(`h${level}`);
      appendInlineMarkdown(node, heading[2]);
      parent.append(node);
      continue;
    }

    if (bullet || numbered) {
      const listType = bullet ? 'ul' : 'ol';
      const explicitNumber = numbered ? Number(numbered[1]) : null;
      if (!list || list.tagName.toLowerCase() !== listType) {
        list = document.createElement(listType);
        if (listType === 'ol' && explicitNumber && explicitNumber > 1) {
          list.setAttribute('start', String(explicitNumber));
        }
        parent.append(list);
      }
      const item = document.createElement('li');
      if (listType === 'ol' && explicitNumber && list.children.length > 0) {
        item.value = explicitNumber;
      }
      appendInlineMarkdown(item, bullet?.[1] || numbered?.[2] || '');
      list.append(item);

      while (index + 1 < lines.length) {
        const nextLine = lines[index + 1];
        if (!nextLine.trim()) {
          index += 1;
          continue;
        }

        const indent = countLeadingSpaces(nextLine);
        const nestedFence = indent >= 2 ? nextLine.match(/^\s*```\s*([^`]*)\s*$/) : null;
        if (nestedFence) {
          const codeIndent = indent;
          const codeLanguage = nestedFence[1]?.trim() || '';
          const codeLines = [];
          index += 1;
          while (index + 1 < lines.length) {
            const codeLine = lines[index + 1];
            if (!codeLine.trim()) {
              codeLines.push('');
              index += 1;
              continue;
            }
            const codeLineIndent = countLeadingSpaces(codeLine);
            if (codeLineIndent >= codeIndent && codeLine.slice(codeIndent).match(/^```\s*$/)) {
              index += 1;
              break;
            }
            codeLines.push(codeLineIndent >= codeIndent ? codeLine.slice(codeIndent) : codeLine);
            index += 1;
          }
          appendCodeBlock(item, codeLines.join('\n'), codeLanguage);
          continue;
        }

        break;
      }
      continue;
    }

    list = null;
    if (!line.trim()) {
      parent.append(document.createElement('br'));
      continue;
    }
    const paragraph = document.createElement('p');
    appendInlineMarkdown(paragraph, line);
    parent.append(paragraph);
  }

  if (inCodeBlock) {
    appendCodeBlock(parent, codeLines.join('\n'), codeLanguage);
  }
}

function messageTextWithoutAttachmentPreview(node) {
  const clone = node.cloneNode(true);
  clone.querySelectorAll('.message-attachments, .message-actions, .code-block-header').forEach((preview) => preview.remove());
  return clone.textContent || '';
}


function isRunningJobHistoryMessage(item) {
  return typeof item?.id === 'string'
    && item.id.startsWith('job_')
    && item.role === 'assistant'
    && !item.completedAt
    && (isPlaceholderPendingText(item.text) || item.jobState === 'queued' || item.jobState === 'running');
}

function isPlaceholderPendingText(text) {
  const normalized = typeof text === 'string' ? text.trim() : '';
  return normalized === '응답 대기 중입니다…' || normalized === '응답을 처리 중입니다…' || /^응답을 처리 중입니다\s*\(\d+초\)$/.test(normalized);
}

function renderHistoryItem(item) {
  if (typeof item?.role !== 'string' || typeof item?.text !== 'string') {
    return;
  }

  if (isRunningJobHistoryMessage(item) && !isPlaceholderPendingText(item.text)) {
    appendMessage('assistant', item.text, {
      id: `${item.id}:partial`,
      savedAt: item.savedAt,
      persist: false,
      autoScroll: false,
      suppressScrollButton: true,
      mediaRefs: mediaRefsFromHistoryAttachments(item.attachments),
    });
    appendMessage('assistant', '응답을 처리 중입니다…', {
      id: item.id,
      savedAt: item.savedAt,
      persist: false,
      autoScroll: false,
      suppressScrollButton: true,
      pending: true,
    });
    return;
  }

  appendMessage(item.role, item.text, {
    id: item.id,
    savedAt: item.savedAt,
    completedAt: item.completedAt,
    persist: false,
    autoScroll: false,
    suppressScrollButton: true,
    mediaRefs: mediaRefsFromHistoryAttachments(item.attachments),
    pending: isPendingHistoryMessage(item),
  });
}

function currentRenderedHistorySignature() {
  return [...elements.messages.querySelectorAll('.message')]
    .map((node) => `${[...node.classList].find((className) => className !== 'message') || ''}:${messageTextWithoutAttachmentPreview(node)}`)
    .join('\n---\n');
}

function historySignature(history) {
  return history.map((item) => `${item.id || ''}:${item.role}:${item.text}:${item.jobId || ''}:${item.completedAt || ''}`).join('\n---\n');
}

function isPendingHistoryMessage(item) {
  return isRunningJobHistoryMessage(item) && isPlaceholderPendingText(item.text);
}

function shouldRerenderHistory(history) {
  return history.length > 0 && historySignature(history) !== currentRenderedHistorySignature();
}

function renderHistorySnapshot(history) {
  const shouldFollow = isNearBottom();
  const previousBottomOffset = elements.messages.scrollHeight - elements.messages.scrollTop;
  clearRenderedMessages();
  renderHistoryLoadMoreControl();
  for (const item of history) {
    renderHistoryItem(item);
  }
  if (shouldFollow) {
    scrollToBottom({ force: true });
    return;
  }
  preserveScrollAfterRender(previousBottomOffset);
  if (history.some((item) => typeof item?.role === 'string' && item.role !== 'user' && !isPendingHistoryMessage(item))) {
    showScrollToLatestButton();
  }
}

async function fetchChangedHistory() {
  const meta = await fetchHistoryMeta();
  if (lastHistoryVersion && meta.version === lastHistoryVersion) {
    return null;
  }
  const history = await fetchHistory();
  lastHistoryVersion = meta.version || lastHistoryVersion;
  return history;
}

async function refreshHistoryIfChanged() {
  if (!canUseApi() || document.hidden || !activeConversation?.id) {
    return;
  }

  try {
    const history = await fetchChangedHistory();
    if (!history) {
      return;
    }
    reconcilePendingJobWithHistory(history);
    if (shouldRerenderHistory(history)) {
      renderHistorySnapshot(history);
    }
  } catch {
    // Polling is best-effort; explicit sends/connection tests surface errors.
  }
}


function reconcilePendingJobWithHistory(history, conversationId = activeConversationId()) {
  const pendingJob = loadPendingJob(conversationId);
  if (!pendingJob?.job_id || !Array.isArray(history)) {
    return;
  }
  const matchingMessage = history.find((item) => item?.id === pendingJob.job_id);
  if (!matchingMessage) {
    clearPendingJob(conversationId);
    if (isActiveConversation(conversationId)) {
      setStatus('');
      setSending(false);
      const node = elements.messages.querySelector(`[data-message-id="${pendingJob.job_id}"]`);
      if (node) {
        node.remove();
      }
    }
    return;
  }
  if (isRunningJobHistoryMessage(matchingMessage)) {
    return;
  }
  clearPendingJob(conversationId);
  if (isActiveConversation(conversationId)) {
    setStatus('');
    setSending(false);
    const node = elements.messages.querySelector(`[data-message-id="${pendingJob.job_id}"]`);
    if (node) {
      node.classList.remove('pending');
    }
  }
}

function shouldPollHistory() {
  return canUseApi() && !document.hidden && Boolean(activeConversation?.id);
}

function startHistoryPolling() {
  if (historyPollTimer || !shouldPollHistory()) {
    return;
  }
  historyPollTimer = window.setInterval(refreshHistoryIfChanged, 5000);
}

function stopHistoryPolling() {
  if (!historyPollTimer) {
    return;
  }
  window.clearInterval(historyPollTimer);
  historyPollTimer = null;
}

function syncHistoryPolling() {
  if (shouldPollHistory()) {
    startHistoryPolling();
    return;
  }
  stopHistoryPolling();
}

function stopConversationEvents() {
  if (conversationEventRefreshTimer) {
    clearTimeout(conversationEventRefreshTimer);
    conversationEventRefreshTimer = null;
  }
  if (conversationEventSource) {
    conversationEventSource.close();
  }
  conversationEventSource = null;
  conversationEventConversationId = '';
}

function startConversationEvents(conversationId = activeConversationId()) {
  if (!canUseApi() || !conversationId || typeof EventSource === 'undefined') {
    stopConversationEvents();
    return;
  }
  if (conversationEventSource && conversationEventConversationId === conversationId) {
    return;
  }
  stopConversationEvents();
  conversationEventConversationId = conversationId;
  const eventsUrl = apiUrl(`/v1/conversations/${encodeURIComponent(conversationId)}/events`);
  const source = new EventSource(eventsUrl, { withCredentials: true });
  conversationEventSource = source;
  source.addEventListener('conversation', (event) => {
    if (conversationEventConversationId !== conversationId) {
      return;
    }
    scheduleConversationEventRefresh(conversationId);
  });
  source.onerror = () => {
    // EventSource reconnects automatically. History polling remains the durable fallback.
  };
}

function scheduleConversationEventRefresh(conversationId = activeConversationId()) {
  if (!conversationId) {
    return;
  }
  if (conversationEventRefreshTimer) {
    clearTimeout(conversationEventRefreshTimer);
  }
  conversationEventRefreshTimer = window.setTimeout(async () => {
    conversationEventRefreshTimer = null;
    await refreshConversations().catch(() => {});
    if (conversationId === activeConversationId()) {
      await refreshHistoryIfChanged();
    }
  }, 150);
}

function extractMediaRefs(text) {
  const refs = [];
  const visibleLines = [];
  let inCodeBlock = false;

  for (const line of text.split('\n')) {
    const fenceMatch = line.match(/^\s*```/);
    if (fenceMatch) {
      inCodeBlock = !inCodeBlock;
      visibleLines.push(line);
      continue;
    }

    if (!inCodeBlock) {
      const mediaMatch = line.match(/^\s*MEDIA:\s*(.+?)\s*$/);
      if (mediaMatch) {
        refs.push(mediaMatch[1].trim());
        continue;
      }
    }

    visibleLines.push(line);
  }

  const visibleText = visibleLines.join('\n').trim();
  return { text: visibleText || (refs.length > 0 ? '' : text), refs };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function applyMediaViewerTransform() {
  const { scale, x, y } = mediaViewerTransform;
  elements.mediaViewerImage.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
  elements.mediaViewerImage.classList.toggle('zoomed', scale > 1.01);
}

function resetMediaViewerZoom() {
  mediaViewerTransform = { scale: 1, x: 0, y: 0 };
  mediaViewerPointers.clear();
  mediaViewerGestureStart = null;
  applyMediaViewerTransform();
}

function pointerDistance(first, second) {
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
}

function pointerMidpoint(first, second) {
  return {
    x: (first.clientX + second.clientX) / 2,
    y: (first.clientY + second.clientY) / 2,
  };
}

function beginMediaViewerGesture() {
  const pointers = [...mediaViewerPointers.values()];
  if (pointers.length >= 2) {
    const [first, second] = pointers;
    mediaViewerGestureStart = {
      mode: 'pinch',
      distance: Math.max(1, pointerDistance(first, second)),
      midpoint: pointerMidpoint(first, second),
      scale: mediaViewerTransform.scale,
      x: mediaViewerTransform.x,
      y: mediaViewerTransform.y,
    };
    return;
  }
  if (pointers.length === 1) {
    const [pointer] = pointers;
    mediaViewerGestureStart = {
      mode: 'pan',
      clientX: pointer.clientX,
      clientY: pointer.clientY,
      x: mediaViewerTransform.x,
      y: mediaViewerTransform.y,
    };
  }
}

function updateMediaViewerGesture() {
  const pointers = [...mediaViewerPointers.values()];
  if (pointers.length >= 2 && mediaViewerGestureStart?.mode === 'pinch') {
    const [first, second] = pointers;
    const midpoint = pointerMidpoint(first, second);
    const scale = clamp(mediaViewerGestureStart.scale * (pointerDistance(first, second) / mediaViewerGestureStart.distance), 1, 5);
    mediaViewerTransform = {
      scale,
      x: scale <= 1.01 ? 0 : mediaViewerGestureStart.x + midpoint.x - mediaViewerGestureStart.midpoint.x,
      y: scale <= 1.01 ? 0 : mediaViewerGestureStart.y + midpoint.y - mediaViewerGestureStart.midpoint.y,
    };
    applyMediaViewerTransform();
    return;
  }
  if (pointers.length === 1 && mediaViewerGestureStart?.mode === 'pan' && mediaViewerTransform.scale > 1.01) {
    const [pointer] = pointers;
    mediaViewerTransform = {
      ...mediaViewerTransform,
      x: mediaViewerGestureStart.x + pointer.clientX - mediaViewerGestureStart.clientX,
      y: mediaViewerGestureStart.y + pointer.clientY - mediaViewerGestureStart.clientY,
    };
    applyMediaViewerTransform();
  }
}

function handleMediaViewerPointerDown(event) {
  if (elements.mediaViewer.classList.contains('hidden')) {
    return;
  }
  event.preventDefault();
  elements.mediaViewer.classList.add('gesturing');
  elements.mediaViewerImage.setPointerCapture?.(event.pointerId);
  mediaViewerPointers.set(event.pointerId, event);
  beginMediaViewerGesture();
}

function handleMediaViewerPointerMove(event) {
  if (!mediaViewerPointers.has(event.pointerId)) {
    return;
  }
  event.preventDefault();
  mediaViewerPointers.set(event.pointerId, event);
  updateMediaViewerGesture();
}

function handleMediaViewerPointerEnd(event) {
  if (!mediaViewerPointers.has(event.pointerId)) {
    return;
  }
  mediaViewerPointers.delete(event.pointerId);
  elements.mediaViewerImage.releasePointerCapture?.(event.pointerId);
  if (mediaViewerPointers.size === 0) {
    elements.mediaViewer.classList.remove('gesturing');
  }
  beginMediaViewerGesture();
}

function handleMediaViewerWheel(event) {
  if (elements.mediaViewer.classList.contains('hidden')) {
    return;
  }
  event.preventDefault();
  const nextScale = clamp(mediaViewerTransform.scale + (event.deltaY < 0 ? 0.25 : -0.25), 1, 5);
  mediaViewerTransform = {
    scale: nextScale,
    x: nextScale <= 1.01 ? 0 : mediaViewerTransform.x,
    y: nextScale <= 1.01 ? 0 : mediaViewerTransform.y,
  };
  applyMediaViewerTransform();
}

function toggleMediaViewerZoom() {
  if (elements.mediaViewer.classList.contains('hidden')) {
    return;
  }
  const nextScale = mediaViewerTransform.scale > 1.01 ? 1 : 2.5;
  mediaViewerTransform = {
    scale: nextScale,
    x: 0,
    y: 0,
  };
  applyMediaViewerTransform();
}

function openMediaViewer(url, fileName = 'openclaw-image.png') {
  mediaViewerCurrentUrl = url;
  mediaViewerCurrentName = fileName || 'openclaw-image.png';
  resetMediaViewerZoom();
  elements.mediaViewerImage.src = url;
  elements.mediaViewerImage.alt = mediaViewerCurrentName;
  elements.mediaViewerDownload.href = url;
  elements.mediaViewerDownload.download = mediaViewerCurrentName;
  elements.mediaViewer.classList.remove('hidden');
  if (!mediaViewerHistoryActive) {
    window.history.pushState({ openclawMediaViewer: true }, '');
    mediaViewerHistoryActive = true;
  }
}

function closeMediaViewer(options = {}) {
  const { syncHistory = true } = options;
  if (syncHistory && mediaViewerHistoryActive) {
    window.history.back();
    return;
  }
  elements.mediaViewer.classList.add('hidden');
  elements.mediaViewerImage.removeAttribute('src');
  elements.mediaViewerDownload.removeAttribute('href');
  mediaViewerCurrentUrl = '';
  mediaViewerHistoryActive = false;
  resetMediaViewerZoom();
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(reader.error || new Error('파일을 읽지 못했습니다.'));
    reader.readAsDataURL(blob);
  });
}

async function downloadUrlThroughClient(url, fileName, trigger, event) {
  if (!url || !window.OpenClawAndroid?.downloadBlob) {
    return false;
  }
  event?.preventDefault();
  const originalText = trigger?.textContent;
  if (trigger) {
    trigger.textContent = '저장 중…';
  }
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const blob = await response.blob();
    const base64 = await blobToBase64(blob);
    window.OpenClawAndroid.downloadBlob(fileName, blob.type || 'application/octet-stream', base64);
    return true;
  } catch (error) {
    appendMessage('system', `다운로드 실패: ${error instanceof Error ? error.message : String(error)}`, { persist: false });
    return false;
  } finally {
    if (trigger && originalText) {
      trigger.textContent = originalText;
    }
  }
}

async function downloadCurrentMedia(event) {
  if (!mediaViewerCurrentUrl) {
    return;
  }
  await downloadUrlThroughClient(mediaViewerCurrentUrl, mediaViewerCurrentName, elements.mediaViewerDownload, event);
}

function mediaRefsFromHistoryAttachments(attachments) {
  if (!Array.isArray(attachments)) {
    return [];
  }
  return attachments
    .filter((attachment) => typeof attachment?.path === 'string')
    .map((attachment) => ({
      path: attachment.path,
      name: attachment.name,
      type: attachment.mime_type,
      size: attachment.size,
    }));
}

async function getAuthorizedMediaUrl(ref) {
  if (mediaUrlCache.has(ref)) {
    const cached = mediaUrlCache.get(ref);
    mediaUrlCache.delete(ref);
    mediaUrlCache.set(ref, cached);
    return cached;
  }

  const response = await fetch(`${settings.apiUrl}/v1/media?path=${encodeURIComponent(ref)}`, {
    credentials: 'include',
    headers: await historyHeaders(),
    cache: 'force-cache',
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  mediaUrlCache.set(ref, url);
  pruneMediaUrlCache();
  return url;
}

function appendMediaRef(parent, rawRef) {
  const refInfo = typeof rawRef === 'string' ? { path: rawRef } : rawRef;
  const ref = normalizeMediaRefPath(refInfo?.path);
  if (!ref || isPlaceholderMediaRef(ref)) {
    return;
  }
  const refKey = canonicalMediaRefKey(ref);
  if (!refKey) {
    return;
  }

  const preview = parent.querySelector('.message-attachments') || document.createElement('div');
  preview.className = 'message-attachments';
  preview._mediaRefKeys ||= new Set([...preview.querySelectorAll('[data-media-ref-key]')].map((item) => item.dataset.mediaRefKey));
  if (preview._mediaRefKeys.has(refKey)) {
    return;
  }
  preview._mediaRefKeys.add(refKey);
  if (!preview.parentElement) {
    parent.append(preview);
  }

  const item = document.createElement('div');
  item.className = 'message-attachment';
  item.dataset.mediaRefKey = refKey;
  const isRemote = /^https?:\/\//i.test(ref);
  const fileName = refInfo.name || ref.split('/').pop() || ref;
  const displayName = shortenFileName(fileName);
  const captionText = refInfo.size ? `${displayName} · ${formatBytes(refInfo.size)}` : displayName;
  let image = null;

  if (isImageRef(ref) || refInfo.type?.startsWith('image/')) {
    image = document.createElement('img');
    image.alt = fileName;
    image.loading = 'lazy';
    item.classList.add('image-attachment');
    item.append(image);
  } else {
    const icon = document.createElement('span');
    icon.className = 'attachment-file-icon';
    icon.textContent = '📎';
    item.append(icon);
  }

  const caption = document.createElement('a');
  caption.className = 'attachment-caption';
  caption.textContent = captionText;
  caption.target = '_blank';
  caption.rel = 'noopener noreferrer';
  caption.download = fileName;
  item.append(caption);

  const downloadLink = image ? null : document.createElement('a');
  if (downloadLink) {
    downloadLink.className = 'attachment-download-button';
    downloadLink.textContent = '다운로드';
    downloadLink.download = fileName;
    downloadLink.target = '_blank';
    downloadLink.rel = 'noopener noreferrer';
    downloadLink.setAttribute('aria-disabled', 'true');
    item.append(downloadLink);
  }
  preview.append(item);

  const wireImageViewer = (url) => {
    if (!image) {
      return;
    }
    const open = (event) => {
      event.preventDefault();
      openMediaViewer(url, fileName);
    };
    image.addEventListener('click', open);
    caption.addEventListener('click', open);
  };

  const wireDownload = (url) => {
    if (!downloadLink) {
      return;
    }
    downloadLink.href = url;
    downloadLink.removeAttribute('aria-disabled');
    downloadLink.addEventListener('click', (event) => {
      downloadUrlThroughClient(url, fileName, downloadLink, event);
    }, { once: false });
  };

  if (isRemote) {
    caption.href = ref;
    wireDownload(ref);
    if (image) {
      image.src = ref;
      wireImageViewer(ref);
    }
    return;
  }

  if (mediaUrlCache.has(ref)) {
    const cachedUrl = mediaUrlCache.get(ref);
    caption.href = cachedUrl;
    caption.textContent = captionText;
    wireDownload(cachedUrl);
    if (image) {
      image.src = cachedUrl;
      wireImageViewer(cachedUrl);
    }
    return;
  }

  caption.removeAttribute('href');
  caption.textContent = `${captionText} · 불러오는 중`;
  getAuthorizedMediaUrl(ref)
    .then((url) => {
      caption.href = url;
      caption.textContent = captionText;
      wireDownload(url);
      if (image) {
        image.src = url;
        wireImageViewer(url);
      }
    })
    .catch(() => {
      caption.textContent = `${captionText} · 불러오기 실패`;
      if (image) {
        item.replaceChildren();
        const icon = document.createElement('span');
        icon.className = 'attachment-file-icon';
        icon.textContent = '⚠️';
        item.append(icon, caption);
      }
    });
}

function retryTextForNode(node) {
  let current = node.previousElementSibling;
  while (current) {
    if (current.classList?.contains('user')) {
      return messageTextWithoutAttachmentPreview(current).replace(/\n\n첨부 파일:\n[\s\S]*$/, '').trim();
    }
    current = current.previousElementSibling;
  }
  return '';
}

function ensureMessageActions(node) {
  let actions = node.querySelector(':scope > .message-actions');
  if (!actions) {
    actions = document.createElement('div');
    actions.className = 'message-actions';
    node.append(actions);
  }
  return actions;
}

function appendCopyAction(node, role, text, options = {}) {
  if (options.pending || !['user', 'assistant', 'system'].includes(role)) {
    return;
  }
  const copyText = extractMediaRefs(text).text.trim();
  if (!copyText) {
    return;
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'message-copy-button';
  button.setAttribute('aria-label', '메시지 원문 복사');
  button.title = '메시지 원문 복사';
  button.innerHTML = '<svg class="message-copy-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 7.5V5.75A2.75 2.75 0 0 1 10.75 3h6.5A2.75 2.75 0 0 1 20 5.75v8.5A2.75 2.75 0 0 1 17.25 17H15.5"/><path d="M3.75 7h7.5A2.75 2.75 0 0 1 14 9.75v8.5A2.75 2.75 0 0 1 11.25 21h-7.5A2.75 2.75 0 0 1 1 18.25v-8.5A2.75 2.75 0 0 1 3.75 7Z"/></svg>';
  button.addEventListener('click', async () => {
    try {
      await copyTextToClipboard(copyText);
      button.classList.add('copied');
      window.setTimeout(() => { button.classList.remove('copied'); }, 900);
    } catch {
      button.classList.add('copy-failed');
      window.setTimeout(() => { button.classList.remove('copy-failed'); }, 900);
    }
  });
  node.append(button);
}

function appendRetryAction(node, role, text) {
  if (role !== 'system' || !text.startsWith('전송 실패:')) {
    return;
  }
  const retryText = retryTextForNode(node);
  if (!retryText) {
    return;
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'message-action-button';
  button.textContent = '다시 시도';
  button.addEventListener('click', () => {
    elements.messageInput.value = retryText;
    saveComposerDraft();
    autoResizeTextarea();
    elements.messageInput.focus();
  });
  ensureMessageActions(node).append(button);
}

function appendCancelJobAction(node, role, text, options = {}) {
  const jobId = node.dataset.messageId;
  const normalizedRole = String(role || '').split(/\s+/)[0];
  const rawText = typeof text === 'string' ? text.trim() : '';
  const looksPending = options.pending || rawText === '응답 대기 중입니다…' || rawText === '응답을 처리 중입니다…' || /^응답을 처리 중입니다\s*\(\d+초\)$/.test(rawText);
  if (!looksPending || normalizedRole !== 'assistant' || !jobId?.startsWith('job_')) {
    return;
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'message-cancel-button';
  button.title = '이 응답 작업 중지';
  button.setAttribute('aria-label', '이 응답 작업 중지');
  button.addEventListener('click', async () => {
    const conversationId = activeConversationId();
    button.disabled = true;
    button.setAttribute('aria-label', '응답 작업 중지 중');
    setStatus('응답을 중지하는 중입니다...');
    try {
      await cancelJob(jobId, conversationId);
      clearPendingJob(conversationId);
      await refreshHistoryIfChanged();
      await refreshConversations().catch(() => {});
      showToast('응답을 중지했습니다.', { kind: 'success' });
      setStatus('');
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (error?.status === 404 || detail.includes('Job not found or already finished.')) {
        clearPendingJob(conversationId);
        node.remove();
        await refreshHistoryIfChanged().catch(() => {});
        await refreshConversations().catch(() => {});
        showToast('이미 끝난 작업이라 남아 있던 처리중 표시를 정리했습니다.', { kind: 'success' });
        setStatus('');
        return;
      }
      button.disabled = false;
      button.setAttribute('aria-label', '이 응답 작업 중지');
      appendMessage('system', detail, { persist: false });
      setStatus('');
    }
  });
  node.append(button);
}

function renderMessageNode(node, role, text, options = {}) {
  const wasNearBottom = isNearBottom();
  const media = extractMediaRefs(text);
  node.className = `message ${role}${options.pending ? ' pending' : ''}`;
  node.replaceChildren();
  appendMarkdown(node, media.text);
  const mediaRefs = [];
  const seenMediaRefs = new Set();
  for (const ref of [...media.refs, ...(node._mediaRefs || [])]) {
    const refPath = typeof ref === 'string' ? ref : ref?.path;
    const refKey = canonicalMediaRefKey(refPath);
    if (!refKey || seenMediaRefs.has(refKey)) {
      continue;
    }
    seenMediaRefs.add(refKey);
    mediaRefs.push(ref);
  }
  for (const ref of mediaRefs) {
    appendMediaRef(node, ref);
  }
  appendCopyAction(node, role, text, options);
  appendRetryAction(node, role, text);
  appendCancelJobAction(node, role, text, options);
  if (options.autoScroll === false) {
    if (!wasNearBottom && !options.pending && !options.suppressScrollButton) {
      showScrollToLatestButton();
    }
    return;
  }
  scrollToBottom({ ...options, autoScroll: options.force || wasNearBottom });
}

function appendAttachmentPreview(parent, files) {
  if (!files?.length) {
    return;
  }

  const preview = document.createElement('div');
  preview.className = 'message-attachments';

  for (const file of files) {
    const item = document.createElement('div');
    item.className = 'message-attachment';

    if (file.type?.startsWith('image/')) {
      const image = document.createElement('img');
      image.src = URL.createObjectURL(file);
      image.alt = file.name;
      image.loading = 'lazy';
      image.addEventListener('load', () => URL.revokeObjectURL(image.src), { once: true });
      item.classList.add('image-attachment');
      item.append(image);
    } else {
      const icon = document.createElement('span');
      icon.className = 'attachment-file-icon';
      icon.textContent = '📎';
      item.append(icon);
    }

    const caption = document.createElement('span');
    caption.className = 'attachment-caption';
    caption.textContent = `${file.name} · ${formatBytes(file.size)}`;
    item.append(caption);
    preview.append(item);
  }

  parent.append(preview);
}

function appendMessage(role, text, options = {}) {
  const node = document.createElement('article');
  if (options.id) {
    node.dataset.messageId = options.id;
  }
  const timestamp = options.pending ? '' : formatMessageTimestamp(options.completedAt || options.savedAt);
  if (timestamp && (role === 'user' || role === 'assistant')) {
    node.dataset.messageTime = timestamp;
  }
  node._mediaRefs = options.mediaRefs || [];
  renderMessageNode(node, role, text, options);
  appendAttachmentPreview(node, options.files || []);
  if (options.pending) {
    node.classList.add('pending');
  }
  elements.messages.append(node);
  if (options.autoScroll === false) {
    if (!isNearBottom() && !options.pending && !options.suppressScrollButton) {
      showScrollToLatestButton();
    }
  } else {
    scrollToBottom(options);
  }
  if (options.persist !== false) {
    persistMessage(role, text);
  }
  return node;
}

function startThinkingMessage(options = {}) {
  const startedAt = options.startedAt || Date.now();
  const label = options.label || '응답을 작성 중입니다…';
  const node = appendMessage('assistant', `${label} (${Math.max(1, Math.round((Date.now() - startedAt) / 1000))}초)`, { persist: false });
  node.classList.add('pending');
  const timer = window.setInterval(() => {
    const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    renderMessageNode(node, 'assistant pending', `${label} (${elapsedSeconds}초)`, { autoScroll: false });
  }, 1000);
  return {
    node,
    stop() {
      window.clearInterval(timer);
      node.classList.remove('pending');
    },
  };
}

function setSending(isSending) {
  isSendingMessage = isSending;
  updateComposerAvailability();
  if (elements.continueNewSessionButton) {
    elements.continueNewSessionButton.disabled = isSending;
  }
  updateComposerAvailability();
}

function isActiveConversation(conversationId) {
  return conversationId && conversationId === activeConversationId();
}

function locationErrorMessage(error) {
  const rawMessage = error?.message || '';
  if (rawMessage.includes('Only secure origins are allowed') || !window.isSecureContext) {
    return '현재 위치는 HTTPS 또는 localhost 접속에서만 사용할 수 있습니다. HTTPS 주소로 접속한 뒤 다시 시도해주세요.';
  }
  if (error?.code === 1) {
    return '브라우저에서 위치 권한이 거부되었습니다. 주소창의 사이트 권한에서 위치를 허용해주세요.';
  }
  if (error?.code === 2) {
    return '현재 위치를 확인하지 못했습니다. GPS/위치 서비스를 켠 뒤 다시 시도해주세요.';
  }
  if (error?.code === 3) {
    return '현재 위치 확인 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.';
  }
  return rawMessage || '현재 위치를 가져오지 못했습니다.';
}

function locationMetadata(position) {
  const { latitude, longitude, accuracy } = position.coords;
  return {
    latitude,
    longitude,
    accuracy,
    captured_at: new Date(position.timestamp || Date.now()).toISOString(),
  };
}

function getCurrentPosition(options) {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

async function getCurrentLocationMetadata() {
  if (!navigator.geolocation) {
    throw new Error('이 브라우저는 현재 위치 기능을 지원하지 않습니다.');
  }

  try {
    const position = await getCurrentPosition({
      enableHighAccuracy: false,
      timeout: 7000,
      maximumAge: 5 * 60 * 1000,
    });
    return locationMetadata(position);
  } catch (firstError) {
    try {
      const position = await getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0,
      });
      return locationMetadata(position);
    } catch (secondError) {
      throw new Error(locationErrorMessage(secondError || firstError));
    }
  }
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function canResizeSidebar() {
  return window.matchMedia(SIDEBAR_RESIZE_MEDIA).matches && !document.body.classList.contains('sidebar-collapsed');
}

function startSidebarResize(event) {
  if (!elements.conversationSidebar || !canResizeSidebar()) {
    return;
  }
  event.preventDefault();
  sidebarResizeState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startWidth: elements.conversationSidebar.getBoundingClientRect().width,
  };
  elements.sidebarResizeHandle?.setPointerCapture?.(event.pointerId);
  document.body.classList.add('sidebar-resizing');
}

function moveSidebarResize(event) {
  if (!sidebarResizeState || event.pointerId !== sidebarResizeState.pointerId) {
    return;
  }
  const nextWidth = sidebarResizeState.startWidth + event.clientX - sidebarResizeState.startX;
  document.documentElement.style.setProperty('--sidebar-width', `${clampSidebarWidth(nextWidth)}px`);
}

function finishSidebarResize(event) {
  if (!sidebarResizeState || event.pointerId !== sidebarResizeState.pointerId) {
    return;
  }
  const nextWidth = sidebarResizeState.startWidth + event.clientX - sidebarResizeState.startX;
  saveSidebarWidth(nextWidth);
  elements.sidebarResizeHandle?.releasePointerCapture?.(event.pointerId);
  sidebarResizeState = null;
  document.body.classList.remove('sidebar-resizing');
}

function cancelSidebarResize() {
  if (!sidebarResizeState) {
    return;
  }
  sidebarResizeState = null;
  document.body.classList.remove('sidebar-resizing');
}

function syncSidebarWidthToViewport() {
  applyStoredSidebarWidth();
}

async function sendMessage(message, attachments = [], metadata = undefined) {
  const conversation = await ensureActiveConversation();
  const response = await apiFetch('/v1/message', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(await historyHeaders()),
    },
    body: JSON.stringify({ conversation_id: conversation.id, message, attachments, ...(metadata ? { metadata } : {}) }),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = body?.error?.message || `HTTP ${response.status}`;
    throw new Error(detail);
  }
  return body;
}

function pendingJobStorageKey(conversationId = activeConversationId()) {
  return `${PENDING_JOB_KEY}:${settings.apiUrl}:${authUser?.id || settings.apiKey || 'anonymous'}:${conversationId || 'no-conversation'}`;
}

function savePendingJob(job, conversationId = activeConversationId()) {
  localStorage.setItem(pendingJobStorageKey(conversationId), JSON.stringify(job));
  if (isActiveConversation(conversationId)) {
    ensurePendingJobBubble(job.job_id, conversationId);
    updateComposerAvailability();
  }
}

function ensurePendingJobBubble(jobId, conversationId = activeConversationId()) {
  if (!jobId || !isActiveConversation(conversationId)) {
    return null;
  }

  let node = elements.messages.querySelector(`[data-message-id="${jobId}"]`);
  if (!node) {
    return null;
  }

  if (!node.querySelector(':scope > .message-cancel-button')) {
    const text = messageTextWithoutAttachmentPreview(node).trim() || '응답 대기 중입니다…';
    renderMessageNode(node, 'assistant', text, { pending: true, autoScroll: false, suppressScrollButton: true });
  }
  return node;
}

function loadPendingJob(conversationId = activeConversationId()) {
  try {
    const parsed = JSON.parse(localStorage.getItem(pendingJobStorageKey(conversationId)) || 'null');
    return parsed?.job_id ? parsed : null;
  } catch {
    return null;
  }
}

function clearPendingJob(conversationId = activeConversationId()) {
  localStorage.removeItem(pendingJobStorageKey(conversationId));
  if (isActiveConversation(conversationId)) {
    updateComposerAvailability();
  }
}

function pendingJobStoragePrefix() {
  return `${PENDING_JOB_KEY}:${settings.apiUrl}:${authUser?.id || settings.apiKey || 'anonymous'}:`;
}

async function pruneStoredPendingJobs(conversationList = conversations) {
  const prefix = pendingJobStoragePrefix();
  const knownConversationIds = new Set((conversationList || []).map((conversation) => conversation?.id).filter(Boolean));
  const keys = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key?.startsWith(prefix)) {
      keys.push(key);
    }
  }

  for (const key of keys) {
    const conversationId = key.slice(prefix.length);
    let pendingJob = null;
    try {
      pendingJob = JSON.parse(localStorage.getItem(key) || 'null');
    } catch {
      localStorage.removeItem(key);
      continue;
    }
    if (!conversationId || !pendingJob?.job_id || (knownConversationIds.size > 0 && !knownConversationIds.has(conversationId))) {
      localStorage.removeItem(key);
      continue;
    }
    try {
      const job = await fetchJob(pendingJob.job_id, conversationId);
      if (isTerminalJobState(job.state)) {
        localStorage.removeItem(key);
      }
    } catch (error) {
      if (error?.status === 404) {
        localStorage.removeItem(key);
      }
    }
  }
}

async function fetchConversationHistory(conversationId) {
  const response = await apiFetch('/v1/history', {
    params: { conversation_id: conversationId },
    headers: await historyHeaders(),
  });
  if (!response.ok) {
    throw new Error(`대화 기록을 불러오지 못했습니다: HTTP ${response.status}`);
  }
  const body = await response.json();
  return Array.isArray(body.messages) ? body.messages : [];
}

async function fetchJob(jobId, conversationId = activeConversationId()) {
  const response = await apiFetch(`/v1/jobs/${encodeURIComponent(jobId)}`, {
    params: { conversation_id: conversationId },
    headers: await historyHeaders(),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(body?.error?.message || `Job HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

async function cancelJob(jobId, conversationId = activeConversationId()) {
  const response = await apiFetch(`/v1/jobs/${encodeURIComponent(jobId)}/cancel`, {
    params: { conversation_id: conversationId },
    method: 'POST',
    headers: await historyHeaders(),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(body?.error?.message || `Cancel HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

async function cancelActiveJob() {
  const conversationId = activeConversationId();
  const pendingJob = loadPendingJob(conversationId);
  if (!pendingJob?.job_id) {
    return false;
  }
  setSending(true);
  setStatus('응답을 중지하는 중입니다...');
  try {
    await cancelJob(pendingJob.job_id, conversationId);
    clearPendingJob(conversationId);
    await refreshHistoryIfChanged();
    await refreshConversations().catch(() => {});
    showToast('응답을 중지했습니다.', { kind: 'success' });
    setStatus('');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (error?.status === 404 || detail.includes('Job not found or already finished.')) {
      clearPendingJob(conversationId);
      await refreshHistoryIfChanged().catch(() => {});
      await refreshConversations().catch(() => {});
      showToast('이미 끝난 작업이라 남아 있던 처리중 표시를 정리했습니다.', { kind: 'success' });
      setStatus('');
      return true;
    }
    appendMessage('system', detail, { persist: false });
    setStatus('');
  } finally {
    setSending(false);
  }
  return true;
}


function isTerminalJobState(state) {
  return state === 'completed' || state === 'failed' || state === 'cancelled';
}

function parseSseBlock(block) {
  let event = 'message';
  const dataLines = [];
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith(':')) {
      continue;
    }
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim() || 'message';
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart());
    }
  }
  if (!dataLines.length) {
    return { event, data: null };
  }
  const rawData = dataLines.join('\n');
  try {
    return { event, data: JSON.parse(rawData) };
  } catch {
    return { event, data: rawData };
  }
}

function applyStreamingToken(jobId, token, conversationId = activeConversationId()) {
  if (!token || !isActiveConversation(conversationId)) {
    return;
  }

  let node = elements.messages.querySelector(`[data-message-id="${jobId}"]`);
  if (!node) {
    node = appendMessage('assistant', '', { id: jobId, persist: false, pending: true });
  }

  const currentText = streamingTextByJob.get(jobId) || node._streamingText || (isPlaceholderPendingText(messageTextWithoutAttachmentPreview(node)) ? '' : messageTextWithoutAttachmentPreview(node));
  const nextText = `${currentText}${token}`;
  streamingTextByJob.set(jobId, nextText);
  node._streamingText = nextText;
  renderMessageNode(node, 'assistant', nextText, { pending: true });
  scheduleStreamingIdleCheckpoint(jobId, conversationId);
}

function streamingNodeText(node) {
  if (!node) {
    return '';
  }
  const visibleText = messageTextWithoutAttachmentPreview(node);
  const bufferedText = streamingTextByJob.get(node.dataset.messageId || '') || (typeof node._streamingText === 'string' ? node._streamingText : '');
  if (visibleText.length > bufferedText.length && !isPlaceholderPendingText(visibleText)) {
    return visibleText;
  }
  return bufferedText;
}

function clearStreamingState(jobId) {
  if (!jobId) {
    return;
  }
  window.clearTimeout(streamingIdleTimers.get(jobId));
  streamingIdleTimers.delete(jobId);
  streamingTextByJob.delete(jobId);
}

function nextPartialSegmentId(jobId) {
  const nodes = [...elements.messages.querySelectorAll(`[data-message-id^="${jobId}:partial:"]`)];
  let maxIndex = 0;
  for (const node of nodes) {
    const rawId = node.dataset.messageId || '';
    const index = Number(rawId.split(':').pop());
    if (Number.isFinite(index)) {
      maxIndex = Math.max(maxIndex, index);
    }
  }
  return `${jobId}:partial:${maxIndex + 1}`;
}

function flushStreamingCheckpointNow(jobId, conversationId = activeConversationId()) {
  window.clearTimeout(streamingIdleTimers.get(jobId));
  streamingIdleTimers.delete(jobId);
  if (!isActiveConversation(conversationId)) {
    return;
  }
  const node = elements.messages.querySelector(`[data-message-id="${jobId}"]`);
  const text = streamingNodeText(node);
  if (!node) {
    return;
  }
  if (!text.trim()) {
    renderMessageNode(node, 'assistant', '응답을 처리 중입니다…', { pending: true, autoScroll: false, suppressScrollButton: true });
    return;
  }
  if (text.trim().length < MIN_STREAMING_CHECKPOINT_CHARS) {
    streamingTextByJob.set(jobId, '');
    node._streamingText = '';
    renderMessageNode(node, 'assistant', '응답을 처리 중입니다…', { pending: true, autoScroll: false, suppressScrollButton: true });
    return;
  }

  const checkpoint = document.createElement('article');
  checkpoint.dataset.messageId = nextPartialSegmentId(jobId);
  node.before(checkpoint);
  renderMessageNode(checkpoint, 'assistant', text, { autoScroll: false, suppressScrollButton: true });
  streamingTextByJob.set(jobId, '');
  node._streamingText = '';
  renderMessageNode(node, 'assistant', '응답을 처리 중입니다…', { pending: true, autoScroll: false, suppressScrollButton: true });
}

function scheduleStreamingIdleCheckpoint(jobId, conversationId = activeConversationId()) {
  window.clearTimeout(streamingIdleTimers.get(jobId));
  streamingIdleTimers.delete(jobId);
}

async function waitForJobViaSse(jobId, onTick = () => {}, conversationId = activeConversationId(), onToken = () => {}) {
  if (!window.ReadableStream || !window.TextDecoder || !window.AbortController) {
    throw new Error('이 브라우저는 SSE fetch stream을 지원하지 않습니다.');
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 720_000);
  try {
    const response = await apiFetch(`/v1/jobs/${encodeURIComponent(jobId)}/events`, {
    params: { conversation_id: conversationId },
      headers: await historyHeaders(),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      const body = await response.json().catch(() => null);
      const error = new Error(body?.error?.message || `SSE HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

      let separatorIndex;
      while ((separatorIndex = buffer.search(/\r?\n\r?\n/)) >= 0) {
        const block = buffer.slice(0, separatorIndex);
        const match = buffer.slice(separatorIndex).match(/^\r?\n\r?\n/);
        buffer = buffer.slice(separatorIndex + (match ? match[0].length : 2));
        const message = parseSseBlock(block);
        if (message.event === 'expired') {
          clearStreamingState(jobId);
          clearPendingJob(conversationId);
          return { id: jobId, state: 'expired' };
        }
        if (message.event === 'token' && message.data?.token) {
          onToken(String(message.data.token));
          continue;
        }
        if (message.event === 'agent' && message.data?.stream === 'tool' && message.data?.data?.phase === 'start') {
          flushStreamingCheckpointNow(jobId, conversationId);
          continue;
        }
        if (message.event === 'job' && message.data) {
          const job = message.data;
          onTick(job);
          if (isTerminalJobState(job.state)) {
            clearStreamingState(jobId);
            clearPendingJob(conversationId);
            return job;
          }
        }
      }

      if (done) {
        break;
      }
    }
  } finally {
    window.clearTimeout(timeout);
  }

  throw new Error('SSE 응답이 완료 상태 없이 종료되었습니다.');
}

async function isJobResolvedInHistory(jobId, conversationId = activeConversationId()) {
  try {
    const history = isActiveConversation(conversationId) ? await fetchHistory() : await fetchConversationHistory(conversationId);
    return history.some((item) => item.id === jobId && !isPendingHistoryMessage(item));
  } catch {
    return false;
  }
}

async function waitForJob(jobId, onTick = () => {}, conversationId = activeConversationId(), onToken = () => {}) {
  ensurePendingJobBubble(jobId, conversationId);
  try {
    return await waitForJobViaSse(jobId, (job) => {
      if (!isTerminalJobState(job.state)) {
        ensurePendingJobBubble(jobId, conversationId);
      }
      onTick(job);
    }, conversationId, onToken);
  } catch (error) {
    console.warn('SSE job events unavailable; falling back to polling.', error);
  }

  let transientFailures = 0;
  let lastError = null;
  for (let attempt = 0; attempt < 240; attempt += 1) {
    await delay(attempt < 10 ? 1000 : 3000);
    try {
      const job = await fetchJob(jobId, conversationId);
      transientFailures = 0;
      lastError = null;
      if (!isTerminalJobState(job.state)) {
        ensurePendingJobBubble(jobId, conversationId);
      }
      onTick(job);
      if (isTerminalJobState(job.state)) {
        clearStreamingState(jobId);
        clearPendingJob(conversationId);
        return job;
      }
    } catch (error) {
      lastError = error;
      transientFailures += 1;
      if (await isJobResolvedInHistory(jobId, conversationId)) {
        clearStreamingState(jobId);
        clearPendingJob(conversationId);
        return { id: jobId, state: 'completed' };
      }
      if (error?.status === 404) {
        clearStreamingState(jobId);
        clearPendingJob(conversationId);
        return { id: jobId, state: 'expired' };
      }
      if (transientFailures >= 5) {
        throw lastError;
      }
    }
  }
  throw new Error('응답 작업 확인 시간이 초과되었습니다. 잠시 후 대화 기록을 새로고침해주세요.');
}

async function resumePendingJobIfNeeded() {
  const pendingJob = loadPendingJob();
  if (!pendingJob || !canUseApi()) {
    return;
  }

  setStatus('이전 응답 작업을 확인하는 중입니다...');
  await refreshHistoryIfChanged();

  try {
    const job = await waitForJob(pendingJob.job_id, undefined, activeConversationId());
    await renderHistory();
    if (job.state === 'failed') {
      notifyReplyReady('OpenClaw 응답 실패', job.error || '응답 작업이 실패했습니다.');
    } else if (job.state === 'completed') {
      notifyReplyReady();
    }
  } catch (error) {
    appendMessage('system', error instanceof Error ? error.message : String(error), { persist: false });
  } finally {
    setStatus('');
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  const rawMessage = elements.messageInput.value.trim();
  if (!rawMessage && selectedAttachments.length === 0) {
    return;
  }

  if (!canUseApi()) {
    appendMessage('system', '로그인 후 대화를 시작할 수 있습니다.');
    openSettingsPanel();
    return;
  }
  if (!activeConversation?.id) {
    appendMessage('system', '새 대화를 열거나 목록에서 대화를 선택한 뒤 메시지를 보내주세요.', { persist: false });
    return;
  }
  if (isConversationArchived(activeConversation)) {
    appendMessage('system', '보관된 대화입니다. 대화를 이어가려면 아카이브를 해제하세요.', { persist: false });
    updateComposerAvailability();
    return;
  }

  setSending(true);
  setStatus('메시지를 준비하는 중입니다...');

  try {
    const conversation = await ensureActiveConversation();
    const outgoingMessage = rawMessage || '첨부 파일을 확인하고 사용자의 의도에 맞게 분석해주세요.';
    const isSlashCommand = rawMessage.startsWith('/');
    const autoLocationOnHere = settings.autoLocationOnHere !== false;
    const shouldIncludeLocation = elements.includeLocationInput.checked || slashCommandUsesCurrentLocation(rawMessage) || (autoLocationOnHere && !isSlashCommand && rawMessage.includes('여기'));
    let metadata;
    if (shouldIncludeLocation) {
      setStatus('현재 위치를 가져오는 중입니다...');
      metadata = { location: await getCurrentLocationMetadata() };
    }

    setStatus('첨부 파일을 준비하는 중입니다...');
    const attachedFiles = [...selectedAttachments];
    const attachments = await buildAttachmentsPayload();
    const displayedUserText = `${outgoingMessage}${attachmentSummary(attachedFiles)}`;
    appendMessage('user', displayedUserText, { files: attachedFiles, savedAt: new Date().toISOString() });
    elements.messageInput.value = '';
    clearComposerDraft(conversation.id);
    autoResizeTextarea();
    selectedAttachments = [];
    renderAttachmentTray();
    elements.attachmentInput.value = '';
    elements.includeLocationInput.checked = false;
    setStatus('OpenClaw 응답을 기다리는 중입니다...');

    let activeJobId = null;
    try {
      const response = await sendMessage(outgoingMessage, attachments, metadata);
      await refreshConversations().catch(() => {});
      if (response.job_id) {
        activeJobId = response.job_id;
        const conversationId = response.conversation_id || conversation.id;
        savePendingJob({ job_id: response.job_id, startedAt: Date.now() }, conversationId);
        setSending(false);
        if (isActiveConversation(conversationId)) {
          setStatus('서버에서 응답을 처리 중입니다. 앱을 닫아도 작업은 계속됩니다.');
        }
        lastHistoryVersion = null;
        await refreshHistoryIfChanged();
        ensurePendingJobBubble(response.job_id, conversationId);
        let receivedStreamingToken = false;
        const job = await waitForJob(response.job_id, (jobUpdate) => {
          if (!isActiveConversation(conversationId)) {
            return;
          }
          if (!receivedStreamingToken || isTerminalJobState(jobUpdate.state)) {
            refreshHistoryIfChanged();
          }
        }, conversationId, (token) => {
          receivedStreamingToken = true;
          applyStreamingToken(response.job_id, token, conversationId);
        });
        if (isActiveConversation(conversationId)) {
          await renderHistory({ scrollToLatest: true });
        }
        await refreshConversations().catch(() => {});
        if (job.state === 'failed') {
          notifyReplyReady('OpenClaw 응답 실패', job.error || '응답 작업이 실패했습니다.');
        } else if (job.state === 'completed') {
          notifyReplyReady();
        }
      } else {
        appendMessage('assistant', response.reply || '(빈 응답)', { force: true, savedAt: new Date().toISOString() });
      }
      setStatus('');
      window.setTimeout(refreshHistoryIfChanged, 800);
      window.setTimeout(() => refreshConversations().catch(() => {}), 900);
    } catch (error) {
      if (activeJobId && await isJobResolvedInHistory(activeJobId, conversation.id)) {
        clearPendingJob();
        setStatus('');
        notifyReplyReady();
        return;
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (activeJobId) {
        setStatus('응답 상태 확인이 일시적으로 끊겼습니다. 대화 기록을 새로고침하면 이어서 확인합니다.');
        window.setTimeout(refreshHistoryIfChanged, 800);
        return;
      }
      elements.messageInput.value = rawMessage;
      saveComposerDraft(conversation.id);
      autoResizeTextarea();
      appendMessage('system', errorMessage, { persist: false });
      setStatus('');
    }
  } catch (error) {
    appendMessage('system', error instanceof Error ? error.message : String(error));
    setStatus('');
  } finally {
    setSending(false);
    if (!isMobileLikeInput()) {
      elements.messageInput.focus();
    }
  }
}

async function clearAppCacheAndReload() {
  setStatus('캐시를 삭제하는 중입니다...');
  pruneMediaUrlCache({ force: true, limit: 0 });
  try {
    if (navigator.serviceWorker?.getRegistrations) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
    if (window.caches?.keys) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
    if (window.OpenClawAndroid?.clearWebCache) {
      window.OpenClawAndroid.clearWebCache();
      window.setTimeout(() => window.location.reload(), 350);
      return;
    }
  } catch (error) {
    appendMessage('system', `캐시 삭제 실패: ${error instanceof Error ? error.message : String(error)}`, { persist: false });
  }
  window.location.reload();
}

async function resetPassword() {
  const currentPassword = window.prompt('현재 비밀번호를 입력하세요.');
  if (currentPassword === null) {
    return;
  }
  const newPassword = window.prompt('새 비밀번호를 입력하세요. 8자 이상이어야 합니다.');
  if (newPassword === null) {
    return;
  }
  const confirmPassword = window.prompt('새 비밀번호를 한 번 더 입력하세요.');
  if (confirmPassword === null) {
    return;
  }
  if (newPassword !== confirmPassword) {
    appendMessage('system', '새 비밀번호가 서로 일치하지 않습니다.', { persist: false });
    return;
  }
  try {
    const response = await apiFetch('/v1/auth/password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(body?.error?.message || `비밀번호 재설정 실패: HTTP ${response.status}`);
    }
    showToast('비밀번호를 변경했습니다.', { kind: 'success' });
  } catch (error) {
    appendMessage('system', error instanceof Error ? error.message : String(error), { persist: false });
  }
}

async function healthCheck() {
  settings = readSettingsFromForm();
  try {
    assertValidApiKey(settings.apiKey);
    const healthResponse = await fetch(`${settings.apiUrl}/health`);
    if (!healthResponse.ok) {
      throw new Error(`서버 상태 확인 실패: HTTP ${healthResponse.status}`);
    }
    const healthBody = await healthResponse.json();

    const authResponse = settings.apiKey
      ? await fetch(`${settings.apiUrl}/v1/message`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${settings.apiKey}`,
          'x-user-id': `${await sharedUserId()}-connection-test`,
          'x-openclaw-sync': '1',
        },
        body: JSON.stringify({ message: '연결 테스트입니다. OK만 답해주세요.' }),
      })
      : await apiFetch('/v1/auth/me');
    const authBody = await authResponse.json().catch(() => null);
    if (!authResponse.ok) {
      throw new Error(authBody?.error?.message || `인증 테스트 실패: HTTP ${authResponse.status}`);
    }

    appendMessage('system', `연결 성공: ${healthBody.status} / transport=${healthBody.transport}`);
  } catch (error) {
    appendMessage('system', `연결 실패: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function updateClearMessageInputButton() {
  elements.clearMessageInputButton?.classList.toggle('hidden', elements.messageInput.value.length === 0);
}

function autoResizeTextarea() {
  elements.messageInput.style.height = 'auto';
  const minHeight = Number.parseFloat(getComputedStyle(elements.messageInput).minHeight) || 74;
  elements.messageInput.style.height = `${Math.max(minHeight, Math.min(elements.messageInput.scrollHeight, 150))}px`;
  updateClearMessageInputButton();
}

function slashCommandQuery() {
  const value = elements.messageInput.value;
  const cursor = elements.messageInput.selectionStart ?? value.length;
  if (cursor !== value.length || !value.startsWith('/')) {
    return null;
  }
  if (value.includes('\n')) {
    return null;
  }
  return value.slice(1).trim().toLowerCase();
}

function matchingSlashCommands() {
  const query = slashCommandQuery();
  if (query === null) {
    return [];
  }
  return slashCommands.filter((item) => {
    const haystack = `${item.command} ${item.title} ${item.description}`.toLowerCase();
    return haystack.includes(query);
  });
}

function applySlashCommand(command) {
  elements.messageInput.value = command;
  saveComposerDraft();
  hideSlashCommandPalette();
  autoResizeTextarea();
  elements.messageInput.focus();
  elements.messageInput.setSelectionRange(command.length, command.length);
}

function hideSlashCommandPalette() {
  elements.slashCommandPalette.classList.add('hidden');
  elements.slashCommandPalette.replaceChildren();
}

function renderSlashCommandPalette() {
  const matches = matchingSlashCommands();
  elements.slashCommandPalette.replaceChildren();

  if (matches.length === 0) {
    hideSlashCommandPalette();
    return;
  }

  selectedSlashCommandIndex = Math.max(0, Math.min(selectedSlashCommandIndex, matches.length - 1));
  for (const [index, item] of matches.entries()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `slash-command-item${index === selectedSlashCommandIndex ? ' selected' : ''}`;
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', index === selectedSlashCommandIndex ? 'true' : 'false');
    button.addEventListener('click', () => applySlashCommand(item.command));

    const command = document.createElement('strong');
    command.textContent = item.command.trim();
    const text = document.createElement('span');
    text.textContent = `${item.title} · ${item.description}`;
    button.append(command, text);
    elements.slashCommandPalette.append(button);
  }

  elements.slashCommandPalette.classList.remove('hidden');
}

function acceptSelectedSlashCommand() {
  const matches = matchingSlashCommands();
  if (matches.length === 0) {
    return false;
  }
  applySlashCommand(matches[selectedSlashCommandIndex].command);
  return true;
}

applySettingsToForm();
renderHome();
updateChatTitle();
updateConversationSearchClearButton();
function startClientServerVersionPolling() {
  if (versionCheckTimer || document.hidden) {
    return;
  }
  versionCheckTimer = window.setInterval(checkClientServerVersion, 10 * 60 * 1000);
}

function stopClientServerVersionPolling() {
  if (!versionCheckTimer) {
    return;
  }
  window.clearInterval(versionCheckTimer);
  versionCheckTimer = null;
}

function syncPageLifecyclePolling() {
  syncHistoryPolling();
  if (document.hidden) {
    stopClientServerVersionPolling();
    return;
  }
  startClientServerVersionPolling();
  checkClientServerVersion();
  refreshHistoryIfChanged().catch(() => {});
}

document.addEventListener('visibilitychange', syncPageLifecyclePolling);
checkClientServerVersion();
startClientServerVersionPolling();
const initialConversationId = conversationIdFromPath();
(async () => {
  const user = await loadCurrentUser();
  if (!user && !settings.apiKey) {
    return;
  }
  await refreshConversations();
  if (user && !initialConversationId && !activeConversation?.id && conversations.length === 0) {
    await startNewConversation();
    return;
  }
  if (!initialConversationId) {
    renderHome();
    renderConversationList();
    return;
  }
  const selected = await selectConversation(initialConversationId, { replaceUrl: true });
  if (!selected) {
    goHome({ replaceUrl: true });
  }
})().catch((error) => appendMessage('system', error instanceof Error ? error.message : String(error), { persist: false }));
startHistoryPolling();

function persistSettingsFromForm(options = {}) {
  const previousApiKey = settings.apiKey;
  try {
    settings = readSettingsFromForm();
    assertValidApiKey(settings.apiKey);
  } catch (error) {
    if (!options.silent) {
      appendMessage('system', error instanceof Error ? error.message : String(error), { persist: false });
    }
    return false;
  }
  saveSettings(settings);
  applySettingsToForm();
  if (previousApiKey !== settings.apiKey) {
    conversations = [];
    lastHistoryVersion = null;
    refreshConversations().catch(() => {});
    if (activeConversation) {
      refreshHistory({ force: true, preserveScroll: true }).catch(() => {});
    }
  }
  return true;
}

function openSettingsPanel(options = {}) {
  if (!elements.settingsPanel || !elements.settingsPanel.classList.contains('hidden')) {
    return;
  }
  elements.settingsPanel.classList.remove('hidden');
  document.body.classList.add('settings-open');
  if (options.pushHistory === false || settingsPanelHistoryActive || !window.history?.pushState) {
    return;
  }
  window.history.pushState({ ...(window.history.state || {}), settingsPanelOpen: true }, '', window.location.href);
  settingsPanelHistoryActive = true;
}

function closeSettingsPanel(options = {}) {
  if (!elements.settingsPanel || elements.settingsPanel.classList.contains('hidden')) {
    settingsPanelHistoryActive = false;
    document.body.classList.remove('settings-open');
    return;
  }
  persistSettingsFromForm({ silent: true });
  elements.settingsPanel.classList.add('hidden');
  document.body.classList.remove('settings-open');
  if (options.syncHistory && settingsPanelHistoryActive && window.history?.back) {
    settingsPanelHistoryActive = false;
    window.history.back();
    return;
  }
  settingsPanelHistoryActive = false;
}

function toggleSettingsPanel() {
  if (elements.settingsPanel.classList.contains('hidden')) {
    openSettingsPanel();
  } else {
    closeSettingsPanel({ syncHistory: true });
  }
}

elements.settingsButton?.addEventListener('click', toggleSettingsPanel);
elements.sidebarSettingsButton?.addEventListener('click', () => {
  toggleSettingsPanel();
  closeMobileDrawer();
});
elements.mobileMenuButton?.addEventListener('click', toggleMobileDrawer);
elements.modelPickerButton?.addEventListener('click', (event) => {
  event.stopPropagation();
  toggleModelPicker();
});
elements.mobileDrawerBackdrop?.addEventListener('click', () => closeMobileDrawer({ syncHistory: true }));
elements.chatPanel?.addEventListener('touchstart', handleDrawerSwipeStart, { passive: true });
elements.chatPanel?.addEventListener('touchend', handleDrawerSwipeEnd, { passive: false });

document.addEventListener('click', (event) => {
  const target = event.target;
  if (openConversationMenuId && !target?.closest?.('.conversation-menu-wrap')) {
    openConversationMenuId = null;
    renderConversationList();
  }
  if (floatingActionsExpanded && !target?.closest?.('#floatingActionMenu')) {
    setFloatingActionsExpanded(false);
  }
  if (modelPickerExpanded && !target?.closest?.('.chat-titlebar-actions')) {
    setModelPickerExpanded(false);
  }
  if (elements.settingsPanel.classList.contains('hidden')) {
    return;
  }
  if (
    elements.settingsPanel.contains(target)
    || elements.settingsButton?.contains(target)
    || elements.sidebarSettingsButton?.contains(target)
    || elements.floatingSettingsButton?.contains(target)
  ) {
    return;
  }
  closeSettingsPanel({ syncHistory: true });
});


elements.loginForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const username = elements.loginUsernameInput?.value.trim() || '';
  const password = elements.loginPasswordInput?.value || '';
  if (elements.loginSubmitButton) {
    elements.loginSubmitButton.disabled = true;
  }
  if (elements.loginStatusText) {
    elements.loginStatusText.textContent = '로그인 중입니다…';
  }
  try {
    await login(username, password);
    await refreshConversations();
    if (!initialConversationId && !activeConversation?.id && conversations.length === 0) {
      await startNewConversation();
      return;
    }
    if (!initialConversationId) {
      renderHome();
      renderConversationList();
      return;
    }
    const selected = await selectConversation(initialConversationId, { replaceUrl: true });
    if (!selected) {
      goHome({ replaceUrl: true });
    }
  } catch (error) {
    showLoginScreen(error instanceof Error ? error.message : String(error));
  } finally {
    if (elements.loginSubmitButton) {
      elements.loginSubmitButton.disabled = false;
    }
  }
});

elements.logoutButton?.addEventListener('click', logout);

elements.saveSettingsButton?.addEventListener('click', () => {
  if (persistSettingsFromForm()) {
    showToast('설정을 저장했습니다.', { kind: 'success' });
    closeSettingsPanel({ syncHistory: true });
  }
});

elements.themeModeInput.addEventListener('change', () => {
  applyTheme(elements.themeModeInput.value);
});

elements.autoLocationOnHereInput?.addEventListener('change', () => {
  settings = { ...settings, autoLocationOnHere: elements.autoLocationOnHereInput.checked };
  saveSettings(settings);
});

elements.fontSizeInput.addEventListener('input', () => {
  settings = { ...settings, fontSize: normalizeFontSize(elements.fontSizeInput.value) };
  applyDisplaySettings();
  saveSettings(settings);
});

elements.historyPageSizeInput?.addEventListener('change', () => {
  settings = { ...settings, historyPageSize: normalizeHistoryPageSize(elements.historyPageSizeInput.value) };
  elements.historyPageSizeInput.value = String(settings.historyPageSize);
  activeHistoryLimit = normalizeHistoryPageSize(settings.historyPageSize);
  lastHistoryVersion = null;
  saveSettings(settings);
  if (activeConversation?.id) {
    renderHistory({ scrollToLatest: true }).catch((error) => appendMessage('system', error instanceof Error ? error.message : String(error), { persist: false }));
  }
});

elements.newConversationButton?.addEventListener('click', async () => {
  try {
    await startNewConversation();
  } catch (error) {
    appendMessage('system', error instanceof Error ? error.message : String(error), { persist: false });
  }
});

elements.archiveToggleButton?.addEventListener('click', () => {
  showingArchived = !showingArchived;
  openConversationMenuId = null;
  goHome();
});

elements.conversationSearchInput?.addEventListener('input', () => {
  conversationSearchQuery = elements.conversationSearchInput.value;
  updateConversationSearchClearButton();
  conversationContentMatches = new Set();
  renderConversationList();
  scheduleConversationSearch();
});

elements.clearConversationSearchButton?.addEventListener('click', () => {
  conversationSearchQuery = '';
  if (elements.conversationSearchInput) {
    elements.conversationSearchInput.value = '';
    elements.conversationSearchInput.focus();
  }
  updateConversationSearchClearButton();
  conversationContentMatches = new Set();
  renderConversationList();
  scheduleConversationSearch();
});

elements.clearHistoryButton?.addEventListener('click', async () => {
  if (!window.confirm('새 대화를 시작합니다. 기존 대화는 서버에 보존됩니다.')) {
    return;
  }
  try {
    await startNewConversation();
    appendMessage('system', '새 대화를 시작했습니다. 기존 대화는 보존됩니다.', { persist: false });
  } catch (error) {
    appendMessage('system', error instanceof Error ? error.message : String(error), { persist: false });
  }
});

elements.healthCheckButton?.addEventListener('click', healthCheck);
elements.refreshAppButton.addEventListener('click', () => window.location.reload());
elements.floatingActionToggle?.addEventListener('click', toggleFloatingActions);
elements.floatingSettingsButton?.addEventListener('click', (event) => {
  event.stopPropagation();
  setFloatingActionsExpanded(false);
  openSettingsPanel();
});
elements.floatingRefreshButton?.addEventListener('click', () => window.location.reload());
elements.floatingScrollTopButton?.addEventListener('click', () => {
  setFloatingActionsExpanded(false);
  elements.messages.scrollTo({ top: 0, behavior: 'smooth' });
});
elements.floatingScrollBottomButton?.addEventListener('click', () => {
  setFloatingActionsExpanded(false);
  scrollToBottom({ force: true, smooth: true });
});
elements.continueNewSessionButton?.addEventListener('click', continueInNewSession);
elements.scrollToLatestButton?.addEventListener('click', () => scrollToBottom({ force: true }));
elements.messages.addEventListener('scroll', () => {
  elements.messages.classList.add('is-scrolling');
  updateMessagesScrollIndicator();
  hideMessagesScrollIndicatorSoon();
  if (isNearBottom(80)) {
    hideScrollToLatestButton();
  }
});
elements.clearCacheButton.addEventListener('click', clearAppCacheAndReload);
elements.resetPasswordButton?.addEventListener('click', resetPassword);
elements.notificationButton.addEventListener('click', enableNotifications);
elements.mediaViewerDownload.addEventListener('click', downloadCurrentMedia);
elements.mediaViewerClose.addEventListener('click', closeMediaViewer);
elements.mediaViewerImage.addEventListener('pointerdown', handleMediaViewerPointerDown);
elements.mediaViewerImage.addEventListener('pointermove', handleMediaViewerPointerMove);
elements.mediaViewerImage.addEventListener('pointerup', handleMediaViewerPointerEnd);
elements.mediaViewerImage.addEventListener('pointercancel', handleMediaViewerPointerEnd);
elements.mediaViewerImage.addEventListener('wheel', handleMediaViewerWheel, { passive: false });
elements.mediaViewerImage.addEventListener('dblclick', toggleMediaViewerZoom);
elements.mediaViewer.addEventListener('click', (event) => {
  if (event.target?.hasAttribute?.('data-media-viewer-close')) {
    closeMediaViewer();
  }
});
window.addEventListener('popstate', () => {
  if (document.body.classList.contains('drawer-open')) {
    closeMobileDrawer({ syncHistory: false });
    return;
  }
  if (!elements.settingsPanel.classList.contains('hidden')) {
    closeSettingsPanel({ syncHistory: false });
    return;
  }
  if (mediaViewerHistoryActive && !elements.mediaViewer.classList.contains('hidden')) {
    closeMediaViewer({ syncHistory: false });
    return;
  }
  const conversationId = conversationIdFromPath();
  if (conversationId) {
    selectConversation(conversationId, { replaceUrl: true }).then((selected) => {
      if (!selected) {
        goHome({ replaceUrl: true });
      }
    }).catch(() => goHome({ replaceUrl: true }));
    return;
  }
  goHome({ replaceUrl: true });
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !elements.mediaViewer.classList.contains('hidden')) {
    closeMediaViewer();
    return;
  }
  if (event.key === 'Escape' && floatingActionsExpanded) {
    setFloatingActionsExpanded(false);
    return;
  }
  if (event.key === 'Escape' && modelPickerExpanded) {
    setModelPickerExpanded(false);
    return;
  }
  if (event.key === 'Escape' && document.body.classList.contains('drawer-open')) {
    closeMobileDrawer({ syncHistory: true });
  }
});
renderModelPicker();
elements.attachButton.addEventListener('click', () => elements.attachmentInput.click());
elements.clearMessageInputButton?.addEventListener('click', () => {
  elements.messageInput.focus();
  document.execCommand('selectAll');
  document.execCommand('delete');
  elements.messageInput.dispatchEvent(new Event('input', { bubbles: true }));
});
elements.attachmentInput.addEventListener('change', () => {
  try {
    addAttachmentFilesSafely(elements.attachmentInput.files || [], '파일 선택');
  } finally {
    elements.attachmentInput.value = '';
  }
});
elements.messageInput.addEventListener('paste', handleMessagePaste);
elements.messageForm.addEventListener('dragenter', handleComposerDragEnter);
elements.messageForm.addEventListener('dragover', handleComposerDragOver);
elements.messageForm.addEventListener('dragleave', handleComposerDragLeave);
elements.messageForm.addEventListener('drop', handleComposerDrop);
elements.messageForm.addEventListener('submit', handleSubmit);
elements.messageInput.addEventListener('input', () => {
  saveComposerDraft();
  autoResizeTextarea();
  selectedSlashCommandIndex = 0;
  renderSlashCommandPalette();
});
elements.messageInput.addEventListener('blur', () => {
  window.setTimeout(hideSlashCommandPalette, 160);
});
elements.sidebarResizeHandle?.addEventListener('pointerdown', startSidebarResize);
window.addEventListener('pointermove', moveSidebarResize);
window.addEventListener('pointerup', finishSidebarResize);
window.addEventListener('pointercancel', cancelSidebarResize);
window.addEventListener('resize', syncSidebarWidthToViewport);

elements.messageInput.addEventListener('keydown', (event) => {
  const hasSlashPalette = !elements.slashCommandPalette.classList.contains('hidden');
  if (hasSlashPalette && ['ArrowDown', 'ArrowUp', 'Tab', 'Enter'].includes(event.key)) {
    const matches = matchingSlashCommands();
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      selectedSlashCommandIndex = (selectedSlashCommandIndex + 1) % matches.length;
      renderSlashCommandPalette();
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      selectedSlashCommandIndex = (selectedSlashCommandIndex - 1 + matches.length) % matches.length;
      renderSlashCommandPalette();
      return;
    }
    if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
      event.preventDefault();
      acceptSelectedSlashCommand();
      return;
    }
  }

  if (isMobileLikeInput()) {
    return;
  }
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    elements.messageForm.requestSubmit();
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js?v=pwa-client-2026-05-04-039').catch(() => {});
  });
}
