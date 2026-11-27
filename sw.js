// BK공방 모바일 — 고칠 때마다 숫자 +1
const CACHE = 'bk-gongbang-v11';
const FILES = ['./', 'index.html', 'app.css', 'license.js', 'auto.html', 'auto.js', 'auto/anchor_shock.jpg', 'auto/anchor_angry.jpg', 'auto/anchor_smug.jpg', 'album.html', 'album.js', 'drama.html', 'drama.js', 'music.html', 'music.js', 'edit/', 'edit/index.html', 'edit/edit.css', 'edit/gb-edit.css', 'edit/edit.js', 'edit/bkkit.js', 'edit/fx.js', 'edit/lib.js', 'edit/mp4mux.js', 'edit/terms.js', 'fx.js', 'mp4mux.js', 'icon-192.png', 'manifest.json'];
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' }))))); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('bk-gongbang-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
// 항상 서버에 새 판이 있는지 먼저 물어보고(브라우저 임시 저장 건너뜀), 인터넷이 없을 때만 저장된 것 쓰기
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); } return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
