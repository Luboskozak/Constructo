/* Constructo – „Firmy / osoby na projektu“: jeden společný kód pro Management (/pc/), Deník (/denik/) i mobil (/).
   Všude stejný vzhled i ovládání: nahoře rozřazení do oblastí, + Přidat, Upravit, Odebrat.
   Data jsou v údajích stavby: D.project.firmy (1. Dodavatel – firmy a jejich pracovníci na stavbě)
   a D.project.prijemci (2. Objednatel – Investor, TDS, BOZP, Architekt, Ostatní).
   Použití: CXFirmy.panel(element, host)
     host.data()            → {firmy: [], prijemci: []}
     host.uloz(k, x, puv)   → uloží jednu položku (k = 'firmy' | 'prijemci'); může vrátit Promise
     host.odeber(k, id)     → odebere položku (s náhrobkem, aby se jinde neobnovila)
     host.ro                → true / funkce: jen prohlížení
     host.toast(text), host.ares(ico) (nepovinné), host.pocetZprav(firma), host.zpravy(firma) (nepovinné)
     host.pozvatDoStavby()  → nepovinné: tlačítko „Pozvat do stavby“ (Docházka, jen Management) */
const CXFirmy = (() => {
  const VERZE = 1;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯˇ´˘˚¨]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const EMAIL_RE = /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/;
  const nid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const ls = {get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} }};

  // oblasti – pořadí a názvy jsou všude stejné
  const OBJ = [['inv', 'Investor'], ['tds', 'TDS'], ['bozp', 'BOZP'], ['arch', 'Architekt'], ['ost', 'Ostatní']];
  const PIS = {inv: 'a', tds: 'b', bozp: 'c', arch: 'd', ost: 'e'};
  const oblast = x => {
    if (x && OBJ.some(o => o[0] === x.obl)) return x.obl;
    const k = (x && x.kdo) || '';
    return /investor|objednatel|stavebn[ií]k/i.test(k) ? 'inv' : /tds|technick/i.test(k) ? 'tds' : /bozp|bezpe/i.test(k) ? 'bozp' : /archit|autorsk/i.test(k) ? 'arch' : 'ost';
  };
  const oblNazev = k => (OBJ.find(o => o[0] === k) || OBJ[4])[1];
  const kontakty = f => Array.isArray(f.kontakty) && f.kontakty.length ? f.kontakty
    : (f.email || f.tel || f.kontakt) ? [{id: 'k0', jmeno: f.kontakt || '', funkce: '', email: f.email || '', tel: f.tel || '', posilat: true}] : [];
  const tvar = (n, a, b, c) => n === 1 ? a : n > 1 && n < 5 ? b : c;

  const ICO = {
    firmy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V4h8v3M3 13h18"/></svg>',
    obj: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4.5-6 8-6s7 2 8 6"/></svg>',
  };

  let cssHotovo = false;
  function css() {
    if (cssHotovo) return; cssHotovo = true;
    const s = document.createElement('style'); s.id = 'cxf-css';
    s.textContent = `
.cxf{--cxk:#131518;--cxy:#F4D23C;--cxl:#dcdcd5;--cxm:#5f676d;--cxb:#fff;--cxr:#c0332b;font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:var(--cxk);max-width:1400px}
.cxf *{box-sizing:border-box}
.cxf button{font:inherit;cursor:pointer}
.cxf-top{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:0 0 12px}
.cxf-top h2{margin:0;font-size:22px;font-weight:800;letter-spacing:-.01em;display:flex;align-items:center;gap:9px}
.cxf-top h2 svg{width:24px;height:24px}
.cxf-top .sp{flex:1}
.cxf-q{min-width:0;width:240px;max-width:100%;font:inherit;font-size:14px;padding:9px 12px;border:1px solid var(--cxl);border-radius:10px;background:var(--cxb);color:var(--cxk)}
.cxf-obl{display:flex;flex-direction:column;gap:8px;background:var(--cxb);border:1px solid var(--cxl);border-radius:14px;padding:10px;margin-bottom:16px;position:sticky;top:0;z-index:5}
.cxf-r{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.cxf-t{border:1px solid var(--cxl);background:#f4f4f1;color:var(--cxk);border-radius:10px;padding:9px 14px;font-weight:700;font-size:14.5px;display:inline-flex;align-items:center;gap:8px}
.cxf-t:hover{border-color:var(--cxk)}
.cxf-t[aria-pressed="true"]{background:var(--cxk);color:#fff;border-color:var(--cxk)}
.cxf-t em{font-style:normal;font-weight:700;font-size:12px;background:rgba(0,0,0,.08);border-radius:9px;padding:1px 7px}
.cxf-t[aria-pressed="true"] em{background:var(--cxy);color:var(--cxk)}
.cxf-t.sub{padding:6px 11px;font-size:13px;font-weight:600;background:var(--cxb)}
.cxf-t.sub[aria-pressed="true"]{background:var(--cxy);color:var(--cxk);border-color:var(--cxk)}
.cxf-r .lb{font-size:12px;color:var(--cxm);font-weight:600;margin-right:2px}
.cxf-sec{background:var(--cxb);border:1px solid var(--cxl);border-radius:14px;margin-bottom:16px;overflow:hidden}
.cxf-sh{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;padding:12px 14px;border-bottom:1px solid var(--cxl);background:#fafaf7}
.cxf-sh b{font-size:17px;font-weight:800}
.cxf-sh span{font-size:12.5px;color:var(--cxm)}
.cxf-sh .sp{flex:1}
.cxf-sub .cxf-sh{background:none;padding:10px 14px 8px;border-bottom:1px solid #eeeee8}
.cxf-sub .cxf-sh b{font-size:15px}
.cxf-sub+.cxf-sub{border-top:1px solid var(--cxl)}
.cxf-row{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1.6fr) auto;gap:6px 14px;padding:11px 14px;border-bottom:1px solid #eeeee8;align-items:start}
.cxf-row:last-child{border-bottom:0}
.cxf-row b.n{display:block;font-size:15px;word-break:break-word}
.cxf-row small{display:block;font-size:12px;color:var(--cxm);margin-top:2px;word-break:break-word}
.cxf-ks{display:flex;flex-direction:column;gap:6px}
.cxf-ks .k b{font-size:13.5px}.cxf-ks .k span{font-size:12px;color:var(--cxm)}
.cxf .cxf-ks a{color:var(--cxk)!important}
.cxf-ks .off{opacity:.55}
.cxf-chybi{color:var(--cxr);font-size:12.5px;font-weight:600}
.cxf-a{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;align-items:center}
.cxf-b{border:1px solid var(--cxl);background:var(--cxb);color:var(--cxk);border-radius:10px;padding:7px 13px;font-weight:600;font-size:13.5px;white-space:nowrap}
.cxf-b:hover{border-color:var(--cxk)}
.cxf-b.pri{background:var(--cxk);color:#fff;border-color:var(--cxk)}
.cxf-b.add{background:var(--cxy);border-color:var(--cxk);color:var(--cxk);font-weight:700}
.cxf-b.del{color:var(--cxr)}
.cxf-b.del.arm{background:var(--cxr);color:#fff;border-color:var(--cxr)}
.cxf-b.lnk{border:0;background:none;padding:2px 0;text-decoration:underline;font-weight:600}
.cxf-empty{padding:14px;color:var(--cxm);font-size:13.5px}
.cxf-ov{position:fixed;inset:0;background:rgba(19,21,24,.55);z-index:100000;display:flex;align-items:flex-start;justify-content:center;padding:4vh 12px;overflow:auto}
.cxf-m{background:#fff;color:#131518;border-radius:16px;width:min(760px,100%);box-shadow:0 20px 60px rgba(0,0,0,.35);font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
.cxf-m *{box-sizing:border-box}
.cxf-mh{display:flex;align-items:center;gap:10px;padding:16px 18px;border-bottom:1px solid #dcdcd5}
.cxf-mh h3{margin:0;font-size:19px;font-weight:800;flex:1}
.cxf-mb{padding:16px 18px;display:flex;flex-direction:column;gap:12px}
.cxf-mf{display:flex;gap:8px;justify-content:flex-end;padding:14px 18px;border-top:1px solid #dcdcd5;flex-wrap:wrap}
.cxf-m label.l{display:block;font-size:12.5px;font-weight:700;margin-bottom:5px}
.cxf-m input,.cxf-m select,.cxf-m textarea{width:100%;min-width:0;font:inherit;font-size:15px;padding:9px 11px;border:1px solid #c9c9c1;border-radius:10px;background:#fff;color:#131518}
.cxf-m input[type=checkbox]{width:18px;height:18px;padding:0;accent-color:#131518}
.cxf-m .g2{display:grid;grid-template-columns:200px 1fr;gap:10px}
.cxf-m .ico{display:flex;gap:8px;align-items:flex-end}.cxf-m .ico>div{flex:0 0 200px}
.cxf-m .hint{font-size:12.5px;color:#5f676d;margin:0}
.cxf-m .cxf-b{font-size:14px;padding:9px 15px;border:1px solid #c9c9c1;background:#fff;border-radius:10px;font-weight:600;cursor:pointer;color:#131518}
.cxf-m .cxf-b.pri{background:#131518;color:#fff;border-color:#131518}
.cxf-m .cxf-b.add{background:#F4D23C;border-color:#131518;font-weight:700}
.cxf-m .cxf-b.del{color:#c0332b}
.cxf-pr{border:1px solid #dcdcd5;border-radius:12px;padding:10px;display:grid;grid-template-columns:1.2fr 1fr 1.3fr 1fr;gap:8px;align-items:center;background:#fafaf7}
.cxf-pr .pa{grid-column:1/-1;display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12.5px;color:#5f676d}
.cxf-pr .pa label{display:flex;gap:6px;align-items:center}
.cxf-prs{display:flex;flex-direction:column;gap:8px}
.cxf-x{border:0;background:none;font-size:22px;line-height:1;padding:4px 8px;cursor:pointer;color:#131518}
@media (max-width:760px){
  .cxf-row{grid-template-columns:1fr}.cxf-a{justify-content:flex-start}
  .cxf-q{width:100%}
  .cxf-m .g2{grid-template-columns:1fr}.cxf-m .ico>div{flex:1}
  .cxf-pr{grid-template-columns:1fr}
  .cxf-ov{padding:0}.cxf-m{border-radius:0;min-height:100%}
}
@media print{.cxf-a,.cxf-obl,.cxf-b.add,.cxf-q{display:none!important}}`;
    document.head.appendChild(s);
  }

  // jednoduché okno (stejné ve všech aplikacích)
  function okno(titul, telo, ok, onOk) {
    const ov = document.createElement('div'); ov.className = 'cxf-ov';
    ov.innerHTML = `<div class="cxf-m" role="dialog" aria-modal="true" aria-label="${esc(titul)}"><div class="cxf-mh"><h3>${esc(titul)}</h3><button type="button" class="cxf-x" data-z aria-label="Zavřít">✕</button></div>
      <div class="cxf-mb">${telo}</div><div class="cxf-mf"><button type="button" class="cxf-b" data-z>Zrušit</button><button type="button" class="cxf-b pri" data-ok>${esc(ok)}</button></div></div>`;
    const zavri = () => { ov.remove(); document.removeEventListener('keydown', esc_); };
    const esc_ = e => { if (e.key === 'Escape') zavri(); };
    document.addEventListener('keydown', esc_);
    ov.querySelectorAll('[data-z]').forEach(b => b.onclick = zavri);
    ov.querySelector('[data-ok]').onclick = async () => {
      const b = ov.querySelector('[data-ok]'); if (b.disabled) return; b.disabled = true;
      try { const r = await onOk(ov); if (r !== 'keep') zavri(); } catch (e) { alertT(e && e.message ? e.message : String(e)); }
      b.disabled = false;
    };
    document.body.appendChild(ov);
    return ov;
  }
  let alertT = t => { try { console.warn(t); } catch (e) {} };

  // 4.87: pozice (funkce) – stejný seznam všude: základní + každá vlastní pozice, kterou už někdo u osoby zapsal
  const POZICE = ['dělník', 'pomocný dělník', 'mistr', 'parťák', 'technik', 'stavbyvedoucí', 'přípravář', 'elektrikář', 'instalatér', 'zedník', 'tesař', 'svářeč', 'řidič', 'jeřábník', 'brigádník'];
  const pozice = firmy => {
    const m = new Map();
    POZICE.concat(...(Array.isArray(firmy) ? firmy : []).filter(Boolean).map(f => kontakty(f).map(k => String(k.funkce || '').trim())))
      .forEach(x => { const k = fold(x); if (x && !m.has(k)) m.set(k, x); });
    return [...m.values()].sort((a, b) => POZICE.indexOf(a) < 0 && POZICE.indexOf(b) < 0 ? a.localeCompare(b, 'cs') : POZICE.indexOf(a) < 0 ? 1 : POZICE.indexOf(b) < 0 ? -1 : POZICE.indexOf(a) - POZICE.indexOf(b));
  };
  async function aresPrimo(ico) {
    ico = String(ico || '').replace(/\D/g, '');
    if (ico.length !== 8) throw new Error('IČO má mít 8 číslic.');
    const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 12000);
    try {
      const r = await fetch('https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/' + ico, {headers: {Accept: 'application/json'}, signal: ctl.signal});
      if (r.status === 404) throw new Error('Firma s tímto IČO v ARES není.');
      if (!r.ok) throw new Error('ARES se teď nepodařilo načíst. Údaje doplňte ručně.');
      const o = await r.json();
      return {ico: o.ico || ico, firma: o.obchodniJmeno || '', dic: o.dic || '', adresa: (o.sidlo && o.sidlo.textovaAdresa) || ''};
    } catch (e) { if (/ARES/.test(e.message) || /IČO/.test(e.message)) throw e; throw new Error('ARES se teď nepodařilo načíst. Údaje doplňte ručně.'); }
    finally { clearTimeout(tm); }
  }

  function panel(el, host) {
    css();
    if (!el) host = Object.assign({}, host);
    const toast = t => (host.toast ? host.toast(t) : alertT(t));
    alertT = toast;
    const ro = () => typeof host.ro === 'function' ? !!host.ro() : !!host.ro;
    const st = {obl: host.obl0 || ls.get('cxf-obl') || 'vse', q: ''};
    const data = () => { const d = host.data() || {}; return {firmy: (Array.isArray(d.firmy) ? d.firmy : []).filter(x => x && x.id), prijemci: (Array.isArray(d.prijemci) ? d.prijemci : []).filter(x => x && x.id)}; };
    const sedi = (x, ...pole) => !st.q || fold(pole.concat(...(x.kontakty || []).map(k => [k.jmeno, k.funkce, k.email, k.tel])).join(' ')).includes(fold(st.q));

    function render() {
      if (!el) { if (host.po) host.po(); return; }
      const {firmy, prijemci} = data(), R = ro();
      const fs = firmy.slice().sort((a, b) => String(a.firma).localeCompare(String(b.firma), 'cs'));
      const ps = prijemci.slice().sort((a, b) => String(a.jmeno || a.firma || '').localeCompare(String(b.jmeno || b.firma || ''), 'cs'));
      const pocet = {dod: fs.length, obj: ps.length}; OBJ.forEach(([k]) => pocet[k] = ps.filter(x => oblast(x) === k).length);
      const t = (k, n, sub) => `<button type="button" class="cxf-t${sub ? ' sub' : ''}" data-obl="${k}" aria-pressed="${st.obl === k}">${n}<em>${k === 'vse' ? fs.length + ps.length : pocet[k]}</em></button>`;
      let h = `<div class="cxf-top">${host.nadpis === false ? '' : `<h2>${ICO.firmy}Firmy / osoby na projektu</h2>`}<span class="sp"></span>${host.pozvatDoStavby && !R ? '<button type="button" class="cxf-b add" data-cxf-pozvat="1" title="Vybrat jméno nebo zapsat novou osobu a poslat jí odkaz na Docházku">＋ Pozvat do stavby</button>' : ''}<input class="cxf-q" type="search" placeholder="Hledat firmu nebo osobu" value="${esc(st.q)}" aria-label="Hledat firmu nebo osobu"></div>
        <div class="cxf-obl" role="group" aria-label="Oblasti"><div class="cxf-r">${t('vse', 'Vše')}${t('dod', '1. Dodavatel')}${t('obj', '2. Objednatel')}</div>
        <div class="cxf-r"><span class="lb">Objednatel:</span>${OBJ.map(([k, n]) => t(k, PIS[k] + ') ' + n, true)).join('')}</div></div>`;
      const ukazDod = st.obl === 'vse' || st.obl === 'dod';
      const ukazObj = k => st.obl === 'vse' || st.obl === 'obj' || st.obl === k;
      if (ukazDod) {
        const xs = fs.filter(x => sedi(x, x.firma, x.ico, x.adresa, x.zkratky, x.pozn));
        h += `<section class="cxf-sec" data-sec="dod"><div class="cxf-sh"><b>1. Dodavatel</b><span>firmy na stavbě a jejich pracovníci (jméno, e-mail, telefon) · použije se pro zprávy i docházku</span><span class="sp"></span>${R ? '' : '<button type="button" class="cxf-b add" data-add="dod">+ Přidat</button>'}</div>`;
        h += xs.length ? xs.map(x => {
          const ks = kontakty(x), maMail = ks.some(k => k.email && k.posilat !== false), n = host.pocetZprav ? host.pocetZprav(x.firma) : 0;
          return `<div class="cxf-row" data-id="${esc(x.id)}"><div><b class="n">${esc(x.firma)}</b>${x.ico || x.dic ? `<small>${esc([x.ico ? 'IČO ' + x.ico : '', x.dic ? 'DIČ ' + x.dic : ''].filter(Boolean).join(' · '))}</small>` : ''}${x.adresa ? `<small>${esc(x.adresa)}</small>` : ''}${x.zkratky ? `<small>Zkratky: ${esc(x.zkratky)}</small>` : ''}${x.pozn ? `<small><i>${esc(x.pozn)}</i></small>` : ''}${n && host.zpravy ? `<small><button type="button" class="cxf-b lnk" data-zpr="${esc(x.firma)}">${n} ${tvar(n, 'zpráva', 'zprávy', 'zpráv')} →</button></small>` : ''}</div>
            <div class="cxf-ks">${ks.length ? ks.map(k => `<div class="k${k.posilat === false ? ' off' : ''}"><b>${esc(k.jmeno || 'e-mail firmy')}</b>${k.funkce ? ` <span>· ${esc(k.funkce)}</span>` : ''}<br><span>${[k.email ? `<a href="mailto:${esc(k.email)}">${esc(k.email)}</a>` : '', k.tel ? `<a href="tel:${esc(String(k.tel).replace(/\s/g, ''))}">${esc(k.tel)}</a>` : ''].filter(Boolean).join(' · ') || 'bez kontaktu'}${k.posilat === false ? ' · zprávy nedostává' : ''}</span>${window.CXDochazka && CXDochazka.tlacitko ? ' ' + CXDochazka.tlacitko(x, k) : ''}</div>`).join('') : '<span class="cxf-chybi">zatím žádní pracovníci</span>'}${ks.length && !maMail ? '<span class="cxf-chybi">chybí e-mail pro zprávy</span>' : ''}</div>
            <div class="cxf-a">${R ? '' : `<button type="button" class="cxf-b" data-ed="firmy" data-i="${esc(x.id)}">Upravit</button><button type="button" class="cxf-b del" data-od="firmy" data-i="${esc(x.id)}">Odebrat</button>`}</div></div>`;
        }).join('') : `<div class="cxf-empty">${st.q ? 'Nic neodpovídá hledání.' : 'Zatím žádný dodavatel. Klikněte na + Přidat, napište IČO a zbytek se doplní z ARES.'}</div>`;
        h += '</section>';
      }
      const obl = OBJ.filter(([k]) => ukazObj(k));
      if (obl.length) {
        h += `<section class="cxf-sec" data-sec="obj"><div class="cxf-sh"><b>2. Objednatel</b><span>investor a jeho zástupci · dostávají PDF zpráv v kopii · do programu se nepřihlašují</span></div>`;
        obl.forEach(([k, nm]) => {
          const xs = ps.filter(x => oblast(x) === k && sedi(x, x.jmeno, x.firma, x.email, x.tel, x.kdo));
          h += `<div class="cxf-sub" data-sub="${k}"><div class="cxf-sh"><b>${PIS[k]}) ${nm}</b><span>${xs.length ? xs.length + ' ' + tvar(xs.length, 'osoba', 'osoby', 'osob') : ''}</span><span class="sp"></span>${R ? '' : `<button type="button" class="cxf-b add" data-add="${k}">+ Přidat</button>`}</div>`;
          h += xs.length ? xs.map(x => `<div class="cxf-row" data-id="${esc(x.id)}"><div><b class="n">${esc(x.jmeno || x.firma || x.kdo || nm)}</b>${k === 'ost' && x.kdo && fold(x.kdo) !== 'ostatni' ? `<small>${esc(x.kdo)}</small>` : ''}${x.firma && x.jmeno ? `<small>${esc(x.firma)}</small>` : ''}</div>
              <div class="cxf-ks"><div class="k"><span>${[x.email ? `<a href="mailto:${esc(x.email)}">${esc(x.email)}</a>` : '<span class="cxf-chybi">bez e-mailu</span>', x.tel ? `<a href="tel:${esc(String(x.tel).replace(/\s/g, ''))}">${esc(x.tel)}</a>` : ''].filter(Boolean).join(' · ')}</span></div></div>
              <div class="cxf-a">${R ? '' : `<button type="button" class="cxf-b" data-ed="prijemci" data-i="${esc(x.id)}">Upravit</button><button type="button" class="cxf-b del" data-od="prijemci" data-i="${esc(x.id)}">Odebrat</button>`}</div></div>`).join('')
            : `<div class="cxf-empty">${st.q ? 'Nic neodpovídá hledání.' : 'Zatím nikdo.'}</div>`;
          h += '</div>';
        });
        h += '</section>';
      }
      el.innerHTML = `<div class="cxf">${h}</div>`;
      bind();
    }

    function bind() {
      el.querySelectorAll('[data-obl]').forEach(b => b.onclick = () => { st.obl = b.dataset.obl; ls.set('cxf-obl', st.obl); render(); });
      const q = el.querySelector('.cxf-q'); let tm;
      q.oninput = () => { clearTimeout(tm); tm = setTimeout(() => { st.q = q.value; const p = q.selectionStart; render(); const n = el.querySelector('.cxf-q'); n.focus(); try { n.setSelectionRange(p, p); } catch (e) {} }, 200); };
      el.querySelectorAll('[data-add]').forEach(b => b.onclick = () => b.dataset.add === 'dod' ? upravFirmu() : upravOsobu(null, b.dataset.add));
      el.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => b.dataset.ed === 'firmy' ? upravFirmu(b.dataset.i) : upravOsobu(b.dataset.i));
      el.querySelectorAll('[data-zpr]').forEach(b => b.onclick = () => host.zpravy(b.dataset.zpr));
      el.querySelectorAll('[data-cxf-pozvat]').forEach(b => b.onclick = () => host.pozvatDoStavby());
      el.querySelectorAll('[data-od]').forEach(b => b.onclick = async () => {
        if (!b.classList.contains('arm')) { b.classList.add('arm'); b.textContent = 'Opravdu odebrat?'; setTimeout(() => { if (b.isConnected) { b.classList.remove('arm'); b.textContent = 'Odebrat'; } }, 5000); return; }
        const k = b.dataset.od, id = b.dataset.i, x = data()[k].find(y => y.id === id);
        try { await host.odeber(k, id, x); toast('Odebráno: ' + (x ? x.firma || x.jmeno || x.kdo || '' : '')); } catch (e) { toast('Nepodařilo se odebrat: ' + (e.message || e)); }
        render();
      });
    }

    function upravFirmu(id) {
      const ed = data().firmy.find(x => x.id === id) || null;
      let ks = (ed ? kontakty(ed) : []).map(k => Object.assign({}, k));
      if (!ks.length) ks = [{id: nid('k'), jmeno: '', funkce: '', email: '', tel: '', posilat: true}];
      const f = (k, l, ph, t) => `<div><label class="l" for="cxf-${k}">${l}</label><input id="cxf-${k}"${t ? ` type="${t}"` : ''} value="${esc(ed ? ed[k] || '' : '')}" placeholder="${esc(ph)}"></div>`;
      const ksHtml = () => ks.map((k, i) => `<div class="cxf-pr" data-ki="${i}">
          <input data-kf="jmeno" value="${esc(k.jmeno || '')}" placeholder="Jméno a příjmení" aria-label="Jméno a příjmení">
          <input data-kf="funkce" list="cxf-pozl" value="${esc(k.funkce || '')}" placeholder="Pozice (vyberte nebo napište vlastní)" aria-label="Pozice">
          <input data-kf="email" type="email" value="${esc(k.email || '')}" placeholder="E-mail" aria-label="E-mail">
          <input data-kf="tel" type="tel" value="${esc(k.tel || '')}" placeholder="Telefon" aria-label="Telefon">
          <div class="pa"><label><input type="checkbox" data-kf="posilat"${k.posilat !== false ? ' checked' : ''}> posílat zprávy</label><button type="button" class="cxf-b del" data-krm="${i}">Odebrat</button></div></div>`).join('');
      const ov = okno(ed ? 'Upravit dodavatele' : 'Přidat dodavatele', `
        <div class="ico">${f('ico', 'IČO', '12345678')}<button type="button" class="cxf-b" id="cxf-ares">Doplnit z ARES</button></div>
        <p class="hint" id="cxf-ares-st">Napište IČO a klikněte Doplnit z ARES: název, sídlo a DIČ se vyplní samy.</p>
        ${f('firma', 'Název firmy', 'např. TT Tech s.r.o.')}
        <div class="g2">${f('dic', 'DIČ', 'CZ12345678')}${f('adresa', 'Sídlo', 'Ulice 1, 110 00 Praha 1')}</div>
        ${f('zkratky', 'Zkratky pro hledání', 'např. TT, TTT (oddělte čárkou)')}
        <div><label class="l">Pracovníci na stavbě <span class="hint" style="display:inline;font-weight:400">(jméno, e-mail, telefon – použije se pro zprávy i docházku)</span></label><div class="cxf-prs" id="cxf-ks">${ksHtml()}</div><datalist id="cxf-pozl">${pozice(data().firmy).map(x => `<option value="${esc(x)}">`).join('')}</datalist>
          <button type="button" class="cxf-b add" id="cxf-kadd" style="margin-top:8px">+ Přidat pracovníka</button></div>
        <div><label class="l" for="cxf-pozn">Poznámka</label><input id="cxf-pozn" value="${esc(ed ? ed.pozn || '' : '')}" placeholder="např. elektroinstalace, objekt B"></div>`, 'Uložit', async () => {
        sber();
        const g = k => ov.querySelector('#cxf-' + k).value.trim(), n = g('firma');
        if (!n) { toast('Napište název firmy (nebo IČO a Doplnit z ARES).'); ov.querySelector('#cxf-firma').focus(); return 'keep'; }
        const kk = ks.filter(k => k.jmeno || k.email || k.tel);
        const spatny = kk.find(k => k.email && !EMAIL_RE.test(k.email));
        if (spatny) { toast('E-mail ' + spatny.email + ' nevypadá správně.'); return 'keep'; }
        if (data().firmy.some(x => x.id !== (ed && ed.id) && fold(x.firma) === fold(n))) { toast('Firma ' + n + ' už v seznamu je.'); return 'keep'; }
        kk.forEach(k => { if (!k.id) k.id = nid('k'); });
        // první osoba, které chodí zprávy, se ukládá i postaru (e-mail, telefon, kontakt) pro starší verze
        const hl = kk.find(k => k.posilat !== false && k.email) || kk.find(k => k.posilat !== false) || kk[0] || {};
        const x = Object.assign({}, ed || {}, {id: ed ? ed.id : nid('f'), firma: n, ico: g('ico').replace(/\s/g, ''), dic: g('dic'), adresa: g('adresa'), pozn: g('pozn'), zkratky: g('zkratky'),
          kontakty: kk, email: hl.email || '', tel: hl.tel || '', kontakt: [hl.jmeno, hl.funkce].filter(Boolean).join(', '), _ts: Date.now()});
        await host.uloz('firmy', x, ed);
        toast(ed ? 'Uloženo' : 'Dodavatel přidán: ' + n); render();
      });
      function sber() { ov.querySelectorAll('.cxf-pr').forEach(r => { const k = ks[+r.dataset.ki]; r.querySelectorAll('[data-kf]').forEach(i => { k[i.dataset.kf] = i.type === 'checkbox' ? i.checked : i.value.trim(); }); }); }
      function kresli() { ov.querySelector('#cxf-ks').innerHTML = ksHtml(); ov.querySelectorAll('[data-krm]').forEach(b => b.onclick = () => { sber(); ks.splice(+b.dataset.krm, 1); kresli(); }); }
      kresli();
      ov.querySelector('#cxf-kadd').onclick = () => { sber(); ks.push({id: nid('k'), jmeno: '', funkce: '', email: '', tel: '', posilat: true}); kresli(); const r = ov.querySelectorAll('.cxf-pr'); r[r.length - 1].querySelector('input').focus(); };
      ov.querySelector('#cxf-ares').onclick = async () => {
        const b = ov.querySelector('#cxf-ares'), s = ov.querySelector('#cxf-ares-st'); b.disabled = true; s.textContent = 'Hledám v ARES…'; s.style.color = '';
        try {
          const o = await (host.ares || aresPrimo)(ov.querySelector('#cxf-ico').value);
          if (o.firma) ov.querySelector('#cxf-firma').value = o.firma; if (o.dic) ov.querySelector('#cxf-dic').value = o.dic; if (o.adresa) ov.querySelector('#cxf-adresa').value = o.adresa; if (o.ico) ov.querySelector('#cxf-ico').value = o.ico;
          s.textContent = '✓ Doplněno z ARES: ' + String(o.firma || o.ico).replace(/\.$/, '') + '. Teď doplňte pracovníky s e-mailem a telefonem.';
        } catch (e) { s.textContent = e.message; s.style.color = '#c0332b'; }
        b.disabled = false;
      };
      setTimeout(() => { const i = ov.querySelector(ed ? '#cxf-firma' : '#cxf-ico'); if (i) i.focus(); }, 30);
    }

    function upravOsobu(id, obl0) {
      const ed = data().prijemci.find(x => x.id === id) || null, o0 = ed ? oblast(ed) : (obl0 || 'inv');
      const vlastni = ed && o0 === 'ost' && ed.kdo && fold(ed.kdo) !== 'ostatni' ? ed.kdo : '';
      const ov = okno(ed ? 'Upravit – ' + oblNazev(o0) : 'Přidat – ' + oblNazev(o0), `
        <div><label class="l" for="cxf-obl">Oblast</label><select id="cxf-obl">${OBJ.map(([k, n]) => `<option value="${k}"${k === o0 ? ' selected' : ''}>2. Objednatel – ${PIS[k]}) ${n}</option>`).join('')}</select></div>
        <div id="cxf-kdo-w"${o0 === 'ost' ? '' : ' hidden'}><label class="l" for="cxf-kdo">Pozice</label><input id="cxf-kdo" value="${esc(vlastni)}" placeholder="např. Projektant statiky"></div>
        <div><label class="l" for="cxf-jm">Jméno a příjmení</label><input id="cxf-jm" value="${esc(ed ? ed.jmeno || '' : '')}" placeholder="např. Ing. Jan Novák"></div>
        <div><label class="l" for="cxf-fi">Firma</label><input id="cxf-fi" value="${esc(ed ? ed.firma || '' : '')}" placeholder="např. Stavební dozor Praha s.r.o."></div>
        <div class="g2"><div><label class="l" for="cxf-tel">Telefon</label><input id="cxf-tel" type="tel" value="${esc(ed ? ed.tel || '' : '')}" placeholder="např. 777 123 456"></div>
          <div><label class="l" for="cxf-em">E-mail</label><input id="cxf-em" type="email" value="${esc(ed ? ed.email || '' : '')}" placeholder="např. tds@firma.cz"></div></div>
        <p class="hint">Dostává PDF zpráv pro firmy v kopii. Do programu se nepřihlašuje a nepřidává se do Lidí.</p>`, 'Uložit', async () => {
        const g = k => ov.querySelector('#cxf-' + k).value.trim(), o = ov.querySelector('#cxf-obl').value;
        const jmeno = g('jm'), firma = g('fi'), email = g('em'), tel = g('tel');
        if (!jmeno && !firma) { toast('Napište jméno nebo firmu.'); return 'keep'; }
        if (email && !EMAIL_RE.test(email)) { toast('E-mail nevypadá správně.'); return 'keep'; }
        const kdo = o === 'ost' ? (g('kdo') || 'Ostatní') : o === 'bozp' ? 'Koordinátor BOZP' : oblNazev(o);
        const x = Object.assign({}, ed || {}, {id: ed ? ed.id : nid('p'), obl: o, kdo, jmeno, firma, email, tel, _ts: Date.now()});
        await host.uloz('prijemci', x, ed);
        toast('Uloženo: ' + (jmeno || firma)); render();
      });
      const sel = ov.querySelector('#cxf-obl'), w = ov.querySelector('#cxf-kdo-w');
      sel.onchange = () => { w.hidden = sel.value !== 'ost'; ov.querySelector('.cxf-mh h3').textContent = (ed ? 'Upravit – ' : 'Přidat – ') + oblNazev(sel.value); };
      setTimeout(() => ov.querySelector('#cxf-jm').focus(), 30);
    }

    if (el) render();
    return {render, upravFirmu, upravOsobu};
  }
  // jen okno Přidat / Upravit (bez seznamu), např. z formuláře záznamu: CXFirmy.okna(host).upravOsobu(null, 'tds')
  const okna = host => panel(null, host);

  return {VERZE, panel, okna, oblast, oblNazev, OBJ, kontakty, pozice, aresPrimo};
})();
if (typeof window !== 'undefined') window.CXFirmy = CXFirmy;
