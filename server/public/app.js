const STORAGE_KEY = 'openclaw-web-channel-settings-v1';
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
  clearHistoryButton: document.querySelector('#clearHistoryButton'),
  messages: document.querySelector('#messages'),
  messageForm: document.querySelector('#messageForm'),
  messageInput: document.querySelector('#messageInput'),
  includeLocationInput: document.querySelector('#includeLocationInput'),
  attachmentInput: document.querySelector('#attachmentInput'),
  attachButton: document.querySelector('#attachButton'),
  attachmentTray: document.querySelector('#attachmentTray'),
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
const mediaUrlCache = new Map();

function applyTheme(themeMode) {
  document.documentElement.dataset.theme = ['light', 'dark'].includes(themeMode) ? themeMode : 'system';
}

function applySettingsToForm() {
  elements.apiUrlInput.value = settings.apiUrl || window.location.origin;
  elements.apiKeyInput.value = settings.apiKey || '';
  elements.deviceIdInput.value = settings.deviceId || randomDeviceId();
  elements.themeModeInput.value = settings.themeMode || 'dark';
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
        appendMessage(item.role, item.text, { persist: false, autoScroll: false, mediaRefs: mediaRefsFromHistoryAttachments(item.attachments) });
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
  clone.querySelectorAll('.message-attachments').forEach((preview) => preview.remove());
  return clone.textContent || '';
}

function currentRenderedHistorySignature() {
  return [...elements.messages.querySelectorAll('.message')]
    .map((node) => `${[...node.classList].find((className) => className !== 'message') || ''}:${messageTextWithoutAttachmentPreview(node)}`)
    .join('\n---\n');
}

function historySignature(history) {
  return history.map((item) => `${item.role}:${item.text}`).join('\n---\n');
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

  return { text: visibleLines.join('\n').trim() || text, refs };
}

function isImageRef(ref) {
  return /\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(ref);
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

  if (isRemote) {
    caption.href = ref;
    if (image) {
      image.src = ref;
    }
    return;
  }

  if (mediaUrlCache.has(ref)) {
    const cachedUrl = mediaUrlCache.get(ref);
    caption.href = cachedUrl;
    caption.textContent = captionText;
    if (image) {
      image.src = cachedUrl;
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

function renderMessageNode(node, role, text, options = {}) {
  const media = extractMediaRefs(text);
  node.className = `message ${role}`;
  node.replaceChildren();
  appendMarkdown(node, media.text);
  for (const ref of [...media.refs, ...(node._mediaRefs || [])]) {
    appendMediaRef(node, ref);
  }
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
  elements.messages.append(node);
  scrollToBottom(options);
  if (options.persist !== false) {
    persistMessage(role, text);
  }
  return node;
}

function startThinkingMessage() {
  const startedAt = Date.now();
  const node = appendMessage('assistant', '응답을 작성 중입니다…', { persist: false });
  node.classList.add('pending');
  const timer = window.setInterval(() => {
    const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    renderMessageNode(node, 'assistant pending', `응답을 작성 중입니다… (${elapsedSeconds}초)`, { force: true });
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

function formatLocationText(position) {
  const { latitude, longitude, accuracy } = position.coords;
  return `현재위치: ${latitude.toFixed(6)}, ${longitude.toFixed(6)} (정확도 약 ${Math.round(accuracy)}m)`;
}

function getCurrentPosition(options) {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

async function getCurrentLocationText() {
  if (!navigator.geolocation) {
    throw new Error('이 브라우저는 현재 위치 기능을 지원하지 않습니다.');
  }

  try {
    const position = await getCurrentPosition({
      enableHighAccuracy: false,
      timeout: 7000,
      maximumAge: 5 * 60 * 1000,
    });
    return formatLocationText(position);
  } catch (firstError) {
    try {
      const position = await getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0,
      });
      return formatLocationText(position);
    } catch (secondError) {
      throw new Error(locationErrorMessage(secondError || firstError));
    }
  }
}

async function sendMessage(message, attachments = []) {
  assertValidApiKey(settings.apiKey);
  const response = await fetch(`${settings.apiUrl}/v1/message`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${settings.apiKey}`,
      'x-user-id': await sharedUserId(),
    },
    body: JSON.stringify({ message, attachments }),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = body?.error?.message || `HTTP ${response.status}`;
    throw new Error(detail);
  }
  return body;
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
    let outgoingMessage = rawMessage || '첨부 파일을 확인하고 사용자의 의도에 맞게 분석해주세요.';
    if (elements.includeLocationInput.checked && !rawMessage.startsWith('/')) {
      setStatus('현재 위치를 가져오는 중입니다...');
      outgoingMessage = `${rawMessage}\n\n${await getCurrentLocationText()}`;
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
    try {
      const response = await sendMessage(outgoingMessage, attachments);
      thinkingMessage.stop();
      renderMessageNode(thinkingMessage.node, 'assistant', response.reply || '(빈 응답)', { force: true });
      setStatus('');
      window.setTimeout(refreshHistoryIfChanged, 800);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      thinkingMessage.stop();
      renderMessageNode(thinkingMessage.node, 'system', errorMessage, { force: true });
      await appendServerHistoryMessages([
        { role: 'user', text: displayedUserText, savedAt: new Date().toISOString() },
        { role: 'system', text: `전송 실패: ${errorMessage}`, savedAt: new Date().toISOString() },
      ]).catch(() => {});
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
  elements.messageInput.style.height = `${Math.min(elements.messageInput.scrollHeight, 150)}px`;
}

applySettingsToForm();
renderHistory();
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
elements.messageInput.addEventListener('input', autoResizeTextarea);
elements.messageInput.addEventListener('keydown', (event) => {
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
