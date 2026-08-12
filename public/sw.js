// Hand-rolled service worker (Next 16 + Turbopack has no compatible
// Serwist integration yet: @serwist/next refuses to run under Turbopack,
// and @serwist/turbopack is experimental and unsuited to this app).
// Bump SW_VERSION on every deploy that changes cached assets/behavior.
const SW_VERSION = 'v1';
const SHELL_CACHE = `hermes-shell-${SW_VERSION}`;
const DATA_CACHE = `hermes-data-${SW_VERSION}`;

const APP_SHELL_URLS = [
  '/',
  '/offline',
  '/manifest.webmanifest',
  '/icon-192x192.png',
  '/icon-512x512.png',
  '/icon-maskable-512x512.png',
];

// Paths that must always hit the network: auth flows and privileged
// admin/export screens should never serve stale or cached state.
const NEVER_CACHE_PATH_PREFIXES = [
  '/auth',
  '/control-center/admin-panel',
  '/control-center/export',
];

function isNeverCachePath(pathname) {
  return NEVER_CACHE_PATH_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix)
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) =>
        Promise.all(
          APP_SHELL_URLS.map((url) =>
            cache.add(url).catch(() => {
              // Don't let one missing/unreachable URL abort the whole install.
            })
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== DATA_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (fallbackUrl) {
      const fallback = await cache.match(fallbackUrl);
      if (fallback) return fallback;
    }
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Never intercept mutations - they must always go straight to the network.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (isNeverCachePath(url.pathname)) return;

    if (request.mode === 'navigate') {
      event.respondWith(networkFirst(request, SHELL_CACHE, '/offline'));
      return;
    }

    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  // Cross-origin: only cache Supabase's REST read endpoints. Auth,
  // realtime (websocket), storage, and the bot/chat-adapter traffic pass
  // straight through untouched.
  if (
    url.hostname.endsWith('.supabase.co') &&
    url.pathname.startsWith('/rest/v1/')
  ) {
    event.respondWith(networkFirst(request, DATA_CACHE));
  }
});
