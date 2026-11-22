// Cache version bumped to wanderer-v5 so returning players get the rewritten
// main.js / index.html instead of the stale v4 bundle.
const cacheName = 'wanderer-v5';
const filesToCache = [
  '/', '/index.html', '/main.js', '/manifest.json', '/sw.js', '/icon.png',
  '/assets/ui/item_wood.svg', '/assets/ui/item_stone.svg', '/assets/ui/item_metal.svg',
  '/assets/ui/item_fiber.svg', '/assets/ui/item_axe.svg', '/assets/ui/item_pickaxe.svg',
  '/assets/ui/item_torch.svg', '/assets/ui/item_campfire.svg'
];

self.addEventListener('install', e => {
  self.skipWaiting(); // push the update to clients immediately
  e.waitUntil(
    caches.open(cacheName).then(cache =>
      Promise.all(filesToCache.map(url =>
        cache.add(url).catch(err => console.warn('SW: failed to cache', url, err))
      ))
    )
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(keys.map(k => {
        if (k !== cacheName) return caches.delete(k);
      }));
    }).then(() => self.clients.claim())
  );
});

// Cache-first, then network. Cache new requests dynamically. Offline fallback to index.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(res => {
      return res || fetch(e.request).then(fetchRes => {
        if (!fetchRes || fetchRes.status !== 200 || fetchRes.type !== 'basic') {
          return fetchRes;
        }
        const responseToCache = fetchRes.clone();
        caches.open(cacheName).then(cache => cache.put(e.request, responseToCache));
        return fetchRes;
      }).catch(() => caches.match('/index.html'));
    })
  );
});
