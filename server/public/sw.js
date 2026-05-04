const CACHE_NAME = 'openclaw-web-channel-v201';
const ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/modules/attachments.js',
  '/modules/conversation-format.js',
  '/modules/display.js',
  '/modules/media.js',
  '/modules/settings.js',
  '/modules/sidebar-width.js',
  '/plugins/plugin-registry.js',
  '/plugins/spot-order-card.js',
  '/plugins/spot-wallet-intent.js',
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
  const isMutableClientAsset = ['/', '/index.html', '/app.js', '/styles.css', '/sw.js'].includes(url.pathname)
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
