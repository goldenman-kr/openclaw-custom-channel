export function notificationsSupported() {
  return 'Notification' in window;
}

export function pushNotificationsSupported() {
  return notificationsSupported() && 'serviceWorker' in navigator && 'PushManager' in window;
}

export function updateNotificationButton(button, enabled) {
  if (!button) {
    return;
  }
  if (!notificationsSupported()) {
    button.textContent = '알림 미지원';
    button.disabled = true;
    return;
  }
  if (!pushNotificationsSupported()) {
    button.textContent = '탭 알림만 지원';
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
  if (!pushNotificationsSupported()) {
    return { ok: false, reason: 'unsupported' };
  }
  const permission = await requestNotificationPermission();
  if (permission !== 'granted') {
    return { ok: false, reason: permission };
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
