const CACHE_NAME = 'openclaw-web-channel-v346';
const ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/modules/api-client.js',
  '/modules/attachment-preview.js',
  '/modules/clipboard.js',
  '/modules/code-block.js',
  '/modules/attachments.js',
  '/modules/composer-draft.js',
  '/modules/composer-input.js',
  '/modules/conversation-dialogs.js',
  '/modules/conversation-format.js',
  '/modules/conversation-list-item.js',
  '/modules/conversation-list-view.js',
  '/modules/conversation-list.js',
  '/modules/composer-availability.js',
  '/modules/conversation-search.js',
  '/modules/display.js',
  '/modules/floating-actions.js',
  '/modules/history-api.js',
  '/modules/history-controls.js',
  '/modules/history-handoff.js',
  '/modules/job-utils.js',
  '/modules/history-state.js',
  '/modules/home-screen.js',
  '/modules/login-screen.js',
  '/modules/location.js',
  '/modules/markdown-table.js',
  '/modules/media.js',
  '/modules/message-actions.js',
  '/modules/mobile-drawer.js',
  '/modules/model-picker.js',
  '/modules/navigation.js',
  '/modules/notifications.js',
  '/modules/scroll-ui.js',
  '/modules/settings-panel.js',
  '/modules/settings.js',
  '/modules/slash-commands.js',
  '/modules/toast.js',
  '/modules/user-identity.js',
  '/modules/version-check.js',
  '/modules/sidebar-width.js',
  '/plugins/plugin-registry.js',
  '/plugins/wallet-provider.js',
  '/plugins/spot-wallet-provider.js',
  '/plugins/spot-order-card.js',
  '/plugins/spot-wallet-intent.js',
  '/plugins/spot-wallet-balance.js',
  '/plugins/orbs-polygon-bridge-card.js',
  '/plugins/wallet-transaction-card.js',
  '/manifest.webmanifest',
  '/assets/openclaw-app-icon-180.png',
  '/assets/openclaw-app-icon-192.png',
  '/assets/openclaw-app-icon-512.png',
  '/assets/chevron-up.svg',
  '/assets/chevron-down.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

async function networkFirst(request, fallbackPath) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    return (await caches.match(request)) || (fallbackPath ? caches.match(fallbackPath) : undefined);
  }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.pathname.startsWith('/v1/')) {
    return;
  }

  const isNavigation = event.request.mode === 'navigate';
  const isMutableClientAsset = ['/', '/index.html', '/app.js', '/styles.css', '/sw.js', '/assets/spot-reown-wallet.js'].includes(url.pathname)
    || url.pathname.startsWith('/plugins/')
    || url.pathname.startsWith('/modules/');

  if (isNavigation || isMutableClientAsset) {
    event.respondWith(networkFirst(event.request, isNavigation ? '/index.html' : undefined));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request)),
  );
});

self.addEventListener('push', (event) => {
  const payload = parsePushPayload(event.data);
  const title = payload.title || 'OpenClaw 응답 도착';
  const options = {
    body: payload.body || '새 답변이 도착했습니다.',
    tag: payload.tag || (payload.conversationId ? `openclaw-reply-ready-${payload.conversationId}` : 'openclaw-reply-ready'),
    renotify: true,
    silent: false,
    data: {
      url: payload.url || '/',
      conversationId: payload.conversationId || null,
    },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || '/', self.location.origin).toString();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client) {
        await client.focus();
        if ('navigate' in client) {
          await client.navigate(targetUrl);
        }
        return;
      }
    }
    await self.clients.openWindow(targetUrl);
  })());
});

function parsePushPayload(data) {
  if (!data) {
    return {};
  }
  try {
    return data.json();
  } catch {
    return { body: data.text() };
  }
}
