// Nakuadiary Admin service worker (scope /admin).
// 1. Shows "new order" push notifications (data-only FCM messages sent by
//    functions/src/push.js) even when the app is closed, and opens the order
//    when tapped.
// 2. Keeps the admin shell usable on a weak connection: network first, with
//    the last good copy as fallback. Data always comes live from Firebase.
const CACHE = 'nakua-admin-v1';
const SHELL = ['/admin', '/admin/styles.css?v=2', '/admin/js/app.js?v=2', '/admin/manifest.webmanifest', '/admin/icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith('/admin')) return;
  event.respondWith((async () => {
    try {
      const fresh = await fetch(event.request);
      if (fresh.ok) (await caches.open(CACHE)).put(event.request, fresh.clone());
      return fresh;
    } catch {
      return (await caches.match(event.request)) || (event.request.mode === 'navigate' ? caches.match('/admin') : Response.error());
    }
  })());
});

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { /* not JSON */ }
  const data = payload.data || payload;
  const title = data.title || payload.notification?.title || 'Nakuadiary';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || payload.notification?.body || 'Open the admin to see what’s new.',
    icon: '/admin/icons/icon-192.png',
    badge: '/admin/icons/badge-96.png',
    tag: data.tag || 'nakua-admin',
    renotify: true,
    data: { url: data.url || '/admin#/orders' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/admin#/orders', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find((w) => w.url.includes('/admin'));
    if (open) { await open.focus(); return open.navigate(target).catch(() => open.postMessage({ type: 'open', url: target })); }
    return self.clients.openWindow(target);
  })());
});
