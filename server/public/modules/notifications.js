export function notificationsSupported() {
  return 'Notification' in window;
}

export function pushNotificationsSupported() {
  return getPushNotificationSupportState().supported;
}

export function getPushNotificationSupportState(env = browserNotificationEnv()) {
  if (!env.hasNotification) {
    return { supported: false, reason: 'notification-unsupported', message: '이 환경은 브라우저 알림을 지원하지 않습니다.' };
  }
  if (env.isIos && !env.isStandalone) {
    return { supported: false, reason: 'ios-install-required', message: 'iOS에서는 홈 화면에 추가한 뒤 앱 아이콘으로 실행해야 푸시 알림을 사용할 수 있습니다.' };
  }
  if (!env.hasServiceWorker || !env.hasPushManager) {
    return { supported: false, reason: 'push-unsupported', message: '이 브라우저는 백그라운드 푸시 알림을 지원하지 않습니다.' };
  }
  return { supported: true, reason: 'supported', message: '푸시 알림을 사용할 수 있습니다.' };
}

export function isIosLike(userAgent = navigator.userAgent, platform = navigator.platform, maxTouchPoints = navigator.maxTouchPoints || 0) {
  return /iPad|iPhone|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
}

export function isStandalonePwa() {
  return Boolean(window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true);
}

export function updateNotificationButton(button, enabled) {
  if (!button) {
    return;
  }
  const support = getPushNotificationSupportState();
  if (!notificationsSupported()) {
    button.textContent = '알림 미지원';
    button.disabled = true;
    return;
  }
  if (!support.supported) {
    button.textContent = support.reason === 'ios-install-required' ? '홈 화면 설치 필요' : '탭 알림만 지원';
    button.disabled = false;
    return;
  }
  if (Notification.permission === 'granted' && enabled) {
    button.textContent = '푸시 알림 켜짐';
    button.disabled = false;
    return;
  }
  if (Notification.permission === 'denied') {
    button.textContent = '알림 차단됨';
    button.disabled = true;
    return;
  }
  button.textContent = '알림 허용';
  button.disabled = false;
}

export async function requestNotificationPermission() {
  if (!notificationsSupported()) {
    return 'unsupported';
  }
  return Notification.requestPermission();
}

export async function subscribeToPushNotifications({ apiFetch, apiHeaders, deviceId }) {
  const support = getPushNotificationSupportState();
  if (!support.supported) {
    return { ok: false, reason: support.reason, message: support.message };
  }
  const permission = await requestNotificationPermission();
  if (permission !== 'granted') {
    return { ok: false, reason: permission, message: '알림 권한이 허용되지 않았습니다.' };
  }

  const registration = await navigator.serviceWorker.ready;
  const keyResponse = await apiFetch('/v1/push/vapid-public-key');
  if (!keyResponse.ok) {
    const text = await keyResponse.text().catch(() => '');
    throw new Error(text || '푸시 알림 키를 불러오지 못했습니다.');
  }
  const { public_key: publicKey } = await keyResponse.json();
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  const saveResponse = await apiFetch('/v1/push/subscriptions', {
    method: 'POST',
    headers: {
      ...(await apiHeaders({ 'content-type': 'application/json', 'x-device-id': deviceId })),
    },
    body: JSON.stringify({ ...subscription.toJSON(), device_id: deviceId }),
  });
  if (!saveResponse.ok) {
    const text = await saveResponse.text().catch(() => '');
    throw new Error(text || '푸시 알림 구독을 저장하지 못했습니다.');
  }
  return { ok: true, permission };
}

export function notifyReplyReady({ enabled, title = 'OpenClaw 응답 도착', body = '새 답변이 도착했습니다.' }) {
  if (!enabled || !notificationsSupported() || Notification.permission !== 'granted') {
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

function browserNotificationEnv() {
  return {
    hasNotification: 'Notification' in window,
    hasServiceWorker: 'serviceWorker' in navigator,
    hasPushManager: 'PushManager' in window,
    isIos: isIosLike(),
    isStandalone: isStandalonePwa(),
  };
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = `${base64String}${padding}`.replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
