// sw.js -- rack.bar's service worker template (RBAR-81, ADR-0018). Hand-written, no
// libraries. The build (scripts/offline.ts) fills in the two markers below and emits
// the result as dist/sw.js; this file is never served as-is.
//
//   install   precache every built file under a cache named for this build. No
//             skipWaiting: an update waits until the lifter taps "Update".
//   activate  delete the older rack-bar caches, then take control of open pages.
//   fetch     pages (navigations): network first, the cached page when offline.
//             everything else same-origin: cache first (built assets are hashed, so a
//             cached copy is never stale), falling back to the network and keeping it.
//   message   SKIP_WAITING, sent by the Update button, activates a waiting worker.

const CACHE = '__RACK_CACHE__';
const PRECACHE = __RACK_PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
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

async function page(request) {
  try {
    return await keep(request, await fetch(request));
  } catch (err) {
    // Offline: this page as cached (a share link's ?query never misses), else the app.
    const cache = await caches.open(CACHE);
    const hit =
      (await cache.match(request, { ignoreSearch: true, ignoreVary: true })) ||
      (await cache.match('/', { ignoreVary: true }));
    if (hit) return hit;
    throw err;
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
