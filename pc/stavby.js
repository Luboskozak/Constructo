/* Constructo – více staveb (4.63). Jeden soubor pro Management (/pc/), Deník (/denik/) i Dokumentaci (/dokumentace/).
   - Seznam staveb je společný pro všechny (záznamy „st~<id>“ v kolekci dokumenty sdílených dat na Googlu).
   - Hybernská = původní sdílená data (beze změny). Každá další stavba má svá data zvlášť, takže se vždy
     načítá a posílá jen otevřená stavba (rychlé i při 100 stavbách).
   - Skript Google od verze 15 ukládá data každé stavby do vlastního souboru (akce „stavba“).
     Se starším skriptem (13/14) jdou data stavby jako zabalený soubor na Disk Google (akce dok_maly / dok_cti)
     a sdílená data Hybernské nesou jen ukazatel na nejnovější soubor (záznam „sp~<id>“).
   - Otevřená stavba: localStorage „hyb-stavba“ (stejná pro Management i Deník). Kopie dat staveb v tomto
     počítači jsou v IndexedDB (localStorage má jen 5 MB a sdílí ho všechny části aplikace). */
/* 4.79: čeština všude (Management, Deník, mobil, Dokumentace – tento soubor načítají všechny).
   1) Mac / iPhone píše háčky a čárky „mrtvou klávesou“ (ˇ, potom z = ž). Během skládání znaku aplikace nesmí
      pole překreslit, jinak v něm zůstane samostatné „ˇ“ a hledání nic nenajde. Události psaní během skládání
      se proto podrží a po dokončení znaku se pošlou jednou s hotovým textem.
   2) Kdyby přesto v poli zůstal samostatný háček nebo čárka před písmenem (ˇz, ´a, ˚u), složí se na ž, á, ů.
   3) Řazení textů bez udaného jazyka (localeCompare) je vždy podle češtiny (ch za h, č za c…). */
(() => {
  if (window.__cxCestina) return; window.__cxCestina = 1;
  const ZNAK = {'ˇ': '̌', '˘': '̌', '´': '́', '˚': '̊', '¨': '̈'};
  const RX = /([ˇ˘´˚¨])\s?([A-Za-z])/g;
  const opravit = t => {
    if (!t || !('value' in t) || typeof t.value !== 'string' || /^(password|file|checkbox|radio|number|date|time|color|range|hidden)$/i.test(t.type || '')) return false;
    const v = t.value; if (!/[ˇ˘´˚¨]/.test(v)) return false;
    let pos = null; try { pos = t.selectionStart; } catch (e) {}
    let ubr = 0;
    const n = v.replace(RX, (m, z, p, off) => { const c = (p + ZNAK[z]).normalize('NFC'); if (pos != null && off < pos) ubr += m.length - c.length; return c; }).replace(/[ˇ˘´˚¨](?=\p{L})/gu, (m, off) => { if (pos != null && off < pos) ubr++; return ''; });
    if (n === v) return false;
    t.value = n;
    if (pos != null) try { t.setSelectionRange(pos - ubr, pos - ubr); } catch (e) {}
    return true;
  };
  addEventListener('compositionend', e => {
    const t = e.target;
    setTimeout(() => { opravit(t); if (t && t.isConnected) t.dispatchEvent(new Event('input', {bubbles: true})); }, 0);
  }, true);
  addEventListener('input', e => {
    if (e.isComposing) { e.stopImmediatePropagation(); return; }
    opravit(e.target);
  }, true);
  window.cxBezDiakritiky = s => String(s == null ? '' : s).replace(RX, (m, z, p) => p).normalize('NFD').replace(/[̀-ͯˇ˘´˚¨]/g, '').toLowerCase();
  try {
    const kol = new Intl.Collator('cs'), lc = String.prototype.localeCompare;
    String.prototype.localeCompare = function (b, loc, opt) { return loc === undefined && opt === undefined ? kol.compare(String(this), String(b)) : lc.call(this, b, loc, opt); };
  } catch (e) { /* starý prohlížeč – zůstane výchozí řazení */ }
})();
(() => {
  if (window.CXStavby) return;
  const HYB = 'hybernska';
  const HYB_NAZEV = 'Hybernská 1000/8';
  const WEB_SCRIPT = 'https://script.google.com/macros/s/AKfycbwJCT7cNtZyKrk21RItnIu4qu2SsSPhNyYdsbIJ5d8Q91esVBEVe82724ufLctboJb4/exec';
  const KEY_BASE = 'hybernska-rizeni-data-v1';
  const REG = 'cx-stavby-reg';
  const STAV = {aktivni: 'Probíhá', priprava: 'V přípravě', pozastavena: 'Pozastavená', dokoncena: 'Dokončená'};
  const ls = {
    get: k => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } },
    set: (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del: k => { try { localStorage.removeItem(k); } catch (e) {} },
  };
  const jsn = (s, d) => { try { const x = JSON.parse(s); return x == null ? d : x; } catch (e) { return d; } };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const fold = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f\u02c7\u02d8\u00b4\u02da\u00a8]/g, '').toLowerCase();
  // mobil 1.32: telefon má spojení v IndexedDB (ne v hyb-sync) – předá ho přes CXStavby.spojeni(conn)
  let spoj = null;
  const SY = () => { if (spoj) return spoj; const s = jsn(ls.get('hyb-sync'), null); return s && s.url && s.key ? s : null; };
  const ro = () => { const s = SY(); return ls.get('hyb-ro') === '1' || !!(s && /^cteni-/.test(s.key)); };

  /* ---------- slučování dat: stejný kód jako mergeData v Managementu (pc/index.html) a ve skriptu Google ---------- */
  function mergeData(a, b) {
    const KEYS = {tasks: r => r.id, hmg: r => String(r.hid), hmgGroups: r => r.obj, diary: r => r.id, log: r => r.id, zavady: r => r.id, dokumenty: r => r.id, rozpocty: r => r.id, rozpKat: r => r.id, faktury: r => r.id};
    a = a || {}; b = b || {};
    const out = Object.assign({}, a); out.tomb = {};
    Object.keys(KEYS).forEach(c => {
      const k = KEYS[c], ta = (a.tomb || {})[c] || {}, tb = (b.tomb || {})[c] || {}, tomb = Object.assign({}, ta);
      Object.keys(tb).forEach(x => { if (!(tomb[x] >= tb[x])) tomb[x] = tb[x]; });
      const m = new Map();
      (a[c] || []).concat(b[c] || []).forEach(r => { const key = k(r), o = m.get(key); if (!o || (r._ts || 0) > (o._ts || 0)) m.set(key, r); });
      out[c] = Array.from(m.values()).filter(r => !(tomb[k(r)] >= (r._ts || 0)));
      out.tomb[c] = tomb;
    });
    ['project', 'hmgInfo'].forEach(f => { out[f] = ((b[f] || {})._ts || 0) > ((a[f] || {})._ts || 0) ? b[f] : (a[f] || b[f]); });
    // 4.34: firmy, příjemci, lidé a tým v údajích stavby se slučují po jednom (dřív vyhrála celá novější kopie a starší počítač mohl firmy smazat)
    const pa = a.project, pb = b.project;
    if (pa && pb && pa !== pb) {
      const win = out.project === pb ? pb : pa, los = win === pb ? pa : pb, P = Object.assign({}, win), sm = {};
      ['firmy', 'prijemci', 'people', 'team'].forEach(k => { sm[k] = Object.assign({}, ((los.smazane || {})[k]) || {}); const w = ((win.smazane || {})[k]) || {}; Object.keys(w).forEach(x => { if (!(sm[k][x] >= w[x])) sm[k][x] = w[x]; }); });
      P.smazane = sm;
      ['firmy', 'prijemci'].forEach(k => {
        const m = new Map();
        (Array.isArray(los[k]) ? los[k] : []).forEach(r => { if (r && r.id) m.set(r.id, {r, w: false}); });
        (Array.isArray(win[k]) ? win[k] : []).forEach(r => { if (!r || !r.id) return; const o = m.get(r.id); if (!o || (r._ts || 0) >= (o.r._ts || 0)) m.set(r.id, {r, w: true}); });
        P[k] = Array.from(m.values()).filter(x => x.w || !(sm[k][x.r.id] >= (x.r._ts || 0))).map(x => x.r);
      });
      const pw = win.people || {}, pl = los.people || {}, pp = Object.assign({}, pw);
      Object.keys(pl).forEach(n => { if (!(n in pp) && !(sm.people[n] >= ((pl[n] || {})._ts || 0))) pp[n] = pl[n]; });
      if (win.people || los.people) P.people = pp;
      if (Array.isArray(win.team) || Array.isArray(los.team)) { const t = Array.isArray(win.team) ? win.team.slice() : []; (Array.isArray(los.team) ? los.team : []).forEach(n => { if (!t.includes(n) && !sm.team[n]) t.push(n); }); P.team = t; }
      out.project = P;
    }
    return out;
  }
  // stejný obsah = stejný otisk bez ohledu na pořadí klíčů
  const otisk = o => JSON.stringify(o, (k, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).sort().reduce((x, y) => { x[y] = v[y]; return x; }, {}) : v);

  /* ---------- volání skriptu Google ---------- */
  async function volej(body, ms) {
    const s = SY(); if (!s) throw new Error('Počítač není připojený ke Constructu (chybí spojení s Googlem).');
    const adresy = [s.url, WEB_SCRIPT].filter((u, i, a) => u && a.indexOf(u) === i);
    let chyba = null;
    for (const url of adresy) {
      const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), ms || 60000);
      try {
        const r = await fetch(url, {method: 'POST', headers: {'Content-Type': 'text/plain;charset=utf-8'}, body: JSON.stringify(Object.assign({key: s.key}, body)), signal: ctl.signal, redirect: 'follow'});
        const t = await r.text();
        let x; try { x = JSON.parse(t); } catch (e) { throw new Error(/<html|<!doctype/i.test(t) ? 'Google vrátil stránku místo dat.' : 'Neplatná odpověď serveru.'); }
        if (x && x.error) { const e = new Error(x.error === 'heslo' ? 'Heslo synchronizace nesedí se skriptem na Googlu.' : String(x.error)); e.server = true; throw e; }
        return x;
      } catch (e) {
        chyba = e.name === 'AbortError' ? new Error('Google neodpověděl včas.') : e;
        if (e.server) throw chyba;
      } finally { clearTimeout(tm); }
    }
    throw chyba;
  }
  async function getMain(rev) {
    const s = SY(); if (!s) throw new Error('Počítač není připojený ke Constructu.');
    const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 45000);
    try {
      const r = await fetch(s.url + (s.url.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(s.key) + '&rev=' + (Number(rev) || 0) + '&t=' + Date.now(), {signal: ctl.signal, redirect: 'follow'});
      const x = JSON.parse(await r.text());
      if (x && x.error) throw new Error(String(x.error));
      return x;
    } catch (e) { throw e.name === 'AbortError' ? new Error('Google neodpověděl včas.') : e; }
    finally { clearTimeout(tm); }
  }
  // verze skriptu na Googlu (zapamatovat na 10 minut)
  async function verzeSkriptu(znovu) {
    const c = jsn(ls.get('cx-skript-verze'), null);
    if (!znovu && c && Date.now() - c.t < 600000) return c.v;
    try { const r = await volej({akce: 'verze'}, 30000); const v = Number(r && r.verze) || 0; ls.set('cx-skript-verze', JSON.stringify({v, t: Date.now()})); return v; }
    catch (e) { return c ? c.v : 0; }
  }

  /* ---------- seznam staveb ---------- */
  // cache: {rev, st: {sid: záznam}, sp: {sid: ukazatel}, t}
  const regCache = () => { const r = jsn(ls.get(REG), null); return r && r.st ? r : {rev: 0, st: {}, sp: {}, t: 0}; };
  // převzít záznamy st~/sp~ ze sdílených dat Hybernské (volá Management i Deník, když stejně stáhly data)
  function prevezmi(data, rev) {
    if (!data || !Array.isArray(data.dokumenty)) return false;
    const c = regCache(), st = {}, sp = {};
    data.dokumenty.forEach(r => {
      const id = String((r && r.id) || '');
      if (id.startsWith('st~')) st[id.slice(3)] = r;
      else if (id.startsWith('sp~')) sp[id.slice(3)] = r;
    });
    // ukazatel si nechat novější (vlastní nahrání mohlo doběhnout dřív, než ho server vrátil)
    Object.keys(c.sp).forEach(k => { if (!sp[k] || (c.sp[k]._ts || 0) > (sp[k]._ts || 0)) sp[k] = c.sp[k]; });
    const pred = otisk({st: c.st});
    ls.set(REG, JSON.stringify({rev: Number(rev) || c.rev, st, sp, t: Date.now()}));
    const zmena = pred !== otisk({st});
    if (zmena) zmenaSeznamu();
    return zmena;
  }
  const posluchaci = new Set();
  function zmenaSeznamu() { posluchaci.forEach(f => { try { f(); } catch (e) {} }); }
  async function obnovSeznam(vzdy) {
    const c = regCache();
    if (!SY()) return c;
    const v = await verzeSkriptu();
    if (v >= 15) {
      const r = await volej({akce: 'stavby', rev: vzdy ? 0 : c.rev}, 45000);
      if (!r.same) prevezmi({dokumenty: r.zaznamy || []}, r.rev);
      else ls.set(REG, JSON.stringify(Object.assign(c, {t: Date.now()})));
      return regCache();
    }
    const r = await getMain(vzdy ? 0 : c.rev);
    if (r && r.data) prevezmi(r.data, r.rev);
    return regCache();
  }
  function nazevHyb() {
    const z = regCache().st[HYB];
    return (z && z.name) || HYB_NAZEV;
  }
  // seznam pro výběr: Hybernská + všechny založené stavby
  function seznam() {
    const c = regCache();
    const a = [{sid: HYB, name: nazevHyb(), project: Object.assign({stav: 'aktivni', mesto: 'Praha 1', ulice: 'Hybernská 1000/8'}, (c.st[HYB] || {}).project || {})}];
    Object.keys(c.st).forEach(sid => { const z = c.st[sid]; if (sid !== HYB && z && !z.smazano) a.push({sid, name: z.name || 'Stavba', project: z.project || {}, created: z.created, by: z.by}); });
    // stavby založené dřív jen v tomto počítači (4.33) – dokud se nepřenesou
    jsn(ls.get('hyb-stavby'), []).forEach(x => { if (x && x.id && x.id !== HYB && !a.some(y => y.sid === x.id)) a.push({sid: x.id, name: x.name || 'Stavba', project: x.project || {}, mistni: true}); });
    return a;
  }
  const aktivni = () => { const s = ls.get('hyb-stavba') || HYB; return s; };
  const info = sid => seznam().find(x => x.sid === sid) || null;

  async function zapisZaznam(rec) {
    // pošle jen tento záznam; server ho sloučí do sdílených dat (nic jiného se nemění)
    const r = await volej({rev: 0, data: {dokumenty: [rec], tomb: {}}}, 60000);
    if (r && r.data) prevezmi(r.data, r.rev);
    else { const c = regCache(); const id = rec.id; if (id.startsWith('st~')) c.st[id.slice(3)] = rec; else c.sp[id.slice(3)] = rec; ls.set(REG, JSON.stringify(c)); }
    return r;
  }
  async function zaloz(udaje, sidPevne) {
    if (ro()) throw new Error('Jen prohlížení: stavbu nejde založit.');
    const P = Object.assign({}, udaje || {});
    const name = String(P.name || '').trim(); if (!name) throw new Error('Napište název stavby.');
    const sid = sidPevne || ('s' + uid());
    const rec = {id: 'st~' + sid, sid, name, project: P, created: new Date().toISOString(), by: ls.get('hyb-me') || '', _ts: Date.now()};
    await zapisZaznam(rec);
    return sid;
  }
  async function uprav(sid, udaje) {
    if (!sid || ro()) return;
    const c = regCache(), z = c.st[sid] || {id: 'st~' + sid, sid, created: new Date().toISOString()};
    const P = Object.assign({}, z.project || {}, udaje || {});
    const name = String(P.name || z.name || '').trim() || 'Stavba';
    if (z.name === name && otisk(z.project || {}) === otisk(P)) return;
    await zapisZaznam(Object.assign({}, z, {id: 'st~' + sid, sid, name, project: P, _ts: Date.now()}));
  }

  /* ---------- místní kopie dat staveb (IndexedDB) ---------- */
  let dbP = null;
  function idb() {
    if (dbP) return dbP;
    dbP = new Promise((res, rej) => {
      try {
        const q = indexedDB.open('cx-stavby', 1);
        q.onupgradeneeded = () => { q.result.createObjectStore('data'); };
        q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
      } catch (e) { rej(e); }
    });
    dbP.catch(() => { dbP = null; });
    return dbP;
  }
  async function idbGet(k) { const db = await idb(); return new Promise((res, rej) => { const q = db.transaction('data').objectStore('data').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
  async function idbSet(k, v) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction('data', 'readwrite'); t.objectStore('data').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); }
  async function ulozMistne(sid, D) { if (!sid || sid === HYB || !D) return; await idbSet(sid, {D, t: Date.now(), savedAt: D.savedAt || ''}); }
  async function nactiMistne(sid) { try { const x = await idbGet(sid); return x && x.D ? x.D : null; } catch (e) { return null; } }
  const lsKlic = sid => sid === HYB ? KEY_BASE : KEY_BASE + ':' + sid;
  // localStorage drží jen Hybernskou a právě otevřenou stavbu; ostatní se přesunou do IndexedDB
  async function uklidLocalStorage(otevrena) {
    let klice = [];
    try { klice = Object.keys(localStorage).filter(k => k.startsWith(KEY_BASE + ':')); } catch (e) { return; }
    for (const k of klice) {
      const sid = k.slice(KEY_BASE.length + 1);
      if (!sid || sid === otevrena) continue;
      const D = jsn(ls.get(k), null);
      if (D) {
        const m = await nactiMistne(sid);
        const vys = m ? mergeData(m, D) : D;
        vys.savedAt = [m && m.savedAt, D.savedAt].filter(Boolean).sort().pop() || '';
        await ulozMistne(sid, vys);
        if (!(await nactiMistne(sid))) continue;  // uložení se nepovedlo – nic nemazat
      }
      ls.del(k);
    }
  }
  // před otevřením stavby: dát její data z IndexedDB do localStorage (Management je čte hned při startu)
  async function pripravOtevreni(sid) {
    if (!sid || sid === HYB) return;
    const m = await nactiMistne(sid);
    if (!m) return;
    const L = jsn(ls.get(lsKlic(sid)), null);
    const vys = L ? mergeData(m, L) : m;
    vys.savedAt = [m.savedAt, L && L.savedAt].filter(Boolean).sort().pop() || '';
    ls.set(lsKlic(sid), JSON.stringify(vys));
  }

  /* ---------- data jedné stavby na Googlu ---------- */
  const gzip = async str => new Blob([await new Response(new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()]);
  const gunzip = async bytes => new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  const b64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
  const z64 = s => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
  async function ctiSoubor(id) {
    const KUS = 4 * 1024 * 1024, casti = [];
    let od = 0, celkem = Infinity;
    while (od < celkem) {
      const r = await volej({akce: 'dok_cti', id, od, do: od + KUS - 1}, 120000);
      if (!r || typeof r.data !== 'string') throw new Error('Data stavby se nepodařilo stáhnout.');
      const u = z64(r.data); casti.push(u); od += u.length; celkem = Number(r.celkem) || od;
      if (!u.length) break;
    }
    const all = new Uint8Array(casti.reduce((n, x) => n + x.length, 0)); let i = 0; casti.forEach(x => { all.set(x, i); i += x.length; });
    const d = JSON.parse(await gunzip(all));
    if (!d || typeof d !== 'object') throw new Error('Data stavby jsou poškozená.');
    return d;
  }
  async function nahrajSoubor(sid, data) {
    const blob = await gzip(JSON.stringify(data));
    if (blob.size > 5.5 * 1024 * 1024) throw new Error('Data stavby jsou příliš velká pro starší skript Google – je potřeba skript 15.');
    const r = await volej({akce: 'dok_maly', nazev: 'stavba-' + sid + '-' + Date.now() + '.json.gz', mime: 'application/gzip', cesta: ['Data staveb (needitovat)', sid], data: await b64(blob)}, 120000);
    if (!r || !r.id) throw new Error('Data stavby se nepodařilo uložit na Disk Google.');
    return r.id;
  }
  const mojeSoubory = () => jsn(ls.get('cx-stavby-moje'), {});
  function smazSoubory(ids) { ids = ids.filter(Boolean); if (ids.length) volej({akce: 'dok_smaz', ids}, 60000).catch(() => {}); }
  // zámek: v jednom prohlížeči posílá data jedné stavby vždy jen jedno okno
  const zamek = (sid, f) => navigator.locks && navigator.locks.request ? navigator.locks.request('cx-stavba-' + sid, f) : f();

  async function stahni(sid, rev) {
    if (!sid || sid === HYB) throw new Error('Hybernská se synchronizuje zvlášť.');
    const v = await verzeSkriptu();
    if (v >= 15) {
      const n = /^v:/.test(String(rev || '')) ? Number(String(rev).slice(2)) || 0 : 0;
      const r = await volej({akce: 'stavba', stavba: sid, rev: n}, 60000);
      if (r.same) return {rev: 'v:' + r.rev, same: true};
      let data = r.data || {};
      // přechod ze starší cesty (soubory na Disku): jednou přenést do nového úložiště
      if (!Number(r.rev) || !data.project) {
        const c = await obnovSeznam().catch(() => regCache());
        const p = c.sp[sid];
        if (p && p.f) { const f = await ctiSoubor(p.f); const x = await volej({akce: 'stavba', stavba: sid, data: f}, 120000); return {rev: 'v:' + x.rev, data: x.data}; }
      }
      return {rev: 'v:' + r.rev, data};
    }
    const c = await obnovSeznam();
    const p = c.sp[sid];
    if (!p || !p.f) return {rev: 'f:', data: null, prazdna: true};
    if (rev === 'f:' + p.f) return {rev, same: true};
    return {rev: 'f:' + p.f, data: await ctiSoubor(p.f)};
  }
  // pošle změny (celá data nebo jen část); vrací sloučená data ze serveru
  async function posli(sid, data) {
    if (!sid || sid === HYB) throw new Error('Hybernská se synchronizuje zvlášť.');
    if (ro()) throw new Error('Jen prohlížení: změny se neukládají.');
    const v = await verzeSkriptu();
    if (v >= 15) {
      const r = await volej({akce: 'stavba', stavba: sid, data}, 120000);
      return {rev: 'v:' + r.rev, data: r.data};
    }
    return zamek(sid, async () => {
      const c = await obnovSeznam();
      const p = c.sp[sid];
      const remote = p && p.f ? await ctiSoubor(p.f) : null;   // když stažení selže, chyba – nikdy nepřepsat data stavby neúplnou kopií
      const merged = mergeData(remote || {}, data);
      if (remote && otisk(merged) === otisk(remote)) return {rev: 'f:' + p.f, data: remote};
      const id = await nahrajSoubor(sid, merged);
      const moje = mojeSoubory(); moje[sid] = (moje[sid] || []).concat([id]).slice(-5); ls.set('cx-stavby-moje', JSON.stringify(moje));
      await zapisZaznam({id: 'sp~' + sid, f: id, _ts: Date.now()});
      const c2 = regCache(), p2 = c2.sp[sid];
      if (p2 && p2.f === id) {
        // náš soubor je nejnovější: starý smazat, stejně tak naše dřívější nahrání, která prohrála souběh
        smazSoubory([p && p.f].concat((moje[sid] || []).filter(x => x !== id)));
        moje[sid] = [id]; ls.set('cx-stavby-moje', JSON.stringify(moje));
      }
      return {rev: 'f:' + id, data: merged};
    });
  }

  /* ---------- přenos staveb založených dřív jen v jednom počítači (4.33) ---------- */
  async function prenesMistni() {
    if (!SY() || ro()) return 0;
    const stare = jsn(ls.get('hyb-stavby'), []).filter(x => x && x.id && x.id !== HYB);
    if (!stare.length) return 0;
    await obnovSeznam();
    let n = 0;
    for (const x of stare) {
      if (!regCache().st[x.id]) { await zaloz(Object.assign({}, x.project || {}, {name: x.name || (x.project || {}).name || 'Stavba'}), x.id); n++; }
      const D = jsn(ls.get(lsKlic(x.id)), null) || await nactiMistne(x.id);
      if (D && (D.tasks || []).concat(D.hmg || [], D.diary || [], D.zavady || []).length) await posli(x.id, D);
    }
    ls.set('hyb-stavby', JSON.stringify(jsn(ls.get('hyb-stavby'), []).filter(x => x && (x.id === HYB || !regCache().st[x.id]))));
    return n;
  }

  /* ---------- vzhled: výběr stavby a formulář nové stavby (stejné v Managementu i Deníku) ---------- */
  const CSS = `
.cxs-pop{position:fixed;z-index:2000;width:340px;max-width:calc(100vw - 16px);max-height:78vh;display:flex;flex-direction:column;background:#fff;color:#16191c;border:1px solid #d9d9d2;border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.25);padding:8px;font:14px/1.35 "Hanken Grotesk",system-ui,-apple-system,"Segoe UI",sans-serif}
.cxs-pop .cap{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#6b6f73;padding:6px 8px 4px}
.cxs-pop input.cxs-q{margin:2px 4px 6px;padding:9px 10px;border:1px solid #d9d9d2;border-radius:8px;font:inherit;outline:none}
.cxs-pop input.cxs-q:focus{border-color:#16191c}
.cxs-pop .cxs-list{overflow:auto;flex:1;min-height:0}
.cxs-pop button{display:block;width:100%;text-align:left;border:0;background:none;font:inherit;color:inherit;padding:9px 10px;border-radius:8px;cursor:pointer}
.cxs-pop button:hover,.cxs-pop button:focus-visible{background:#f4f4f1;outline:none}
.cxs-pop button.on{background:#FFF4BF;font-weight:700}
.cxs-pop button small{display:block;font-size:12px;color:#6b6f73;font-weight:400;margin-top:1px}
.cxs-pop .grp{font-size:11px;color:#6b6f73;padding:8px 10px 2px;font-weight:700}
.cxs-pop hr{border:0;border-top:1px solid #e6e6e0;margin:6px 0}
.cxs-pop .new{font-weight:700}
.cxs-pop .nic{padding:10px;color:#6b6f73}
.cxs-ov{position:fixed;inset:0;z-index:2100;background:rgba(15,17,19,.55);display:flex;align-items:flex-start;justify-content:center;padding:4vh 12px;overflow:auto;font:14px/1.4 "Hanken Grotesk",system-ui,-apple-system,"Segoe UI",sans-serif}
.cxs-mod{background:#fff;color:#16191c;border-radius:14px;max-width:640px;width:100%;padding:20px 22px;box-shadow:0 20px 50px rgba(0,0,0,.35)}
.cxs-mod h2{margin:0 0 12px;font-size:22px}
.cxs-mod .sec{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#6b6f73;margin:14px 0 6px;font-weight:700}
.cxs-mod .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.cxs-mod .full{grid-column:1/-1}
.cxs-mod label{display:block;font-size:12.5px;color:#4a4f54;margin-bottom:3px;font-weight:600}
.cxs-mod input,.cxs-mod select,.cxs-mod textarea{width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid #cfcfc8;border-radius:8px;font:inherit;background:#fff;color:inherit}
.cxs-mod .foot{display:flex;gap:10px;justify-content:flex-end;margin-top:18px;flex-wrap:wrap}
.cxs-mod .btn{padding:10px 16px;border-radius:9px;border:1px solid #cfcfc8;background:#fff;font:inherit;font-weight:600;cursor:pointer;color:#16191c}
.cxs-mod .btn.pri{background:#16191c;color:#fff;border-color:#16191c}
.cxs-mod .btn:disabled{opacity:.5;cursor:default}
.cxs-mod .hint{font-size:12.5px;color:#6b6f73;margin:10px 0 0}
.cxs-mod .err{color:#a3262f;font-weight:600;margin-top:10px}
@media (max-width:560px){.cxs-mod .grid{grid-template-columns:1fr}}
.cxs-wait{position:fixed;inset:0;z-index:2200;background:rgba(244,244,241,.92);display:flex;align-items:center;justify-content:center;font:600 18px/1.4 "Hanken Grotesk",system-ui,sans-serif;color:#16191c;text-align:center;padding:20px}`;
  function css() { if (document.getElementById('cxs-css')) return; const s = document.createElement('style'); s.id = 'cxs-css'; s.textContent = CSS; document.head.appendChild(s); }
  function cekani(text) { css(); const d = document.createElement('div'); d.className = 'cxs-wait'; d.textContent = text; document.body.appendChild(d); return () => d.remove(); }
  const popis = x => { const P = x.project || {}; return [x.mistni ? 'zatím jen v tomto počítači' : '', [P.ulice, P.mesto].filter(Boolean).join(', '), P.stav && P.stav !== 'aktivni' ? STAV[P.stav] || '' : ''].filter(Boolean).join(' · '); };

  // menu(kotva, {naVyber(sid), naUdaje?(), naNovou?() }) – rozbalí seznam staveb pod políčkem Projekt
  function menu(kotva, o) {
    o = o || {}; css();
    const stare = document.querySelector('.cxs-pop'); if (stare) { stare.remove(); return; }
    const akt = o.aktualni || aktivni();
    const pop = document.createElement('div'); pop.className = 'cxs-pop'; pop.setAttribute('role', 'menu');
    pop.innerHTML = `<div class="cap">Stavby</div><input class="cxs-q" type="search" placeholder="Hledat stavbu…" aria-label="Hledat stavbu"><div class="cxs-list"></div><hr>
      ${o.bezNove ? '' : '<button type="button" role="menuitem" class="new" data-act="nova">+ Nová stavba</button>'}${o.naUdaje ? '<button type="button" role="menuitem" data-act="udaje">Údaje o stavbě, role a lidé</button>' : ''}`;
    document.body.appendChild(pop);
    const r = kotva.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8)) + 'px';
    pop.style.top = Math.max(8, Math.min(r.bottom + 6, window.innerHeight - pop.offsetHeight - 8)) + 'px';
    kotva.setAttribute('aria-expanded', 'true');
    const q = pop.querySelector('.cxs-q'), list = pop.querySelector('.cxs-list');
    const kresli = () => {
      const h = fold(q.value.trim());
      const a = seznam().filter(x => !h || fold(x.name + ' ' + popis(x)).includes(h));
      const otevrene = a.filter(x => (x.project || {}).stav !== 'dokoncena'), hotove = a.filter(x => (x.project || {}).stav === 'dokoncena');
      const radek = x => `<button type="button" role="menuitem" data-stv="${esc(x.sid)}" class="${x.sid === akt ? 'on' : ''}">${esc(x.name)}<small>${x.sid === akt ? 'otevřená' + (popis(x) ? ' · ' + esc(popis(x)) : '') : esc(popis(x))}</small></button>`;
      otevrene.sort((x, y) => (x.sid === HYB ? -1 : y.sid === HYB ? 1 : 0) || x.name.localeCompare(y.name, 'cs', {numeric: true}));
      hotove.sort((x, y) => x.name.localeCompare(y.name, 'cs', {numeric: true}));
      list.innerHTML = (otevrene.map(radek).join('') + (hotove.length ? `<div class="grp">Dokončené</div>${hotove.map(radek).join('')}` : '')) || '<div class="nic">Žádná stavba neodpovídá hledání.</div>';
      list.querySelectorAll('[data-stv]').forEach(b => b.onclick = () => { zavri(); if (b.dataset.stv !== akt && o.naVyber) o.naVyber(b.dataset.stv); });
    };
    kresli();
    q.oninput = kresli;
    q.onkeydown = e => { if (e.key === 'Enter') { const b = list.querySelector('[data-stv]'); if (b) b.click(); } };
    const zavri = () => { pop.remove(); kotva.setAttribute('aria-expanded', 'false'); document.removeEventListener('mousedown', venku, true); document.removeEventListener('keydown', klav); posluchaci.delete(kresli); };
    const venku = e => { if (!pop.contains(e.target) && !kotva.contains(e.target)) zavri(); };
    const klav = e => { if (e.key === 'Escape') zavri(); };
    setTimeout(() => { document.addEventListener('mousedown', venku, true); document.addEventListener('keydown', klav); }, 0);
    posluchaci.add(kresli);
    const nb = pop.querySelector('[data-act=nova]'); if (nb) nb.onclick = () => { zavri(); (o.naNovou || (() => formular({naHotovo: o.naVyber})))(); };
    const ub = pop.querySelector('[data-act=udaje]'); if (ub) ub.onclick = () => { zavri(); o.naUdaje(); };
    if (seznam().length > 6) q.focus(); else { q.style.display = 'none'; const f0 = list.querySelector('button.on') || list.querySelector('button'); if (f0) f0.focus(); }
    // čerstvý seznam ze serveru (v pozadí)
    obnovSeznam().catch(() => {});
  }

  // formulář nové stavby: stejná pole v Managementu i v Deníku; role a lidi se doplní v Údajích o stavbě
  function formular(o) {
    o = o || {}; css();
    if (!SY()) { alert('Novou stavbu jde založit jen na počítači připojeném ke Constructu (Management → Data → Automatická synchronizace).'); return; }
    if (ro()) { alert('Máte přístup jen pro prohlížení – stavbu nemůžete založit.'); return; }
    const ja = o.ja || ls.get('hyb-me') || '';
    const ov = document.createElement('div'); ov.className = 'cxs-ov';
    const f = (id, label, extra = '', cls = '') => `<div class="${cls}"><label for="${id}">${label}</label><input id="${id}" ${extra}></div>`;
    ov.innerHTML = `<div class="cxs-mod" role="dialog" aria-modal="true" aria-labelledby="cxs-h"><h2 id="cxs-h">Nová stavba</h2>
      <div class="sec">Základní údaje</div>
      <div class="grid">
        ${f('cxs-name', 'Název stavby', 'placeholder="např. Bytový dům Vinohrady" maxlength="120"', 'full')}
        ${f('cxs-ulice', 'Ulice a číslo', 'placeholder="Ulice"')}
        ${f('cxs-mesto', 'Město', 'placeholder="Město"')}
        ${f('cxs-psc', 'PSČ', 'placeholder="PSČ" inputmode="numeric"')}
        ${f('cxs-stat', 'Stát', 'value="Česká republika" list="cxs-staty"')}
        <datalist id="cxs-staty"><option value="Česká republika"><option value="Slovensko"><option value="Německo"><option value="Rakousko"><option value="Polsko"></datalist>
        <div class="full"><label for="cxs-popis">Popis</label><textarea id="cxs-popis" rows="2" placeholder="Krátký popis stavby"></textarea></div>
      </div>
      <div class="sec">Řízení stavby</div>
      <div class="grid">
        ${f('cxs-zac', 'Odhadovaný začátek', 'type="date"')}
        ${f('cxs-kon', 'Odhadovaný konec', 'type="date"')}
        ${f('cxs-inv', 'Investor', 'placeholder="Investor"')}
        ${f('cxs-co', 'Zhotovitel', `placeholder="Zhotovitel" value="${esc(o.zhotovitel || '')}"`)}
        <div><label for="cxs-stav">Stav stavby</label><select id="cxs-stav">${Object.entries(STAV).map(([k, v]) => `<option value="${k}"${k === 'priprava' ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
      </div>
      <p class="hint">Stavba začne prázdná a hned ji uvidí všichni kolegové připojení ke Constructu – v Managementu i v Deníku. Správcem bude ${esc(ja || 'ten, kdo ji zakládá')}. Role, lidi a firmy doplníte v Údajích o stavbě.</p>
      <div class="err" hidden></div>
      <div class="foot"><button type="button" class="btn" data-x>Zrušit</button><button type="button" class="btn pri" data-ok>Založit stavbu</button></div></div>`;
    document.body.appendChild(ov);
    const $ = s => ov.querySelector(s), v = id => ($('#' + id).value || '').trim();
    const zavri = () => { ov.remove(); document.removeEventListener('keydown', klav); };
    const klav = e => { if (e.key === 'Escape') zavri(); };
    document.addEventListener('keydown', klav);
    $('[data-x]').onclick = zavri;
    ov.addEventListener('mousedown', e => { if (e.target === ov) zavri(); });
    const err = t => { const e = $('.err'); e.textContent = t; e.hidden = !t; };
    $('[data-ok]').onclick = async () => {
      const P = {name: v('cxs-name'), ulice: v('cxs-ulice'), mesto: v('cxs-mesto'), psc: v('cxs-psc'), stat: v('cxs-stat'), popis: v('cxs-popis'), zacatek: v('cxs-zac'), konec: v('cxs-kon'), investor: v('cxs-inv'), company: v('cxs-co'), stav: v('cxs-stav')};
      if (!P.name) { err('Napište název stavby.'); $('#cxs-name').focus(); return; }
      if (P.zacatek && P.konec && P.konec < P.zacatek) { err('Konec je dřív než začátek.'); $('#cxs-kon').focus(); return; }
      if (seznam().some(x => fold(x.name) === fold(P.name))) { err('Stavba s tímto názvem už existuje. Vyberte ji v seznamu, nebo napište jiný název.'); return; }
      if (ja) P.clenove = [{id: 'c' + uid(), jmeno: ja, firma: P.company || '', role: 'spravce', email: '', pozice: ''}];
      const b = $('[data-ok]'); b.disabled = true; b.textContent = 'Zakládám…'; err('');
      try {
        const sid = await zaloz(P);
        zavri();
        if (o.naHotovo) o.naHotovo(sid, P);
      } catch (e) { b.disabled = false; b.textContent = 'Založit stavbu'; err('Stavbu se nepodařilo založit: ' + (e.message || e) + ' Zkuste to prosím znovu.'); }
    };
    setTimeout(() => $('#cxs-name').focus(), 30);
  }

  // přepnout na jinou stavbu (Management i Deník): zapamatovat, připravit data, pak obnovit stránku / zavolat hotovo
  async function prepni(sid, o) {
    o = o || {};
    const hotovo = cekani('Otevírám stavbu ' + ((info(sid) || {}).name || '') + '…');
    try {
      if (o.ulozAktualni) await o.ulozAktualni();
      await pripravOtevreni(sid);
    } catch (e) { console.warn('Příprava stavby', e); }
    ls.set('hyb-stavba', sid);
    if (o.hotovo) { await o.hotovo(sid); hotovo(); } else location.reload();
  }

  window.CXStavby = {HYB, HYB_NAZEV, KEY_BASE, STAV, aktivni, seznam, info, nazevHyb, obnovSeznam, prevezmi, zaloz, uprav, stahni, posli, prenesMistni,
    ulozMistne, nactiMistne, uklidLocalStorage, pripravOtevreni, lsKlic, menu, formular, prepni, cekani, mergeData, otisk, verzeSkriptu,
    naZmenu: f => { posluchaci.add(f); return () => posluchaci.delete(f); },
    spojeni: c => { spoj = c && c.url && c.key ? {url: c.url, key: c.key} : null; }};
})();
