export function notificationsSupported() {
  return 'Notification' in window;
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
  if (Notification.permission === 'granted' && enabled) {
    button.textContent = '알림 켜짐';
    return;
  }
  if (Notification.permission === 'denied') {
    button.textContent = '알림 차단됨';
    return;
  }
  button.textContent = '알림 허용';
}

export async function requestNotificationPermission() {
  if (!notificationsSupported()) {
    return 'unsupported';
  }
  return Notification.requestPermission();
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
