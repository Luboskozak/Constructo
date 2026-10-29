/* Constructo mobil – service worker: aplikace se otevře i bez signálu a fronta se na Androidu odešle sama na pozadí. */
importScripts('queue.js');
const CACHE = 'constructo-mobil-8';
const SHELL = ['./', 'index.html', 'queue.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// vlastní soubory: nejdřív zkusit síť (nová verze), bez signálu vzít uloženou kopii; Google se neukládá
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    try {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 5000);
      const r = await fetch(e.request, {signal: ctl.signal}); clearTimeout(t);
      if (r.ok) c.put(e.request, r.clone());
      return r;
    } catch (x) {
      // počítačová verze (/pc/) dostane jen svou uloženou kopii, nikdy mobilní aplikaci
      if (u.pathname.startsWith('/pc')) return (await c.match(e.request, {ignoreSearch: true})) || (await c.match('/pc/')) || Response.error();
      return (await c.match(e.request, {ignoreSearch: true})) || (await c.match('index.html')) || Response.error();
    }
  })());
});
self.addEventListener('sync', e => {
  if (e.tag === 'cx-odeslat') e.waitUntil(CXQ.process().then(async r => {
    const cl = await self.clients.matchAll(); cl.forEach(c => c.postMessage({cx: 'queue', r}));
    if (r && r.err && r.err === 'OFFLINE') throw new Error('zkusit později');
  }));
});
self.addEventListener('message', e => { if (e.data === 'cx-odeslat') e.waitUntil(CXQ.process()); });
