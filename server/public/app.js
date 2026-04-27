const STORAGE_KEY = 'openclaw-web-channel-settings-v1';
const PENDING_JOB_KEY = 'openclaw-web-channel-pending-job-v1';
const LEGACY_HISTORY_KEY_PREFIX = 'openclaw-web-channel-history-v1';
const MAX_ATTACHMENTS = 3;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const ALLOWED_ATTACHMENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'text/plain',
  'application/zip',
]);

const elements = {
  settingsButton: document.querySelector('#settingsButton'),
  settingsPanel: document.querySelector('#settingsPanel'),
  apiUrlInput: document.querySelector('#apiUrlInput'),
  apiKeyInput: document.querySelector('#apiKeyInput'),
  deviceIdInput: document.querySelector('#deviceIdInput'),
  themeModeInput: document.querySelector('#themeModeInput'),
  saveSettingsButton: document.querySelector('#saveSettingsButton'),
  healthCheckButton: document.querySelector('#healthCheckButton'),
  refreshAppButton: document.querySelector('#refreshAppButton'),
  notificationButton: document.querySelector('#notificationButton'),
  clearHistoryButton: document.querySelector('#clearHistoryButton'),
  messages: document.querySelector('#messages'),
  messageForm: document.querySelector('#messageForm'),
  messageInput: document.querySelector('#messageInput'),
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

function randomDeviceId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `web-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isMobileLikeInput() {
  return window.matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function loadSettings() {
  const fallback = {
    apiUrl: window.location.origin,
    apiKey: '',
    deviceId: randomDeviceId(),
    themeMode: 'dark',
    notificationsEnabled: false,
  };

  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') };
  } catch {
    return fallback;
  }
}

function saveSettings(settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

let settings = loadSettings();
let historyPollTimer = null;
let isSendingMessage = false;
let selectedAttachments = [];
let lastHistoryVersion = null;
let mediaViewerCurrentUrl = '';
let mediaViewerCurrentName = 'openclaw-image.png';
const mediaUrlCache = new Map();
const slashCommands = [
  { command: '/status', title: '상태 확인', description: '현재 세션/모델/토큰/설정 상태를 확인합니다.' },
  { command: '/model ', title: '모델 변경', description: '모델을 지정합니다. 예: /model gpt-5.5' },
  { command: '/models', title: '모델 목록', description: '사용 가능한 모델 목록을 봅니다.' },
  { command: '/new', title: '새 대화', description: '새 세션/대화 흐름을 시작합니다.' },
  { command: '/reset', title: '대화 초기화', description: '현재 대화 맥락을 초기화합니다.' },
  { command: '/reasoning', title: '추론 표시 전환', description: 'reasoning 설정을 켜거나 끕니다.' },
  { command: '/help', title: '도움말', description: 'OpenClaw 명령 도움말을 표시합니다.' },
  { command: '/memory', title: '메모리', description: '메모리 관련 명령을 확인하거나 실행합니다.' },
  { command: '/tasks', title: '작업 목록', description: 'TaskFlow/작업 상태를 확인합니다.' },
];
let selectedSlashCommandIndex = 0;

function applyTheme(themeMode) {
  document.documentElement.dataset.theme = ['light', 'dark'].includes(themeMode) ? themeMode : 'system';
}

function applySettingsToForm() {
  elements.apiUrlInput.value = settings.apiUrl || window.location.origin;
  elements.apiKeyInput.value = settings.apiKey || '';
  elements.deviceIdInput.value = settings.deviceId || randomDeviceId();
  elements.themeModeInput.value = settings.themeMode || 'dark';
  updateNotificationButton();
  applyTheme(settings.themeMode || 'dark');
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) {
    return '';
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)}KB`;
  }
  return `${bytes}B`;
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
  if (!ALLOWED_ATTACHMENT_TYPES.has(file.type)) {
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
    selectedAttachments.map(async (file) => ({
      type: file.type.startsWith('image/') ? 'image' : 'file',
      name: file.name,
      mime_type: file.type,
      content_base64: await fileToBase64(file),
    })),
  );
}

function attachmentSummary(files = selectedAttachments) {
  if (files.length === 0) {
    return '';
  }
  return `\n\n첨부 파일:\n${files.map((file) => `- ${file.name} (${file.type || 'unknown'}, ${formatBytes(file.size)})`).join('\n')}`;
}

function normalizeApiKey(value) {
  return value.trim().replace(/[\s\u200B-\u200D\uFEFF]/g, '');
}

function assertValidApiKey(apiKey) {
  if (!apiKey) {
    throw new Error('API Key를 입력해주세요.');
  }
  if (!/^[A-Za-z0-9._~+-]+$/.test(apiKey)) {
    throw new Error('API Key에 사용할 수 없는 문자가 포함되어 있습니다. 키만 다시 복사해서 붙여넣어 주세요.');
  }
}

function readSettingsFromForm() {
  const apiUrl = elements.apiUrlInput.value.trim().replace(/\/+$/, '') || window.location.origin;
  const apiKey = normalizeApiKey(elements.apiKeyInput.value);
  const deviceId = elements.deviceIdInput.value.trim() || randomDeviceId();
  const themeMode = elements.themeModeInput.value || 'dark';
  return { apiUrl, apiKey, deviceId, themeMode };
}

function setStatus(message) {
  elements.statusText.textContent = message || '';
}

function isNearBottom(threshold = 120) {
  return elements.messages.scrollHeight - elements.messages.scrollTop - elements.messages.clientHeight < threshold;
}

function scrollToBottom(options = {}) {
  const { force = false, autoScroll = true } = options;
  if (!autoScroll) {
    return;
  }
  if (!force && !isNearBottom()) {
    return;
  }
  requestAnimationFrame(() => {
    elements.messages.scrollTop = elements.messages.scrollHeight;
  });
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
  return `web-api-key-${await hashText(settings.apiKey || 'anonymous')}`;
}

function persistMessage() {
  // Server-side history is authoritative. This hook is intentionally kept as a no-op.
}

function clearRenderedMessages() {
  elements.messages.replaceChildren();
}

async function historyHeaders() {
  assertValidApiKey(settings.apiKey);
  return {
    authorization: `Bearer ${settings.apiKey}`,
    'x-user-id': await sharedUserId(),
  };
}

function canUseApi() {
  return Boolean(settings.apiUrl && settings.apiKey);
}

async function fetchHistory() {
  const response = await fetch(`${settings.apiUrl}/v1/history`, {
    headers: await historyHeaders(),
  });
  if (!response.ok) {
    throw new Error(`대화 기록을 불러오지 못했습니다: HTTP ${response.status}`);
  }
  const body = await response.json();
  lastHistoryVersion = body.version || lastHistoryVersion;
  return Array.isArray(body.messages) ? body.messages : [];
}

async function fetchHistoryMeta() {
  const response = await fetch(`${settings.apiUrl}/v1/history?meta=1`, {
    headers: await historyHeaders(),
  });
  if (!response.ok) {
    throw new Error(`대화 기록 상태를 확인하지 못했습니다: HTTP ${response.status}`);
  }
  return response.json();
}

async function clearServerHistory() {
  const response = await fetch(`${settings.apiUrl}/v1/history`, {
    method: 'DELETE',
    headers: await historyHeaders(),
  });
  if (!response.ok) {
    throw new Error(`대화 기록을 삭제하지 못했습니다: HTTP ${response.status}`);
  }
}

async function appendServerHistoryMessages(messages) {
  const response = await fetch(`${settings.apiUrl}/v1/history`, {
    method: 'POST',
    headers: {
      ...(await historyHeaders()),
      'content-type': 'application/json',
    },
    body: JSON.stringify({ messages }),
  });
  if (!response.ok) {
    throw new Error(`대화 기록을 저장하지 못했습니다: HTTP ${response.status}`);
  }
}

function loadLegacyHistory() {
  try {
    const key = `${LEGACY_HISTORY_KEY_PREFIX}:${settings.deviceId || 'anonymous'}`;
    const parsed = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function importLegacyHistoryIfNeeded(serverHistory) {
  if (serverHistory.length > 0) {
    return serverHistory;
  }

  const legacyHistory = loadLegacyHistory().filter(
    (item) => typeof item?.role === 'string' && typeof item?.text === 'string',
  );
  if (legacyHistory.length === 0) {
    return serverHistory;
  }

  const response = await fetch(`${settings.apiUrl}/v1/history`, {
    method: 'POST',
    headers: {
      ...(await historyHeaders()),
      'content-type': 'application/json',
    },
    body: JSON.stringify({ messages: legacyHistory }),
  });
  if (!response.ok) {
    return legacyHistory;
  }
  return legacyHistory;
}

async function renderHistory() {
  clearRenderedMessages();
  if (!canUseApi()) {
    appendMessage('system', '설정에서 API Key를 입력하면 대화를 시작할 수 있습니다.', { persist: false });
    return;
  }

  try {
    const history = await importLegacyHistoryIfNeeded(await fetchHistory());
    if (history.length === 0) {
      appendMessage('system', 'OpenClaw Web Channel MVP입니다. 현재위치 포함을 켜면 전송 시 GPS 좌표가 메시지에 붙습니다.', { persist: false });
      return;
    }

    for (const item of history) {
      if (typeof item?.role === 'string' && typeof item?.text === 'string') {
        appendMessage(item.role, item.text, { persist: false, autoScroll: false, mediaRefs: mediaRefsFromHistoryAttachments(item.attachments), pending: isPendingHistoryMessage(item) });
      }
    }
  } catch (error) {
    appendMessage('system', error instanceof Error ? error.message : String(error), { persist: false });
  }
}

function appendInlineMarkdown(parent, text) {
  const pattern = /(\*\*([^*\n]+)\*\*)|(\*([^*\n]+)\*)|(_([^_\n]+)_)|(`([^`\n]+)`)|(\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\))|(https?:\/\/[^\s<)]+)/g;
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parent.append(document.createTextNode(text.slice(lastIndex, match.index)));
    }

    if (match[2]) {
      const strong = document.createElement('strong');
      strong.textContent = match[2];
      parent.append(strong);
    } else if (match[4] || match[6]) {
      const emphasis = document.createElement('em');
      emphasis.textContent = match[4] || match[6];
      parent.append(emphasis);
    } else if (match[8]) {
      const code = document.createElement('code');
      code.textContent = match[8];
      parent.append(code);
    } else {
      const label = match[10] || match[12];
      const url = match[11] || match[12];
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

function appendMarkdown(parent, text) {
  const lines = text.split('\n');
  let list = null;

  for (const line of lines) {
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);

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
      if (!list || list.tagName.toLowerCase() !== listType) {
        list = document.createElement(listType);
        parent.append(list);
      }
      const item = document.createElement('li');
      appendInlineMarkdown(item, bullet?.[1] || numbered?.[1] || '');
      list.append(item);
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
}

function messageTextWithoutAttachmentPreview(node) {
  const clone = node.cloneNode(true);
  clone.querySelectorAll('.message-attachments, .message-actions').forEach((preview) => preview.remove());
  return clone.textContent || '';
}

function currentRenderedHistorySignature() {
  return [...elements.messages.querySelectorAll('.message')]
    .map((node) => `${[...node.classList].find((className) => className !== 'message') || ''}:${messageTextWithoutAttachmentPreview(node)}`)
    .join('\n---\n');
}

function historySignature(history) {
  return history.map((item) => `${item.id || ''}:${item.role}:${item.text}`).join('\n---\n');
}

function isPendingHistoryMessage(item) {
  return typeof item?.id === 'string' && item.id.startsWith('job_') && item.role === 'assistant' && item.text.includes('처리 중');
}

async function refreshHistoryIfChanged() {
  if (!canUseApi() || document.hidden || isSendingMessage) {
    return;
  }

  try {
    const meta = await fetchHistoryMeta();
    if (lastHistoryVersion && meta.version === lastHistoryVersion) {
      return;
    }

    const history = await fetchHistory();
    lastHistoryVersion = meta.version || lastHistoryVersion;
    if (history.length > 0 && historySignature(history) !== currentRenderedHistorySignature()) {
      const shouldFollow = isNearBottom();
      const previousScrollTop = elements.messages.scrollTop;
      clearRenderedMessages();
      for (const item of history) {
        if (typeof item?.role === 'string' && typeof item?.text === 'string') {
          appendMessage(item.role, item.text, {
            persist: false,
            autoScroll: false,
            mediaRefs: mediaRefsFromHistoryAttachments(item.attachments),
            pending: isPendingHistoryMessage(item),
          });
        }
      }
      if (shouldFollow) {
        scrollToBottom({ force: true });
      } else {
        elements.messages.scrollTop = previousScrollTop;
      }
    }
  } catch {
    // Polling is best-effort; explicit sends/connection tests surface errors.
  }
}

function startHistoryPolling() {
  if (historyPollTimer) {
    clearInterval(historyPollTimer);
  }
  historyPollTimer = window.setInterval(refreshHistoryIfChanged, 5000);
}

function extractMediaRefs(text) {
  const refs = [];
  const visibleLines = [];

  for (const line of text.split('\n')) {
    const mediaMatch = line.match(/^\s*MEDIA:\s*(.+?)\s*$/);
    if (mediaMatch) {
      refs.push(mediaMatch[1]);
      continue;
    }
    visibleLines.push(line);
  }

  const visibleText = visibleLines.join('\n').trim();
  return { text: visibleText || (refs.length > 0 ? '' : text), refs };
}

function isImageRef(ref) {
  return /\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(ref);
}

function openMediaViewer(url, fileName = 'openclaw-image.png') {
  mediaViewerCurrentUrl = url;
  mediaViewerCurrentName = fileName || 'openclaw-image.png';
  elements.mediaViewerImage.src = url;
  elements.mediaViewerImage.alt = mediaViewerCurrentName;
  elements.mediaViewerDownload.href = url;
  elements.mediaViewerDownload.download = mediaViewerCurrentName;
  elements.mediaViewer.classList.remove('hidden');
}

function closeMediaViewer() {
  elements.mediaViewer.classList.add('hidden');
  elements.mediaViewerImage.removeAttribute('src');
  elements.mediaViewerDownload.removeAttribute('href');
  mediaViewerCurrentUrl = '';
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(reader.error || new Error('파일을 읽지 못했습니다.'));
    reader.readAsDataURL(blob);
  });
}

async function downloadCurrentMedia(event) {
  if (!mediaViewerCurrentUrl) {
    return;
  }
  if (!window.OpenClawAndroid?.downloadBlob) {
    return;
  }
  event.preventDefault();
  const originalText = elements.mediaViewerDownload.textContent;
  elements.mediaViewerDownload.textContent = '저장 중…';
  try {
    const response = await fetch(mediaViewerCurrentUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const blob = await response.blob();
    const base64 = await blobToBase64(blob);
    window.OpenClawAndroid.downloadBlob(mediaViewerCurrentName, blob.type || 'application/octet-stream', base64);
  } catch (error) {
    appendMessage('system', `다운로드 실패: ${error instanceof Error ? error.message : String(error)}`, { persist: false });
  } finally {
    elements.mediaViewerDownload.textContent = originalText;
  }
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
    return mediaUrlCache.get(ref);
  }

  const response = await fetch(`${settings.apiUrl}/v1/media?path=${encodeURIComponent(ref)}`, {
    headers: await historyHeaders(),
    cache: 'force-cache',
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  mediaUrlCache.set(ref, url);
  return url;
}

function appendMediaRef(parent, rawRef) {
  const refInfo = typeof rawRef === 'string' ? { path: rawRef } : rawRef;
  const ref = refInfo?.path;
  if (!ref) {
    return;
  }

  const preview = parent.querySelector('.message-attachments') || document.createElement('div');
  preview.className = 'message-attachments';
  if (!preview.parentElement) {
    parent.append(preview);
  }

  const item = document.createElement('div');
  item.className = 'message-attachment';
  const isRemote = /^https?:\/\//i.test(ref);
  const fileName = refInfo.name || ref.split('/').pop() || ref;
  const captionText = refInfo.size ? `${fileName} · ${formatBytes(refInfo.size)}` : fileName;
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

  if (isRemote) {
    caption.href = ref;
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

function appendRetryAction(node, role, text) {
  if (role !== 'system' || !text.startsWith('전송 실패:')) {
    return;
  }
  const retryText = retryTextForNode(node);
  if (!retryText) {
    return;
  }
  const actions = document.createElement('div');
  actions.className = 'message-actions';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'message-action-button';
  button.textContent = '다시 시도';
  button.addEventListener('click', () => {
    elements.messageInput.value = retryText;
    autoResizeTextarea();
    elements.messageInput.focus();
  });
  actions.append(button);
  node.append(actions);
}

function renderMessageNode(node, role, text, options = {}) {
  const media = extractMediaRefs(text);
  node.className = `message ${role}${options.pending ? ' pending' : ''}`;
  node.replaceChildren();
  appendMarkdown(node, media.text);
  for (const ref of [...media.refs, ...(node._mediaRefs || [])]) {
    appendMediaRef(node, ref);
  }
  appendRetryAction(node, role, text);
  scrollToBottom(options);
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
  node._mediaRefs = options.mediaRefs || [];
  renderMessageNode(node, role, text, options);
  appendAttachmentPreview(node, options.files || []);
  if (options.pending) {
    node.classList.add('pending');
  }
  elements.messages.append(node);
  scrollToBottom(options);
  if (options.persist !== false) {
    persistMessage(role, text);
  }
  return node;
}

function startThinkingMessage(options = {}) {
  const startedAt = options.startedAt || Date.now();
  const label = options.label || '응답을 작성 중입니다…';
  const node = appendMessage('assistant', `${label} (${Math.max(1, Math.round((Date.now() - startedAt) / 1000))}초)`, { persist: false, force: true });
  node.classList.add('pending');
  const timer = window.setInterval(() => {
    const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    renderMessageNode(node, 'assistant pending', `${label} (${elapsedSeconds}초)`, { force: true });
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
  elements.sendButton.disabled = isSending;
  elements.messageInput.disabled = isSending;
  elements.includeLocationInput.disabled = isSending;
  elements.sendButton.textContent = isSending ? '전송 중' : '전송';
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

async function sendMessage(message, attachments = [], metadata = undefined) {
  assertValidApiKey(settings.apiKey);
  const response = await fetch(`${settings.apiUrl}/v1/message`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${settings.apiKey}`,
      'x-user-id': await sharedUserId(),
    },
    body: JSON.stringify({ message, attachments, ...(metadata ? { metadata } : {}) }),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = body?.error?.message || `HTTP ${response.status}`;
    throw new Error(detail);
  }
  return body;
}

function pendingJobStorageKey() {
  return `${PENDING_JOB_KEY}:${settings.apiUrl}:${settings.apiKey || 'anonymous'}`;
}

function savePendingJob(job) {
  localStorage.setItem(pendingJobStorageKey(), JSON.stringify(job));
}

function loadPendingJob() {
  try {
    const parsed = JSON.parse(localStorage.getItem(pendingJobStorageKey()) || 'null');
    return parsed?.job_id ? parsed : null;
  } catch {
    return null;
  }
}

function clearPendingJob() {
  localStorage.removeItem(pendingJobStorageKey());
}

async function fetchJob(jobId) {
  const response = await fetch(`${settings.apiUrl}/v1/jobs/${encodeURIComponent(jobId)}`, {
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

async function isJobResolvedInHistory(jobId) {
  try {
    const history = await fetchHistory();
    return history.some((item) => item.id === jobId && !isPendingHistoryMessage(item));
  } catch {
    return false;
  }
}

async function waitForJob(jobId, onTick = () => {}) {
  let transientFailures = 0;
  let lastError = null;
  for (let attempt = 0; attempt < 240; attempt += 1) {
    await delay(attempt < 10 ? 1000 : 3000);
    try {
      const job = await fetchJob(jobId);
      transientFailures = 0;
      lastError = null;
      onTick(job);
      if (job.state === 'completed' || job.state === 'failed') {
        clearPendingJob();
        return job;
      }
    } catch (error) {
      lastError = error;
      transientFailures += 1;
      if (await isJobResolvedInHistory(jobId)) {
        clearPendingJob();
        return { id: jobId, state: 'completed' };
      }
      if (error?.status === 404) {
        clearPendingJob();
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
  const thinkingMessage = startThinkingMessage({
    startedAt: pendingJob.startedAt,
    label: '서버에서 응답을 처리 중입니다…',
  });

  try {
    const job = await waitForJob(pendingJob.job_id);
    thinkingMessage.stop();
    if (job.state === 'failed') {
      renderMessageNode(thinkingMessage.node, 'system', job.error || '응답 작업이 실패했습니다.', { force: true });
      notifyReplyReady('OpenClaw 응답 실패', job.error || '응답 작업이 실패했습니다.');
    } else {
      thinkingMessage.node.remove();
      await renderHistory();
      if (job.state === 'completed') {
        notifyReplyReady();
      }
    }
  } catch (error) {
    thinkingMessage.stop();
    renderMessageNode(thinkingMessage.node, 'system', error instanceof Error ? error.message : String(error), { force: true });
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
    appendMessage('system', '설정에서 API URL과 API Key를 먼저 저장해주세요.');
    elements.settingsPanel.classList.remove('hidden');
    return;
  }

  setSending(true);
  setStatus('메시지를 준비하는 중입니다...');

  try {
    const outgoingMessage = rawMessage || '첨부 파일을 확인하고 사용자의 의도에 맞게 분석해주세요.';
    const shouldIncludeLocation = !rawMessage.startsWith('/') && (
      elements.includeLocationInput.checked || rawMessage.includes('여기')
    );
    let metadata;
    if (shouldIncludeLocation) {
      setStatus('현재 위치를 가져오는 중입니다...');
      metadata = { location: await getCurrentLocationMetadata() };
    }

    setStatus('첨부 파일을 준비하는 중입니다...');
    const attachedFiles = [...selectedAttachments];
    const attachments = await buildAttachmentsPayload();
    const displayedUserText = `${outgoingMessage}${attachmentSummary(attachedFiles)}`;
    appendMessage('user', displayedUserText, { files: attachedFiles });
    elements.messageInput.value = '';
    selectedAttachments = [];
    renderAttachmentTray();
    elements.attachmentInput.value = '';
    elements.includeLocationInput.checked = false;
    setStatus('OpenClaw 응답을 기다리는 중입니다...');

    const thinkingMessage = startThinkingMessage();
    let activeJobId = null;
    try {
      const response = await sendMessage(outgoingMessage, attachments, metadata);
      if (response.job_id) {
        activeJobId = response.job_id;
        savePendingJob({ job_id: response.job_id, startedAt: Date.now() });
        setStatus('서버에서 응답을 처리 중입니다. 앱을 닫아도 작업은 계속됩니다.');
        const job = await waitForJob(response.job_id, () => refreshHistoryIfChanged());
        thinkingMessage.stop();
        if (job.state === 'failed') {
          renderMessageNode(thinkingMessage.node, 'system', job.error || '응답 작업이 실패했습니다.', { force: true });
          notifyReplyReady('OpenClaw 응답 실패', job.error || '응답 작업이 실패했습니다.');
        } else {
          thinkingMessage.node.remove();
          await refreshHistoryIfChanged();
          if (job.state === 'completed') {
            notifyReplyReady();
          }
        }
      } else {
        thinkingMessage.stop();
        renderMessageNode(thinkingMessage.node, 'assistant', response.reply || '(빈 응답)', { force: true });
      }
      setStatus('');
      window.setTimeout(refreshHistoryIfChanged, 800);
    } catch (error) {
      if (activeJobId && await isJobResolvedInHistory(activeJobId)) {
        clearPendingJob();
        thinkingMessage.stop();
        thinkingMessage.node.remove();
        setStatus('');
        notifyReplyReady();
        return;
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      thinkingMessage.stop();
      if (activeJobId) {
        thinkingMessage.node.remove();
        setStatus('응답 상태 확인이 일시적으로 끊겼습니다. 대화 기록을 새로고침하면 이어서 확인합니다.');
        window.setTimeout(refreshHistoryIfChanged, 800);
        return;
      }
      renderMessageNode(thinkingMessage.node, 'system', errorMessage, { force: true });
      setStatus('');
    }
  } catch (error) {
    appendMessage('system', error instanceof Error ? error.message : String(error));
    setStatus('');
  } finally {
    setSending(false);
    elements.messageInput.focus();
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

    const authResponse = await fetch(`${settings.apiUrl}/v1/message`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${settings.apiKey}`,
        'x-user-id': `${await sharedUserId()}-connection-test`,
        'x-openclaw-sync': '1',
      },
      body: JSON.stringify({ message: '연결 테스트입니다. OK만 답해주세요.' }),
    });
    const authBody = await authResponse.json().catch(() => null);
    if (!authResponse.ok) {
      throw new Error(authBody?.error?.message || `인증 테스트 실패: HTTP ${authResponse.status}`);
    }

    appendMessage('system', `연결 성공: ${healthBody.status} / transport=${healthBody.transport}`);
  } catch (error) {
    appendMessage('system', `연결 실패: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function autoResizeTextarea() {
  elements.messageInput.style.height = 'auto';
  const minHeight = Number.parseFloat(getComputedStyle(elements.messageInput).minHeight) || 74;
  elements.messageInput.style.height = `${Math.max(minHeight, Math.min(elements.messageInput.scrollHeight, 150))}px`;
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
renderHistory().then(() => resumePendingJobIfNeeded()).catch(() => {});
startHistoryPolling();

elements.settingsButton.addEventListener('click', () => {
  elements.settingsPanel.classList.toggle('hidden');
});

elements.saveSettingsButton.addEventListener('click', () => {
  const previousApiKey = settings.apiKey;
  settings = readSettingsFromForm();
  try {
    assertValidApiKey(settings.apiKey);
  } catch (error) {
    appendMessage('system', error instanceof Error ? error.message : String(error), { persist: false });
    return;
  }
  saveSettings(settings);
  applySettingsToForm();
  if (previousApiKey !== settings.apiKey) {
    lastHistoryVersion = null;
    renderHistory();
  }
  appendMessage('system', '설정을 저장했습니다.');
  elements.settingsPanel.classList.add('hidden');
});

elements.themeModeInput.addEventListener('change', () => {
  applyTheme(elements.themeModeInput.value);
});

elements.clearHistoryButton.addEventListener('click', async () => {
  if (!window.confirm('이 API Key 세션에 저장된 대화 기록을 삭제할까요?')) {
    return;
  }
  try {
    await clearServerHistory();
    await renderHistory();
    appendMessage('system', '대화 기록을 삭제했습니다.', { persist: false });
  } catch (error) {
    appendMessage('system', error instanceof Error ? error.message : String(error), { persist: false });
  }
});

elements.healthCheckButton.addEventListener('click', healthCheck);
elements.refreshAppButton.addEventListener('click', () => window.location.reload());
elements.notificationButton.addEventListener('click', enableNotifications);
elements.mediaViewerDownload.addEventListener('click', downloadCurrentMedia);
elements.mediaViewerClose.addEventListener('click', closeMediaViewer);
elements.mediaViewer.addEventListener('click', (event) => {
  if (event.target?.hasAttribute?.('data-media-viewer-close')) {
    closeMediaViewer();
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !elements.mediaViewer.classList.contains('hidden')) {
    closeMediaViewer();
  }
});
elements.attachButton.addEventListener('click', () => elements.attachmentInput.click());
elements.attachmentInput.addEventListener('change', () => {
  try {
    addAttachmentFiles(elements.attachmentInput.files || []);
  } catch (error) {
    appendMessage('system', error instanceof Error ? error.message : String(error), { persist: false });
  } finally {
    elements.attachmentInput.value = '';
  }
});
elements.messageForm.addEventListener('submit', handleSubmit);
elements.messageInput.addEventListener('input', () => {
  autoResizeTextarea();
  selectedSlashCommandIndex = 0;
  renderSlashCommandPalette();
});
elements.messageInput.addEventListener('blur', () => {
  window.setTimeout(hideSlashCommandPalette, 160);
});
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
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
