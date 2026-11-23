/* Constructo 4.91 – Management a Deník v JEDNOM okně (Luboš 23. 11.)
   Management (/pc/) si Deník (/denik/) načte předem na pozadí. Přepnutí Management ↔ Deník
   pak jen ukáže / schová už načtený Deník – bez znovunačtení stránky, přihlášení a synchronizace.
   Stejný soubor načítá i Deník (denik/index.html): když běží uvnitř Managementu, jeho odkaz
   „Management“ jen schová Deník. Data se propisují jako dřív (stejné úložiště prohlížeče). */
(function () {
  'use strict';
  var w = window, d = document;
  var vRamci = false, horniPc = false;
  try { vRamci = w.top !== w; horniPc = vRamci && /^\/pc(\/|$)/.test(w.top.location.pathname); } catch (e) { horniPc = false; }
  var jePc = /^\/pc(\/|$)/.test(location.pathname);

  /* ---------- uvnitř Managementu ---------- */
  if (horniPc) {
    if (jePc) {
      // Deník poslal rámeček na /pc/… (např. „Údaje o stavbě“) → Management to otevře sám, rámeček se vrátí na Deník
      try { w.top.postMessage({cx: 'management', hash: location.hash, znovu: 1}, location.origin); } catch (e) {}
      try { w.stop(); } catch (e) {}
      d.documentElement.innerHTML = '';
      throw new Error('cx-jednaapp: Management v rámečku nepouštím');
    }
    // Deník v rámečku: odkazy na Management jen přepnou zpět (bez načítání)
    d.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      var a = e.target && e.target.closest && e.target.closest('a[href]');
      if (!a || a.target === '_blank') return;
      var u; try { u = new URL(a.getAttribute('href'), location.href); } catch (er) { return; }
      if (u.origin !== location.origin || !/^\/pc(\/|$)/.test(u.pathname)) return;
      e.preventDefault(); e.stopPropagation();
      w.top.postMessage({cx: 'management', hash: u.hash}, location.origin);
    }, true);
    return;
  }

  if (!jePc || vRamci) return;

  /* ---------- Management (hlavní okno) ---------- */
  var RAM_URL = '/denik/';
  var box = null, ifr = null, nacteno = false, zobrazeno = false, titulek = '';

  function css() {
    var s = d.createElement('style');
    s.textContent =
      '#cx-denik{position:fixed;inset:0;z-index:2147483000;background:#131518;visibility:hidden;pointer-events:none}' +
      '#cx-denik.on{visibility:visible;pointer-events:auto}' +
      '#cx-denik iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:transparent}' +
      '#cx-denik .cx-nac{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#c9ced3;font:600 16px system-ui,-apple-system,Segoe UI,sans-serif}' +
      '#cx-denik.ok .cx-nac{display:none}';
    d.head.appendChild(s);
  }
  function vytvor() {
    if (box) return;
    css();
    box = d.createElement('div'); box.id = 'cx-denik';
    box.innerHTML = '<div class="cx-nac">Načítám Deník…</div>';
    ifr = d.createElement('iframe');
    ifr.title = 'Stavební deník Constructo';
    ifr.setAttribute('allow', 'camera; microphone; geolocation; clipboard-read; clipboard-write; fullscreen');
    ifr.addEventListener('load', function () { nacteno = true; box.classList.add('ok'); });
    ifr.src = RAM_URL;
    box.appendChild(ifr);
    d.body.appendChild(box);
  }
  function ukazDenik() {
    vytvor();
    zobrazeno = true;
    box.classList.add('on');
    if (!titulek) titulek = d.title;
    d.title = 'Constructo · Deník';
    try { history.replaceState(history.state, '', location.pathname + location.search + '#denik'); } catch (e) {}
    try { ifr.focus(); } catch (e) {}
  }
  function ukazManagement(hash) {
    zobrazeno = false;
    if (box) box.classList.remove('on');
    if (titulek) d.title = titulek;
    if (hash && hash !== '#denik' && hash.length > 1) {
      // např. #udaje – Management ho umí otevřít jen při startu
      try { history.replaceState(null, '', location.pathname + location.search + hash); } catch (e) {}
      location.reload();
      return;
    }
    try { history.replaceState(history.state, '', location.pathname + location.search); } catch (e) {}
  }
  w.CXJednaApp = {denik: ukazDenik, management: ukazManagement, jeDenik: function () { return zobrazeno; }};

  // odkazy na Deník v Managementu → přepnout bez načítání
  d.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    var a = e.target && e.target.closest && e.target.closest('a[href]');
    if (!a || a.target === '_blank') return;
    var u; try { u = new URL(a.getAttribute('href'), location.href); } catch (er) { return; }
    if (u.origin !== location.origin || !/^\/denik(\/|$)/.test(u.pathname)) return;
    e.preventDefault(); e.stopPropagation();
    ukazDenik();
  }, true);

  w.addEventListener('message', function (e) {
    if (e.origin !== location.origin || !e.data || e.data.cx !== 'management') return;
    if (e.data.znovu && ifr) { nacteno = false; box.classList.remove('ok'); ifr.src = RAM_URL; }
    ukazManagement(e.data.hash || '');
  });

  function predem() { vytvor(); }
  function start() {
    if (location.hash === '#denik') { ukazDenik(); return; }
    // Deník se načte na pozadí, až Management doběhne – první přepnutí je pak okamžité
    var spust = function () { setTimeout(function () { (w.requestIdleCallback || function (f) { setTimeout(f, 1); })(predem, {timeout: 4000}); }, 1500); };
    if (d.readyState === 'complete') spust(); else w.addEventListener('load', spust);
  }
  if (d.body) start(); else d.addEventListener('DOMContentLoaded', start);
})();
