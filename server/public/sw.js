const CACHE_NAME = 'openclaw-web-channel-v186';
const ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
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

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.pathname.startsWith('/v1/')) {
    return;
  }

  const isNavigation = event.request.mode === 'navigate';
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(event.request).catch(() => isNavigation ? caches.match('/index.html') : undefined);
    }),
  );
});
