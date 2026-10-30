// Service worker for Sử Việt: lets the installed app open without a network.
//
// Bump CACHE_VERSION when a deploy adds, renames or removes a file in the
// lists below (or to make every phone re-download the whole app). Edits to
// existing files such as app.js are picked up without a bump: see networkFirst.
const CACHE_VERSION = 'v2';
const CACHE_PREFIX = 'su-viet-';
const CACHE = CACHE_PREFIX + CACHE_VERSION;

// Paths are relative to this file (the site is served from /su-viet/).
// The page, scripts and styles: network first.
const CODE = [
  './',
  'index.html',
  'style.css',
  'history-details.js',
  'app.js',
  'history-extend.js',
  'quiz.js',
];
// Icons, favicon and manifest rarely change: cache first.
const STATIC = [
  'manifest.webmanifest',
  'favicon.ico',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

// How long to wait for the network before showing the cached copy.
const NETWORK_TIMEOUT = 4000;

// Cache key: the URL without query string or hash, so "?utm=…" visits do not
// pile up extra copies.
const keyOf = (url) => url.origin + url.pathname;
const STATIC_KEYS = new Set(STATIC.map((path) => keyOf(new URL(path, self.location))));
const HOME_KEY = keyOf(new URL('./', self.location));

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // cache: 'reload' skips the browser's HTTP cache, so a new version never
    // stores files left over from the previous deploy.
    await cache.addAll([...CODE, ...STATIC].map((path) => new Request(path, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // GitHub Pages serves all of the owner's project sites from one origin and
    // they share Cache Storage, so only this site's old caches are deleted.
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;
  // Cross-origin requests (source links, Wikipedia…) and other sites on this
  // origin (e.g. /emailer-dashboard/) are left to the browser.
  if (!req.url.startsWith(self.registration.scope)) return;

  const key = keyOf(new URL(req.url));
  event.respondWith(STATIC_KEYS.has(key) ? cacheFirst(event, key) : networkFirst(event, key));
});

async function cacheFirst(event, key) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(key, { ignoreVary: true });
  if (cached) return cached;
  const res = await fetch(event.request);
  if (res.ok && res.type === 'basic') event.waitUntil(cache.put(key, res.clone()));
  return res;
}

// The page, scripts, styles and anything else in scope: network first, falling
// back to the cache.
// Why not cache first or stale-while-revalidate: app.js is large and changes
// often, and history-details.js / history-extend.js depend on it (the extra
// era details are matched to app.js's periods by position). Network first
// gives every online visit the current deploy straight away, with all files
// from the same version, and each response refreshes the cache. Offline, the
// whole set comes from the cache. On a very slow network the cached copy is
// shown after NETWORK_TIMEOUT and the cache is updated when the network answers.
function networkFirst(event, key) {
  const req = event.request;
  let saving;
  const fresh = fetch(req).then((res) => {
    if (res.ok && res.type === 'basic') {
      const copy = res.clone();
      saving = caches.open(CACHE).then((cache) => cache.put(key, copy));
    }
    return res;
  });
  event.waitUntil(fresh.then(() => saving).catch(() => {}));

  return (async () => {
    let res;
    try {
      res = await Promise.race([fresh, new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT))]);
    } catch (err) {
      // Offline or the request failed: use the cache below.
    }
    if (res && res.status < 500) return res;
    const cache = await caches.open(CACHE);
    const cached = await cache.match(key, { ignoreVary: true })
      || (req.mode === 'navigate' ? await cache.match(HOME_KEY, { ignoreVary: true }) : undefined);
    if (cached) return cached;
    // Nothing cached: return the server's error, or keep waiting for the network.
    return res || fresh;
  })();
}
