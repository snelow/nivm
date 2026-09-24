// Service Worker for Project NIVM PWA
// Provides installable shortcut capability and renders a dedicated offline fallback when host is unreachable.

const CACHE_NAME = 'nivm-pwa-v8';
const OFFLINE_URL = '/offline.html';

const ASSETS_TO_CACHE = [
    OFFLINE_URL,
    '/static/offline.html',
    '/manifest.json',
    '/favicon.ico',
    '/static/icons/icon-192.png',
    '/static/icons/icon-512.png',
    '/static/icons/icon-maskable-192.png',
    '/static/icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return Promise.allSettled(
                ASSETS_TO_CACHE.map(url => cache.add(url).catch(err => console.debug('Pre-cache miss:', url, err)))
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
                        console.log('[SW] Purging old cache:', key);
                        return caches.delete(key);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('message', (event) => {
    if (event.data && (event.data.type === 'SKIP_WAITING' || event.data === 'skipWaiting')) {
        self.skipWaiting();
    }
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = new URL(request.url);

    // Bypass API, uploads, images, streaming, and non-GET requests entirely
    if (
        request.method !== 'GET' ||
        url.pathname.startsWith('/api/') ||
        url.pathname.startsWith('/uploads/') ||
        url.pathname.startsWith('/images/') ||
        url.pathname.includes('/chat') ||
        request.headers.get('accept')?.includes('text/event-stream')
    ) {
        return;
    }

    // Navigation requests (opening or refreshing the page)
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request).catch(async () => {
                // When host is unreachable or user is offline, return the dedicated offline page
                const cache = await caches.open(CACHE_NAME);
                const cachedOffline = await cache.match(OFFLINE_URL) || await cache.match('/static/offline.html');
                if (cachedOffline) {
                    return cachedOffline;
                }
                return new Response('Project NIVM host is currently unreachable.', {
                    status: 503,
                    headers: { 'Content-Type': 'text/plain' }
                });
            })
        );
        return;
    }

    // Static asset requests (icons, manifest, etc.)
    event.respondWith(
        fetch(request).catch(async () => {
            const cached = await caches.match(request);
            if (cached) {
                return cached;
            }
            return new Response('Network unavailable', { status: 408, headers: { 'Content-Type': 'text/plain' } });
        })
    );
});
