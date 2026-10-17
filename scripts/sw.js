// sw.js -- rack.bar's service worker template (RBAR-81, ADR-0018). Hand-written, no
// libraries. The build (scripts/offline.ts) fills in the two markers below and emits
// the result as dist/sw.js; this file is never served as-is.
//
//   install   precache every built file under a cache named for this build, straight
//             from the network (cache: 'reload'), never from the browser's HTTP cache,
//             which could hand back the previous build's page. No skipWaiting: an
//             update waits until the lifter taps "Update".
//   activate  delete the older rack-bar caches, then take control of open pages.
//   fetch     pages (navigations): network first, but give up after PAGE_TIMEOUT_MS
//             (one bar of signal can hang a fetch for tens of seconds) and serve the
//             precached page. Pages are never written to the cache: the only page in
//             it is the one this build precached, so it always matches its assets.
//             everything else same-origin: cache first (built assets are hashed, so a
//             cached copy is never stale), falling back to the network and keeping it.
//   message   SKIP_WAITING, sent by the Update button, activates a waiting worker.

const CACHE = '__RACK_CACHE__';
const PRECACHE = __RACK_PRECACHE__;
const PAGE_TIMEOUT_MS = 3000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith('rack-bar-') && k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Keep a good same-origin response in this build's cache. Errors and opaque responses
// are not kept.
async function keep(request, response) {
  if (response.ok && response.type === 'basic') {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

// The precached copy of a page: its path without the query string (a share link's
// ?query never misses), /index.html read as /, and / for anything not precached.
async function cachedPage(request) {
  const path = new URL(request.url).pathname;
  const key = path === '/index.html' ? '/' : PRECACHE.includes(path) ? path : '/';
  const cache = await caches.open(CACHE);
  return cache.match(key, { ignoreVary: true });
}

async function page(request) {
  const network = fetch(request);
  // If the precached page wins the race, a late network failure is expected; mark it
  // handled so it is not reported as an unhandled rejection.
  network.catch(() => {});
  let timer;
  const slow = new Promise((resolve) => {
    timer = setTimeout(resolve, PAGE_TIMEOUT_MS);
  });
  try {
    const first = await Promise.race([network, slow]);
    if (first) return first;
    // Too slow: the precached page now, else keep waiting on the network.
    return (await cachedPage(request)) || (await network);
  } catch (err) {
    // Offline.
    const hit = await cachedPage(request);
    if (hit) return hit;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ignoreVary: a crossorigin <script>/font request carries an Origin header the
// precache request did not, and a server answering "Vary: Origin" would make every
// cached copy miss. These are our own static files; they never vary.
async function asset(request) {
  const hit = await caches.match(request, { ignoreVary: true });
  return hit || keep(request, await fetch(request));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(request.mode === 'navigate' ? page(request) : asset(request));
});
