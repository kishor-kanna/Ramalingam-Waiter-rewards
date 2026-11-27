// Lets the home-screen app open without internet. Always tries the network first,
// so updates pushed to GitHub show up on the next open; the saved copy is only a fallback.
// Sales still go to the Google Sheet directly and are never cached.
const CACHE = 'rewards-v3';
const SHELL = ['./', 'index.html', 'manager.html', 'ops.html', 'style.css?v=4', 'img/logo.png'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req))
  );
});
