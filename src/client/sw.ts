export {};
declare const self: ServiceWorkerGlobalScope;

const CACHE = 'ccm-v8';
const SHELL = ['/', '/css/style.css', '/assets/shop.js', '/icons/logo.webp', '/icons/icon-192.png', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const put = (key: Request | string, res: Response) => {
  const copy = res.clone();
  void caches.open(CACHE).then((c) => c.put(key, copy));
};

self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/admin') || url.pathname.startsWith('/api/admin') || url.pathname === '/assets/admin.js' || url.pathname === '/assets/login.js') return;
  if (url.pathname.startsWith('/api/') && url.pathname !== '/api/products') return;

  const networkFirst = url.pathname === '/api/products' || req.mode === 'navigate' || SHELL.includes(url.pathname);
  if (networkFirst) { // réseau d'abord, cache en secours (hors-ligne)
    e.respondWith(
      fetch(req)
        .then((r) => { if (r.ok) put(req.mode === 'navigate' ? '/' : req, r); return r; })
        .catch(async () => (await caches.match(req.mode === 'navigate' ? '/' : req, { ignoreSearch: true })) ?? Response.error()),
    );
  } else { // images et fichiers statiques : cache d'abord
    e.respondWith(
      caches.match(req, { ignoreSearch: true }).then((hit) => hit ?? fetch(req).then((r) => { if (r.ok) put(req, r); return r; })),
    );
  }
});

interface PushData { title?: string; body?: string; url?: string }

self.addEventListener('push', (e) => {
  let d: PushData = {};
  try { d = e.data ? (e.data.json() as PushData) : {}; } catch { d = { body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'CCM-NONSAKA', {
    body: d.body || '', icon: '/icons/icon-192.png', badge: '/icons/icon-96.png', data: { url: d.url || '/' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL((e.notification.data as { url: string }).url, self.location.origin).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.startsWith(self.location.origin)) { void c.navigate(target); return c.focus(); }
      }
      return self.clients.openWindow(target);
    }),
  );
});
