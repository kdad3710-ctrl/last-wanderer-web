// Cache version bumped to wanderer-v7: v4 restores the original SVG UI
// (buttons, joystick, windows, hotbar/slots, menu frame, recipe rows,
// feedback banner) and adds item_sword.svg, so all those assets must be
// precached for offline/PWA play.
const cacheName = 'wanderer-v7';
const filesToCache = [
  '/', '/index.html', '/main.js', '/manifest.json', '/sw.js', '/icon.png',
  '/assets/ui/joystick_base.svg', '/assets/ui/joystick_knob.svg',
  '/assets/ui/btn_break.svg', '/assets/ui/btn_jump.svg',
  '/assets/ui/btn_craft.svg', '/assets/ui/btn_inventory.svg',
  '/assets/ui/ui_window.svg', '/assets/ui/ui_main_menu_frame.svg',
  '/assets/ui/recipe_row.svg', '/assets/ui/inventory_slot.svg',
  '/assets/ui/hotbar_slot.svg', '/assets/ui/hotbar_selector.svg',
  '/assets/ui/menu_button_start.svg', '/assets/ui/feedback_banner.svg',
  '/assets/ui/item_wood.svg', '/assets/ui/item_stone.svg', '/assets/ui/item_metal.svg',
  '/assets/ui/item_fiber.svg', '/assets/ui/item_axe.svg', '/assets/ui/item_pickaxe.svg',
  '/assets/ui/item_torch.svg', '/assets/ui/item_campfire.svg', '/assets/ui/item_sword.svg'
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
