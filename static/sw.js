// Service Worker for nivm PWA
const CACHE_NAME = 'nivm-shell-v20';
const STATIC_ASSETS = [
    '/',
    '/static/index.html',
    '/static/css/main.css',
    '/static/css/base.css',
    '/static/css/layout.css',
    '/static/css/chat.css',
    '/static/css/modals.css',
    '/static/css/markdown.css',
    '/static/manifest.json',
    '/static/icons/favicon-32.png',
    '/static/icons/icon-192.png',
    '/static/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            // Attempt to cache essential shell assets, ignoring non-fatal failures
            return Promise.allSettled(
                STATIC_ASSETS.map(url => cache.add(url).catch(e => console.debug('SW pre-cache miss:', url)))
            );
        })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) {
                        return caches.delete(key);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = new URL(request.url);

    // Completely bypass non-GET and API / dynamic / streaming requests
    if (
        request.method !== 'GET' ||
        url.pathname.startsWith('/api/') ||
        url.pathname.startsWith('/uploads/') ||
        url.pathname.startsWith('/images/') ||
        url.pathname.includes('/chat') ||
        request.headers.get('accept')?.includes('text/event-stream')
    ) {
        return; // standard browser network fetch
    }

    // Network-first strategy for index and static files to ensure latest version is always seen,
    // falling back to cache if offline
    event.respondWith(
        fetch(request)
            .then((response) => {
                if (response && response.status === 200 && response.type === 'basic') {
                    const responseToCache = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(request, responseToCache);
                    });
                }
                return response;
            })
            .catch(() => {
                return caches.match(request).then((cached) => {
                    if (cached) return cached;
                    if (request.mode === 'navigate') {
                        return caches.match('/');
                    }
                    return new Response('Network error', { status: 408, headers: { 'Content-Type': 'text/plain' } });
                });
            })
    );
});
