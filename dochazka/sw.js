/* Constructo Docházka – service worker: aplikace se otevře i bez signálu (záznamy čekají v telefonu a odešlou se samy). */
const CACHE = 'constructo-dochazka-8';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('constructo-dochazka') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
// nejdřív síť (vždy nejnovější verze), bez signálu uložená kopie; Google se neukládá
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || !u.pathname.startsWith('/dochazka/') || /\.mp4$/.test(u.pathname)) return;   // video jde rovnou ze sítě (iPhone ho stahuje po kouscích)
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    try {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 5000);
      const r = await fetch(e.request, {signal: ctl.signal, cache: 'no-cache'}); clearTimeout(t);
      if (r.ok) c.put(e.request, r.clone());
      return r;
    } catch (x) {
      return (await c.match(e.request, {ignoreSearch: true})) || (await c.match('index.html')) || Response.error();
    }
  })());
});
