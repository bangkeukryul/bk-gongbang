// BK공방 추억앨범 — 고칠 때마다 숫자 +1
const CACHE = 'bk-gongbang-v8';
const FILES = ['./', 'index.html', 'app.css', 'license.js', 'album.html', 'album.js', 'drama.html', 'drama.js', 'music.html', 'music.js', 'fx.js', 'mp4mux.js', 'icon-192.png', 'manifest.json'];
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('bk-gongbang-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
// 새 판을 먼저 받고, 인터넷이 없을 때만 저장된 것 쓰기
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});
