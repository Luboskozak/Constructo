/* Constructo 4.81 (4.84: Pozvat do stavby): Docházka pracovníků firem – záložka v Managementu (window.CXDochazka).
   Pracovníci = kontakty firem (D.project.firmy[].kontakty, panel Firmy / osoby na projektu). Záznamy Příchod / Pauza / Konec pauzy / Odchod
   posílají pracovníci ze stránky /dochazka/ (telefon, ikona na ploše). Data jsou na Disku Google zvlášť po měsících (skript Google ≥ 16),
   sem se načítají jen měsíce, které se změnily, a pamatují se v počítači (IndexedDB). Vidí jen osoby s právem „Vidí docházku“. */
(function () {
  'use strict';
  const ODKAZ = 'https://lovely-gumption-be0f29.netlify.app/dochazka/';
  const TYP = {prichod: 'Příchod', pauza: 'Pauza', konec: 'Konec pauzy', odchod: 'Odchod'};
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);
  const pad = n => String(n).padStart(2, '0');
  const fold = x => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const den = d => { const x = d instanceof Date ? d : new Date(d); return x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate()); };
  const pd = s => { const p = String(s).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
  const plus = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return den(d); };
  const cas = iso => { if (!iso) return '–'; const d = new Date(iso); return d.getHours() + ':' + pad(d.getMinutes()); };
  const hod = min => Math.floor(min / 60) + ':' + pad(Math.round(min % 60));
  const fD = s => { const p = String(s).split('-').map(Number); return p[2] + '. ' + p[1] + '.'; };
  const fDY = s => { const p = String(s).split('-').map(Number); return p[2] + '. ' + p[1] + '. ' + p[0]; };
  const DOW = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'], MES = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];
  const dow = s => DOW[(pd(s).getDay() + 6) % 7];
  const osob = n => n === 1 ? 'osoba' : n > 1 && n < 5 ? 'osoby' : 'osob';
  const mapa = (lat, lng) => 'https://mapy.cz/zakladni?x=' + lng + '&y=' + lat + '&z=18&source=coor&id=' + lng + '%2C' + lat;
  const vzd = (a, b) => { const R = 6371000, r = Math.PI / 180, dl = (b.lat - a.lat) * r, dn = (b.lng - a.lng) * r; const x = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };

  let H = null, EL = null;
  const S = {tab: 'dnes', den: den(new Date()), obd: 'tyden', ref: den(new Date()), graf: 'hod', data: {}, mr: {}, rev: '', qr: '', report: '', nacita: false, chyba: '', nacteno: false, klice: {},
    f: {firma: '', osoba: '', od: '', do: '', zrus: false}, archN: 200, sid: ''};

  /* ---------- paměť v počítači (IndexedDB), ať se celá historie nestahuje pokaždé ---------- */
  const idb = () => new Promise((res, rej) => { const q = indexedDB.open('cx-dochazka', 1); q.onupgradeneeded = () => q.result.createObjectStore('kv'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  async function idbGet(k) { try { const db = await idb(); return await new Promise(res => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(null); }); } catch (e) { return null; } }
  async function idbSet(k, v) { try { const db = await idb(); db.transaction('kv', 'readwrite').objectStore('kv').put(v, k); } catch (e) {} }

  /* ---------- výpočet dne jednoho člověka (stejně jako ve skriptu Google: dochSpocti_) ---------- */
  function spocti(ev, konecMs) {
    let stav = '', od = 0, prace = 0, pauza = 0, prichod = '', odchod = '', pauz = 0;
    ev.forEach(x => {
      const t = new Date(x.at).getTime();
      if (x.typ === 'prichod') { if (stav === 'prace') prace += t - od; if (stav === 'pauza') pauza += t - od; if (!prichod) prichod = x.at; stav = 'prace'; od = t; odchod = ''; }
      else if (x.typ === 'pauza') { if (stav === 'prace') { prace += t - od; stav = 'pauza'; od = t; pauz++; } }
      else if (x.typ === 'konec') { if (stav === 'pauza') { pauza += t - od; stav = 'prace'; od = t; } }
      else if (x.typ === 'odchod') { if (stav === 'prace') prace += t - od; if (stav === 'pauza') pauza += t - od; if (stav) odchod = x.at; stav = ''; }
    });
    const od0 = od;
    if (stav && konecMs > od) { if (stav === 'prace') prace += konecMs - od; else pauza += konecMs - od; }
    return {prichod, odchod, prace: Math.round(prace / 60000), pauza: Math.round(pauza / 60000), pauz, stav, od: od0};
  }
  const vse = () => Object.keys(S.data).sort().flatMap(m => S.data[m] || []);
  const platne = () => vse().filter(x => !x.zrus);
  // den → kid → záznamy
  function poDnech(od, dd) {
    const out = {};
    platne().forEach(x => { const d = den(x.at); if (d < od || d > dd) return; ((out[d] = out[d] || {})[x.kid] = out[d][x.kid] || []).push(x); });
    Object.values(out).forEach(o => Object.values(o).forEach(a => a.sort((a1, b1) => a1.at < b1.at ? -1 : 1)));
    return out;
  }
  function lideDne(d) {
    const o = poDnech(d, d)[d] || {}, dnes = den(new Date());
    return Object.keys(o).map(kid => {
      const ev = o[kid], z = ev[ev.length - 1], s = spocti(ev, d === dnes ? Date.now() : 0);
      return Object.assign(s, {kid, jmeno: z.jmeno, funkce: z.funkce || '', firma: z.firma || 'Bez firmy', ev});
    }).sort((a, b) => (a.firma + a.jmeno).localeCompare(b.firma + b.jmeno, 'cs'));
  }
  // střed stavby = medián poloh příchodů (bez nastavení); záznam dál než 400 m se označí
  // 4.88: střed stavby = skutečná adresa stavby (souřadnice uložené u stavby, jinak dohledané z adresy přes OpenStreetMap).
  // Dřív se brala „obvyklá poloha příchodů“ – zkušební příchody z domova ji posunuly a lidé na stavbě pak byli „4 km od stavby“.
  const gpsOk = g => g && typeof g.lat === 'number' && typeof g.lng === 'number';
  function adresaStavby() {
    const p = (H && H.projekt()) || {};
    const a = [p.ulice, [p.psc, p.mesto].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    if (a) return a;
    const m = String(p.name || '').match(/(\S+\s+\d+(?:\/\d+\w?)?)\s*,\s*([^,]+)$/);
    return m ? m[1] + ', ' + m[2] : '';
  }
  let gpsHleda = '';
  async function gpsStavby() {
    const p = (H && H.projekt()) || {}, a = adresaStavby();
    if (!a || (gpsOk(p.gps) && p.gps.adr === a) || gpsHleda === a) return;
    gpsHleda = a;
    try {
      const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=cz,sk&q=' + encodeURIComponent(a), {headers: {Accept: 'application/json'}});
      const o = (await r.json())[0];
      if (!o) return;
      const g = {lat: +(+o.lat).toFixed(6), lng: +(+o.lon).toFixed(6), adr: a};
      if (H.ulozGps) H.ulozGps(g); else S.gps = g;
      obnov();
    } catch (e) {}
  }
  function stred() {
    const p = (H && H.projekt()) || {};
    if (gpsOk(p.gps)) return p.gps;
    if (gpsOk(S.gps)) return S.gps;
    gpsStavby();
    const g = platne().filter(x => x.typ === 'prichod' && typeof x.lat === 'number' && (x.acc || 0) < 200);
    if (g.length < 3) return null;
    const md = a => { const s = a.slice().sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; };
    return {lat: md(g.map(x => x.lat)), lng: md(g.map(x => x.lng))};
  }
  function mistoHtml(x, st) {
    if (typeof x.lat !== 'number') return '<span class="dc-np" title="Telefon polohu nezjistil: ' + esc(x.bezPolohy || '') + '">bez polohy</span>';
    const d = st ? vzd(st, x) : 0, daleko = st && d > 400 + (x.acc || 0);
    return '<a href="' + mapa(x.lat, x.lng) + '" target="_blank" rel="noopener" class="dc-map' + (daleko ? ' far' : st ? ' ok' : '') + '" title="Přesnost ±' + (x.acc || '?') + ' m' + (st ? ', ' + Math.round(d) + ' m od stavby' : '') + '">📍 ' + (!st ? 'mapa' : daleko ? (d > 1500 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m') + ' od stavby' : 'na stavbě') + '</a>';
  }

  /* ---------- načtení z Googlu ---------- */
  async function nacti(tise) {
    if (!H || S.nacita) return;
    if (!H.pripojeno()) { S.chyba = 'Docházka se načítá z Googlu. Připojte Constructo (Data → Automatická synchronizace).'; obnov(); return; }
    S.nacita = true; if (!tise) obnov();
    try {
      const r = await H.volej({akce: 'dochazka_cti', stavba: S.sid, rev: S.rev, mam: S.mr});
      if (r && r.error === 'heslo') S.chyba = 'Nesprávné heslo ke Googlu.';
      else if (!r || !r.ok) {
        S.chyba = r && r.error ? (/Unknown|neznám/i.test(r.error) ? '' : 'Google: ' + r.error) : 'Google nevrátil docházku.';
        if (r && !r.error && !r.ok || (r && r.rev === undefined)) { S.chyba = 'Docházka potřebuje novější skript Google (verze 16). Constructo ho aktualizuje samo – zkuste to prosím za chvíli.'; if (H.aktualizujSkript) H.aktualizujSkript().then(x => { if (x && x.ok) { S.chyba = ''; setTimeout(() => nacti(), 1500); } else if (x && x.duvod) { S.chyba = 'Skript Google se nepodařilo aktualizovat: ' + String(x.duvod).slice(0, 200) + ' (postup je v červeném pruhu nahoře).'; obnov(); } }).catch(() => {}); }
      } else {
        S.chyba = '';
        if (!r.same) { Object.keys(r.data || {}).forEach(m => { S.data[m] = r.data[m]; }); S.mr = r.mesice || {}; S.rev = r.rev; if (r.qr) S.qr = r.qr; S.report = r.report || ''; idbSet('d:' + S.sid, {data: S.data, mr: S.mr, rev: S.rev, qr: S.qr}); }
        S.nacteno = true;
      }
    } catch (e) { S.chyba = e.message || 'Bez připojení.'; }
    finally { S.nacita = false; obnov(); }
  }
  async function zPameti() {
    const x = await idbGet('d:' + S.sid);
    if (x && x.data) { S.data = x.data; S.mr = x.mr || {}; S.rev = x.rev || ''; S.qr = x.qr || ''; S.nacteno = true; obnov(); }
  }

  /* ---------- pracovníci z firem (panel Firmy / osoby na projektu) ---------- */
  function kontakty() {
    const fy = (H && H.firmy()) || [], out = [];
    fy.forEach(f => {
      const ks = window.CXFirmy && CXFirmy.kontakty ? CXFirmy.kontakty(f) : (Array.isArray(f.kontakty) ? f.kontakty : []);
      (ks || []).forEach(k => { if (k && k.id && k.jmeno) out.push({kid: String(k.id), jmeno: k.jmeno, funkce: k.funkce || '', tel: k.tel || k.telefon || '', email: k.email || '', firma: f.firma || f.nazev || '', fid: f.id || '', pozvano: k.pozvano || {}}); });
    });
    return out;
  }
  async function klic(kids) {
    const chybi = kids.filter(k => !S.klice[k]);
    if (chybi.length) {
      const r = await H.volej({akce: 'dochazka_klic', stavba: S.sid, kid: chybi});
      if (!r || !r.ok) throw new Error(r && r.error ? r.error : 'Google nevrátil odkaz (skript Google musí být verze 16).');
      Object.assign(S.klice, r.klice || {}); if (r.qr) S.qr = r.qr;
    }
    return kids.map(k => S.klice[k]);
  }
  const odkazOsoby = (kid, tok) => ODKAZ + '?s=' + encodeURIComponent(S.sid) + '&k=' + encodeURIComponent(kid) + '&t=' + encodeURIComponent(tok);
  const odkazQR = () => ODKAZ + '?s=' + encodeURIComponent(S.sid) + '&q=' + encodeURIComponent(S.qr);
  const qrSvg = (text, px) => { try { const q = qrcode(0, 'M'); q.addData(text); q.make(); const n = q.getModuleCount(), c = Math.max(2, Math.floor((px || 240) / (n + 8))); return q.createSvgTag(c, c * 4); } catch (e) { return '<p>QR kód se nepodařilo vytvořit.</p>'; } };
  // 4.85: jazyk pozvánky CZ / UA (přepínač v okně pozvánky); odkaz s &l=uk otevře Docházku ukrajinsky
  let POZJ = 'cs';
  try { POZJ = localStorage.getItem('cx-doch-poz-jaz') === 'uk' ? 'uk' : 'cs'; } catch (e) {}
  const urlJ = url => POZJ === 'uk' ? url + '&l=uk' : url;
  const zpravaPozvanky = (k, url) => POZJ === 'uk'
    ? 'Добрий день, ' + k.jmeno.split(' ')[0] + '! Це облік робочого часу Docházka Constructo для будови ' + projektNazev() + '. Відкрийте посилання і натисніть «Зрозуміло». Вранці на будові натисніть «Прихід», ввечері «Відхід». Більше нічого. Збережіть це повідомлення, щодня відкривайте посилання звідси. ' + url
    : 'Dobrý den, ' + k.jmeno.split(' ')[0] + ', tady je Docházka Constructo pro stavbu ' + projektNazev() + '. Otevřete odkaz a klepněte na Rozumím. Ráno na stavbě klepnete na Příchod, večer na Odchod. Nic víc. Zprávu si nechte, odkaz otevírejte každý den odsud. ' + url;
  const projektNazev = () => String((H.projekt() || {}).name || 'stavba').split(',')[0];

  /* ---------- dialog ---------- */
  function dlg(html, sir) {
    const bg = document.createElement('div'); bg.className = 'dc-bg';
    bg.innerHTML = '<div class="dc-dlg" role="dialog" aria-modal="true"' + (sir ? ' style="max-width:' + sir + 'px"' : '') + '><button type="button" class="dc-x" aria-label="Zavřít">✕ Zavřít</button>' + html + '</div>';
    bg.addEventListener('click', e => { if (e.target === bg || e.target.closest('.dc-x')) bg.remove(); });
    document.body.appendChild(bg);
    return bg;
  }
  // 4.84: odeslání osobního odkazu jedním tlačítkem (e-mail, WhatsApp, SMS, kopírovat, QR) – stejné z Docházky, Firem i Správy stavby
  function cestyHtml(k, url) { return '<div class="dc-cw">' + cestyIn(k, url) + '</div>'; }
  // 4.86: jasně vidět, co už odešlo (uloženo u osoby, vidí to všichni kolegové) – nic se neposílá omylem vícekrát
  const kdy = iso => { const d = new Date(iso), t = new Date(); const h = d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); return d.toDateString() === t.toDateString() ? 'dnes ' + h : d.getDate() + '. ' + (d.getMonth() + 1) + '. ' + h; };
  function stavPozvanky(k) {
    const pz = k.pozvano || {}, c = [];
    if (pz.mail) c.push('✉ e-mail ' + kdy(pz.mail));
    if (pz.wa) c.push('WhatsApp otevřen ' + kdy(pz.wa));
    if (pz.sms) c.push('SMS otevřena ' + kdy(pz.sms));
    return c.length ? '<div class="dc-uz">✓ ' + c.join(' · ') + '.' + (pz.mail ? ' Když e-mail nedorazil, ať se podívá do <b>Spamu / Nevyžádané pošty</b>.' : '') + (pz.wa || pz.sms ? ' WhatsApp a SMS odejdou, až je v telefonu odešlete tlačítkem ➤.' : '') + '</div>' : '';
  }
  function oznac(box, k, kid, url0, cesta) {
    k.pozvano = Object.assign({}, k.pozvano, {[cesta]: new Date().toISOString()});
    if (H.oznacPozvanku) H.oznacPozvanku(k.fid, kid, cesta, k.pozvano[cesta]);
    const w = box.querySelector('.dc-cw'); if (w) { w.innerHTML = cestyIn(k, url0); cestyBind(box, k, kid, url0); }
  }
  function cestyIn(k, url0) {
    const url = urlJ(url0), pz = k.pozvano || {};
    const tel = String(k.tel || '').replace(/[^0-9+]/g, ''), txt = zpravaPozvanky(k, url), wa = tel.replace(/^00/, '+').replace(/^\+/, '');
    return '<div class="dc-jaz"><span>Jazyk pozvánky:</span><button type="button" class="btn' + (POZJ === 'cs' ? ' dc-on' : '') + '" data-pj="cs">Čeština</button><button type="button" class="btn' + (POZJ === 'uk' ? ' dc-on' : '') + '" data-pj="uk">Українська</button></div>' +
      stavPozvanky(k) +
      '<div class="dc-poz"><div class="dc-qr">' + qrSvg(url, 200) + '<small>Pracovník může QR naskenovat i přímo z obrazovky.</small></div><div class="dc-cesty">' +
      (k.email ? (pz.mail ? '<button type="button" class="btn dc-hotovo" data-p="mail">✓ E-mail odeslán ' + kdy(pz.mail) + '<small>poslat znovu (klepněte 2×)</small></button>' : '<button type="button" class="btn dc-pri" data-p="mail">✉ Poslat e-mailem<small>' + esc(k.email) + '</small></button>') : '<p class="dc-m">E-mail není vyplněný.</p>') +
      (wa ? '<a class="btn dc-wa" data-p="wa" target="_blank" rel="noopener" href="https://wa.me/' + esc(wa) + '?text=' + encodeURIComponent(txt) + '">' + (pz.wa ? '✓ ' : '') + 'WhatsApp<small>' + (pz.wa ? 'otevřeno ' + kdy(pz.wa) + ' · znovu' : esc(k.tel)) + ' · ve WhatsAppu pak klepněte na ➤ Odeslat</small></a>' : '') +
      (tel ? '<a class="btn' + (pz.sms ? ' dc-hotovo' : '') + '" data-p="sms" href="sms:' + esc(tel) + '?&body=' + encodeURIComponent(txt) + '">' + (pz.sms ? '✓ SMS otevřena ' + kdy(pz.sms) + '<small>znovu · ve Zprávách klepněte na ↑ Odeslat</small>' : 'SMS z vašeho telefonu<small>ve Zprávách pak klepněte na ↑ Odeslat</small>') + '</a>' : '') +
      (!k.email && !tel ? '<p class="dc-m">Bez e-mailu a telefonu: zkopírujte odkaz nebo nechte pracovníka naskenovat QR.</p>' : '') +
      '<button type="button" class="btn" data-p="kop">Kopírovat odkaz</button></div></div>' +
      '<p class="dc-m">Odkaz je osobní: kdo ho otevře, zapisuje docházku za ' + esc(k.jmeno) + '. Neposílejte ho nikomu jinému.</p>';
  }
  function cestyBind(box, k, kid, url0) {
    const url = urlJ(url0), txt = zpravaPozvanky(k, url);
    box.querySelectorAll('[data-pj]').forEach(b => b.onclick = () => {
      POZJ = b.dataset.pj; try { localStorage.setItem('cx-doch-poz-jaz', POZJ); } catch (e) {}
      box.querySelector('.dc-cw').innerHTML = cestyIn(k, url0); cestyBind(box, k, kid, url0);
    });
    box.querySelector('[data-p="kop"]').onclick = async () => { try { await navigator.clipboard.writeText(url); H.toast('Odkaz zkopírován'); } catch (e) { prompt('Zkopírujte odkaz:', url); } };
    box.querySelectorAll('[data-p="wa"],[data-p="sms"]').forEach(a => a.addEventListener('click', () => setTimeout(() => oznac(box, k, kid, url0, a.dataset.p), 400)));
    const bm = box.querySelector('[data-p="mail"]');
    let znovu = 0;
    if (bm) bm.onclick = async () => {
      if ((k.pozvano || {}).mail && !znovu) { znovu = 1; bm.innerHTML = 'Opravdu poslat znovu?<small>klepněte ještě jednou</small>'; setTimeout(() => { znovu = 0; }, 6000); return; }
      bm.disabled = true; bm.innerHTML = '⏳ Odesílám…<small>' + esc(k.email) + '</small>';
      const uk = POZJ === 'uk';
      const html = '<div style="font-family:Arial,sans-serif;font-size:16px;color:#16191c;max-width:560px">' + (uk
        ? '<p>Добрий день,</p><p>це <b>Docházka Constructo</b> (облік робочого часу) для будови ' + esc(projektNazev()) + '.</p>'
        : '<p>Dobrý den,</p><p>tady je <b>Docházka Constructo</b> pro stavbu ' + esc(projektNazev()) + '.</p>') +
        '<p style="margin:22px 0"><a href="' + esc(url) + '" style="background:#F4D23C;color:#131518;padding:14px 26px;border-radius:10px;font-weight:800;text-decoration:none;font-size:18px">' + (uk ? 'Відкрити Docházku' : 'Otevřít Docházku') + '</a></p>' +
        (uk ? '<ol><li>Відкрийте посилання в телефоні і натисніть <b>Зрозуміло</b>.</li><li>Вранці на будові натисніть велику зелену кнопку <b>Прихід</b>, ввечері <b>Відхід</b>. Більше нічого.</li><li>Збережіть цей лист, щодня відкривайте посилання звідси.</li></ol>' +
          '<p style="color:#6b7279;font-size:13px">Місцезнаходження телефону визначається лише в мить натискання, ніколи інакше. Посилання особисте, нікому його не пересилайте.</p></div>'
        : '<ol><li>Otevřete odkaz v telefonu a klepněte na <b>Rozumím</b>.</li><li>Ráno na stavbě klepněte na velké zelené tlačítko <b>Příchod</b>, večer na <b>Odchod</b>. Nic víc.</li><li>E-mail si nechte, odkaz otevírejte každý den odsud.</li></ol>' +
          '<p style="color:#6b7279;font-size:13px">Poloha telefonu se zjistí jen ve chvíli klepnutí, nikdy jindy. Odkaz je osobní, nikomu ho neposílejte.</p></div>');
      const opak = !!(k.pozvano || {}).mail;   // vědomé opakované poslání = nové číslo zprávy (jinak by ho Google ten den přeskočil)
      const r = await H.posliMail({komu: k.email, predmet: (POZJ === 'uk' ? 'Docházka Constructo (облік робочого часу) – ' : 'Docházka Constructo – ') + projektNazev(), html, text: txt, cid: 'doch-' + kid + '-' + den(new Date()) + (opak ? '-' + Date.now().toString(36) : '')});
      bm.disabled = false;
      if (r && r.ok) { H.toast('✓ E-mail odeslán: ' + k.email); oznac(box, k, kid, url0, 'mail'); }
      else { bm.innerHTML = '✕ Neodešlo – zkusit znovu<small>' + esc(r && r.error ? String(r.error).slice(0, 80) : 'bez signálu?') + '</small>'; bm.classList.add('dc-chyba'); }
    };
  }
  async function pozvat(kid) {
    const k = kontakty().find(x => x.kid === kid);
    if (!k) return;
    let url;
    try { url = odkazOsoby(kid, (await klic([kid]))[0]); } catch (e) { H.toast(e.message); return; }
    const d = dlg('<h3>Docházka pro: ' + esc(k.jmeno) + '</h3><p class="dc-m">' + esc([k.firma, k.funkce].filter(Boolean).join(' · ')) + '</p>' + cestyHtml(k, url));
    cestyBind(d, k, kid, url);
  }
  // 4.87: seznam pozic je společný (pc/firmy.js): základní + vlastní pozice zapsané kdekoli u osob
  const pozice = () => window.CXFirmy && CXFirmy.pozice ? CXFirmy.pozice((H && H.firmy()) || []) : FUNKCE;
  const FUNKCE = ['dělník', 'pomocný dělník', 'mistr', 'parťák', 'technik', 'stavbyvedoucí', 'elektrikář', 'instalatér', 'zedník', 'tesař', 'svářeč', 'řidič', 'jeřábník', 'brigádník'];
  // Jedno tlačítko „Pozvat do stavby“: vybrat uložené jméno (nebo zapsat novou osobu, uloží se k firmě ve Firmy / osoby na projektu)
  // a hned poslat osobní odkaz. Volá se z Docházky, z Firem (CXFirmy) i ze Správy stavby: pozvatDoStavby({jmeno, kid, po}).
  function pozvatDoStavby(o) {
    o = o || {};
    if (!H && window.CXDochPripoj) window.CXDochPripoj();
    if (!H) return;
    if (!H.smi('doch')) { H.toast('Zvát do Docházky může jen ten, kdo má právo „Vidí docházku“.'); return; }
    if (!H.pripojeno()) { H.toast('Nejdřív připojte Constructo ke Googlu (Data → Automatická synchronizace).'); return; }
    if (S.sid !== H.stavba()) { S.sid = H.stavba(); S.klice = {}; S.qr = ''; }
    const fy = (H.firmy() || []).filter(f => f && f.id).sort((a, b) => String(a.firma || '').localeCompare(String(b.firma || ''), 'cs'));
    let vyber = '';
    const ks0 = kontakty();
    if (o.kid && ks0.some(k => k.kid === o.kid)) vyber = o.kid;
    else if (o.jmeno) { const f = ks0.filter(k => fold(k.jmeno) === fold(o.jmeno)); if (f.length === 1) vyber = f[0].kid; }
    const d = dlg('<h3>Pozvat do stavby</h3><p class="dc-m">Pracovník dostane odkaz s ikonou <b>Docházka</b> do telefonu: Příchod · Pauza · Odchod.</p>' +
      '<div class="dc-pk"><label class="dc-l" for="dp-kdo">Kdo</label><div class="dc-row"><select id="dp-kdo"></select><button type="button" class="btn" id="dp-nova">+ Nová osoba</button></div></div>' +
      '<div id="dp-form" hidden class="dc-nf"><h4>Nová osoba</h4><div class="dc-g2">' +
      '<div><label class="dc-l" for="dp-j">Jméno a příjmení *</label><input id="dp-j" autocomplete="off"></div>' +
      '<div><label class="dc-l" for="dp-f">Firma *</label><select id="dp-f"><option value="">– vyberte firmu –</option><option value="+">＋ Nová firma…</option>' + fy.map(f => '<option value="' + esc(f.id) + '">' + esc(f.firma || '') + '</option>').join('') + '</select></div>' +
      '<div><label class="dc-l" for="dp-fu">Pozice</label><select id="dp-fu"><option value="">– vyberte pozici –</option><option value="+">＋ Vlastní pozice…</option>' + pozice().map(x => '<option>' + esc(x) + '</option>').join('') + '</select>' +
      '<input id="dp-fuv" hidden placeholder="Napište pozici, např. obkladač" autocomplete="off" style="margin-top:6px"></div>' +
      '<div><label class="dc-l" for="dp-t">Telefon (pro WhatsApp / SMS)</label><input id="dp-t" type="tel" placeholder="+420 …"></div>' +
      '<div><label class="dc-l" for="dp-e">E-mail</label><input id="dp-e" type="email"></div></div>' +
      '<p class="dc-m">Osoba i nová firma se uloží do <b>Firmy / osoby na projektu</b> a uvidí je všichni (Management, Deník, mobil).</p>' +
      '<div class="dc-row"><button type="button" class="btn dc-pri" id="dp-ul">Uložit a pozvat</button><button type="button" class="btn" id="dp-zr">Zrušit</button></div></div>' +
      '<div id="dp-out"></div>', 640);
    const sel = d.querySelector('#dp-kdo'), form = d.querySelector('#dp-form'), out = d.querySelector('#dp-out');
    function plnSel() {
      const ks = kontakty(), g = {};
      ks.forEach(k => (g[k.firma || 'Bez firmy'] = g[k.firma || 'Bez firmy'] || []).push(k));
      sel.innerHTML = '<option value="">– vyberte jméno –</option>' + Object.keys(g).sort((a, b) => a.localeCompare(b, 'cs')).map(f => '<optgroup label="' + esc(f) + '">' +
        g[f].sort((a, b) => a.jmeno.localeCompare(b.jmeno, 'cs')).map(k => '<option value="' + esc(k.kid) + '">' + esc(k.jmeno) + (k.funkce ? ' · ' + esc(k.funkce) : '') + '</option>').join('') + '</optgroup>').join('');
      sel.value = vyber;
    }
    async function ukaz(kid) {
      vyber = kid; out.innerHTML = '';
      const k = kontakty().find(x => x.kid === kid);
      if (!k) return;
      out.innerHTML = '<p class="dc-m">Připravuji osobní odkaz…</p>';
      let url;
      try { url = odkazOsoby(kid, (await klic([kid]))[0]); } catch (e) { out.innerHTML = '<p class="dc-err">' + esc(e.message) + '</p>'; return; }
      if (vyber !== kid) return;
      out.innerHTML = '<h4 class="dc-ph">' + esc(k.jmeno) + ' <small>' + esc([k.firma, k.funkce].filter(Boolean).join(' · ')) + '</small></h4>' + cestyHtml(k, url);
      cestyBind(out, k, kid, url);
    }
    plnSel();
    sel.onchange = () => { form.hidden = true; ukaz(sel.value); };
    d.querySelector('#dp-nova').onclick = () => { form.hidden = false; out.innerHTML = ''; sel.value = ''; vyber = ''; d.querySelector('#dp-j').value = o.jmeno && !o.kid ? o.jmeno : ''; d.querySelector('#dp-j').focus(); };
    d.querySelector('#dp-zr').onclick = () => { form.hidden = true; };
    const fuv = d.querySelector('#dp-fuv'), fsel = d.querySelector('#dp-f');
    // 4.87: nová firma se zakládá stejným oknem jako ve Firmy / osoby na projektu (IČO nebo název → ARES)
    const plnFirmy = v => { fsel.innerHTML = '<option value="">– vyberte firmu –</option><option value="+">＋ Nová firma…</option>' + (H.firmy() || []).filter(f => f && f.id).sort((a, b) => String(a.firma || '').localeCompare(String(b.firma || ''), 'cs')).map(f => '<option value="' + esc(f.id) + '">' + esc(f.firma || '') + '</option>').join(''); fsel.value = v || ''; };
    fsel.onchange = () => {
      if (fsel.value !== '+') return;
      fsel.value = '';
      if (!H.novaFirma) { H.toast('Obnovte stránku (F5).'); return; }
      H.novaFirma(id => plnFirmy(id));
    };
    d.querySelector('#dp-fu').onchange = e => { fuv.hidden = e.target.value !== '+'; if (!fuv.hidden) fuv.focus(); };
    d.querySelector('#dp-ul').onclick = async () => {
      const g = id => d.querySelector(id).value.trim();
      const j = g('#dp-j'), em = g('#dp-e');
      const fid = g('#dp-f');
      const fu = g('#dp-fu') === '+' ? g('#dp-fuv') : g('#dp-fu');
      if (!j) { H.toast('Napište jméno a příjmení.'); d.querySelector('#dp-j').focus(); return; }
      if (!fid) { H.toast('Vyberte firmu.'); d.querySelector('#dp-f').focus(); return; }
      if (g('#dp-fu') === '+' && !fu) { H.toast('Napište pozici.'); fuv.focus(); return; }
      if (em && !/^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/.test(em)) { H.toast('E-mail ' + em + ' nevypadá správně.'); return; }
      if (kontakty().some(k => k.fid === fid && fold(k.jmeno) === fold(j))) { H.toast(j + ' už u této firmy je, vyberte ho v seznamu.'); return; }
      if (!H.pridejOsobu) { H.toast('Novou osobu zapište ve Firmy / osoby na projektu.'); return; }
      const kid = 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      const ok = await H.pridejOsobu(fid, {id: kid, jmeno: j, funkce: fu, tel: g('#dp-t'), email: em, posilat: false});
      if (!ok) return;
      H.toast('Uloženo: ' + j);
      form.hidden = true; vyber = kid; plnSel();
      if (o.po) try { o.po(); } catch (e) {}
      ukaz(kid);
    };
    if (vyber) ukaz(vyber); else if (o.jmeno && !o.kid) d.querySelector('#dp-nova').click();
  }
  const tlacitkoPozvat = () => H && H.smi('doch') && !H.ro() ? '<button type="button" class="btn dc-pri dc-pozv" data-doch-pozvat="1">＋ Pozvat do stavby</button>' : '';
  async function cedule() {
    if (!S.qr) { try { await klic(['_']); } catch (e) { H.toast(e.message); return; } }
    const url = odkazQR(), nazev = String((H.projekt() || {}).name || '');
    const w = window.open('', '_blank');
    if (!w) { H.toast('Prohlížeč zablokoval nové okno. Povolte vyskakovací okna.'); return; }
    w.document.write('<!doctype html><html lang="cs"><head><meta charset="utf-8"><title>Docházka – QR cedule</title><style>@page{size:A4;margin:12mm}body{font-family:Arial,Helvetica,sans-serif;margin:0;color:#131518;text-align:center}' +
      '.h{background:#131518;color:#fff;padding:22px;border-bottom:10px solid #F4D23C}.h b{display:block;font-size:54px;letter-spacing:2px;color:#F4D23C}.h span{font-size:20px}' +
      '.q{margin:28px auto 10px}.q svg{width:330px;height:330px}.s{font-size:22px;font-weight:700;margin:0 0 20px}ol{text-align:left;display:inline-block;font-size:21px;line-height:1.5;margin:0}' +
      '.u{margin-top:22px;font-size:15px;color:#444}.p{margin-top:24px;font-size:12px;color:#777}</style></head><body>' +
      '<div class="h"><span>Constructo</span><b>DOCHÁZKA</b><span>' + esc(nazev) + '</span></div>' +
      '<div class="q">' + qrSvg(url, 330) + '</div><p class="s">Naskenujte fotoaparátem telefonu</p>' +
      '<ol><li>Vyberte své jméno (jen poprvé).</li><li>Ráno klepněte na <b>Příchod</b>, večer na <b>Odchod</b>.</li></ol>' +
      '<p class="u" style="font-size:19px;color:#131518">UA: Відскануйте QR-код камерою телефону. Виберіть своє імʼя (лише перший раз). Вранці натисніть <b>Прихід</b>, ввечері <b>Відхід</b>. Мову змінює кнопка <b>CZ | UA</b> угорі.</p>' +
      '<p class="p">Poloha telefonu se zjistí jen ve chvíli potvrzení příchodu, pauzy nebo odchodu. Vidí ji jen vedení stavby.</p></body></html>');
    w.document.close(); setTimeout(() => { try { w.focus(); w.print(); } catch (e) {} }, 400);
  }

  /* ---------- ruční oprava (zapomenutý odchod apod.) ---------- */
  function doplnit(kid0, typ0, den0) {
    const ks = kontakty(), d0 = den0 || S.den;
    const d = dlg('<h3>Doplnit záznam docházky</h3><p class="dc-m">Např. když pracovník zapomněl potvrdit odchod. U záznamu bude vidět, kdo ho doplnil.</p>' +
      '<div class="dc-form"><label>Pracovník<select id="dc-o">' + ks.map(k => '<option value="' + esc(k.kid) + '"' + (k.kid === kid0 ? ' selected' : '') + '>' + esc(k.jmeno + ' – ' + k.firma) + '</option>').join('') + '</select></label>' +
      '<label>Co<select id="dc-t">' + Object.keys(TYP).map(t => '<option value="' + t + '"' + (t === (typ0 || 'odchod') ? ' selected' : '') + '>' + TYP[t] + '</option>').join('') + '</select></label>' +
      '<label>Den<input type="date" id="dc-d" value="' + d0 + '"></label><label>Čas<input type="time" id="dc-c" value="' + (typ0 === 'prichod' ? '07:00' : '16:00') + '"></label>' +
      '<label class="w">Poznámka<input type="text" id="dc-p" maxlength="200" placeholder="např. zapomněl potvrdit odchod"></label></div>' +
      '<div class="dc-acts"><button type="button" class="btn dc-pri" id="dc-ok">Uložit</button></div>', 520);
    d.querySelector('#dc-ok').onclick = async () => {
      const k = ks.find(x => x.kid === d.querySelector('#dc-o').value), dd = d.querySelector('#dc-d').value, cc = d.querySelector('#dc-c').value;
      if (!k || !dd || !cc) return;
      const at = new Date(dd + 'T' + cc + ':00').toISOString();
      const r = {id: 'r' + Date.now().toString(36), kid: k.kid, jmeno: k.jmeno, funkce: k.funkce, firma: k.firma, fid: k.fid, typ: d.querySelector('#dc-t').value, at, pozn: d.querySelector('#dc-p').value.trim(), bezPolohy: 'doplněno ručně'};
      await uprav([r]); d.remove();
    };
  }
  async function uprav(recs) {
    const r = await H.volej({akce: 'dochazka_uprav', stavba: S.sid, kdo: H.kdo(), zaznamy: recs});
    if (!r || !r.ok) { H.toast('Nepodařilo se uložit' + (r && r.error ? ': ' + r.error : '.')); return; }
    H.toast('Uloženo'); S.rev = ''; await nacti(true);
  }

  /* ---------- vykreslení ---------- */
  function lista() {
    return '<div class="sl-top dc-top"><b>Docházka</b><span>' + (S.nacita ? 'načítám…' : S.nacteno ? 'pracovníci potvrzují v telefonu · obnovuje se samo' : '') + '</span><span class="sp" style="flex:1"></span>' + tlacitkoPozvat() +
      '<div class="seg" role="tablist">' + [['dnes', 'Den'], ['prehled', 'Přehledy a grafy'], ['archiv', 'Archiv záznamů'], ['lide', 'Pracovníci a QR']].map(([k, l]) => '<button type="button" data-dt="' + k + '" aria-pressed="' + (S.tab === k && !S.q) + '">' + l + '</button>').join('') + '</div></div>' +
      '<div class="dc-hl"><input id="dc-q" type="search" autocomplete="off" placeholder="🔍 Vyhledat osobu, firmu, pozici, telefon… (stačí část textu)" value="' + esc(S.q || '') + '">' + (S.q ? '<button type="button" class="btn" id="dc-qx">✕ Zrušit hledání</button>' : '') + '</div>';
  }
  // 4.90: Vyhledat – osoby i firmy z celého Constructa (Firmy / osoby na projektu), i podle části textu, bez háčků, s překlepem
  function vHledat() {
    const q = S.q, sedi = (...co) => H.hledej ? H.hledej(q, ...co) : co.join(' ').toLowerCase().includes(q.toLowerCase());
    const ks = kontakty().filter(k => sedi(k.jmeno, k.firma, k.funkce, k.tel, k.email));
    const fy = (H.firmy() || []).filter(f => f && f.id && sedi(f.firma, f.ico, f.zkratky, f.adresa, (window.CXFirmy ? CXFirmy.kontakty(f) : []).map(k => k.jmeno)));
    const zaz = vse().filter(x => !x.zrus), pocet = kid => zaz.filter(x => x.kid === kid).length;
    const smi = H.smi('doch') && !H.ro();
    let h = '<div class="dc-card"><h4>Osoby <small>' + ks.length + '</small></h4>';
    h += ks.length ? '<table class="dc-t"><tbody>' + ks.sort((a, b) => a.jmeno.localeCompare(b.jmeno, 'cs')).map(k => '<tr><td><b>' + esc(k.jmeno) + '</b>' + (k.funkce ? '<small>' + esc(k.funkce) + '</small>' : '') + '</td><td>' + esc(k.firma) + '</td><td>' + esc([k.tel, k.email].filter(Boolean).join(' · ')) + '</td><td>' +
      (Object.keys(k.pozvano || {}).length ? '<span class="dc-st g">pozván</span>' : '<span class="dc-npz">nepozván</span>') + '</td><td class="r">' +
      (smi ? '<button type="button" class="btn" data-hpoz="' + esc(k.kid) + '">Pozvat / odkaz</button> ' : '') + '<button type="button" class="btn" data-hzaz="' + esc(k.kid) + '">Záznamy (' + pocet(k.kid) + ')</button>' + (smi && k.fid && H.upravFirmu ? ' <button type="button" class="btn" data-hupr="' + esc(k.fid) + '">✎ Upravit</button>' : '') + '</td></tr>').join('') + '</tbody></table>' : '<p class="dc-m">Žádná osoba neodpovídá.</p>';
    h += '</div><div class="dc-card"><h4>Firmy <small>' + fy.length + '</small></h4>';
    h += fy.length ? '<table class="dc-t"><tbody>' + fy.sort((a, b) => String(a.firma).localeCompare(String(b.firma), 'cs')).map(f => { const n = (window.CXFirmy ? CXFirmy.kontakty(f) : []).length; return '<tr><td><b>' + esc(f.firma) + '</b>' + (f.ico ? '<small>IČO ' + esc(f.ico) + '</small>' : '') + '</td><td>' + n + ' ' + osob(n) + '</td><td class="r"><button type="button" class="btn" data-hfz="' + esc(f.firma) + '">Záznamy firmy</button>' + (smi && H.upravFirmu ? ' <button type="button" class="btn" data-hupr="' + esc(f.id) + '">✎ Upravit</button>' : '') + '</td></tr>'; }).join('') + '</tbody></table>' : '<p class="dc-m">Žádná firma neodpovídá.</p>';
    return h + '</div><p class="dc-m">Úpravy se ukládají do Firmy / osoby na projektu a propíšou se všude (Management, Deník, mobil).</p>';
  }
  function vDen() {
    const L = lideDne(S.den), st = stred(), dnes = den(new Date());
    const n = {prace: L.filter(x => x.stav === 'prace').length, pauza: L.filter(x => x.stav === 'pauza').length};
    const fy = {}; L.forEach(x => (fy[x.firma] = fy[x.firma] || []).push(x));
    let h = '<div class="dc-nav"><button type="button" class="btn" data-dd="-1" aria-label="Předchozí den">‹</button><b>' + dow(S.den) + ' ' + fDY(S.den) + (S.den === dnes ? ' · dnes' : '') + '</b><button type="button" class="btn" data-dd="1" aria-label="Další den"' + (S.den >= dnes ? ' disabled' : '') + '>›</button>' +
      (S.den !== dnes ? '<button type="button" class="btn" data-dd="0">Dnes</button>' : '') + '<input type="date" id="dc-den" value="' + S.den + '" max="' + dnes + '"><span style="flex:1"></span>' +
      '<button type="button" class="btn" id="dc-pdf">⬇ PDF tohoto dne</button>' + (H.smi('doch') && !H.ro() ? '<button type="button" class="btn" id="dc-dopl">+ Doplnit záznam</button>' : '') + '</div>';
    h += '<div class="dc-tiles">' + (S.den === dnes ? '<div class="dc-tile g"><b>' + n.prace + '</b>teď na stavbě</div><div class="dc-tile y"><b>' + n.pauza + '</b>na pauze</div>' : '') +
      '<div class="dc-tile"><b>' + L.length + '</b>' + osob(L.length) + ' celkem</div><div class="dc-tile"><b>' + Object.keys(fy).length + '</b>firem</div><div class="dc-tile"><b>' + hod(L.reduce((s, x) => s + x.prace, 0)) + '</b>odpracováno (h:min)</div></div>';
    if (!L.length) h += '<p class="dc-empty">' + (S.den === dnes ? 'Dnes zatím nikdo nepotvrdil příchod.' : 'Tento den nikdo docházku nepotvrdil.') + '</p>';
    Object.keys(fy).sort((a, b) => a.localeCompare(b, 'cs')).forEach(f => {
      h += '<div class="dc-firma"><h4>' + esc(f) + ' <small>' + fy[f].length + ' ' + osob(fy[f].length) + ' · ' + hod(fy[f].reduce((s, x) => s + x.prace, 0)) + ' h</small></h4><table class="dc-t"><thead><tr><th>Jméno</th><th>Stav</th><th>Příchod</th><th>Odchod</th><th class="r">Pauza</th><th class="r">Práce</th><th>Poloha při příchodu</th></tr></thead><tbody>' +
        fy[f].map(x => {
          const pr = x.ev.find(e => e.typ === 'prichod') || x.ev[0];
          const stav = x.stav === 'prace' ? (S.den === dnes ? '<span class="dc-st g">● na stavbě</span>' : '<span class="dc-st r">chybí odchod</span>') : x.stav === 'pauza' ? (S.den === dnes ? '<span class="dc-st y">● pauza</span>' : '<span class="dc-st r">chybí odchod</span>') : '<span class="dc-st">odešel</span>';
          return '<tr data-kid="' + esc(x.kid) + '" title="' + esc(x.ev.map(e => cas(e.at) + ' ' + TYP[e.typ] + (e.rucne ? ' (doplnil ' + e.rucne + ')' : '')).join(' · ')) + '"><td><b>' + esc(x.jmeno) + '</b>' + (x.funkce ? '<small>' + esc(x.funkce) + '</small>' : '') + '</td><td>' + stav +
            (x.stav && S.den !== dnes && H.smi('doch') && !H.ro() ? ' <button type="button" class="dc-lnk" data-dopl="' + esc(x.kid) + '">doplnit</button>' : '') + '</td><td>' + cas(x.prichod) + '</td><td>' + cas(x.odchod) + '</td><td class="r">' + (x.pauza ? x.pauza + ' min' : '–') + '</td><td class="r"><b>' + hod(x.prace) + '</b></td><td>' + mistoHtml(pr, st) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    });
    // 4.88: i lidé bez záznamu – aby bylo vidět, že nová firma / osoba je v Docházce (propsaná z Firem)
    const bez = kontakty().filter(k => !L.some(x => x.kid === k.kid)), fb = {};
    bez.forEach(k => (fb[k.firma || 'Bez firmy'] = fb[k.firma || 'Bez firmy'] || []).push(k));
    if (bez.length) h += '<div class="dc-card dc-bez"><h4>Bez záznamu ' + (S.den === dnes ? 'dnes' : 'tento den') + ' <small>' + bez.length + ' ' + osob(bez.length) + '</small></h4>' +
      Object.keys(fb).sort((a, b) => a.localeCompare(b, 'cs')).map(f => '<p><b>' + esc(f) + ':</b> ' + fb[f].sort((a, b) => a.jmeno.localeCompare(b.jmeno, 'cs')).map(k => esc(k.jmeno) + (k.funkce ? ' <small>(' + esc(k.funkce) + ')</small>' : '') + (Object.keys(k.pozvano || {}).length ? '' : ' <small class="dc-npz">nepozván</small>')).join(', ') + '</p>').join('') + '</div>';
    if (S.den === dnes) h += '<p class="dc-m">Každý den v 19:00 přijde vedení stavby e-mail s PDF docházky a počasím' + (S.report ? ' (naposledy ' + esc(fDY(S.report.split(' ')[0])) + ')' : '') + '.</p>';
    return h;
  }
  function obdobi() {
    const r = S.ref;
    if (S.obd === 'den') return [r, r, dow(r) + ' ' + fDY(r)];
    if (S.obd === 'tyden') { const o = plus(r, -((pd(r).getDay() + 6) % 7)); return [o, plus(o, 6), fD(o) + ' – ' + fDY(plus(o, 6))]; }
    if (S.obd === 'mesic') { const d = pd(r), o = den(new Date(d.getFullYear(), d.getMonth(), 1)), k = den(new Date(d.getFullYear(), d.getMonth() + 1, 0)); return [o, k, MES[d.getMonth()] + ' ' + d.getFullYear()]; }
    const vs = platne().map(x => den(x.at)).sort(); const o = vs[0] || den(new Date()); return [o, den(new Date()), 'celá stavba (od ' + fDY(o) + ')'];
  }
  function vPrehled() {
    const [od, dd, txt] = obdobi(), P = poDnech(od, dd), dnes = den(new Date());
    const dny = []; for (let d = od; d <= dd && dny.length < 1200; d = plus(d, 1)) dny.push(d);
    const lid = {}, fy = {}, perDen = {};
    dny.forEach(d => {
      const o = P[d] || {}; let m = 0;
      Object.keys(o).forEach(kid => {
        const ev = o[kid], z = ev[ev.length - 1], s = spocti(ev, d === dnes ? Date.now() : 0);
        m += s.prace;
        const L = lid[kid] = lid[kid] || {jmeno: z.jmeno, funkce: z.funkce || '', firma: z.firma || 'Bez firmy', dny: 0, min: 0, prich: [], chybi: 0};
        L.dny++; L.min += s.prace; if (s.prichod) { const t = new Date(s.prichod); L.prich.push(t.getHours() * 60 + t.getMinutes()); } if (s.stav && d !== dnes) L.chybi++;
        const F = fy[L.firma] = fy[L.firma] || {min: 0, lide: new Set()}; F.min += s.prace; F.lide.add(kid);
      });
      perDen[d] = {min: m, n: Object.keys(o).length};
    });
    const celk = Object.values(lid).reduce((s, x) => s + x.min, 0), aktivni = dny.filter(d => perDen[d].n).length;
    let h = '<div class="dc-nav"><div class="seg">' + [['den', 'Den'], ['tyden', 'Týden'], ['mesic', 'Měsíc'], ['vse', 'Celá stavba']].map(([k, l]) => '<button type="button" data-ob="' + k + '" aria-pressed="' + (S.obd === k) + '">' + l + '</button>').join('') + '</div>' +
      (S.obd !== 'vse' ? '<button type="button" class="btn" data-or="-1" aria-label="Předchozí">‹</button><b>' + esc(txt) + '</b><button type="button" class="btn" data-or="1" aria-label="Další">›</button>' : '<b>' + esc(txt) + '</b>') +
      '<span style="flex:1"></span><button type="button" class="btn" id="dc-csv">⬇ Tabulka pro Excel</button></div>';
    h += '<div class="dc-tiles"><div class="dc-tile"><b>' + Object.keys(lid).length + '</b>' + osob(Object.keys(lid).length) + '</div><div class="dc-tile"><b>' + Object.keys(fy).length + '</b>firem</div>' +
      '<div class="dc-tile"><b>' + hod(celk) + '</b>odpracováno (h:min)</div><div class="dc-tile"><b>' + (aktivni ? (Object.values(perDen).reduce((s, x) => s + x.n, 0) / aktivni).toFixed(1).replace('.', ',') : '0') + '</b>průměrně lidí za den</div></div>';
    if (!Object.keys(lid).length) return h + '<p class="dc-empty">V tomto období nikdo docházku nepotvrdil.</p>';
    if (dny.length > 1) {
      // sloupce po dnech (u celé stavby po týdnech, ať jsou čitelné)
      let body = dny.map(d => ({k: d, l: dny.length <= 31 ? (dny.length <= 7 ? dow(d) + ' ' + fD(d) : String(pd(d).getDate())) : '', min: perDen[d].min, n: perDen[d].n, t: dow(d) + ' ' + fDY(d)}));
      if (dny.length > 62) { const t = {}; body.forEach(x => { const o = plus(x.k, -((pd(x.k).getDay() + 6) % 7)); const T = t[o] = t[o] || {k: o, l: '', min: 0, n: 0, nd: 0, t: 'týden od ' + fDY(o)}; T.min += x.min; T.n += x.n; T.nd += x.n ? 1 : 0; }); body = Object.values(t).map(x => Object.assign(x, {n: x.nd ? Math.round(x.n / x.nd * 10) / 10 : 0})); }
      const val = x => S.graf === 'hod' ? x.min / 60 : x.n, mx = Math.max(1, ...body.map(val)), W = 760, Hh = 200, bw = W / body.length, krok = mx <= 10 ? 2 : mx <= 50 ? 10 : mx <= 200 ? 50 : 100, top = Math.ceil(mx / krok) * krok;
      let g = '';
      for (let y = 0; y <= top; y += krok) { const yy = Hh - y / top * Hh; g += '<line x1="0" x2="' + W + '" y1="' + yy + '" y2="' + yy + '" class="gl"/><text x="-6" y="' + (yy + 4) + '" class="ax" text-anchor="end">' + y + '</text>'; }
      body.forEach((x, i) => {
        const v = val(x), hgt = v / top * Hh, bx = i * bw + Math.max(1, bw * .15), w = Math.max(2, bw * .7);
        g += '<g class="bar" data-tip="' + esc(x.t + ': ' + (S.graf === 'hod' ? hod(x.min) + ' h' : x.n + ' ' + osob(Math.round(x.n)) + (dny.length > 62 ? ' průměrně za den' : ''))) + '"><rect x="' + (i * bw) + '" y="0" width="' + bw + '" height="' + (Hh + 20) + '" fill="transparent"/>' +
          (hgt > 0 ? '<path d="M' + bx + ' ' + Hh + 'V' + (Hh - hgt + Math.min(4, hgt)) + 'q0 -' + Math.min(4, hgt) + ' ' + Math.min(4, w / 2) + ' -' + Math.min(4, hgt) + 'H' + (bx + w - Math.min(4, w / 2)) + 'q' + Math.min(4, w / 2) + ' 0 ' + Math.min(4, w / 2) + ' ' + Math.min(4, hgt) + 'V' + Hh + 'Z" class="bm"/>' : '') +
          (x.l ? '<text x="' + (i * bw + bw / 2) + '" y="' + (Hh + 16) + '" class="ax" text-anchor="middle">' + esc(x.l) + '</text>' : '') + '</g>';
      });
      h += '<div class="dc-card"><div class="dc-ch"><h4>' + (S.graf === 'hod' ? 'Odpracované hodiny' : 'Počet lidí na stavbě') + (dny.length > 62 ? ' po týdnech' : ' po dnech') + '</h4><div class="seg"><button type="button" data-gr="hod" aria-pressed="' + (S.graf === 'hod') + '">Hodiny</button><button type="button" data-gr="lide" aria-pressed="' + (S.graf === 'lide') + '">Lidé</button></div></div>' +
        '<svg class="dc-svg" viewBox="-34 -8 ' + (W + 40) + ' ' + (Hh + 30) + '" role="img" aria-label="Graf docházky">' + g + '</svg><div class="dc-tip" hidden></div></div>';
    }
    // firmy: vodorovné pruhy (délka = hodiny)
    const fk = Object.keys(fy).sort((a, b) => fy[b].min - fy[a].min), fmx = Math.max(1, ...fk.map(f => fy[f].min));
    h += '<div class="dc-card"><h4>Hodiny podle firem</h4><div class="dc-hb">' + fk.map(f => '<div class="r"><span class="n">' + esc(f) + '<small>' + fy[f].lide.size + ' ' + osob(fy[f].lide.size) + '</small></span><span class="b"><i style="width:' + Math.max(1, fy[f].min / fmx * 100) + '%"></i></span><b>' + hod(fy[f].min) + ' h</b></div>').join('') + '</div></div>';
    const prum = a => { if (!a.length) return '–'; const m = Math.round(a.reduce((s, x) => s + x, 0) / a.length); return Math.floor(m / 60) + ':' + pad(m % 60); };
    h += '<div class="dc-card"><h4>Lidé</h4><table class="dc-t"><thead><tr><th>Jméno</th><th>Firma</th><th class="r">Dní</th><th class="r">Odpracováno</th><th class="r">Průměr za den</th><th class="r">Obvyklý příchod</th><th>Pozor</th></tr></thead><tbody>' +
      Object.keys(lid).sort((a, b) => (lid[a].firma + lid[a].jmeno).localeCompare(lid[b].firma + lid[b].jmeno, 'cs')).map(k => { const x = lid[k]; return '<tr><td><b>' + esc(x.jmeno) + '</b>' + (x.funkce ? '<small>' + esc(x.funkce) + '</small>' : '') + '</td><td>' + esc(x.firma) + '</td><td class="r">' + x.dny + '</td><td class="r"><b>' + hod(x.min) + '</b></td><td class="r">' + hod(Math.round(x.min / x.dny)) + '</td><td class="r">' + prum(x.prich) + '</td><td>' + (x.chybi ? '<span class="dc-st r">' + x.chybi + '× chybí odchod</span>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div>';
    S._csv = {od, dd, P, dny};
    return h;
  }
  function csv() {
    const {P, dny, od, dd} = S._csv || {}; if (!P) return;
    const dnes = den(new Date()), rows = [['Datum', 'Den', 'Firma', 'Jméno', 'Funkce', 'Příchod', 'Odchod', 'Pauza (min)', 'Odpracováno (h)', 'Poznámka']];
    dny.forEach(d => Object.keys(P[d] || {}).forEach(kid => { const ev = P[d][kid], z = ev[ev.length - 1], s = spocti(ev, d === dnes ? Date.now() : 0); rows.push([fDY(d), dow(d), z.firma, z.jmeno, z.funkce || '', cas(s.prichod), s.odchod ? cas(s.odchod) : '', s.pauza, (s.prace / 60).toFixed(2).replace('.', ','), s.stav && d !== dnes ? 'chybí odchod' : '']); }));
    const t = '﻿' + rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(';')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([t], {type: 'text/csv;charset=utf-8'})); a.download = 'dochazka-' + od + '-az-' + dd + '.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  function vArchiv() {
    const st = stred(), f = S.f, ks = [...new Map(vse().map(x => [x.kid, x])).values()];
    const firmy = [...new Set(ks.map(x => x.firma || 'Bez firmy'))].sort((a, b) => a.localeCompare(b, 'cs'));
    const L = vse().filter(x => (!f.firma || (x.firma || 'Bez firmy') === f.firma) && (!f.osoba || x.kid === f.osoba) && (!f.od || den(x.at) >= f.od) && (!f.do || den(x.at) <= f.do) && (f.zrus || !x.zrus)).sort((a, b) => a.at < b.at ? 1 : -1);
    const smi = H.smi('doch') && !H.ro();
    let h = '<div class="dc-nav dc-fil"><select id="af-f"><option value="">Všechny firmy</option>' + firmy.map(x => '<option' + (x === f.firma ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select>' +
      '<select id="af-o"><option value="">Všichni lidé</option>' + ks.filter(x => !f.firma || (x.firma || 'Bez firmy') === f.firma).sort((a, b) => a.jmeno.localeCompare(b.jmeno, 'cs')).map(x => '<option value="' + esc(x.kid) + '"' + (x.kid === f.osoba ? ' selected' : '') + '>' + esc(x.jmeno) + '</option>').join('') + '</select>' +
      '<label>od <input type="date" id="af-od" value="' + f.od + '"></label><label>do <input type="date" id="af-do" value="' + f.do + '"></label><label class="chk"><input type="checkbox" id="af-z"' + (f.zrus ? ' checked' : '') + '> i zrušené</label>' +
      '<span style="flex:1"></span><span class="dc-m">' + L.length + ' záznamů</span>' + (smi ? '<button type="button" class="btn" id="dc-dopl">+ Doplnit záznam</button>' : '') + '</div>';
    if (!L.length) return h + '<p class="dc-empty">Žádné záznamy.</p>';
    let dPred = '';
    h += '<table class="dc-t dc-arch"><thead><tr><th>Čas</th><th>Co</th><th>Jméno</th><th>Firma</th><th>Poloha</th><th>Poznámka</th>' + (smi ? '<th></th>' : '') + '</tr></thead><tbody>' +
      L.slice(0, S.archN).map(x => { const d = den(x.at), hl = d !== dPred ? '<tr class="dh"><td colspan="' + (smi ? 7 : 6) + '">' + dow(d) + ' ' + fDY(d) + '</td></tr>' : ''; dPred = d;
        return hl + '<tr class="' + (x.zrus ? 'zr' : '') + '"><td><b>' + cas(x.at) + '</b></td><td><span class="dc-typ ' + x.typ + '">' + esc(TYP[x.typ] || x.typ) + '</span></td><td>' + esc(x.jmeno) + (x.funkce ? '<small>' + esc(x.funkce) + '</small>' : '') + '</td><td>' + esc(x.firma) + '</td><td>' + (x.rucne ? '<span class="dc-np">doplnil ' + esc(x.rucne) + '</span>' : mistoHtml(x, st)) + '</td><td>' + esc([x.pozn, x.zrus ? 'zrušeno (' + (x.upravil || '') + ')' : ''].filter(Boolean).join(' · ')) + '</td>' +
          (smi ? '<td><button type="button" class="dc-lnk" data-zr="' + esc(x.id) + '">' + (x.zrus ? 'obnovit' : 'zrušit') + '</button></td>' : '') + '</tr>'; }).join('') + '</tbody></table>' +
      (L.length > S.archN ? '<button type="button" class="btn" id="af-vic" style="margin:10px 0">Zobrazit dalších 200</button>' : '');
    return h;
  }
  function vLide() {
    const ks = kontakty(), posl = {};
    vse().forEach(x => { if (!x.zrus && (!posl[x.kid] || posl[x.kid] < x.at)) posl[x.kid] = x.at; });
    const fy = {}; ks.forEach(k => (fy[k.firma || 'Bez firmy'] = fy[k.firma || 'Bez firmy'] || []).push(k));
    let h = '<div class="dc-card dc-ced"><div><h4>QR cedule u vstupu na stavbu</h4><p>Vytiskněte ji a pověste u vstupu. Pracovník ji naskenuje <b>jen jednou</b>: vybere svou firmu a jméno a přidá si ikonu Docházka na plochu. Pak už QR nepotřebuje.</p>' +
      '<p class="dc-m">Vybírat jde jen z lidí zapsaných u firem ve <b>Firmy / osoby na projektu</b>.</p><button type="button" class="btn dc-pri" id="dc-ced">🖨 Vytisknout QR ceduli (A4)</button></div>' +
      (S.qr ? '<div class="dc-qr sm">' + qrSvg(odkazQR(), 150) + '</div>' : '') + '</div>';
    h += '<div class="dc-card"><h4>Osobní odkaz pro každého pracovníka</h4><p class="dc-m">Pro toho, kdo nebude u cedule: pošlete mu odkaz e-mailem, WhatsAppem nebo SMS z vlastního telefonu (vše zdarma).</p>' + (tlacitkoPozvat() ? '<p>' + tlacitkoPozvat() + ' <span class="dc-m">vyberete jméno, nebo zapíšete novou osobu</span></p>' : '');
    if (!ks.length) h += '<p class="dc-empty">Zatím žádní pracovníci. Zapíšete je ve <b>Firmy / osoby na projektu</b> u každé firmy (jméno, funkce, telefon, e-mail).</p>';
    Object.keys(fy).sort((a, b) => a.localeCompare(b, 'cs')).forEach(f => {
      h += '<h5 class="dc-fh">' + esc(f) + '</h5><table class="dc-t"><tbody>' + fy[f].sort((a, b) => a.jmeno.localeCompare(b.jmeno, 'cs')).map(k => '<tr><td><b>' + esc(k.jmeno) + '</b>' + (k.funkce ? '<small>' + esc(k.funkce) + '</small>' : '') + '</td><td>' + esc(k.tel || '') + (k.email ? '<small>' + esc(k.email) + '</small>' : '') + '</td><td>' + (posl[k.kid] ? 'naposledy ' + fDY(den(posl[k.kid])) + ' ' + cas(posl[k.kid]) : '<span class="dc-np">zatím nepoužil</span>') + '</td><td class="r"><button type="button" class="btn" data-doch-k="' + esc(k.kid) + '">Poslat docházku</button></td></tr>').join('') + '</tbody></table>';
    });
    return h + '</div>';
  }

  function obnov() {
    if (!EL || !EL.isConnected || !EL.querySelector('.dc')) return;
    const box = EL.querySelector('.dc');
    const y = window.scrollY;
    let h = lista();
    if (S.chyba) h += '<p class="dc-err">' + esc(S.chyba) + '</p>';
    if (!S.nacteno && S.tab !== 'lide') h += '<p class="dc-empty">' + (S.nacita ? 'Načítám docházku z Googlu…' : 'Docházka zatím není načtená.') + '</p>';
    else h += '<div class="dc-body">' + (S.q ? vHledat() : S.tab === 'dnes' ? vDen() : S.tab === 'prehled' ? vPrehled() : S.tab === 'archiv' ? vArchiv() : vLide()) + '</div>';
    const fq = document.activeElement && document.activeElement.id === 'dc-q';
    box.innerHTML = h;
    window.scrollTo(0, y);
    if (fq) { const i = box.querySelector('#dc-q'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
  }
  function vykresli(el) {
    EL = el;
    const sid = H.stavba();
    if (sid !== S.sid) { S.sid = sid; S.data = {}; S.mr = {}; S.rev = ''; S.qr = ''; S.nacteno = false; S.klice = {}; zPameti(); }
    el.innerHTML = '<div class="sl dc"></div>';
    obnov(); nacti(S.nacteno);
  }

  /* ---------- události (delegovaně, i tlačítko „Poslat docházku“ v panelu Firmy) ---------- */
  document.addEventListener('click', e => {
    const pz = e.target.closest('[data-doch-pozvat]');
    if (pz) { e.preventDefault(); pozvatDoStavby({}); return; }
    const pk = e.target.closest('[data-doch-k]');
    if (pk && H) { e.preventDefault(); pozvat(pk.dataset.dochK); return; }
    if (!EL || !e.target.closest('.dc')) return;
    const t = e.target.closest('button, [data-tip]'); if (!t) return;
    if (t.dataset.dt) { S.tab = t.dataset.dt; S.q = ''; obnov(); return; }
    if (t.id === 'dc-qx') { S.q = ''; obnov(); return; }
    if (t.dataset.hpoz) { pozvatDoStavby({kid: t.dataset.hpoz, po: obnov}); return; }
    if (t.dataset.hzaz) { S.q = ''; S.tab = 'archiv'; S.f = Object.assign({}, S.f, {firma: '', osoba: t.dataset.hzaz, od: '', do: ''}); obnov(); return; }
    if (t.dataset.hfz) { S.q = ''; S.tab = 'archiv'; S.f = Object.assign({}, S.f, {firma: t.dataset.hfz, osoba: '', od: '', do: ''}); obnov(); return; }
    if (t.dataset.hupr) { H.upravFirmu(t.dataset.hupr, obnov); return; }
    if (t.dataset.dd !== undefined) { S.den = t.dataset.dd === '0' ? den(new Date()) : plus(S.den, Number(t.dataset.dd)); obnov(); return; }
    if (t.dataset.ob) { S.obd = t.dataset.ob; obnov(); return; }
    if (t.dataset.or) { const n = Number(t.dataset.or); S.ref = S.obd === 'den' ? plus(S.ref, n) : S.obd === 'tyden' ? plus(S.ref, 7 * n) : den(new Date(pd(S.ref).getFullYear(), pd(S.ref).getMonth() + n, 1)); obnov(); return; }
    if (t.dataset.gr) { S.graf = t.dataset.gr; obnov(); return; }
    if (t.dataset.dopl) { doplnit(t.dataset.dopl, 'odchod', S.den); return; }
    if (t.dataset.zr) { const x = vse().find(r => r.id === t.dataset.zr); if (x) uprav([Object.assign({}, x, {zrus: !x.zrus})]); return; }
    if (t.id === 'dc-dopl') { doplnit('', 'odchod', S.tab === 'dnes' ? S.den : den(new Date())); return; }
    if (t.id === 'dc-ced') { cedule(); return; }
    if (t.id === 'dc-csv') { csv(); return; }
    if (t.id === 'af-vic') { S.archN += 200; obnov(); return; }
    if (t.id === 'dc-pdf') {
      t.disabled = true; t.textContent = 'Připravuji PDF…';
      H.volej({akce: 'dochazka_pdf', stavba: S.sid, den: S.den}).then(r => {
        if (!r || !r.pdf) { H.toast(r && r.error ? r.error : 'PDF se nepodařilo vytvořit.'); return; }
        const b = Uint8Array.from(atob(r.pdf), c => c.charCodeAt(0)), a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([b], {type: 'application/pdf'})); a.download = r.jmeno || 'dochazka.pdf'; a.click();
      }).catch(er => H.toast(er.message)).finally(() => obnov());
    }
  });
  let qT = 0;
  document.addEventListener('input', e => {
    if (!EL || e.target.id !== 'dc-q' || !e.target.closest('.dc')) return;
    clearTimeout(qT); const v = e.target.value; qT = setTimeout(() => { S.q = v.trim(); obnov(); }, 200);
  });
  document.addEventListener('change', e => {
    if (!EL || !e.target.closest('.dc')) return;
    const t = e.target;
    if (t.id === 'dc-den' && t.value) { S.den = t.value; obnov(); }
    if (t.id === 'af-f') { S.f.firma = t.value; S.f.osoba = ''; obnov(); }
    if (t.id === 'af-o') { S.f.osoba = t.value; obnov(); }
    if (t.id === 'af-od') { S.f.od = t.value; obnov(); }
    if (t.id === 'af-do') { S.f.do = t.value; obnov(); }
    if (t.id === 'af-z') { S.f.zrus = t.checked; obnov(); }
  });
  // popisek grafu při najetí myší
  document.addEventListener('mousemove', e => {
    const tip = EL && EL.querySelector('.dc-tip'); if (!tip) return;
    const b = e.target.closest && e.target.closest('.dc-svg .bar');
    EL.querySelectorAll('.dc-svg .bar.on').forEach(x => { if (x !== b) x.classList.remove('on'); });
    if (!b) { tip.hidden = true; return; }
    b.classList.add('on'); tip.hidden = false; tip.textContent = b.dataset.tip;
    const r = tip.parentElement.getBoundingClientRect(); tip.style.left = Math.min(r.width - 180, Math.max(0, e.clientX - r.left + 12)) + 'px'; tip.style.top = (e.clientY - r.top - 34) + 'px';
  });
  setInterval(() => { if (EL && EL.isConnected && EL.querySelector('.dc') && !document.hidden) nacti(true); }, 60000);

  const css = document.createElement('style');
  css.textContent = `
.dc .dc-top .seg button{font-weight:600}
.dc-body{padding:12px 14px 18px}
.dc-nav{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px}.dc-nav b{font-size:16px}.dc-nav input,.dc-nav select{font:inherit;padding:5px 8px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--ink)}
.dc-fil label{display:flex;gap:4px;align-items:center;font-size:13px;color:var(--muted)}
.dc-tiles{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px}
.dc-tile{background:var(--soft);border-radius:10px;padding:10px 16px;min-width:130px;font-size:13px;color:var(--muted)}.dc-tile b{display:block;font-size:28px;line-height:1.1;color:var(--ink);font-weight:800}
.dc-tile.g{background:var(--good-soft)}.dc-tile.g b{color:var(--good)}.dc-tile.y{background:#fff4bf}
.dc-map.ok{color:#1f7a3d;font-weight:600}.dc-hl{display:flex;gap:8px;margin:10px 0 0}.dc-hl input{flex:1;min-width:0;font:inherit;font-size:16px;padding:10px 12px;border-radius:10px;border:1px solid var(--line,#d9dcdf);background:var(--card,#fff);color:inherit}.dc-t td.r .btn{margin:2px 0}.dc-bez p{margin:4px 0;font-size:14px;color:var(--muted,#6b7279)}.dc-bez p b{color:var(--ink,#131518)}.dc-npz{color:#b42318}.dc-firma{margin-bottom:16px}.dc-firma h4,.dc-card h4{margin:0 0 6px;font-size:16px}.dc-firma h4 small{font-weight:500;color:var(--muted);font-size:13px;margin-left:6px}
.dc-t{width:100%;border-collapse:collapse;font-size:14px}.dc-t th{text-align:left;font-size:11.5px;text-transform:uppercase;letter-spacing:.03em;color:var(--muted);padding:6px 8px;border-bottom:2px solid var(--line);font-weight:700}
.dc-t td{padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:top}.dc-t td small{display:block;color:var(--muted);font-size:12px}.dc-t .r{text-align:right}
.dc-arch tr.dh td{background:var(--soft);font-weight:800;font-size:13px}.dc-arch tr.zr td{color:var(--muted);text-decoration:line-through}
.dc-st{font-weight:700;font-size:13px;color:var(--muted)}.dc-st.g{color:var(--good)}.dc-st.y{color:var(--warn)}.dc-st.r{color:var(--bad)}
.dc-typ{display:inline-block;font-size:12px;font-weight:800;padding:2px 9px;border-radius:12px;background:var(--soft)}.dc-typ.prichod{background:var(--good-soft);color:var(--good)}.dc-typ.odchod{background:#131518;color:#fff}.dc-typ.pauza,.dc-typ.konec{background:#fff4bf;color:#6b5200}
.dc-map{font-size:13px;text-decoration:none}.dc-map.far{color:var(--bad);font-weight:700}.dc-np{font-size:12.5px;color:var(--muted)}
.dc-lnk{border:0;background:none;color:var(--info);text-decoration:underline;font:inherit;font-size:13px;padding:0;cursor:pointer}
.dc-empty{padding:18px 4px;color:var(--muted);font-size:15px}.dc-err{margin:10px 14px 0;padding:10px 12px;background:var(--bad-soft);color:var(--bad);border-radius:8px;font-weight:600}
.dc-m{color:var(--muted);font-size:13px}
.dc-card{border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-bottom:14px;position:relative;background:var(--panel)}
.dc-ch{display:flex;align-items:center;gap:10px;justify-content:space-between;margin-bottom:6px}
.dc-svg{width:100%;height:auto;display:block}.dc-svg .gl{stroke:var(--line);stroke-width:1}.dc-svg .ax{font-size:11px;fill:var(--muted)}.dc-svg .bm{fill:var(--ink)}.dc-svg .bar.on .bm{fill:#d4a900}
.dc-tip{position:absolute;pointer-events:none;background:#131518;color:#fff;font-size:13px;padding:5px 9px;border-radius:6px;white-space:nowrap;z-index:3}
.dc-hb .r{display:grid;grid-template-columns:minmax(120px,220px) 1fr 70px;gap:10px;align-items:center;padding:5px 0}.dc-hb .n{font-weight:700;font-size:14px}.dc-hb .n small{display:block;font-weight:400;color:var(--muted);font-size:12px}
.dc-hb .b{background:var(--soft);border-radius:4px;height:16px;overflow:hidden}.dc-hb .b i{display:block;height:100%;background:var(--ink);border-radius:0 4px 4px 0}.dc-hb b{text-align:right;font-size:14px}
.dc-ced{display:flex;gap:18px;align-items:center;justify-content:space-between;flex-wrap:wrap}.dc-ced p{margin:4px 0 10px;max-width:640px}
.dc-qr{display:flex;flex-direction:column;align-items:center;gap:6px}.dc-qr svg{width:220px;height:220px}.dc-qr.sm svg{width:130px;height:130px}.dc-qr small{color:var(--muted);font-size:12px;text-align:center;max-width:220px}
.dc-fh{margin:14px 0 4px;font-size:14px}
.dc-bg{position:fixed;inset:0;background:rgba(19,21,24,.5);display:flex;align-items:center;justify-content:center;z-index:400;padding:16px}
.dc-dlg{background:var(--panel);color:var(--ink);border-radius:14px;padding:22px;max-width:680px;width:100%;max-height:92vh;overflow:auto;position:relative}
.dc-dlg h3{margin:0 0 4px;font-size:21px;padding-right:110px}.dc-x{position:absolute;top:14px;right:14px;border:1px solid var(--line);background:var(--panel);border-radius:8px;padding:6px 12px;font-weight:700;cursor:pointer;color:var(--ink)}
.dc-jaz{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:10px 0 0}.dc-jaz span{font-weight:700;font-size:14px}.dc-jaz .btn{padding:7px 14px;font-size:15px}.dc-jaz .btn.dc-on{background:var(--ink);color:#fff;border-color:var(--ink)}
.dc-poz{display:flex;gap:20px;flex-wrap:wrap;margin:14px 0}.dc-cesty{display:flex;flex-direction:column;gap:8px;flex:1;min-width:220px}.dc-cesty .btn{text-align:left;display:flex;flex-direction:column;align-items:flex-start;padding:10px 14px;font-size:15px;text-decoration:none}.dc-cesty .btn small{display:block;font-weight:400;font-size:12px;opacity:.8}
.dc-form{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0}.dc-form label{display:flex;flex-direction:column;gap:4px;font-size:13px;font-weight:600}.dc-form .w{grid-column:1/-1}.dc-form select,.dc-form input{font:inherit;padding:8px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--ink)}
.dc-pri{background:#131518!important;color:#fff!important;border-color:#131518!important;font-weight:700}.dc-pri::before{display:none!important}
.dc-chip{border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:14px;padding:2px 10px;font:600 12px var(--f-body);cursor:pointer;margin-left:6px;vertical-align:middle}.dc-chip:hover{border-color:var(--ink)}
.dc-acts{display:flex;gap:8px;justify-content:flex-end}
.dc-l{display:block;font-size:12px;font-weight:700;color:var(--muted,#6b7279);margin:0 0 4px}.dc-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.dc-row select{flex:1;min-width:220px;font:inherit;font-size:16px;padding:10px;border-radius:10px;border:1px solid var(--line,#d9dcdf);background:var(--card,#fff);color:inherit}
.dc-g2s{grid-column:1/-1;margin:0;padding:10px;border-radius:10px;background:rgba(244,210,60,.12)}.dc-g2s>div{margin-bottom:8px}.dc-g2s input{width:100%;box-sizing:border-box;font:inherit;font-size:15px;padding:9px 10px;border-radius:10px;border:1px solid var(--line,#d9dcdf)}.dc-g2 #dp-fuv{width:100%}.dc-nf{margin:14px 0;padding:14px;border:1px solid var(--line,#d9dcdf);border-radius:12px}.dc-nf h4{margin:0 0 10px}.dc-g2{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px}.dc-g2 input,.dc-g2 select{width:100%;box-sizing:border-box;font:inherit;font-size:15px;padding:9px 10px;border-radius:9px;border:1px solid var(--line,#d9dcdf);background:var(--card,#fff);color:inherit}
.dc-uz{background:#dcefe3;color:#1d5e37;border-radius:10px;padding:10px 14px;font-weight:700;font-size:14.5px;margin:12px 0 0}.dc-cesty .btn.dc-hotovo{background:#dcefe3!important;color:#1d5e37!important;border-color:#2f8a52!important}.dc-cesty .btn.dc-chyba{background:#fdeae6!important;color:#b3261e!important}
.dc-ph{margin:16px 0 0}.dc-ph small{font-weight:400;color:var(--muted,#6b7279)}.dc-wa{background:#25D366!important;color:#fff!important;border-color:#25D366!important}.dc-pozv{white-space:nowrap;margin-right:8px}.dc-pozv::before{display:none!important}
@media (max-width:700px){.dc-g2{grid-template-columns:1fr}}
@media (max-width:700px){.dc-t th:nth-child(7),.dc-t td:nth-child(7){display:none}.dc-form{grid-template-columns:1fr}}
`;
  document.head.appendChild(css);

  window.CXDochazka = {
    pripoj: h => { H = h; },
    vykresli, obnov: () => { obnov(); nacti(true); },
    // tlačítko u pracovníka v panelu Firmy / osoby na projektu (klik obslouží CXDochazka sám)
    tlacitko: (firma, k) => H && H.smi('doch') && k && k.id && k.jmeno ? '<button type="button" class="dc-chip" data-doch-k="' + esc(k.id) + '" title="Poslat pracovníkovi odkaz na Docházku">⏱ Docházka</button>' : '',
    pozvat, pozvatDoStavby, tlacitkoPozvat, cedule, spocti, verze: '1.7'
  };
})();
