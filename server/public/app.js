const STORAGE_KEY = 'openclaw-web-channel-settings-v1';
const LEGACY_HISTORY_KEY_PREFIX = 'openclaw-web-channel-history-v1';

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
  sendButton: document.querySelector('#sendButton'),
  statusText: document.querySelector('#statusText'),
};

function randomDeviceId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `web-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

function scrollToBottom() {
  requestAnimationFrame(() => {
    elements.messages.scrollTop = elements.messages.scrollHeight;
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
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
  return Array.isArray(body.messages) ? body.messages : [];
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
        appendMessage(item.role, item.text, { persist: false });
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

function currentRenderedHistorySignature() {
  return [...elements.messages.querySelectorAll('.message')]
    .map((node) => `${[...node.classList].find((className) => className !== 'message') || ''}:${node.textContent || ''}`)
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
    const history = await fetchHistory();
    if (history.length > 0 && historySignature(history) !== currentRenderedHistorySignature()) {
      clearRenderedMessages();
      for (const item of history) {
        if (typeof item?.role === 'string' && typeof item?.text === 'string') {
          appendMessage(item.role, item.text, { persist: false });
        }
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

function renderMessageNode(node, role, text) {
  node.className = `message ${role}`;
  node.replaceChildren();
  appendMarkdown(node, text);
  scrollToBottom();
}

function appendMessage(role, text, options = {}) {
  const node = document.createElement('article');
  renderMessageNode(node, role, text);
  elements.messages.append(node);
  scrollToBottom();
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
    renderMessageNode(node, 'assistant pending', `응답을 작성 중입니다… (${elapsedSeconds}초)`);
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

async function sendMessage(message) {
  assertValidApiKey(settings.apiKey);
  const response = await fetch(`${settings.apiUrl}/v1/message`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${settings.apiKey}`,
      'x-user-id': await sharedUserId(),
    },
    body: JSON.stringify({ message }),
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
  if (!rawMessage) {
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
    let outgoingMessage = rawMessage;
    if (elements.includeLocationInput.checked && !rawMessage.startsWith('/')) {
      setStatus('현재 위치를 가져오는 중입니다...');
      outgoingMessage = `${rawMessage}\n\n${await getCurrentLocationText()}`;
    }

    appendMessage('user', outgoingMessage);
    elements.messageInput.value = '';
    elements.includeLocationInput.checked = false;
    setStatus('OpenClaw 응답을 기다리는 중입니다...');

    const thinkingMessage = startThinkingMessage();
    try {
      const response = await sendMessage(outgoingMessage);
      thinkingMessage.stop();
      renderMessageNode(thinkingMessage.node, 'assistant', response.reply || '(빈 응답)');
      setStatus('');
      window.setTimeout(refreshHistoryIfChanged, 800);
    } catch (error) {
      thinkingMessage.stop();
      renderMessageNode(thinkingMessage.node, 'system', error instanceof Error ? error.message : String(error));
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
elements.messageForm.addEventListener('submit', handleSubmit);
elements.messageInput.addEventListener('input', autoResizeTextarea);
elements.messageInput.addEventListener('keydown', (event) => {
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
