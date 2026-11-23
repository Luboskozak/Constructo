/* Constructo – samostatná stránka Dokumentace (zobrazuje ji Deník v menu Dokumentace). Stejná data jako záložka Dokumentace
   v Managementu: D.dokumenty přes skript Google (připojení „hyb-sync“ z Managementu na tomto počítači). */
(() => {
  const VERZE = '4.94';
  const ls = {get: k => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} }};
  const par = new URLSearchParams(location.search);
  if (window.self !== window.top || par.get('vlozeno')) document.body.classList.add('vlozeno');
  document.getElementById('ver').textContent = 'Constructo ' + VERZE + ' · Dokumentace je společná pro Management i Deník';
  let SY = null; try { SY = JSON.parse(ls.get('hyb-sync') || 'null'); } catch (e) {}
  const el = document.getElementById('dok');
  let tT = 0;
  const toast = m => { const t = document.getElementById('toast'); t.textContent = m; t.style.display = 'block'; clearTimeout(tT); tT = setTimeout(() => { t.style.display = 'none'; }, 4200); };
  if (!SY || !SY.url || !SY.key) {
    el.innerHTML = `<div class="nepripojeno"><b>Tento počítač zatím není připojený ke Constructu.</b><br>Dokumentace se načítá ze stejných dat jako Management. Otevřete jednou <a href="/pc/" target="_top">Management</a> a připojte se zvacím kódem od správce stavby (Data → Automatická synchronizace). Pak se tu dokumentace ukáže sama.</div>`;
    return;
  }
  // 4.63: Dokumentace otevřené stavby (Hybernská = sdílená data, další stavby přes CXStavby – pc/stavby.js)
  const CX = window.CXStavby, SID = CX ? CX.aktivni() : 'hybernska', HYB = SID === 'hybernska';
  const KLIC = HYB ? 'cx-dok-cache' : 'cx-dok-cache:' + SID;
  let D = {dokumenty: [], rev: 0};
  try { const c = JSON.parse(ls.get(KLIC) || 'null'); if (c && Array.isArray(c.dokumenty)) D = c; } catch (e) {}
  let ceka = {zmeny: new Map(), tomb: {}}, bezi = false;
  async function volej(body, ms) {
    const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), ms || 180000);
    try {
      const r = await fetch(SY.url, {method: 'POST', headers: {'Content-Type': 'text/plain;charset=utf-8'}, body: JSON.stringify(Object.assign({key: SY.key}, body)), signal: ctl.signal, redirect: 'follow'});
      const t = await r.text();
      try { return JSON.parse(t); } catch (e) { throw new Error('Google vrátil neplatnou odpověď.'); }
    } catch (e) { throw new Error(e.name === 'AbortError' ? 'Google neodpověděl včas.' : e.message || 'Bez připojení.'); }
    finally { clearTimeout(tm); }
  }
  function prevezmi(data, rev) {
    if (!data) return;
    const loc = new Map([...ceka.zmeny.values()].map(r => [r.id, r]));
    let seznam = (data.dokumenty || []).filter(r => !(ceka.tomb[r.id]) && !/^s[tp]~/.test(String(r.id)));
    seznam = seznam.map(r => loc.has(r.id) && (loc.get(r.id)._ts || 0) > (r._ts || 0) ? loc.get(r.id) : r);
    loc.forEach((r, id) => { if (!seznam.some(x => x.id === id)) seznam.push(r); });
    const pred = JSON.stringify(D.dokumenty);
    D = {dokumenty: seznam, rev: HYB ? Number(rev) || D.rev : rev || D.rev, ro: D.ro};
    ls.set(KLIC, JSON.stringify(D));
    if (JSON.stringify(seznam) !== pred) window.CXDok.obnov();
  }
  async function synchronizuj() {
    if (bezi) return; bezi = true;
    try {
      if (ceka.zmeny.size || Object.keys(ceka.tomb).length) {
        const zm = [...ceka.zmeny.values()], tb = Object.assign({}, ceka.tomb);
        ceka = {zmeny: new Map(), tomb: {}};
        try {
          const r = HYB ? await volej({rev: D.rev, data: {dokumenty: zm, tomb: {dokumenty: tb}}}, 60000) : await CX.posli(SID, {dokumenty: zm, tomb: {dokumenty: tb}});
          if (r.error) throw new Error(r.error);
          prevezmi(r.data, r.rev);
        } catch (e) { zm.forEach(x => { if (!ceka.zmeny.has(x.id)) ceka.zmeny.set(x.id, x); }); Object.keys(tb).forEach(k => { if (!(k in ceka.tomb)) ceka.tomb[k] = tb[k]; }); throw e; }
      } else if (!HYB) {
        const r = await CX.stahni(SID, D.rev);
        if (r && r.data) prevezmi(r.data, r.rev);
      } else {
        const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 30000);
        const r = await fetch(SY.url + (SY.url.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(SY.key) + '&rev=' + D.rev + '&t=' + Date.now(), {signal: ctl.signal, redirect: 'follow'}).then(x => x.json()).finally(() => clearTimeout(tm));
        if (r && r.error) throw new Error(r.error);
        if (r && r.data) prevezmi(r.data, r.rev);
      }
    } catch (e) { console.warn('Dokumentace: synchronizace', e.message); }
    finally { bezi = false; }
  }
  let pushT = 0;
  const host = {
    seznam: () => D.dokumenty,
    upsert: recs => { const now = Date.now(); recs.forEach(r => { r._ts = now; delete ceka.tomb[r.id]; ceka.zmeny.set(r.id, r); const i = D.dokumenty.findIndex(x => x.id === r.id); if (i >= 0) D.dokumenty[i] = r; else D.dokumenty.push(r); }); ls.set(KLIC, JSON.stringify(D)); clearTimeout(pushT); pushT = setTimeout(synchronizuj, 600); window.CXDok.obnov(); },
    smaz: ids => { const now = Date.now(), x = new Set(ids); ids.forEach(id => { ceka.tomb[id] = now; ceka.zmeny.delete(id); }); D.dokumenty = D.dokumenty.filter(r => !x.has(r.id)); ls.set(KLIC, JSON.stringify(D)); clearTimeout(pushT); pushT = setTimeout(synchronizuj, 600); window.CXDok.obnov(); },
    kdo: () => par.get('kdo') || ls.get('hyb-me') || '',
    volej: body => {
      // soubory dalších staveb do vlastní složky na Disku (stejně jako v Managementu)
      if (!HYB && body && Array.isArray(body.cesta) && /^dok_(maly|start)$/.test(body.akce)) body = Object.assign({}, body, {cesta: ['Stavby', String(((CX.info(SID) || {}).name) || SID).slice(0, 100)].concat(body.cesta)});
      return volej(body);
    },
    pripojeno: () => true,
    ro: () => ls.get('hyb-ro') === '1' || /^cteni-/.test(SY.key),
    toast,
  };
  window.CXDok.pripoj(host);
  window.CXDok.vykresli(el);
  synchronizuj();
  setInterval(() => { if (document.visibilityState === 'visible') synchronizuj(); }, 5000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') synchronizuj(); });
})();
