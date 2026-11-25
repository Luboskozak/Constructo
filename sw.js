/* Constructo mobil – service worker: aplikace se otevře i bez signálu a fronta se na Androidu odešle sama na pozadí. */
importScripts('queue.js');
const CACHE = 'constructo-mobil-50';
const SHELL = ['./', 'index.html', 'queue.js', 'pc/qr.js', 'pc/zprava.js', 'pc/dokumentace.js', 'pc/stavby.js', 'pc/firmy.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// vlastní soubory; Google se neukládá
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  if (u.pathname.startsWith('/dokumentace/')) return;   // Dokumentace (velké PDF/DWG knihovny) jde vždy rovnou ze sítě, bez 5s limitu a bez ukládání
  // Deník (/denik/) jde rovnou ze sítě a z běžné mezipaměti prohlížeče – dřív se každé otevření Deníku (19 MB) znovu stahovalo a ukládalo sem (pomalé přepínání)
  if (u.pathname.startsWith('/denik/')) return;
  if (u.pathname.startsWith('/dochazka/')) return;   // Docházka má vlastní service worker (/dochazka/sw.js)
  // dotaz „zkontroluj novou verzi“ (no-cache / no-store) jde vždy rovnou na síť
  if (e.request.mode !== 'navigate' && (e.request.cache === 'no-cache' || e.request.cache === 'no-store')) return;
  // 1.43: MOBILNÍ aplikace (úvodní stránka a její soubory) se otevře okamžitě z kopie v telefonu, bez čekání na signál.
  // Nová kopie se stáhne potichu na pozadí; novou verzi aplikace pozná stránka sama (novaVerze) a přenačte se.
  const ref = e.request.referrer ? new URL(e.request.referrer).pathname : '';
  const mobil = e.request.mode === 'navigate' ? (u.pathname === '/' || u.pathname === '/index.html')
    : ref === '/' || ref === '/index.html';
  if (mobil) {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      const hit = await c.match(e.request, {ignoreSearch: true}) || (e.request.mode === 'navigate' ? await c.match('index.html') || await c.match('./') : null);
      const net = fetch(e.request).then(r => { if (r.ok && r.type === 'basic') c.put(e.request, r.clone()); return r; });
      if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
      return net.catch(() => Response.error());
    })());
    return;
  }
  // ostatní (počítačová verze /pc/): nejdřív zkusit síť (nová verze), bez signálu vzít uloženou kopii
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
