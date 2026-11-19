/* Constructo – Rozpočet a Fakturace (Management /pc/, záložka Rozpočet, od 4.55)
   - import rozpočtu z Excelu (i 40 000 řádků, včetně řádků skrytých v Excelu – jdou rozbalit a znovu schovat)
   - samo pozná sloupce (číslo položky, kód, popis, MJ, množství, jednotková cena, celkem) podle názvů i podle obsahu,
     přiřazení jde ručně opravit
   - členění podle objektů (A–G …) a podle druhu prací (Střecha, Okna …), návrh položek podle slov a kódů ÚRS
   - fakturace z rozpočtu: čerpáno / zbývá, upozornění na překročené množství, jinou cenu a položky mimo rozpočet
   Data: řádky rozpočtu jsou jako jeden zkomprimovaný soubor na Disku Google (skript Google, akce dok_*) a v prohlížeči
   (IndexedDB) – do běžné synchronizace nejdou, aby ji nezahltily. Synchronizují se jen malé záznamy:
   D.rozpocty (seznam rozpočtů + přiřazení objektů), D.rozpKat (druhy prací + vybrané položky), D.faktury (fakturace). */
(() => {
  'use strict';
  const SKRIPT_MIN = 14;                      // skript Google od verze 14 zná kolekce rozpocty / rozpKat / faktury
  const KUS = 5 * 1024 * 1024;
  const ROWH = 30;
  const OBJEKTY = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'Dvory', 'Společné'];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const bezDia = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const norm = s => bezDia(s).replace(/[\[\]\(\)\{\}:;"'`´]/g, ' ').replace(/\s+/g, ' ').trim();
  const EPS = 1e-6;
  const nf2 = new Intl.NumberFormat('cs-CZ', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const nf0 = new Intl.NumberFormat('cs-CZ', {maximumFractionDigits: 0});
  const nf3 = new Intl.NumberFormat('cs-CZ', {maximumFractionDigits: 3});
  const kc = v => v == null || isNaN(v) ? '' : nf2.format(v);
  const kc0 = v => v == null || isNaN(v) ? '' : nf0.format(v) + ' Kč';
  const mnT = v => v == null || isNaN(v) ? '' : nf3.format(v);
  const pct = (a, b) => b > EPS ? Math.round(a / b * 100) : 0;
  const pam = k => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
  const pamSet = (k, v) => { try { localStorage.setItem(k, String(v)); } catch (e) {} };
  const sloupec = i => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  // číslo z buňky: 1 234,50 / 1.234,50 / 1,234.50 / "12 m2" ne
  function cislo(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (v == null) return null;
    let s = String(v).replace(/[\s ]/g, '').replace(/(Kč|CZK|,-)$/i, '');
    if (!s || !/^[-+]?[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
    if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    else if (s.includes(',')) s = (s.match(/,/g).length > 1 ? s.replace(/,/g, '') : s.replace(',', '.'));
    else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
    const n = Number(s); return isFinite(n) ? n : null;
  }
  const txt = v => v == null ? '' : typeof v === 'number' ? String(v) : String(v).replace(/\s+/g, ' ').trim();
  function hash(s) { let h1 = 0x811c9dc5, h2 = 0x12345; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 2246822519) + 7; } return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36).slice(0, 3); }

  /* ---------- styl ---------- */
  const CSS = `
.rz{display:flex;flex-direction:column;gap:12px}
.rz-top{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.rz-top .sp{flex:1}
.rz-top h2{font-size:19px;margin:0}
.rz-btn{display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:14px;font-weight:700;border:1px solid var(--line);border-radius:10px;padding:8px 13px;background:var(--panel);color:var(--ink);cursor:pointer;white-space:nowrap}
.rz-btn:hover{border-color:var(--ink)}.rz-btn.zl{background:#F4D23C;border-color:#F4D23C;color:#16191c}.rz-btn.cr{background:#16191c;border-color:#16191c;color:#fff}
.rz-btn.mini{font-size:12.5px;padding:5px 9px;font-weight:600;border-radius:8px}.rz-btn[disabled]{opacity:.45;cursor:default}
.rz-btn.del{color:var(--bad)}
.rz-sel,.rz-q,.rz-in{font:inherit;font-size:14px;border:1px solid var(--line);border-radius:10px;padding:7px 10px;background:var(--panel);color:var(--ink)}
.rz-q{min-width:240px;flex:1;max-width:420px}
.rz-sum{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;background:var(--line);border:1px solid var(--line);border-radius:12px;overflow:hidden}
.rz-sum>div{background:var(--panel);padding:10px 14px}.rz-sum .k{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:700}
.rz-sum .v{font-size:19px;font-weight:800;white-space:nowrap}.rz-sum .v small{font-size:12px;color:var(--muted);font-weight:600;margin-left:4px}
.rz-bar{height:7px;border-radius:4px;background:var(--soft);overflow:hidden;margin-top:6px}.rz-bar i{display:block;height:100%;background:#2f7d4f}.rz-bar i.nad{background:var(--bad)}
.rz-tabs{display:flex;gap:6px;flex-wrap:wrap;border-bottom:2px solid var(--ink);padding-bottom:0}
.rz-tabs button{font:inherit;font-size:15px;font-weight:700;border:1px solid var(--line);border-bottom:0;border-radius:10px 10px 0 0;background:var(--soft);color:var(--ink);padding:8px 16px;cursor:pointer;margin-bottom:-2px}
.rz-tabs button[aria-pressed=true]{background:#16191c;color:#fff;border-color:#16191c}
.rz-tabs button b{display:inline-grid;place-items:center;min-width:20px;height:20px;border-radius:10px;background:#F4D23C;color:#16191c;font-size:12px;margin-left:6px;padding:0 5px}
.rz-tabs button b.cerv{background:var(--bad);color:#fff}
.rz-fil{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.rz-seg{display:inline-flex;border:1px solid var(--line);border-radius:10px;overflow:hidden}
.rz-seg button{font:inherit;font-size:13.5px;font-weight:600;border:0;border-right:1px solid var(--line);background:var(--panel);color:var(--ink);padding:7px 11px;cursor:pointer}
.rz-seg button:last-child{border-right:0}.rz-seg button[aria-pressed=true]{background:#16191c;color:#fff}
.rz-chk{display:inline-flex;gap:6px;align-items:center;font-size:13.5px;cursor:pointer}
.rz-vyber{display:flex;flex-wrap:wrap;gap:8px;align-items:center;background:#FFF4BF;border:1px solid #f0d36a;border-radius:10px;padding:7px 12px;font-size:14px;color:#16191c}
.rz-tab{border:1px solid var(--line);border-radius:12px;background:var(--panel);overflow:auto;position:relative;height:calc(100vh - 150px);min-height:420px}
.rz-hd,.rz-r{display:grid;grid-template-columns:26px 24px 44px 100px minmax(200px,1fr) 44px 86px 92px 110px 38px 106px 106px 24px;gap:6px;align-items:center;padding:0 6px;min-width:1080px}
.rz-hd{position:sticky;top:0;z-index:2;background:var(--panel);border-bottom:1px solid var(--line);height:34px;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);font-weight:700}
.rz-r{position:absolute;left:0;right:0;height:${ROWH}px;font-size:13.5px;border-bottom:1px solid var(--soft);white-space:nowrap}
.rz-r>span{overflow:hidden;text-overflow:ellipsis}.rz-r .n{text-align:right;font-variant-numeric:tabular-nums}.rz-hd .n{text-align:right}
.rz-r:hover{background:var(--soft)}
.rz-r.L{background:#16191c;color:#fff;font-weight:800}.rz-r.L:hover{background:#26292d}
.rz-r.S1{background:var(--soft);font-weight:800}.rz-r.S2{font-weight:700;background:color-mix(in srgb,var(--soft) 55%,var(--panel))}
.rz-r.D{color:var(--muted);font-size:12.5px;background:repeating-linear-gradient(90deg,transparent 0 6px,color-mix(in srgb,var(--soft) 40%,transparent) 6px 7px)}
.rz-r.T{color:var(--muted);font-style:italic}
.rz-r.vyb{background:#FFF4BF !important;color:#16191c}
.rz-r .tg{border:0;background:none;font:inherit;cursor:pointer;color:inherit;width:24px;height:24px;border-radius:6px;padding:0;font-size:12px}
.rz-r .tg:hover{background:rgba(127,127,127,.25)}
.rz-r .sk{display:inline-block;font-size:10px;font-weight:700;border-radius:4px;padding:0 4px;margin-left:5px;background:var(--soft);color:var(--muted);font-style:normal}
.rz-ob{display:inline-grid;place-items:center;min-width:22px;height:20px;padding:0 4px;border-radius:5px;color:#fff;font-size:11.5px;font-weight:800}
.rz-war{color:var(--bad);font-weight:800;cursor:help}.rz-war.o{color:#c77700}
.rz-ok{color:#2f7d4f}
.rz-empty{padding:40px 18px;text-align:center;color:var(--muted);border:2px dashed var(--line);border-radius:14px;background:var(--panel)}
.rz-empty b{display:block;color:var(--ink);font-size:18px;margin-bottom:6px}.rz-empty ol{text-align:left;display:inline-block;margin:10px auto;color:var(--ink);font-size:15px;line-height:1.7}
.rz-info{font-size:13.5px;color:#7a5600;background:#FFF4BF;border:1px solid #f0d36a;border-radius:10px;padding:8px 12px}
.rz-info.cerv{color:#fff;background:var(--bad);border-color:var(--bad)}
.rz-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}
.rz-card{border:1px solid var(--line);border-radius:12px;background:var(--panel);padding:12px 14px;display:flex;flex-direction:column;gap:6px}
.rz-card h3{margin:0;font-size:16px;display:flex;gap:8px;align-items:center}.rz-card .m{font-size:13px;color:var(--muted)}
.rz-card .r{display:flex;justify-content:space-between;font-size:13.5px}.rz-card .r b{font-variant-numeric:tabular-nums}
.rz-card .a{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
.rz-list{border:1px solid var(--line);border-radius:12px;background:var(--panel);overflow:auto}
.rz-list table{width:100%;border-collapse:collapse;font-size:14px}
.rz-list th{font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
.rz-list td{padding:7px 10px;border-bottom:1px solid var(--soft);vertical-align:middle}.rz-list tr:last-child td{border-bottom:0}
.rz-list td.n,.rz-list th.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.rz-list tr.kl{cursor:pointer}.rz-list tr.kl:hover td{background:var(--soft)}
/* okna */
.rz-ov{position:fixed;inset:0;z-index:2500;background:rgba(10,12,14,.55);display:flex;align-items:flex-start;justify-content:center;padding:24px 12px;overflow:auto}
.rz-dlg{background:var(--panel);color:var(--ink);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.4);width:min(1100px,100%);display:flex;flex-direction:column;max-height:calc(100vh - 48px)}
.rz-dlg.uzky{width:min(620px,100%)}.rz-dlg.siroky{width:min(1500px,100%)}
.rz-dh{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--line)}.rz-dh h3{margin:0;font-size:18px;flex:1}
.rz-x{font:inherit;font-size:15px;font-weight:800;border:2px solid #16191c;background:#fff;color:#16191c;border-radius:10px;padding:6px 14px;cursor:pointer}
.rz-db{padding:14px 18px;overflow:auto;display:flex;flex-direction:column;gap:12px}
.rz-df{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;padding:12px 18px;border-top:1px solid var(--line);align-items:center}.rz-df .sp{flex:1}
.rz-pole{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px}
.rz-pole label{display:flex;flex-direction:column;gap:4px;font-size:12.5px;font-weight:700;color:var(--muted)}
.rz-pole input,.rz-pole select,.rz-pole textarea{font:inherit;font-size:14px;color:var(--ink);border:1px solid var(--line);border-radius:9px;padding:7px 9px;background:var(--panel)}
.rz-list-sh{border:1px solid var(--line);border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:8px}
.rz-list-sh.vyp{opacity:.55}
.rz-list-sh h4{margin:0;font-size:15px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.rz-map{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:8px}
.rz-map label{display:flex;flex-direction:column;gap:3px;font-size:12px;font-weight:700;color:var(--muted)}
.rz-map select{font:inherit;font-size:13px;border:1px solid var(--line);border-radius:8px;padding:5px 6px;background:var(--panel);color:var(--ink)}
.rz-map select.ok{border-color:#2f7d4f;box-shadow:0 0 0 1px #2f7d4f}.rz-map select.chybi{border-color:var(--bad);box-shadow:0 0 0 1px var(--bad)}
.rz-nah{overflow:auto;border:1px solid var(--line);border-radius:8px;max-height:260px}
.rz-nah table{border-collapse:collapse;font-size:12px;white-space:nowrap}
.rz-nah td,.rz-nah th{border:1px solid var(--soft);padding:3px 6px;max-width:260px;overflow:hidden;text-overflow:ellipsis}
.rz-nah th{background:var(--soft);position:sticky;top:0}.rz-nah tr.hl td{background:#FFF4BF;color:#16191c;font-weight:700}
.rz-nah tr.P td{background:color-mix(in srgb,#2f7d4f 10%,transparent)}.rz-nah tr.S td{font-weight:700}.rz-nah tr.D td{color:var(--muted)}
.rz-nah .rl{font-weight:800;color:#2f7d4f}
.rz-fl td input{font:inherit;font-size:13.5px;width:100%;min-width:70px;border:1px solid var(--line);border-radius:7px;padding:4px 6px;text-align:right;background:var(--panel);color:var(--ink)}
.rz-fl td input.t{text-align:left;min-width:200px}
.rz-fl tr.nad td{background:var(--bad-soft,#f8dedb)}.rz-fl tr.cena td{background:var(--warn-soft,#f6ead0)}
.rz-fl .w{font-size:12px;color:var(--bad);font-weight:700;white-space:normal}.rz-fl .w.o{color:#a96a00}
.rz-prog{height:8px;border-radius:4px;background:var(--soft);overflow:hidden}.rz-prog i{display:block;height:100%;background:#F4D23C;transition:width .2s}
.rz-wait{position:fixed;inset:0;z-index:2600;background:rgba(10,12,14,.45);display:grid;place-items:center}
.rz-wait>div{background:#16191c;color:#fff;border-radius:14px;padding:18px 22px;min-width:300px;font-size:15px;box-shadow:0 10px 30px rgba(0,0,0,.4)}
.rz-wait small{display:block;color:#c9c9c9;margin-top:6px}
.rz-tag{display:inline-block;font-size:11px;font-weight:700;border-radius:5px;padding:1px 6px;background:var(--soft);color:var(--ink);margin-right:3px}
@media (max-width:900px){.rz-sum{grid-template-columns:repeat(2,minmax(0,1fr))}.rz-tab{height:calc(100vh - 260px)}}
`;
  function styl() { if (document.getElementById('rz-css')) return; const s = document.createElement('style'); s.id = 'rz-css'; s.textContent = CSS; document.head.appendChild(s); }

  /* ---------- IndexedDB (kopie řádků rozpočtu v prohlížeči) ---------- */
  let dbP = null;
  function db() {
    if (dbP) return dbP;
    dbP = new Promise((res, rej) => { const r = indexedDB.open('cx-rozpocet', 1); r.onupgradeneeded = () => r.result.createObjectStore('d'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    return dbP;
  }
  async function idbGet(k) { try { const d = await db(); return await new Promise((res, rej) => { const q = d.transaction('d').objectStore('d').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); } catch (e) { return null; } }
  async function idbPut(k, v) { try { const d = await db(); await new Promise((res, rej) => { const t = d.transaction('d', 'readwrite'); t.objectStore('d').put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); }); return true; } catch (e) { return false; } }
  async function idbDel(k) { try { const d = await db(); await new Promise(res => { const t = d.transaction('d', 'readwrite'); t.objectStore('d').delete(k); t.oncomplete = res; t.onerror = res; }); } catch (e) {} }

  /* ---------- komprese a base64 ---------- */
  async function gzip(str) { const s = new Blob([str]).stream().pipeThrough(new CompressionStream('gzip')); return new Blob([await new Response(s).arrayBuffer()]); }
  async function gunzip(blob) { const s = blob.stream().pipeThrough(new DecompressionStream('gzip')); return await new Response(s).text(); }
  function b64(blob) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(r.error); r.readAsDataURL(blob); }); }
  function z64(s) { const b = atob(s || ''), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }

  /* ---------- Excel na pozadí ---------- */
  function worker(msg, transfer) {
    return new Promise((res, rej) => {
      let w;
      try { w = new Worker('rozpocet-worker.js'); } catch (e) { rej(new Error('Prohlížeč nedovolil spustit čtení Excelu. Obnovte stránku (F5).')); return; }
      w.onmessage = e => { w.terminate(); const d = e.data || {}; d.ok ? res(d) : rej(new Error(d.chyba || 'Soubor se nepodařilo přečíst.')); };
      w.onerror = e => { w.terminate(); rej(new Error((e && e.message) || 'Soubor se nepodařilo přečíst.')); };
      w.postMessage(msg, transfer || []);
    });
  }

  /* ---------- rozpoznání sloupců ---------- */
  // role: pc = pořadové číslo, typ = typ řádku (KROS: D/K/M/PP/VV…), kod = kód položky, popis, mj, mn = množství, jc = jednotková cena, cc = cena celkem
  const ROLE = [
    ['pc', 'Pořadové číslo (PČ)'], ['typ', 'Typ řádku (D, K, VV…)'], ['kod', 'Kód / číslo položky'], ['popis', 'Popis / název'],
    ['mj', 'Měrná jednotka (MJ)'], ['mn', 'Množství / výměra'], ['jc', 'Jednotková cena'], ['cc', 'Cena celkem']];
  const ROLE_NAZ = Object.fromEntries(ROLE);
  const RX = {
    pc: /^(p\.? ?c\.?|por\.? ?c\.?|poradove cislo|poradi|c\.|c|cis\.?|#|r\.? ?c\.?|pol\.? ?c\.?|c\. ?pol\.?|cislo radku|radek|poz\.?|pozice)$/,
    typ: /^(typ|typ radku|t|druh radku)$/,
    kod: /(^kod|kod polozky|cislo polozky|^c\. ?polozky|oznaceni|polozka c|cenova polozka|^ozn\.?$|^kcn$|katalog)/,
    popis: /(popis|nazev|^text|specifikace|predmet|^polozka$|^polozky$|^prace$|^nazev prace|^description)/,
    mj: /^(m\.? ?j\.?|mj\.?|mer\.? ?j\.?|jedn\.?|jednotka|merna jednotka|jed\.?|jednotky|j\.)$/,
    mn: /(mnozstvi|vymer|^pocet|^mn\.?|mnoz\.?|^qty|^kusu?)/,
    jc: /(jednotkov\w* cen|jedn\.? ?cen|^j\.? ?cen|cena ?\/ ?m\.? ?j|cena za m\.? ?j|cena za jedn|^jc\.?$|kc ?\/ ?m\.? ?j|^j\.? ?c\.?$|cena jedn|^cena\/j)/,
    cc: /(cena celkem|^celkem|celkova cena|^cena$|^cena (kc|czk|bez dph)|kc celkem|^castka|^cena celk|celkem (kc|czk|bez dph)|^celk\.)/,
  };
  const JEDNOTKY = /^(m|m2|m3|m²|m³|bm|km|mm|cm|ks|kus|kusy|t|kg|g|l|kpl|komplet|soub|soubor|hod|h|den|dny|mes|měs|ha|ar|sada|pár|par|bal|%|kč|kc|m\/s|mj|ks\/m|tun|tuna|úsek|usek|bod|místo|misto|osoba|celek|kmpl|kpt|m2\/t|lhůta)$/i;
  function roleZnazvu(t) {
    const s = norm(t); if (!s || s.length > 45) return '';
    for (const r of ['jc', 'cc', 'mn', 'mj', 'typ', 'pc', 'kod', 'popis']) if (RX[r].test(s)) return r;
    return '';
  }
  // hlavička = řádek s nejvíce rozpoznanými názvy (bere v úvahu i dvouřádkovou hlavičku)
  function najdiHlavicku(rows) {
    let best = {r: -1, sc: 0, map: {}};
    const lim = Math.min(rows.length, 120);
    for (let r = 0; r < lim; r++) {
      const row = rows[r] || [];
      for (const dva of [false, true]) {
        if (dva && r + 1 >= rows.length) continue;
        const map = {}; let sc = 0;
        for (let c = 0; c < Math.max(row.length, dva ? (rows[r + 1] || []).length : 0); c++) {
          let t = txt(row[c]); if (dva) t = (t + ' ' + txt((rows[r + 1] || [])[c])).trim();
          if (typeof row[c] === 'number' && !dva) continue;
          let role = roleZnazvu(t);
          if (!role && dva) role = roleZnazvu(txt((rows[r + 1] || [])[c]));
          if (role && !(role in map)) { map[role] = c; sc += role === 'popis' || role === 'mn' || role === 'mj' ? 2 : 1; }
        }
        if (dva) sc -= 0.5;
        if (sc > best.sc && (map.popis != null || map.mn != null || map.jc != null)) best = {r: dva ? r + 1 : r, sc, map, dva};
      }
    }
    return best.sc >= 3 ? best : {r: -1, sc: 0, map: {}};
  }
  // kontrola podle obsahu: množství × jedn. cena ≈ celkem, MJ = krátké jednotky, popis = nejdelší texty, kód = kódy s číslicemi
  function statistikaSloupcu(rows, od) {
    const st = [], vz = [];
    for (let r = od; r < rows.length && vz.length < 1500; r++) { const row = rows[r]; if (row && row.some(v => v !== '' && v != null)) vz.push(row); }
    const nc = vz.reduce((a, r) => Math.max(a, r.length), 0);
    for (let c = 0; c < nc; c++) {
      let n = 0, num = 0, jed = 0, dl = 0, kod = 0, cel = 0, rost = 0, prev = null;
      vz.forEach(r => {
        const v = r[c]; if (v === '' || v == null) return; n++;
        const x = cislo(v), t = txt(v);
        if (x != null) { num++; if (Number.isInteger(x) && x > 0 && x < 100000) { cel++; if (prev != null && x === prev + 1) rost++; prev = x; } }
        else { dl += t.length; if (JEDNOTKY.test(t.replace(/\.$/, ''))) jed++; }
        if (/^[A-Z0-9][A-Z0-9.\-\/ ]{3,20}$/i.test(t) && /\d/.test(t) && /\d{3}/.test(t)) kod++;
      });
      st.push({c, n, num: n ? num / n : 0, jed: n ? jed / n : 0, dl: n - num ? dl / (n - num) : 0, kod: n ? kod / n : 0, rost: n ? rost / n : 0, cnt: n});
    }
    return {st, vz};
  }
  function trojice(vz, nc) {
    // hledá sloupce a, b, c (a < c, b < c) kde a × b = c v co nejvíce řádcích
    const cand = [];
    for (let c = 0; c < nc; c++) { let k = 0; for (const r of vz) if (cislo(r[c]) != null) k++; if (k >= Math.max(3, vz.length * 0.05)) cand.push(c); }
    let best = null;
    for (const c of cand) for (const a of cand) for (const b of cand) {
      if (a === b || a === c || b === c || a > b) continue;
      let ok = 0;
      for (const r of vz) { const x = cislo(r[a]), y = cislo(r[b]), z = cislo(r[c]); if (x != null && y != null && z != null && Math.abs(z) > EPS && Math.abs(x * y - z) <= Math.max(0.6, Math.abs(z) * 0.002)) ok++; }
      if (!best || ok > best.ok) best = {a, b, c, ok};
    }
    return best && best.ok >= 3 ? best : null;
  }
  function rozpoznej(list) {
    const rows = list.rows;
    const h = najdiHlavicku(rows);
    const od = h.r + 1;
    const {st, vz} = statistikaSloupcu(rows, od);
    const nc = st.length;
    const map = Object.assign({}, h.map), jak = {};
    Object.keys(map).forEach(k => jak[k] = 'nazev');
    // čísla: ověřit součin, případně dohledat podle obsahu
    const tr = trojice(vz, nc);
    const sedi = (m) => { if (m.mn == null || m.jc == null || m.cc == null) return 0; let ok = 0; for (const r of vz) { const x = cislo(r[m.mn]), y = cislo(r[m.jc]), z = cislo(r[m.cc]); if (x != null && y != null && z != null && Math.abs(z) > EPS && Math.abs(x * y - z) <= Math.max(0.6, Math.abs(z) * 0.002)) ok++; } return ok; };
    if (tr && tr.ok > sedi(map) * 1.3 + 2) {
      // levý = množství, pravý = jednotková cena (v rozpočtech je množství vždy před cenou)
      const zn = [tr.a, tr.b];
      if (map.mn === tr.b || map.jc === tr.a) zn.reverse();
      map.mn = zn[0]; map.jc = zn[1]; map.cc = tr.c; jak.mn = jak.jc = jak.cc = 'obsah';
    }
    const volne = c => !Object.values(map).includes(c);
    if (map.mj == null) { const s = st.filter(x => volne(x.c) && x.jed > 0.4).sort((a, b) => b.jed - a.jed)[0]; if (s) { map.mj = s.c; jak.mj = 'obsah'; } }
    if (map.popis == null) { const s = st.filter(x => volne(x.c) && x.num < 0.3 && x.cnt > 2).sort((a, b) => b.dl - a.dl)[0]; if (s) { map.popis = s.c; jak.popis = 'obsah'; } }
    if (map.kod == null) { const s = st.filter(x => volne(x.c) && x.kod > 0.25 && x.rost < 0.5).sort((a, b) => b.kod - a.kod)[0]; if (s) { map.kod = s.c; jak.kod = 'obsah'; } }
    if (map.pc == null) { const s = st.filter(x => volne(x.c) && x.rost > 0.3 && x.c < (map.popis == null ? 99 : map.popis)).sort((a, b) => b.rost - a.rost)[0]; if (s) { map.pc = s.c; jak.pc = 'obsah'; } }
    if (map.typ == null) {
      for (const s of st) { if (!volne(s.c)) continue; let k = 0, n = 0; for (const r of vz) { const t = txt(r[s.c]); if (!t) continue; n++; if (/^(D|K|M|PP|PSC|VV|P|VT|PSU|R|H)$/.test(t)) k++; } if (n > 5 && k / n > 0.8) { map.typ = s.c; jak.typ = 'obsah'; break; } }
    }
    const hl = h.r >= 0 ? rows[h.r] : [];
    const nazvy = []; for (let c = 0; c < nc; c++) nazvy.push(txt(hl[c]) || (h.dva ? txt((rows[h.r - 1] || [])[c]) : ''));
    return {hlavicka: h.r, map, jak, nazvy, nc};
  }

  /* ---------- rozdělení řádků: L list, S1/S2 díl, P položka, D podrobnost (výkaz výměr, popis), T součet ---------- */
  const TYP_P = /^(K|M|PSU|R|H|P\d*|ZL|Z|O)$/, TYP_D = /^(PP|PSC|VV|VT|P|POL|POZN|PV)$/;
  function radek(list, mp, r) {
    const row = list.rows[r] || [];
    const g = k => mp[k] == null ? '' : row[mp[k]];
    return {pc: txt(g('pc')), typ: txt(g('typ')).toUpperCase(), kod: txt(g('kod')), popis: txt(g('popis')), mj: txt(g('mj')), mn: cislo(g('mn')), jc: cislo(g('jc')), cc: cislo(g('cc')), prazdny: !row.some(v => v !== '' && v != null)};
  }
  function druhRadku(x, list, mp, r) {
    if (x.prazdny) return '';
    const p = norm(x.popis);
    if (x.typ && mp.typ != null) {
      if (x.typ === 'D') return 'S';
      if (TYP_D.test(x.typ) && x.typ !== 'P') return 'D';
      if (TYP_P.test(x.typ) && (x.mj || x.jc != null)) return 'P';
    }
    const mjOk = x.mj && x.mj.length <= 14 && !/^\d/.test(x.mj);
    if (mjOk && (x.mn != null || x.jc != null || x.cc != null) && (x.popis || x.kod)) return 'P';
    if (/^(celkem|soucet|mezisoucet|cena celkem|celkem za|celkem bez|rekapitulace|cena bez dph|dph|cena s dph|vrn celkem)/.test(p) && !mjOk) return 'T';
    if (!mjOk && !x.popis && !x.kod && x.cc != null) return 'T';
    if (!mjOk && x.popis && (x.kod || x.cc != null || x.pc) && x.jc == null && !(list.skryto[r]) && !/^["'(=+*]|\d\s*[*x×]\s*\d/.test(x.popis)) return 'S';
    return 'D';
  }
  function zapsatRadek(out, o) { out.push(o); return out.length - 1; }
  // výstup: pole řádků {id,t,p,s,x,h,pc,k,d,mj,mn,jc,cc}; p = index rodiče (-1 = list)
  function sestav(listy, nastaveni) {
    const out = [], ids = new Map();
    const uniq = base => { let id = base, n = 1; while (ids.has(id)) id = base + '~' + (n++); ids.set(id, 1); return id; };
    listy.forEach((list, si) => {
      const ns = nastaveni[si]; if (!ns || !ns.zahrnout) return;
      const mp = ns.map;
      const li = zapsatRadek(out, {id: uniq('L' + hash(list.n)), t: 'L', p: -1, s: si, x: 0, h: 0, pc: '', k: '', d: list.n, mj: '', mn: null, jc: null, cc: null});
      let s1 = -1, s2 = -1, pol = -1, detN = 0;
      const sekce = [];
      for (let r = ns.hlavicka + 1; r < list.rows.length; r++) {
        const x = radek(list, mp, r), t = druhRadku(x, list, mp, r);
        if (!t) continue;
        if (ns.hlavicka >= 0 && r > ns.hlavicka + 2) { let shod = 0; ['popis', 'mj', 'mn', 'jc'].forEach(k => { if (mp[k] != null && roleZnazvu(txt((list.rows[r] || [])[mp[k]])) === k) shod++; }); if (shod >= 2) continue; }   // opakovaná hlavička na další stránce
        const zakl = {s: si, x: list.od + r + 1, h: list.skryto[r] ? 1 : 0, pc: x.pc, k: x.kod, d: x.popis, mj: x.mj, mn: x.mn, jc: x.jc, cc: x.cc};
        if (t === 'S') {
          const hl = /^(hsv|psv|m|vrn|on|ost|vedlejsi|ostatni)$/i.test(x.kod) || /^(prace a dodavky|vedlejsi rozpoctove|ostatni naklady|montaze|dodavky)/.test(norm(x.popis));
          if (hl) { s1 = zapsatRadek(out, Object.assign({id: uniq('S' + hash(list.n + '|' + x.kod + '|' + norm(x.popis))), t: 'S1', p: li}, zakl)); s2 = -1; }
          else { s2 = zapsatRadek(out, Object.assign({id: uniq('S' + hash(list.n + '|' + x.kod + '|' + norm(x.popis))), t: 'S2', p: s1 >= 0 ? s1 : li}, zakl)); }
          pol = -1; sekce.push(1);
        } else if (t === 'P') {
          if (zakl.cc == null && zakl.mn != null && zakl.jc != null) zakl.cc = Math.round(zakl.mn * zakl.jc * 100) / 100;
          if (zakl.jc == null && zakl.cc != null && zakl.mn) zakl.jc = Math.round(zakl.cc / zakl.mn * 100) / 100;
          pol = zapsatRadek(out, Object.assign({id: uniq('P' + hash(list.n + '|' + x.kod + '|' + norm(x.popis).slice(0, 90) + '|' + x.pc)), t: 'P', p: s2 >= 0 ? s2 : s1 >= 0 ? s1 : li}, zakl)); detN = 0;
        } else if (t === 'T') {
          zapsatRadek(out, Object.assign({id: uniq('T' + hash(list.n + '|' + r)), t: 'T', p: s2 >= 0 ? s2 : s1 >= 0 ? s1 : li}, zakl));
          pol = -1;
        } else {
          const par = pol >= 0 ? pol : s2 >= 0 ? s2 : s1 >= 0 ? s1 : li;
          zapsatRadek(out, Object.assign({id: out[par].id + '.' + (++detN), t: 'D', p: par}, zakl));
        }
      }
    });
    return out;
  }
  function souhrnListu(list, ns) {
    const rows = sestav([list], [Object.assign({}, ns, {zahrnout: true})]);
    let pol = 0, cel = 0, det = 0, sk = 0;
    rows.forEach(r => { if (r.t === 'P') { pol++; cel += r.cc || 0; } else if (r.t === 'D') det++; if (r.h) sk++; });
    return {pol, cel, det, sk, rows};
  }

  /* ---------- práce s načteným rozpočtem v paměti ---------- */
  // R = {rec, rows, byId: Map, deti: [[]], hloubka: []}
  let R = null;
  const NACTENO = new Map();   // id rozpočtu -> {rev, R}
  function priprav(rec, rows) {
    const byId = new Map(), deti = rows.map(() => []), hl = new Array(rows.length);
    rows.forEach((r, i) => { r.i = i; byId.set(r.id, r); if (r.p >= 0) deti[r.p].push(i); hl[i] = r.p >= 0 ? hl[r.p] + 1 : 0; });
    // součty dílů a listů z položek
    const sum = new Float64Array(rows.length);
    rows.forEach(r => { if (r.t !== 'P') return; let p = r.p; const v = r.cc || 0; while (p >= 0) { sum[p] += v; p = rows[p].p; } });
    return {rec, rows, byId, deti, hl, sum, polozky: rows.filter(r => r.t === 'P')};
  }

  /* ---------- host (Management) ---------- */
  let H = null, EL = null;
  const S = {panel: pam('rz-panel') || 'rozpocet', rp: pam('rz-rp') || '', q: '', obj: '', kat: '', rezim: pam('rz-rezim') || 'pol', jenUpoz: false, otev: new Set(), zav: new Set(), vyb: new Set(), nacitam: '', chyba: '', verze: 0, verzeT: 0, aktT: 0};
  const toast = m => H && H.toast ? H.toast(m) : alert(m);
  const ro = () => !!(H && H.ro && H.ro());
  const kdo = () => (H && H.kdo && H.kdo()) || '';
  const sez = k => (H && H.seznam(k)) || [];
  const rozpocty = () => sez('rozpocty').slice().sort((a, b) => String(a.kdy || '').localeCompare(String(b.kdy || '')));
  const aktRec = () => { const l = rozpocty(); return l.find(r => r.id === S.rp) || l[l.length - 1] || null; };
  const kategorie = rp => sez('rozpKat').filter(k => k.rp === rp).sort((a, b) => String(a.nazev).localeCompare(String(b.nazev), 'cs'));
  const faktury = rp => sez('faktury').filter(f => f.rp === rp).sort((a, b) => String(b.datum || b.kdy || '').localeCompare(String(a.datum || a.kdy || '')));
  const objBarva = o => (H && H.objBarva ? H.objBarva(o) : '#546e7a');

  async function verzeSkriptu() {
    if (!H || !H.pripojeno()) return 0;
    if (S.verze >= SKRIPT_MIN || Date.now() - S.verzeT < 120000) return S.verze;
    S.verzeT = Date.now();
    try { const r = await H.volej({akce: 'verze'}); S.verze = Number(r && r.verze) || 0; } catch (e) {}
    if (S.verze && S.verze < SKRIPT_MIN && H.aktualizujSkript && Date.now() - S.aktT > 180000) {
      S.aktT = Date.now();
      H.aktualizujSkript().then(r => { if (r && r.ok) { S.verze = 0; S.verzeT = 0; prekresli(); } }).catch(() => {});
    }
    return S.verze;
  }
  async function volejOk(body, pokusu) {
    let posl = null;
    for (let i = 0; i < (pokusu || 4); i++) {
      try { const r = await H.volej(body); if (r && !r.error) return r; posl = new Error(r && r.error ? String(r.error) : 'Bez odpovědi'); if (r && r.error === 'heslo') break; }
      catch (e) { posl = e; }
      await new Promise(res => setTimeout(res, 1500 * (i + 1)));
    }
    throw posl || new Error('Nepodařilo se spojit s Googlem.');
  }

  /* ---------- uložení řádků (prohlížeč + Disk Google) ---------- */
  const klic = rec => 'r:' + rec.id + ':' + rec.rev;
  async function nahrajNaDisk(rec, blob) {
    if (!H.pripojeno()) return null;
    const nazev = 'rozpocet-' + rec.id + '-' + rec.rev + '.json.gz';
    let gid = '';
    if (blob.size <= 6 * 1024 * 1024) {
      const r = await volejOk({akce: 'dok_maly', nazev, mime: 'application/gzip', cesta: ['Rozpočty'], data: await b64(blob)});
      gid = r.id;
    } else {
      const st = await volejOk({akce: 'dok_start', nazev, mime: 'application/gzip', vel: blob.size, cesta: ['Rozpočty']});
      let od = 0;
      while (!gid) {
        const kus = blob.slice(od, Math.min(blob.size, od + KUS));
        const r = await volejOk({akce: 'dok_cast', up: st.up, od, celkem: blob.size, data: await b64(kus)});
        if (r.restart) throw new Error('Nahrávání na Disk vypršelo, zkusím to znovu.');
        if (r.id) gid = r.id; else od = r.dalsi != null ? Number(r.dalsi) : od + kus.size;
      }
    }
    return gid;
  }
  async function stahniZDisku(rec, prubeh) {
    const prvni = await volejOk({akce: 'dok_cti', id: rec.gid, od: 0, do: KUS - 1});
    const celkem = Number(prvni.celkem) || 0, dily = [z64(prvni.data)];
    let mam = dily[0].length; prubeh && prubeh(mam, celkem);
    for (let od = mam; od < celkem; od += KUS) { const x = await volejOk({akce: 'dok_cti', id: rec.gid, od, do: Math.min(celkem, od + KUS) - 1}); dily.push(z64(x.data)); mam += dily[dily.length - 1].length; prubeh && prubeh(mam, celkem); }
    return new Blob(dily);
  }
  const POLE = ['id', 't', 'p', 's', 'x', 'h', 'pc', 'k', 'd', 'mj', 'mn', 'jc', 'cc'];
  const naPole = rows => rows.map(r => POLE.map(k => r[k] === '' || r[k] == null ? (k === 'p' ? -1 : null) : r[k]));
  const zPole = arr => arr.map(a => { const r = {}; POLE.forEach((k, i) => r[k] = a[i] == null ? (['pc', 'k', 'd', 'mj'].includes(k) ? '' : k === 'h' ? 0 : a[i]) : a[i]); return r; });
  // čekající nahrání (když Google zrovna nejde) se zkusí znovu při dalším otevření
  async function dokoncitNahrani() {
    if (!H || !H.pripojeno() || ro()) return;
    for (const rec of rozpocty()) {
      if (rec.gid || rec.pc !== pcId()) continue;
      const c = await idbGet(klic(rec)); if (!c || !c.gz) continue;
      try {
        const gid = await nahrajNaDisk(rec, c.gz);
        if (gid) { const akt = sez('rozpocty').find(x => x.id === rec.id); if (akt && akt.rev === rec.rev) H.upsert('rozpocty', [Object.assign({}, akt, {gid})]); }
      } catch (e) { S.chyba = 'Rozpočet se zatím nepodařilo uložit na Disk Google: ' + e.message + ' Zkusím to znovu.'; }
    }
  }
  function pcId() { let x = pam('rz-pc'); if (!x) { x = uid(); pamSet('rz-pc', x); } return x; }

  async function nactiRozpocet(rec) {
    const n = NACTENO.get(rec.id);
    if (n && n.rev === rec.rev) { n.R.rec = rec; return n.R; }
    S.nacitam = 'Načítám rozpočet…'; prekresli();
    try {
      let c = await idbGet(klic(rec)), text = null;
      if (c && c.gz) text = await gunzip(c.gz);
      if (!text) {
        if (!rec.gid) throw new Error(rec.kdo ? 'Rozpočet ještě není na Disku Google – nahrává se z počítače, kde ho ' + rec.kdo + ' vložil(a). Ten počítač musí mít Constructo otevřené s připojením.' : 'Rozpočet ještě není na Disku Google.');
        if (!H.pripojeno()) throw new Error('Pro načtení rozpočtu je potřeba připojení ke Googlu (Data → Automatická synchronizace).');
        const blob = await stahniZDisku(rec, (a, b) => { S.nacitam = 'Stahuji rozpočet z Disku Google… ' + (b ? Math.round(a / b * 100) + ' %' : ''); prekresliStav(); });
        text = await gunzip(blob);
        idbPut(klic(rec), {gz: blob, kdy: Date.now()});
      }
      const data = JSON.parse(text);
      const Rx = priprav(rec, zPole(data.rows || []));
      Rx.listy = data.listy || [];
      NACTENO.set(rec.id, {rev: rec.rev, R: Rx});
      S.chyba = '';
      return Rx;
    } finally { S.nacitam = ''; }
  }

  /* ---------- odvozené údaje: objekty, druhy prací, čerpání ---------- */
  let CERP = null, CERP_SIG = '';
  function objPolozky(Rx, r) { const o = Rx.rec.obj || {}; let x = r; while (x) { if (o[x.id]) return o[x.id]; x = x.p >= 0 ? Rx.rows[x.p] : null; } return ''; }
  function spocti(Rx) {
    const fs = faktury(Rx.rec.id), ks = kategorie(Rx.rec.id);
    const sig = Rx.rec.id + Rx.rec.rev + '|' + JSON.stringify(Rx.rec.obj || {}).length + '|' + fs.map(f => f.id + (f._ts || 0)).join(',') + '|' + ks.map(k => k.id + (k._ts || 0)).join(',');
    if (CERP && CERP_SIG === sig && CERP.R === Rx) return CERP;
    const pol = new Map();      // id položky -> {mn, kc, cena (jiná cena), fak: [{f, mn, jc}]}
    let celkem = 0, mimo = 0, upoz = 0;
    fs.forEach(f => (f.pol || []).forEach(l => {
      const kcL = (Number(l.mn) || 0) * (Number(l.jc) || 0);
      celkem += kcL;
      if (!l.r || !Rx.byId.has(l.r)) { mimo += kcL; return; }
      const x = pol.get(l.r) || {mn: 0, kc: 0, cena: false, fak: []};
      x.mn += Number(l.mn) || 0; x.kc += kcL; x.fak.push({f: f.id, mn: Number(l.mn) || 0, jc: Number(l.jc) || 0});
      const r = Rx.byId.get(l.r); if (r.jc != null && Math.abs((Number(l.jc) || 0) - r.jc) > 0.005) x.cena = true;
      pol.set(l.r, x);
    }));
    const sum = new Float64Array(Rx.rows.length), obj = new Array(Rx.rows.length).fill('');
    const objSum = {};
    Rx.polozky.forEach(r => {
      const o = objPolozky(Rx, r); obj[r.i] = o;
      const os = objSum[o] ||= {roz: 0, cer: 0, n: 0}; os.roz += r.cc || 0; os.n++;
      const x = pol.get(r.id); if (!x) return;
      os.cer += x.kc;
      x.nad = r.mn != null && x.mn > r.mn + Math.max(EPS, Math.abs(r.mn) * 1e-9);
      x.nadKc = r.cc != null && x.kc > r.cc + 0.5;
      if (x.nad || x.cena || x.nadKc) upoz++;
      let p = r.p; while (p >= 0) { sum[p] += x.kc; p = Rx.rows[p].p; }
    });
    const katPol = new Map(), katSum = {};
    ks.forEach(k => { const s = katSum[k.id] = {roz: 0, cer: 0, n: 0}; (k.pol || []).forEach(id => { const r = Rx.byId.get(id); if (!r || r.t !== 'P') return; s.n++; s.roz += r.cc || 0; const x = pol.get(id); if (x) s.cer += x.kc; const a = katPol.get(id) || []; a.push(k.id); katPol.set(id, a); }); });
    let roz = 0; Rx.polozky.forEach(r => roz += r.cc || 0);
    CERP = {R: Rx, pol, sum, obj, objSum, katPol, katSum, celkem, mimo, upoz, roz};
    CERP_SIG = sig;
    return CERP;
  }

  /* ---------- vykreslení ---------- */
  let SCROLL = 0;
  function prekresliStav() { const e = EL && EL.querySelector('.rz-stav'); if (e) e.textContent = S.nacitam; }
  function prekresli() { if (EL && EL.isConnected) vykresli(); }
  function vykresli() {
    styl();
    const tab = EL.querySelector('.rz-tab'); if (tab) SCROLL = tab.scrollTop;
    const list = rozpocty(), rec = aktRec();
    if (rec && S.rp !== rec.id) S.rp = rec.id;
    if (!rec) { EL.innerHTML = prazdne(); vazby(); return; }
    const Rx = R && R.rec.id === rec.id && NACTENO.get(rec.id) && NACTENO.get(rec.id).rev === rec.rev ? R : null;
    if (!Rx) {
      EL.innerHTML = `<div class="rz">${hlava(list, rec, null)}<div class="rz-empty"><b class="rz-stav">${esc(S.nacitam || S.chyba || 'Načítám rozpočet…')}</b>${S.chyba ? '<button type="button" class="rz-btn" data-a="znovu">Zkusit znovu</button>' : ''}</div></div>`;
      vazby();
      if (!S.nacitam && !S.chyba) nactiRozpocet(rec).then(x => { R = x; S.otev.clear(); S.zav.clear(); S.vyb.clear(); prekresli(); }).catch(e => { S.chyba = e.message || String(e); prekresli(); });
      return;
    }
    R = Rx; R.rec = rec;
    const C = spocti(R);
    const nf = faktury(rec.id).length, nk = kategorie(rec.id).length;
    let telo = '';
    if (S.panel === 'objekty') telo = panelObjekty(C);
    else if (S.panel === 'druhy') telo = panelDruhy(C);
    else if (S.panel === 'fakturace') telo = panelFakturace(C);
    else telo = panelRozpocet(C);
    EL.innerHTML = `<div class="rz">${hlava(list, rec, C)}
      <div class="rz-tabs" role="group" aria-label="Části rozpočtu">
        <button type="button" data-p="rozpocet" aria-pressed="${S.panel === 'rozpocet'}">Rozpočet</button>
        <button type="button" data-p="objekty" aria-pressed="${S.panel === 'objekty'}">Objekty</button>
        <button type="button" data-p="druhy" aria-pressed="${S.panel === 'druhy'}">Druhy prací${nk ? `<b>${nk}</b>` : ''}</button>
        <button type="button" data-p="fakturace" aria-pressed="${S.panel === 'fakturace'}">Fakturace${nf ? `<b${C.upoz ? ' class="cerv"' : ''}>${nf}</b>` : ''}</button>
      </div>${telo}</div>`;
    vazby();
    if (S.panel === 'rozpocet') { const t = EL.querySelector('.rz-tab'); if (t) { t.scrollTop = SCROLL; kresliRadky(); } }
  }
  function prazdne() {
    return `<div class="rz"><div class="rz-top"><h2>Rozpočet</h2></div>
      <div class="rz-empty"><b>Zatím tu není žádný rozpočet</b>
        <ol><li>Klikněte na žluté tlačítko <b>Nahrát rozpočet z Excelu</b>.</li><li>Vyberte soubor rozpočtu (.xlsx nebo .xls) – klidně se 40 000 řádky.</li><li>Constructo samo pozná sloupce (číslo, popis, MJ, množství, ceny). Zkontrolujte a klikněte <b>Uložit rozpočet</b>.</li></ol>
        <div><button type="button" class="rz-btn zl" data-a="import"${ro() ? ' disabled' : ''}>⬆ Nahrát rozpočet z Excelu</button></div>
        <p style="margin-top:12px;font-size:13px">Soubor můžete také přetáhnout myší sem do okna.</p></div>${skriptInfo()}</div>`;
  }
  function skriptInfo() {
    if (!H.pripojeno()) return '<div class="rz-info">Bez připojení ke Googlu zůstane rozpočet jen v tomto počítači. Pro sdílení s kolegy zapněte Data → Automatická synchronizace.</div>';
    if (S.verze && S.verze < SKRIPT_MIN) return '<div class="rz-info">Skript Google se právě aktualizuje na verzi ' + SKRIPT_MIN + ' (zvládne sám). Do té doby se druhy prací a fakturace kolegům nepropíšou.</div>';
    return '';
  }
  function hlava(list, rec, C) {
    const sel = list.length > 1 ? `<select class="rz-sel" data-a="rp" aria-label="Rozpočet">${list.map(r => `<option value="${esc(r.id)}"${r.id === rec.id ? ' selected' : ''}>${esc(r.nazev)}</option>`).join('')}</select>` : `<h2>${esc(rec.nazev)}</h2>`;
    const sum = C ? `<div class="rz-sum">
        <div><div class="k">Rozpočet celkem</div><div class="v">${kc0(C.roz)}</div><div class="m" style="font-size:12px;color:var(--muted)">${nf0.format(R.polozky.length)} položek · ${nf0.format(R.rows.length)} řádků</div></div>
        <div><div class="k">Vyfakturováno</div><div class="v">${kc0(C.celkem)}<small>${pct(C.celkem, C.roz)} %</small></div><div class="rz-bar"><i class="${C.celkem > C.roz + 1 ? 'nad' : ''}" style="width:${Math.min(100, pct(C.celkem, C.roz))}%"></i></div></div>
        <div><div class="k">Zbývá</div><div class="v">${kc0(C.roz - C.celkem)}</div></div>
        <div><div class="k">Upozornění</div><div class="v" style="color:${C.upoz || C.mimo ? 'var(--bad)' : '#2f7d4f'}">${C.upoz ? C.upoz + ' položek' : 'žádná'}</div>${C.mimo ? `<div style="font-size:12px;color:var(--bad)">mimo rozpočet ${kc0(C.mimo)}</div>` : ''}</div>
      </div>` : '';
    return `<div class="rz-top">${sel}<span style="font-size:12.5px;color:var(--muted)">${esc(rec.soubor || '')}${rec.kdo ? ' · nahrál(a) ' + esc(rec.kdo) : ''}${rec.kdy ? ' ' + new Date(rec.kdy).toLocaleDateString('cs-CZ') : ''}${rec.gid ? '' : H.pripojeno() ? ' · <b style="color:#a96a00">ukládá se na Disk Google…</b>' : ''}</span><span class="sp"></span>
      <button type="button" class="rz-btn" data-a="xls-roz" title="Stáhnout rozpočet s čerpáním do Excelu (jen to, co je právě vyfiltrované)">⬇ Excel</button>
      <button type="button" class="rz-btn" data-a="menu-rp">Rozpočet ▾</button>
      <button type="button" class="rz-btn zl" data-a="import"${ro() ? ' disabled' : ''}>⬆ Nahrát rozpočet z Excelu</button></div>${sum}${skriptInfo()}${S.chyba ? `<div class="rz-info">${esc(S.chyba)}</div>` : ''}`;
  }

  /* ----- panel Rozpočet (tabulka s rozbalováním, jen viditelné řádky se kreslí) ----- */
  let VIS = [];
  function rozbaleno(r) {
    if (S.zav.has(r.id)) return false;
    if (S.otev.has(r.id)) return true;
    if (S.rezim === 'vse') return true;
    if (S.rezim === 'dily') return r.t === 'L' || r.t === 'S1';
    return r.t !== 'P';   // položky: podrobnosti (výkaz výměr, skryté řádky) schované jako v Excelu
  }
  function filtrAktivni() { return !!(S.q.trim() || S.obj || S.kat || S.jenUpoz); }
  function spocitejViditelne(C) {
    const rows = R.rows, out = [];
    if (!filtrAktivni()) {
      const skryte = new Uint8Array(rows.length);
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (r.p >= 0 && (skryte[r.p] || !rozbaleno(rows[r.p]))) { skryte[i] = 1; continue; }
        out.push(i);
      }
      return out;
    }
    const slova = norm(S.q).split(' ').filter(Boolean);
    const kat = S.kat && (kategorie(R.rec.id).find(k => k.id === S.kat) || {pol: []});
    const katSet = kat ? new Set(kat.pol || []) : null;
    const ok = new Uint8Array(rows.length);
    R.polozky.forEach(r => {
      if (S.obj && (C.obj[r.i] || '-') !== S.obj) return;
      if (katSet && !katSet.has(r.id)) return;
      if (S.jenUpoz) { const x = C.pol.get(r.id); if (!x || !(x.nad || x.cena || x.nadKc)) return; }
      if (slova.length) { const h = r._h || (r._h = norm(r.pc + ' ' + r.k + ' ' + r.d + ' ' + r.mj)); if (!slova.every(s => h.includes(s))) { const ph = norm(rows[r.p] ? rows[r.p].d : ''); if (!slova.every(s => h.includes(s) || ph.includes(s))) return; } }
      ok[r.i] = 1; let p = r.p; while (p >= 0 && ok[p] !== 1) { ok[p] = 2; p = rows[p].p; }
    });
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (ok[i]) { out.push(i); continue; }
      if (r.t === 'D' && ok[r.p] === 1 && S.otev.has(rows[r.p].id)) out.push(i);
    }
    return out;
  }
  function panelRozpocet(C) {
    VIS = spocitejViditelne(C);
    const ks = kategorie(R.rec.id);
    const nV = S.vyb.size;
    let vybKc = 0; if (nV) S.vyb.forEach(id => { const r = R.byId.get(id); if (r) vybKc += r.cc || 0; });
    const objs = OBJEKTY.concat(Object.keys(C.objSum).filter(o => o && !OBJEKTY.includes(o)));
    return `<div class="rz-fil">
        <input class="rz-q" type="search" placeholder="Hledat v rozpočtu (kód, popis, např. krokve)…" value="${esc(S.q)}" data-a="q">
        <select class="rz-sel" data-a="obj" aria-label="Objekt"><option value="">Všechny objekty</option>${objs.map(o => `<option value="${esc(o)}"${S.obj === o ? ' selected' : ''}>Objekt ${esc(o)}</option>`).join('')}<option value="-"${S.obj === '-' ? ' selected' : ''}>Bez objektu</option></select>
        <select class="rz-sel" data-a="kat" aria-label="Druh prací"><option value="">Všechny druhy prací</option>${ks.map(k => `<option value="${esc(k.id)}"${S.kat === k.id ? ' selected' : ''}>${esc(k.nazev)}</option>`).join('')}</select>
        <label class="rz-chk"><input type="checkbox" data-a="upoz"${S.jenUpoz ? ' checked' : ''}> Jen s upozorněním</label>
        <span class="sp" style="flex:1"></span>
        <span style="font-size:12.5px;color:var(--muted)">Zobrazit:</span>
        <div class="rz-seg" role="group" aria-label="Rozbalení"><button type="button" data-rez="dily" aria-pressed="${S.rezim === 'dily'}" title="Jen listy a hlavní díly">Sbalit vše</button><button type="button" data-rez="pol" aria-pressed="${S.rezim === 'pol'}" title="Díly a položky, skryté řádky (výkaz výměr) schované">Položky</button><button type="button" data-rez="vse" aria-pressed="${S.rezim === 'vse'}" title="Všechno včetně řádků skrytých v Excelu">Rozbalit vše</button></div>
      </div>
      ${nV ? `<div class="rz-vyber"><b>Vybráno ${nf0.format(nV)} položek · ${kc0(vybKc)}</b>
        <button type="button" class="rz-btn mini" data-a="v-kat"${ro() ? ' disabled' : ''}>Zařadit do druhu prací…</button>
        ${S.kat ? `<button type="button" class="rz-btn mini" data-a="v-kat-pryc"${ro() ? ' disabled' : ''}>Odebrat z tohoto druhu</button>` : ''}
        <button type="button" class="rz-btn mini" data-a="v-obj"${ro() ? ' disabled' : ''}>Přiřadit objekt…</button>
        <button type="button" class="rz-btn mini" data-a="v-fak"${ro() ? ' disabled' : ''}>Vyfakturovat…</button>
        <span style="flex:1"></span><button type="button" class="rz-btn mini" data-a="v-zrus">Zrušit výběr</button></div>` : ''}
      <div class="rz-tab" tabindex="0">
        <div class="rz-hd"><span><input type="checkbox" data-a="vyb-vse" title="Vybrat všechny zobrazené položky"></span><span></span><span>PČ</span><span>Kód</span><span>Popis</span><span>MJ</span><span class="n">Množství</span><span class="n">J. cena</span><span class="n">Celkem Kč</span><span>Obj.</span><span class="n">Čerpáno Kč</span><span class="n">Zbývá Kč</span><span></span></div>
        <div class="rz-in-tab" style="position:relative;height:${VIS.length * ROWH}px"></div>
      </div>
      <div style="font-size:12.5px;color:var(--muted)">${filtrAktivni() ? `Nalezeno ${nf0.format(VIS.filter(i => R.rows[i].t === 'P').length)} položek. ` : ''}Klik na ▸ rozbalí řádek (díl, nebo u položky výkaz výměr a řádky skryté v Excelu), další klik ho zase schová. Zaškrtnutím vyberete položky – díl nebo list vybere vše pod ním.</div>`;
  }
  function radekHtml(i, C) {
    const r = R.rows[i], d = R.deti[i].length, hl = R.hl[i];
    const ind = Math.max(0, hl - 1) * 14;
    const tg = d ? `<button type="button" class="tg" data-tg="${i}" aria-label="${rozbaleno(r) ? 'Schovat' : 'Rozbalit'}">${rozbaleno(r) && !(filtrAktivni() && r.t === 'P' && !S.otev.has(r.id)) ? '▾' : '▸'}</button>` : '';
    const vyb = r.t === 'P' ? S.vyb.has(r.id) : false;
    if (r.t === 'L' || r.t === 'S1' || r.t === 'S2') {
      const cer = C.sum[i], roz = R.sum[i];
      return `<div class="rz-r ${r.t}" style="top:${VIS._pos[i] * ROWH}px"><span><input type="checkbox" data-vs="${i}"></span><span>${tg}</span><span>${esc(r.pc)}</span><span title="${esc(r.k)}">${esc(r.k)}</span><span style="padding-left:${ind}px" title="${esc(r.d)}">${esc(r.d)}${r.t === 'L' && R.rec.obj && R.rec.obj[r.id] ? '' : ''}</span><span></span><span></span><span></span><span class="n">${kc(roz)}</span><span>${r.t === 'L' || (R.rec.obj || {})[r.id] ? obBadge(objPolozky(R, r)) : ''}</span><span class="n">${cer ? kc(cer) : ''}</span><span class="n">${cer ? kc(roz - cer) : ''}</span><span></span></div>`;
    }
    if (r.t === 'P') {
      const x = C.pol.get(r.id), o = C.obj[i];
      const w = x ? [x.nad ? `překročeno množství: vyfakturováno ${mnT(x.mn)} ${r.mj}, v rozpočtu ${mnT(r.mn)}` : '', x.nadKc ? 'vyfakturováno víc Kč než v rozpočtu' : '', x.cena ? 've fakturaci jiná jednotková cena než v rozpočtu' : ''].filter(Boolean) : [];
      const kats = C.katPol.get(r.id);
      return `<div class="rz-r P${vyb ? ' vyb' : ''}" style="top:${VIS._pos[i] * ROWH}px" data-ri="${i}"><span><input type="checkbox" data-vp="${i}"${vyb ? ' checked' : ''}></span><span>${tg}</span><span>${esc(r.pc)}</span><span title="${esc(r.k)}">${esc(r.k)}</span><span style="padding-left:${ind}px" title="${esc(r.d)}${kats ? '\nDruh prací: ' + esc(kats.map(k => (kategorie(R.rec.id).find(z => z.id === k) || {}).nazev).join(', ')) : ''}">${kats ? '<span class="rz-tag">' + esc(kats.map(k => (kategorie(R.rec.id).find(z => z.id === k) || {}).nazev || '').join(', ')) + '</span>' : ''}${esc(r.d)}${r.h ? '<span class="sk">skryto v Excelu</span>' : ''}</span><span>${esc(r.mj)}</span><span class="n">${mnT(r.mn)}</span><span class="n">${kc(r.jc)}</span><span class="n">${kc(r.cc)}</span><span>${obBadge(o)}</span><span class="n">${x ? kc(x.kc) : ''}</span><span class="n">${x ? kc((r.cc || 0) - x.kc) : ''}</span><span>${w.length ? `<span class="rz-war${x.nad || x.nadKc ? '' : ' o'}" title="${esc(w.join('\n'))}">⚠</span>` : x ? '<span class="rz-ok" title="Fakturace v pořádku">✓</span>' : ''}</span></div>`;
    }
    return `<div class="rz-r ${r.t}" style="top:${VIS._pos[i] * ROWH}px"><span></span><span>${tg}</span><span>${esc(r.pc)}</span><span>${esc(r.k)}</span><span style="padding-left:${ind}px" title="${esc(r.d)}">${esc(r.d)}${r.h ? '<span class="sk">skryto</span>' : ''}</span><span>${esc(r.mj)}</span><span class="n">${mnT(r.mn)}</span><span class="n">${kc(r.jc)}</span><span class="n">${kc(r.cc)}</span><span></span><span></span><span></span><span></span></div>`;
  }
  const obBadge = o => o ? `<span class="rz-ob" style="background:${objBarva(o)}">${esc(o.length > 3 ? o.slice(0, 3) : o)}</span>` : '';
  let rafK = 0;
  function kresliRadky() {
    const tab = EL && EL.querySelector('.rz-tab'), in_ = tab && tab.querySelector('.rz-in-tab'); if (!in_) return;
    const C = spocti(R);
    if (!VIS._pos) { VIS._pos = {}; }
    const top = Math.max(0, tab.scrollTop - 34), h = tab.clientHeight || 600;
    const a = Math.max(0, Math.floor(top / ROWH) - 15), b = Math.min(VIS.length, Math.ceil((top + h) / ROWH) + 15);
    let html = '';
    for (let k = a; k < b; k++) { VIS._pos[VIS[k]] = k; html += radekHtml(VIS[k], C); }
    in_.innerHTML = html;
  }

  /* ----- panel Objekty ----- */
  function panelObjekty(C) {
    const objs = Object.keys(C.objSum).sort((a, b) => !a ? 1 : !b ? -1 : a.localeCompare(b, 'cs'));
    const listy = R.rows.filter(r => r.t === 'L');
    return `<div class="rz-cards">${objs.map(o => { const s = C.objSum[o]; return `<div class="rz-card"><h3>${o ? obBadge(o) + ' Objekt ' + esc(o) : 'Bez objektu'}</h3>
        <div class="r"><span>Rozpočet</span><b>${kc0(s.roz)}</b></div><div class="r"><span>Vyfakturováno</span><b>${kc0(s.cer)}</b></div><div class="r"><span>Zbývá</span><b>${kc0(s.roz - s.cer)}</b></div>
        <div class="rz-bar"><i class="${s.cer > s.roz + 1 ? 'nad' : ''}" style="width:${Math.min(100, pct(s.cer, s.roz))}%"></i></div><div class="m">${nf0.format(s.n)} položek · čerpáno ${pct(s.cer, s.roz)} %</div>
        <div class="a"><button type="button" class="rz-btn mini" data-ukaz-obj="${esc(o || '-')}">Zobrazit položky</button></div></div>`; }).join('')}</div>
      <div class="rz-list"><table><thead><tr><th>List v Excelu</th><th class="n">Položek</th><th class="n">Rozpočet Kč</th><th>Objekt</th></tr></thead><tbody>
        ${listy.map(l => `<tr><td><b>${esc(l.d)}</b></td><td class="n">${nf0.format(R.deti[l.i].length ? R.polozky.filter(p => p.s === l.s).length : 0)}</td><td class="n">${kc(R.sum[l.i])}</td><td><select class="rz-sel" data-lobj="${esc(l.id)}"${ro() ? ' disabled' : ''}><option value="">— bez objektu —</option>${OBJEKTY.map(o => `<option value="${esc(o)}"${(R.rec.obj || {})[l.id] === o ? ' selected' : ''}>Objekt ${esc(o)}</option>`).join('')}</select></td></tr>`).join('')}
      </tbody></table></div>
      <div style="font-size:13px;color:var(--muted)">Objekt se nastaví celému listu. Jednotlivé díly nebo položky můžete přiřadit jinému objektu v záložce Rozpočet: zaškrtněte je a klikněte <b>Přiřadit objekt…</b></div>`;
  }

  /* ----- panel Druhy prací ----- */
  const VYCHOZI_DRUHY = [
    ['Střecha', 'krov, krokev, krokve, trám, pozednic, vaznic, kleštin, sloupek krovu, bednění střech, pobití, prkn, laťován, lat, kontralat, krytin, tašk, bobrovk, břidlic, plechová krytina, střeš, hřeben, úžlab, okap, žlab, svod, klemp, oplech, hromosvod, pojistná hydroizolace, difuzní fóli, parozábran, střešní okn, vikýř, sněhový zachytač, nadkrokevn', '762, 763, 764, 765'],
    ['Okna a dveře', 'okno, oken, okna, dveře, dveří, zárubn, parapet, kování, vrata, prosklen, světlík, rám okna', '766'],
    ['Fasáda a zateplení', 'fasád, zateplen, etics, kontaktní zateplovací, sokl, říms, šambrán, lešení fasád', '622, 629'],
    ['Bourání a demolice', 'bourání, vybour, demont, odstranění, otlučení, odsekání, vysekání, suť, sutě, vyklizení', '96, 97, 997'],
    ['Zdivo a nosné konstrukce', 'zdivo, zdiva, příčk, překlad, věnec, strop, schodiš, ocelové nosník, beton', '31, 34, 41, 42, 43'],
    ['Omítky, malby, nátěry', 'omítk, štuk, malba, malby, nátěr, penetrac, stěrk', '61, 62, 783, 784'],
    ['Podlahy a obklady', 'podlah, potěr, dlažb, parket, mazanin, obklad, lino, vinyl', '63, 771, 775, 776, 781'],
    ['Elektroinstalace', 'elektro, kabel, zásuv, svítidl, rozvaděč, vypínač, jistič, hromosvod', '741, 742, 743, 21'],
    ['ZTI – voda a kanalizace', 'kanaliz, vodovod, potrubí, umyvadl, záchod, wc, baterie, vpust, sprch', '721, 722, 725, 724, 727'],
    ['Vytápění a VZT', 'vytápěn, radiátor, kotel, otopn, vzduchotech, ventilátor, klimatiz, rekuperac', '731, 732, 733, 734, 735, 751'],
  ];
  function panelDruhy(C) {
    const ks = kategorie(R.rec.id);
    return `<div class="rz-top"><span style="font-size:14px">Druh prací = skupina položek z celého rozpočtu (např. Střecha: krokve, bednění, izolace, krytina, okna). Z druhu prací se pak dělá fakturace.</span><span class="sp"></span>
        ${ks.length ? '' : `<button type="button" class="rz-btn" data-a="druhy-vychozi"${ro() ? ' disabled' : ''}>Vytvořit běžné druhy prací</button>`}
        <button type="button" class="rz-btn zl" data-a="druh-novy"${ro() ? ' disabled' : ''}>+ Nový druh prací</button></div>
      ${ks.length ? `<div class="rz-cards">${ks.map(k => { const s = C.katSum[k.id] || {roz: 0, cer: 0, n: 0}; return `<div class="rz-card"><h3>${esc(k.nazev)}</h3>
        <div class="r"><span>Rozpočet</span><b>${kc0(s.roz)}</b></div><div class="r"><span>Vyfakturováno</span><b>${kc0(s.cer)}</b></div><div class="r"><span>Zbývá</span><b>${kc0(s.roz - s.cer)}</b></div>
        <div class="rz-bar"><i class="${s.cer > s.roz + 1 ? 'nad' : ''}" style="width:${Math.min(100, pct(s.cer, s.roz))}%"></i></div><div class="m">${nf0.format(s.n)} položek · čerpáno ${pct(s.cer, s.roz)} %</div>
        <div class="a"><button type="button" class="rz-btn mini" data-ukaz-kat="${esc(k.id)}">Zobrazit položky</button><button type="button" class="rz-btn mini zl" data-navrh="${esc(k.id)}"${ro() ? ' disabled' : ''}>Najít položky…</button><button type="button" class="rz-btn mini" data-fak-kat="${esc(k.id)}"${ro() ? ' disabled' : ''}>Nová fakturace</button><button type="button" class="rz-btn mini" data-upr-kat="${esc(k.id)}"${ro() ? ' disabled' : ''}>Upravit</button></div></div>`; }).join('')}</div>`
      : `<div class="rz-empty"><b>Zatím žádné druhy prací</b>Klikněte <b>Vytvořit běžné druhy prací</b> (Střecha, Okna a dveře, Fasáda, Bourání …) nebo <b>+ Nový druh prací</b>.<br>U každého druhu pak <b>Najít položky…</b> – Constructo navrhne položky z rozpočtu, vy jen potvrdíte.</div>`}`;
  }

  /* ----- panel Fakturace ----- */
  function stavFaktury(f, C) {
    let nad = 0, cena = 0, mimo = 0, kcF = 0;
    (f.pol || []).forEach(l => { kcF += (Number(l.mn) || 0) * (Number(l.jc) || 0); const r = l.r && R.byId.get(l.r); if (!r) { mimo++; return; } const x = C.pol.get(l.r); if (x && (x.nad || x.nadKc)) nad++; if (r.jc != null && Math.abs((Number(l.jc) || 0) - r.jc) > 0.005) cena++; });
    return {nad, cena, mimo, kc: kcF};
  }
  function panelFakturace(C) {
    const fs = faktury(R.rec.id), ks = kategorie(R.rec.id);
    return `<div class="rz-top"><span style="font-size:14px">Fakturace se počítá přímo z rozpočtu: hlídá čerpané a zbývající množství, jinou jednotkovou cenu a položky mimo rozpočet.</span><span class="sp"></span>
        <button type="button" class="rz-btn zl" data-a="fak-nova"${ro() ? ' disabled' : ''}>+ Nová fakturace</button></div>
      ${fs.length ? `<div class="rz-list"><table><thead><tr><th>Číslo</th><th>Firma</th><th>Druh prací</th><th>Období</th><th class="n">Položek</th><th class="n">Částka Kč</th><th>Kontrola</th><th>Stav</th></tr></thead><tbody>
        ${fs.map(f => { const s = stavFaktury(f, C), k = ks.find(z => z.id === f.kat); const fi = (H.firmy() || []).find(z => z.id === f.firma); return `<tr class="kl" data-fak="${esc(f.id)}"><td><b>${esc(f.cislo || '(bez čísla)')}</b></td><td>${esc(fi ? fi.firma : f.firmaN || '')}</td><td>${esc(k ? k.nazev : '')}</td><td>${esc([f.od, f.do].filter(Boolean).map(d => new Date(d).toLocaleDateString('cs-CZ')).join(' – '))}</td><td class="n">${(f.pol || []).length}</td><td class="n"><b>${kc(s.kc)}</b></td>
          <td>${s.nad || s.cena || s.mimo ? `<span class="rz-war">⚠</span> ${[s.nad ? s.nad + '× nad rozpočet' : '', s.cena ? s.cena + '× jiná cena' : '', s.mimo ? s.mimo + '× mimo rozpočet' : ''].filter(Boolean).join(', ')}` : '<span class="rz-ok">✓ v pořádku</span>'}</td><td>${f.stav === 'schvaleno' ? '<b style="color:#2f7d4f">schváleno</b>' : 'rozpracováno'}</td></tr>`; }).join('')}
        <tr><td colspan="5"><b>Celkem</b></td><td class="n"><b>${kc(fs.reduce((a, f) => a + stavFaktury(f, C).kc, 0))}</b></td><td colspan="2"></td></tr></tbody></table></div>`
      : `<div class="rz-empty"><b>Zatím žádná fakturace</b><ol><li>Klikněte <b>+ Nová fakturace</b>.</li><li>Vyberte firmu a případně druh prací (např. Střecha).</li><li>Přidejte položky z rozpočtu, nebo načtěte soupis provedených prací od firmy z Excelu.</li><li>Constructo hned ukáže, kolik je čerpáno, kolik zbývá a co nesedí.</li></ol></div>`}`;
  }

  /* ---------- obsluha ---------- */
  function vazby() {
    const $$ = s => EL.querySelectorAll(s), on = (s, ev, f) => $$(s).forEach(e => e.addEventListener(ev, f));
    on('[data-a="import"]', 'click', () => vyberSoubor());
    on('[data-a="znovu"]', 'click', () => { S.chyba = ''; prekresli(); });
    on('[data-a="rp"]', 'change', e => { S.rp = e.target.value; pamSet('rz-rp', S.rp); S.vyb.clear(); prekresli(); });
    on('[data-p]', 'click', e => { S.panel = e.currentTarget.dataset.p; pamSet('rz-panel', S.panel); prekresli(); });
    on('[data-a="menu-rp"]', 'click', e => menuRozpoctu(e.currentTarget));
    on('[data-a="xls-roz"]', 'click', () => excelRozpocet());
    on('[data-rez]', 'click', e => { S.rezim = e.currentTarget.dataset.rez; pamSet('rz-rezim', S.rezim); S.otev.clear(); S.zav.clear(); SCROLL = 0; prekresli(); });
    const q = EL.querySelector('[data-a="q"]');
    if (q) { let t = 0; q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { S.q = q.value; SCROLL = 0; const pos = q.selectionStart; prekresli(); const n = EL.querySelector('[data-a="q"]'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} } }, 250); }); }
    on('[data-a="obj"]', 'change', e => { S.obj = e.target.value; SCROLL = 0; prekresli(); });
    on('[data-a="kat"]', 'change', e => { S.kat = e.target.value; SCROLL = 0; prekresli(); });
    on('[data-a="upoz"]', 'change', e => { S.jenUpoz = e.target.checked; SCROLL = 0; prekresli(); });
    on('[data-a="v-zrus"]', 'click', () => { S.vyb.clear(); prekresli(); });
    on('[data-a="v-kat"]', 'click', () => zaraditDoDruhu([...S.vyb]));
    on('[data-a="v-kat-pryc"]', 'click', () => { const k = kategorie(R.rec.id).find(z => z.id === S.kat); if (!k) return; const x = new Set(S.vyb); H.upsert('rozpKat', [Object.assign({}, k, {pol: (k.pol || []).filter(id => !x.has(id))})]); toast('Odebráno z druhu ' + k.nazev + '.'); S.vyb.clear(); });
    on('[data-a="v-obj"]', 'click', () => priraditObjekt([...S.vyb]));
    on('[data-a="v-fak"]', 'click', () => novaFakturace({polozky: [...S.vyb], kat: S.kat}));
    on('[data-a="vyb-vse"]', 'change', e => { VIS.forEach(i => { const r = R.rows[i]; if (r.t === 'P') e.target.checked ? S.vyb.add(r.id) : S.vyb.delete(r.id); }); prekresli(); });
    const tab = EL.querySelector('.rz-tab');
    if (tab) {
      tab.addEventListener('scroll', () => { if (rafK) return; rafK = requestAnimationFrame(() => { rafK = 0; SCROLL = tab.scrollTop; kresliRadky(); }); });
      tab.addEventListener('click', e => {
        const tg = e.target.closest('[data-tg]');
        if (tg) { const r = R.rows[+tg.dataset.tg]; const ted = rozbaleno(r) && !(filtrAktivni() && r.t === 'P' && !S.otev.has(r.id)); if (ted) { S.otev.delete(r.id); S.zav.add(r.id); } else { S.zav.delete(r.id); S.otev.add(r.id); } SCROLL = tab.scrollTop; prekresli(); return; }
      });
      tab.addEventListener('change', e => {
        const vp = e.target.closest('[data-vp]'), vs = e.target.closest('[data-vs]');
        if (vp) { const r = R.rows[+vp.dataset.vp]; vp.checked ? S.vyb.add(r.id) : S.vyb.delete(r.id); SCROLL = tab.scrollTop; prekresli(); }
        if (vs) { const i = +vs.dataset.vs, add = vs.checked; const st = [i]; while (st.length) { const k = st.pop(); R.deti[k].forEach(c => { const r = R.rows[c]; if (r.t === 'P') add ? S.vyb.add(r.id) : S.vyb.delete(r.id); else if (r.t !== 'D') st.push(c); }); } SCROLL = tab.scrollTop; prekresli(); }
      });
    }
    on('[data-lobj]', 'change', e => { const o = Object.assign({}, R.rec.obj || {}); if (e.target.value) o[e.target.dataset.lobj] = e.target.value; else delete o[e.target.dataset.lobj]; H.upsert('rozpocty', [Object.assign({}, R.rec, {obj: o})]); });
    on('[data-ukaz-obj]', 'click', e => { S.obj = e.currentTarget.dataset.ukazObj; S.kat = ''; S.panel = 'rozpocet'; SCROLL = 0; prekresli(); });
    on('[data-ukaz-kat]', 'click', e => { S.kat = e.currentTarget.dataset.ukazKat; S.obj = ''; S.panel = 'rozpocet'; SCROLL = 0; prekresli(); });
    on('[data-navrh]', 'click', e => najitPolozky(e.currentTarget.dataset.navrh));
    on('[data-upr-kat]', 'click', e => upravitDruh(e.currentTarget.dataset.uprKat));
    on('[data-fak-kat]', 'click', e => novaFakturace({kat: e.currentTarget.dataset.fakKat}));
    on('[data-a="druh-novy"]', 'click', () => upravitDruh(''));
    on('[data-a="druhy-vychozi"]', 'click', () => { const now = new Date().toISOString(); H.upsert('rozpKat', VYCHOZI_DRUHY.map(([n, s, k]) => ({id: 'rk' + uid(), rp: R.rec.id, nazev: n, slova: s, kody: k, pol: [], kdo: kdo(), kdy: now}))); toast('Druhy prací vytvořeny. U každého klikněte Najít položky…'); });
    on('[data-a="fak-nova"]', 'click', () => novaFakturace({}));
    on('[data-fak]', 'click', e => editorFaktury(e.currentTarget.dataset.fak));
    // přetažení souboru
    if (!EL._drop) {
      EL._drop = true;
      EL.addEventListener('dragover', e => { if (EL.querySelector('.rz') && e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
      EL.addEventListener('drop', e => { if (!EL.querySelector('.rz')) return; const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) { e.preventDefault(); if (ro()) return toast('Jen prohlížení: nahrávat nejde.'); otevriSoubor(f, 'rozpocet'); } });
    }
  }

  /* ---------- okna ---------- */
  function okno(nadpis, telo, paticka, trida) {
    const ov = document.createElement('div'); ov.className = 'rz-ov';
    ov.innerHTML = `<div class="rz-dlg ${trida || ''}" role="dialog" aria-modal="true" aria-label="${esc(nadpis)}"><div class="rz-dh"><h3>${esc(nadpis)}</h3><button type="button" class="rz-x" data-x>✕ Zavřít</button></div><div class="rz-db">${telo}</div>${paticka ? `<div class="rz-df">${paticka}</div>` : ''}</div>`;
    document.body.appendChild(ov);
    const zavri = () => { ov.remove(); document.removeEventListener('keydown', kl); };
    const kl = e => { if (e.key === 'Escape' && document.body.lastElementChild === ov) zavri(); };
    document.addEventListener('keydown', kl);
    ov.querySelector('[data-x]').onclick = zavri;
    ov.zavri = zavri;
    return ov;
  }
  function cekej(text) {
    const w = document.createElement('div'); w.className = 'rz-wait'; w.innerHTML = `<div><b>${esc(text)}</b><small></small><div class="rz-prog" style="margin-top:10px"><i style="width:5%"></i></div></div>`;
    document.body.appendChild(w);
    return {el: w, text: (t, p) => { w.querySelector('b').textContent = t; if (p != null) w.querySelector('i').style.width = Math.max(5, Math.min(100, p)) + '%'; }, maly: t => { w.querySelector('small').textContent = t; }, konec: () => w.remove()};
  }
  function menuRozpoctu(btn) {
    const rec = R && R.rec; if (!rec) return;
    const ov = okno('Rozpočet: ' + rec.nazev, `<div class="rz-pole"><label>Název rozpočtu<input id="rz-m-n" value="${esc(rec.nazev)}"${ro() ? ' disabled' : ''}></label></div>
      <p style="margin:0;font-size:13.5px">Soubor: ${esc(rec.soubor || '')} · ${nf0.format(rec.pocet || 0)} řádků, ${nf0.format(rec.polozek || 0)} položek · nahrál(a) ${esc(rec.kdo || '')} ${rec.kdy ? new Date(rec.kdy).toLocaleString('cs-CZ') : ''}</p>
      <p style="margin:0;font-size:13.5px">Novou verzi rozpočtu (opravený Excel) nahrajete přes <b>Nahrát rozpočet z Excelu</b> → <b>Nahradit tento rozpočet</b>. Druhy prací, objekty i fakturace u stejných položek zůstanou.</p>`,
      `<button type="button" class="rz-btn del" data-smaz${ro() ? ' disabled' : ''}>Smazat rozpočet</button><span class="sp"></span><button type="button" class="rz-btn zl" data-ok${ro() ? ' disabled' : ''}>Uložit</button>`, 'uzky');
    ov.querySelector('[data-ok]').onclick = () => { const n = ov.querySelector('#rz-m-n').value.trim(); if (n) H.upsert('rozpocty', [Object.assign({}, rec, {nazev: n})]); ov.zavri(); };
    ov.querySelector('[data-smaz]').onclick = () => {
      const fs = faktury(rec.id).length;
      if (!confirm('Opravdu smazat rozpočet „' + rec.nazev + '“' + (fs ? ' i s ' + fs + ' fakturacemi' : '') + '? Smaže se všem kolegům.')) return;
      H.smaz('faktury', faktury(rec.id).map(f => f.id)); H.smaz('rozpKat', kategorie(rec.id).map(k => k.id)); H.smaz('rozpocty', [rec.id]);
      if (rec.gid && H.pripojeno()) H.volej({akce: 'dok_smaz', ids: [rec.gid]}).catch(() => {});
      idbDel(klic(rec)); NACTENO.delete(rec.id); R = null; ov.zavri();
    };
  }
  function priraditObjekt(ids) {
    const ov = okno('Přiřadit objekt', `<p style="margin:0">Vybraným ${ids.length} položkám nastavit objekt:</p><div class="rz-seg" style="flex-wrap:wrap">${OBJEKTY.map(o => `<button type="button" data-o="${esc(o)}">${esc(o)}</button>`).join('')}<button type="button" data-o="">Podle listu</button></div>`, '', 'uzky');
    ov.querySelectorAll('[data-o]').forEach(b => b.onclick = () => { const o = Object.assign({}, R.rec.obj || {}); ids.forEach(id => { if (b.dataset.o) o[id] = b.dataset.o; else delete o[id]; }); H.upsert('rozpocty', [Object.assign({}, R.rec, {obj: o})]); S.vyb.clear(); ov.zavri(); toast('Objekt nastaven.'); });
  }
  function zaraditDoDruhu(ids) {
    const ks = kategorie(R.rec.id);
    const ov = okno('Zařadit do druhu prací', `<p style="margin:0">${ids.length} vybraných položek zařadit do:</p><div style="display:flex;flex-wrap:wrap;gap:6px">${ks.map(k => `<button type="button" class="rz-btn" data-k="${esc(k.id)}">${esc(k.nazev)}</button>`).join('')}</div>
      <div class="rz-pole"><label>…nebo nový druh prací<input id="rz-nk" placeholder="např. Střecha – objekt A"></label></div>`, '<button type="button" class="rz-btn zl" data-novy>Vytvořit a zařadit</button>', 'uzky');
    const pridej = k => { const s = new Set(k.pol || []); ids.forEach(i => s.add(i)); H.upsert('rozpKat', [Object.assign({}, k, {pol: [...s]})]); S.vyb.clear(); ov.zavri(); toast(ids.length + ' položek je v druhu ' + k.nazev + '.'); };
    ov.querySelectorAll('[data-k]').forEach(b => b.onclick = () => pridej(ks.find(k => k.id === b.dataset.k)));
    ov.querySelector('[data-novy]').onclick = () => { const n = ov.querySelector('#rz-nk').value.trim(); if (!n) return toast('Napište název druhu prací.'); pridej({id: 'rk' + uid(), rp: R.rec.id, nazev: n, slova: '', kody: '', pol: [], kdo: kdo(), kdy: new Date().toISOString()}); };
  }
  function upravitDruh(id) {
    const k = id ? kategorie(R.rec.id).find(z => z.id === id) : null;
    const ov = okno(k ? 'Upravit druh prací' : 'Nový druh prací', `<div class="rz-pole" style="grid-template-columns:1fr"><label>Název<input id="rz-k-n" value="${esc(k ? k.nazev : '')}" placeholder="např. Střecha"></label>
      <label>Slova pro hledání položek (oddělte čárkou, stačí začátek slova)<textarea id="rz-k-s" rows="3" placeholder="krokev, trám, bednění, krytina, oplech, střešní okno">${esc(k ? k.slova : '')}</textarea></label>
      <label>Začátky kódů položek ÚRS (nepovinné, např. 762 = tesařské, 764 = klempířské, 765 = krytiny)<input id="rz-k-k" value="${esc(k ? k.kody : '')}" placeholder="762, 764, 765"></label></div>
      ${k ? `<p style="margin:0;font-size:13.5px">V druhu je ${(k.pol || []).length} položek.</p>` : ''}`,
      `${k ? '<button type="button" class="rz-btn del" data-smaz>Smazat druh</button>' : ''}<span class="sp"></span><button type="button" class="rz-btn zl" data-ok>${k ? 'Uložit' : 'Vytvořit a najít položky'}</button>`, 'uzky');
    ov.querySelector('[data-ok]').onclick = () => {
      const n = ov.querySelector('#rz-k-n').value.trim(); if (!n) return toast('Napište název.');
      const rec = Object.assign({}, k || {id: 'rk' + uid(), rp: R.rec.id, pol: [], kdo: kdo(), kdy: new Date().toISOString()}, {nazev: n, slova: ov.querySelector('#rz-k-s').value.trim(), kody: ov.querySelector('#rz-k-k').value.trim()});
      H.upsert('rozpKat', [rec]); ov.zavri(); if (!k) setTimeout(() => najitPolozky(rec.id), 50);
    };
    const sm = ov.querySelector('[data-smaz]');
    if (sm) sm.onclick = () => { if (!confirm('Smazat druh prací „' + k.nazev + '“? Položky v rozpočtu zůstanou.')) return; H.smaz('rozpKat', [k.id]); if (S.kat === k.id) S.kat = ''; ov.zavri(); };
  }
  // návrh položek do druhu prací: slova v popisu (i v názvu dílu) a začátky kódů
  function najitPolozky(kid) {
    const k = kategorie(R.rec.id).find(z => z.id === kid); if (!k) return;
    const C = spocti(R);
    const slova = String(k.slova || '').split(/[,;\n]/).map(s => norm(s)).filter(s => s.length >= 2);
    const kody = String(k.kody || '').split(/[,;\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
    const uz = new Set(k.pol || []);
    const shoda = r => {
      const h = ' ' + norm(r.d) + ' ', dil = R.rows[r.p] && R.rows[r.p].t !== 'L' ? ' ' + norm(R.rows[r.p].d) + ' ' : '';
      const sl = slova.find(s => h.includes(' ' + s) || h.includes('-' + s));
      if (sl) return 'slovo „' + sl + '“';
      const kd = kody.find(c => String(r.k).toUpperCase().replace(/\s/g, '').startsWith(c));
      if (kd) return 'kód ' + kd;
      const dl = slova.find(s => dil.includes(' ' + s));
      if (dl) return 'díl „' + R.rows[r.p].d + '“';
      return '';
    };
    const nal = [];
    R.polozky.forEach(r => { if (uz.has(r.id)) return; const d = shoda(r); if (d) nal.push({r, d}); });
    const vybr = new Set(nal.map(x => x.r.id));
    const ov = okno('Najít položky: ' + k.nazev, `<p style="margin:0">Constructo našlo <b>${nal.length}</b> položek, které se hodí do druhu <b>${esc(k.nazev)}</b>${uz.size ? ` (dalších ${uz.size} už v něm je)` : ''}. Odškrtněte ty, které tam nepatří, a klikněte <b>Přidat vybrané</b>.</p>
      <div class="rz-fil"><input class="rz-q" type="search" id="rz-nf" placeholder="Zúžit seznam…"><button type="button" class="rz-btn mini" data-vse>Vybrat vše</button><button type="button" class="rz-btn mini" data-nic>Zrušit vše</button><span id="rz-nc" style="font-size:13px"></span></div>
      <div class="rz-list" style="max-height:55vh"><table><thead><tr><th></th><th>Obj.</th><th>Kód</th><th>Popis</th><th>MJ</th><th class="n">Množství</th><th class="n">Celkem Kč</th><th>Proč</th></tr></thead><tbody id="rz-nb"></tbody></table></div>`,
      `<span class="sp"></span><button type="button" class="rz-btn zl" data-ok>Přidat vybrané</button>`, 'siroky');
    const kresli = () => {
      const q = norm(ov.querySelector('#rz-nf').value), sl = q.split(' ').filter(Boolean);
      const vid = nal.filter(x => !sl.length || sl.every(s => norm(x.r.k + ' ' + x.r.d).includes(s))).slice(0, 3000);
      ov.querySelector('#rz-nb').innerHTML = vid.map(x => `<tr><td><input type="checkbox" data-n="${esc(x.r.id)}"${vybr.has(x.r.id) ? ' checked' : ''}></td><td>${obBadge(C.obj[x.r.i])}</td><td>${esc(x.r.k)}</td><td>${esc(x.r.d)}</td><td>${esc(x.r.mj)}</td><td class="n">${mnT(x.r.mn)}</td><td class="n">${kc(x.r.cc)}</td><td style="font-size:12px;color:var(--muted)">${esc(x.d)}</td></tr>`).join('') + (vid.length >= 3000 ? '<tr><td colspan="8">… zobrazeno prvních 3000, zužte hledání</td></tr>' : '');
      ov.querySelector('#rz-nc').textContent = 'vybráno ' + vybr.size;
    };
    kresli();
    ov.querySelector('#rz-nf').oninput = kresli;
    ov.querySelector('#rz-nb').onchange = e => { const c = e.target.closest('[data-n]'); if (!c) return; c.checked ? vybr.add(c.dataset.n) : vybr.delete(c.dataset.n); ov.querySelector('#rz-nc').textContent = 'vybráno ' + vybr.size; };
    ov.querySelector('[data-vse]').onclick = () => { const q = norm(ov.querySelector('#rz-nf').value).split(' ').filter(Boolean); nal.forEach(x => { if (!q.length || q.every(s => norm(x.r.k + ' ' + x.r.d).includes(s))) vybr.add(x.r.id); }); kresli(); };
    ov.querySelector('[data-nic]').onclick = () => { vybr.clear(); kresli(); };
    ov.querySelector('[data-ok]').onclick = () => { const akt = kategorie(R.rec.id).find(z => z.id === kid) || k; const s = new Set(akt.pol || []); vybr.forEach(i => s.add(i)); H.upsert('rozpKat', [Object.assign({}, akt, {pol: [...s]})]); ov.zavri(); toast('Přidáno ' + vybr.size + ' položek do ' + k.nazev + '.'); };
  }

  /* ---------- import Excelu ---------- */
  function vyberSoubor(ucel, hotovo) {
    if (ro()) return toast('Jen prohlížení: nahrávat nejde.');
    const i = document.createElement('input'); i.type = 'file'; i.accept = '.xlsx,.xlsm,.xls,.ods,.csv'; i.hidden = true;
    i.onchange = () => { const f = i.files && i.files[0]; i.remove(); if (f) otevriSoubor(f, ucel || 'rozpocet', hotovo); };
    document.body.appendChild(i); i.click();
  }
  async function otevriSoubor(f, ucel, hotovo) {
    const w = cekej('Čtu ' + f.name + '…');
    w.maly('Velký rozpočet může trvat i půl minuty. Okno se mezitím nezasekne.');
    try {
      const buf = await f.arrayBuffer();
      w.text('Čtu ' + f.name + '…', 30);
      const res = await worker({akce: 'cti', buf}, [buf]);
      w.text('Rozpoznávám sloupce…', 80);
      await new Promise(r => setTimeout(r, 30));
      const listy = res.listy.filter(l => l.rows.length);
      if (!listy.length) throw new Error('V souboru nejsou žádné řádky.');
      const nast = listy.map(l => { const r = rozpoznej(l); return Object.assign(r, {zahrnout: false}); });
      listy.forEach((l, i) => { const s = souhrnListu(l, nast[i]); nast[i].souhrn = s; nast[i].zahrnout = s.pol >= 3 && !/rekapitul|kryci list|krycí list|souhrn/i.test(bezDia(l.n)); nast[i].obj = odhadObjektu(l); });
      if (!nast.some(n => n.zahrnout)) { let m = -1, mi = 0; nast.forEach((n, i) => { if (n.souhrn.pol > m) { m = n.souhrn.pol; mi = i; } }); nast[mi].zahrnout = true; }
      w.konec();
      if (ucel === 'soupis') hotovo(f, listy, nast); else dialogImportu(f, listy, nast);
    } catch (e) { w.konec(); toast('Soubor se nepodařilo načíst: ' + (e.message || e)); }
  }
  function odhadObjektu(l) {
    const zdroje = [l.n].concat(l.rows.slice(0, 30).map(r => r.map(txt).join(' ')));
    for (const z of zdroje) { const m = /objekt(?:u)?\s*[„"]?([A-G])\b/i.exec(z) || /\b(?:SO|PS)\s*0?\d+\s*[-–]?\s*(?:objekt\s*)?([A-G])\b(?![a-z])/i.exec(z); if (m) return m[1].toUpperCase(); }
    return '';
  }
  function dialogImportu(f, listy, nast) {
    const list = rozpocty();
    const vychNazev = f.name.replace(/\.(xlsx|xlsm|xls|ods|csv)$/i, '');
    let cil = '';  // '' = nový, jinak id rozpočtu k nahrazení
    const ov = okno('Nahrát rozpočet: ' + f.name, '<div id="rz-imp"></div>', `<span id="rz-imp-s" style="font-size:14px"></span><span class="sp"></span><button type="button" class="rz-btn zl" data-ok>Uložit rozpočet</button>`, 'siroky');
    const telo = ov.querySelector('#rz-imp');
    const volby = (ns, l) => { let o = '<option value="">— není —</option>'; for (let c = 0; c < ns.nc; c++) o += `<option value="${c}">${sloupec(c + (l.odSl || 0))}${ns.nazvy[c] ? ': ' + esc(ns.nazvy[c].slice(0, 30)) : ''}</option>`; return o; };
    const nahled = (l, ns) => {
      const rows = ns.souhrn.rows.filter(r => r.t !== 'L');
      const ukaz = []; let p = 0, d = 0;
      for (const r of rows) { if (r.t === 'P' && p < 6) { ukaz.push(r); p++; } else if ((r.t === 'S1' || r.t === 'S2') && ukaz.length < 14) ukaz.push(r); else if (r.t === 'D' && d < 3 && p) { ukaz.push(r); d++; } if (ukaz.length >= 14) break; }
      const nm = {S1: 'díl', S2: 'díl', P: 'položka', D: 'podrobnost', T: 'součet'};
      return `<div class="rz-nah"><table><thead><tr><th>Řádek</th><th>Constructo to bere jako</th><th>PČ</th><th>Kód</th><th>Popis</th><th>MJ</th><th>Množství</th><th>J. cena</th><th>Celkem</th></tr></thead><tbody>${ukaz.map(r => `<tr class="${r.t[0]}"><td>${r.x}${r.h ? ' (skrytý)' : ''}</td><td>${nm[r.t]}</td><td>${esc(r.pc)}</td><td>${esc(r.k)}</td><td>${esc(r.d.slice(0, 80))}</td><td>${esc(r.mj)}</td><td>${mnT(r.mn)}</td><td>${kc(r.jc)}</td><td>${kc(r.cc)}</td></tr>`).join('')}</tbody></table></div>`;
    };
    const kresli = () => {
      let pol = 0, cel = 0, rad = 0, sk = 0;
      nast.forEach(n => { if (n.zahrnout) { pol += n.souhrn.pol; cel += n.souhrn.cel; rad += n.souhrn.rows.length; sk += n.souhrn.sk; } });
      telo.innerHTML = `<div class="rz-pole"><label>Název rozpočtu<input id="rz-i-n" value="${esc(telo.dataset.n || vychNazev)}"></label>
          ${list.length ? `<label>Co s ním udělat<select id="rz-i-c"><option value="">Přidat jako nový rozpočet</option>${list.map(r => `<option value="${esc(r.id)}"${cil === r.id ? ' selected' : ''}>Nahradit rozpočet „${esc(r.nazev)}“ (novou verzí)</option>`).join('')}</select></label>` : ''}</div>
        <div class="rz-info">Zkontrolujte, že sedí sloupce (zeleně = poznáno). Pokud ne, vyberte správný sloupec v rozbalovacím seznamu. Řádky skryté v Excelu Constructo načte všechny – v tabulce půjdou rozbalit a zase schovat. Listy jako Rekapitulace nebo Krycí list nechte vypnuté, jinak by se ceny započítaly dvakrát.</div>
        ${listy.map((l, i) => { const ns = nast[i], s = ns.souhrn; return `<div class="rz-list-sh${ns.zahrnout ? '' : ' vyp'}">
          <h4><label class="rz-chk"><input type="checkbox" data-zahr="${i}"${ns.zahrnout ? ' checked' : ''}> List „${esc(l.n)}“</label><span style="font-weight:400;font-size:13px;color:var(--muted)">${nf0.format(l.rows.length)} řádků v Excelu${l.skryto.some(Boolean) ? ', z toho ' + nf0.format(l.skryto.filter(Boolean).length) + ' skrytých' : ''} · poznáno <b>${nf0.format(s.pol)}</b> položek za <b>${kc0(s.cel)}</b></span>
          <span style="flex:1"></span><label style="font-size:13px;font-weight:600">Objekt <select class="rz-sel" data-lo="${i}"><option value="">— bez objektu —</option>${OBJEKTY.map(o => `<option value="${esc(o)}"${ns.obj === o ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></label></h4>
          ${ns.zahrnout ? `<div class="rz-map">${ROLE.map(([k, n]) => `<label>${esc(n)}<select data-m="${i}" data-k="${k}" class="${ns.map[k] != null ? 'ok' : ['popis', 'mn', 'jc'].includes(k) ? 'chybi' : ''}">${volby(ns, l)}</select></label>`).join('')}
            <label>Hlavička je na řádku<select data-h="${i}"><option value="-1">bez hlavičky</option>${l.rows.slice(0, 120).map((r, ri) => `<option value="${ri}"${ri === ns.hlavicka ? ' selected' : ''}>${l.od + ri + 1}: ${esc(r.map(txt).filter(Boolean).join(' | ').slice(0, 50))}</option>`).join('')}</select></label></div>
          ${nahled(l, ns)}` : ''}</div>`; }).join('')}`;
      telo.querySelectorAll('[data-m]').forEach(s => { const ns = nast[+s.dataset.m]; s.value = ns.map[s.dataset.k] == null ? '' : String(ns.map[s.dataset.k]); });
      ov.querySelector('#rz-imp-s').innerHTML = `Uloží se <b>${nf0.format(pol)}</b> položek · ${nf0.format(rad)} řádků (${nf0.format(sk)} skrytých) · celkem <b>${kc0(cel)}</b>`;
    };
    const prepocti = i => { nast[i].souhrn = souhrnListu(listy[i], nast[i]); };
    telo.addEventListener('change', e => {
      const t = e.target;
      if (t.id === 'rz-i-n') { telo.dataset.n = t.value; return; }
      if (t.id === 'rz-i-c') { cil = t.value; const r = list.find(x => x.id === cil); if (r) telo.dataset.n = r.nazev; kresli(); return; }
      if (t.dataset.zahr != null) { nast[+t.dataset.zahr].zahrnout = t.checked; kresli(); return; }
      if (t.dataset.lo != null) { nast[+t.dataset.lo].obj = t.value; return; }
      if (t.dataset.m != null) { const i = +t.dataset.m, k = t.dataset.k, v = t.value === '' ? null : +t.value; Object.keys(nast[i].map).forEach(z => { if (nast[i].map[z] === v && v != null) delete nast[i].map[z]; }); if (v == null) delete nast[i].map[k]; else nast[i].map[k] = v; prepocti(i); kresli(); return; }
      if (t.dataset.h != null) { const i = +t.dataset.h, ns = nast[i]; ns.hlavicka = +t.value; const hl = listy[i].rows[ns.hlavicka] || []; ns.nazvy = []; for (let c = 0; c < ns.nc; c++) ns.nazvy.push(txt(hl[c])); prepocti(i); kresli(); }
    });
    telo.addEventListener('input', e => { if (e.target.id === 'rz-i-n') telo.dataset.n = e.target.value; });
    kresli();
    ov.querySelector('[data-ok]').onclick = async () => {
      if (!nast.some(n => n.zahrnout)) return toast('Zapněte aspoň jeden list.');
      const nazev = (telo.dataset.n || vychNazev).trim() || vychNazev;
      ov.zavri();
      await ulozitImport(f, listy, nast, nazev, cil);
    };
  }
  async function ulozitImport(f, listy, nast, nazev, cil) {
    const w = cekej('Ukládám rozpočet…');
    try {
      const rows = sestav(listy, nast);
      const stary = cil && rozpocty().find(r => r.id === cil);
      const id = stary ? stary.id : 'rp' + uid(), rev = Date.now();
      const obj = Object.assign({}, stary ? stary.obj || {} : {});
      rows.forEach(r => { if (r.t === 'L') { const o = nast[r.s].obj; if (o) obj[r.id] = o; else if (!stary) delete obj[r.id]; } });
      const ids = new Set(rows.map(r => r.id)); Object.keys(obj).forEach(k => { if (!ids.has(k)) delete obj[k]; });
      const pol = rows.filter(r => r.t === 'P');
      const data = {v: 1, listy: listy.map((l, i) => ({n: l.n, map: nast[i].map, hlavicka: nast[i].hlavicka, zahrnout: nast[i].zahrnout})), rows: naPole(rows)};
      w.text('Komprimuji ' + nf0.format(rows.length) + ' řádků…', 40);
      const gz = await gzip(JSON.stringify(data));
      await idbPut('r:' + id + ':' + rev, {gz, kdy: Date.now()});
      const rec = Object.assign({}, stary || {}, {id, nazev, soubor: f.name, rev, gid: '', vel: gz.size, pocet: rows.length, polozek: pol.length, celkem: Math.round(pol.reduce((a, r) => a + (r.cc || 0), 0) * 100) / 100, kdo: kdo(), pc: pcId(), kdy: new Date().toISOString(), obj, listy: listy.map((l, i) => nast[i].zahrnout ? l.n : null).filter(Boolean)});
      NACTENO.set(id, {rev, R: Object.assign(priprav(rec, rows), {listy: data.listy})});
      R = NACTENO.get(id).R;
      H.upsert('rozpocty', [rec]);
      if (stary) { const old = 'r:' + stary.id + ':' + stary.rev; idbDel(old); if (stary.gid && H.pripojeno()) H.volej({akce: 'dok_smaz', ids: [stary.gid]}).catch(() => {}); }
      S.rp = id; pamSet('rz-rp', id); S.panel = 'rozpocet'; S.vyb.clear(); S.otev.clear(); S.zav.clear(); SCROLL = 0;
      if (H.pripojeno()) {
        w.text('Ukládám na Disk Google (' + Math.round(gz.size / 1024) + ' kB)…', 70);
        try {
          const gid = await nahrajNaDisk(rec, gz);
          if (gid) { const akt = sez('rozpocty').find(x => x.id === id) || rec; H.upsert('rozpocty', [Object.assign({}, akt, {gid})]); }
          toast('Rozpočet uložen: ' + nf0.format(pol.length) + ' položek. Kolegové ho uvidí v záložce Rozpočet.');
        } catch (e) { S.chyba = 'Rozpočet je uložený v tomto počítači, na Disk Google se zatím nedostal (' + e.message + '). Zkusím to znovu sám.'; toast(S.chyba); }
      } else toast('Rozpočet uložen v tomto počítači (' + nf0.format(pol.length) + ' položek).');
    } catch (e) { toast('Rozpočet se nepodařilo uložit: ' + (e.message || e)); }
    finally { w.konec(); prekresli(); }
  }

  /* ---------- fakturace ---------- */
  function novaFakturace(o) {
    if (!R) return;
    const f = {id: 'fa' + uid(), rp: R.rec.id, cislo: '', firma: '', kat: o.kat || '', od: '', do: '', datum: new Date().toISOString().slice(0, 10), pozn: '', stav: 'rozpracovano', pol: [], kdo: kdo(), kdy: new Date().toISOString()};
    const n = faktury(R.rec.id).length + 1; f.cislo = 'F' + String(n).padStart(2, '0');
    (o.polozky || []).forEach(id => { const r = R.byId.get(id); if (r && r.t === 'P') f.pol.push({r: id, mn: 0, jc: r.jc || 0}); });
    S.vyb.clear();
    editorFaktury(null, f);
  }
  function editorFaktury(fid, nova) {
    const puv = nova || faktury(R.rec.id).find(f => f.id === fid); if (!puv) return;
    const F = JSON.parse(JSON.stringify(puv));
    const C0 = spocti(R);
    const ks = kategorie(R.rec.id), firmy = H.firmy() || [];
    // dříve vyfakturováno (jiné fakturace) po položkách
    const jinde = new Map();
    faktury(R.rec.id).forEach(f => { if (f.id === F.id) return; (f.pol || []).forEach(l => { if (l.r) jinde.set(l.r, (jinde.get(l.r) || 0) + (Number(l.mn) || 0)); }); });
    const jindeKc = new Map();
    faktury(R.rec.id).forEach(f => { if (f.id === F.id) return; (f.pol || []).forEach(l => { if (l.r) jindeKc.set(l.r, (jindeKc.get(l.r) || 0) + (Number(l.mn) || 0) * (Number(l.jc) || 0)); }); });
    const ov = okno(nova ? 'Nová fakturace' : 'Fakturace ' + (F.cislo || ''), `
      <div class="rz-pole"><label>Číslo / označení<input data-f="cislo" value="${esc(F.cislo)}"></label>
        <label>Firma<select data-f="firma"><option value="">— vyberte firmu —</option>${firmy.map(z => `<option value="${esc(z.id)}"${F.firma === z.id ? ' selected' : ''}>${esc(z.firma)}</option>`).join('')}</select></label>
        <label>Druh prací<select data-f="kat"><option value="">— celý rozpočet —</option>${ks.map(k => `<option value="${esc(k.id)}"${F.kat === k.id ? ' selected' : ''}>${esc(k.nazev)}</option>`).join('')}</select></label>
        <label>Období od<input type="date" data-f="od" value="${esc(F.od)}"></label><label>Období do<input type="date" data-f="do" value="${esc(F.do)}"></label>
        <label>Datum<input type="date" data-f="datum" value="${esc(F.datum)}"></label>
        <label>Stav<select data-f="stav"><option value="rozpracovano"${F.stav !== 'schvaleno' ? ' selected' : ''}>rozpracováno</option><option value="schvaleno"${F.stav === 'schvaleno' ? ' selected' : ''}>schváleno</option></select></label>
        <label>Poznámka<input data-f="pozn" value="${esc(F.pozn)}"></label></div>
      <div class="rz-fil"><button type="button" class="rz-btn zl" data-pridat>+ Přidat položky z rozpočtu</button><button type="button" class="rz-btn" data-soupis>⬆ Načíst soupis prací z Excelu</button><button type="button" class="rz-btn" data-mimo>+ Položka mimo rozpočet</button><span class="sp" style="flex:1"></span><button type="button" class="rz-btn" data-xls>⬇ Excel</button></div>
      <div id="rz-fw"></div>
      <div class="rz-list rz-fl"><table><thead><tr><th>Kód</th><th>Popis</th><th>MJ</th><th class="n">V rozpočtu</th><th class="n">Dříve vyfakt.</th><th class="n">Tato fakturace</th><th class="n">J. cena</th><th class="n">Celkem Kč</th><th class="n">Zbývá MJ</th><th>Kontrola</th><th></th></tr></thead><tbody id="rz-fb"></tbody></table></div>`,
      `${nova ? '' : '<button type="button" class="rz-btn del" data-smaz>Smazat fakturaci</button>'}<span id="rz-fs" style="font-size:15px"></span><span class="sp"></span><button type="button" class="rz-btn zl" data-ok>Uložit fakturaci</button>`, 'siroky');
    const kontrola = l => {
      const r = l.r && R.byId.get(l.r), w = [];
      if (!r) { w.push(['o', 'Položka není v rozpočtu (vícepráce?)']); return {r, w, zb: null}; }
      const celk = (jinde.get(l.r) || 0) + (Number(l.mn) || 0);
      const zb = r.mn != null ? r.mn - celk : null;
      if (r.mn != null && celk > r.mn + Math.max(EPS, Math.abs(r.mn) * 1e-9)) w.push(['', `Překročeno množství o ${mnT(celk - r.mn)} ${r.mj} (rozpočet ${mnT(r.mn)}, vyfakturováno celkem ${mnT(celk)})`]);
      if (r.jc != null && Math.abs((Number(l.jc) || 0) - r.jc) > 0.005) w.push(['o', `Jiná jednotková cena: v rozpočtu ${kc(r.jc)} Kč, tady ${kc(Number(l.jc) || 0)} Kč (rozdíl ${kc((Number(l.jc) || 0) - r.jc)} Kč/${r.mj})`]);
      const kcCelk = (jindeKc.get(l.r) || 0) + (Number(l.mn) || 0) * (Number(l.jc) || 0);
      if (r.cc != null && kcCelk > r.cc + 0.5 && !w.length) w.push(['', `Vyfakturováno ${kc(kcCelk)} Kč, v rozpočtu ${kc(r.cc)} Kč`]);
      if (F.kat) { const k = ks.find(z => z.id === F.kat); if (k && !(k.pol || []).includes(l.r)) w.push(['o', 'Položka není v druhu prací ' + k.nazev]); }
      return {r, w, zb};
    };
    const kresli = () => {
      let sum = 0, nad = 0, cena = 0, mimo = 0;
      ov.querySelector('#rz-fb').innerHTML = F.pol.map((l, i) => {
        const {r, w, zb} = kontrola(l), cl = (Number(l.mn) || 0) * (Number(l.jc) || 0); sum += cl;
        if (!r) mimo++; if (w.some(x => !x[0])) nad++; else if (w.some(x => x[0] === 'o' && r)) cena++;
        return `<tr class="${w.some(x => !x[0]) ? 'nad' : w.length ? 'cena' : ''}" data-i="${i}"><td>${esc(r ? r.k : '')}</td><td>${r ? esc(r.d) + (C0.obj[r.i] ? ' ' + obBadge(C0.obj[r.i]) : '') : `<input class="t" data-l="t" value="${esc(l.t || '')}" placeholder="popis práce">`}</td><td>${r ? esc(r.mj) : `<input class="t" style="min-width:50px" data-l="mj" value="${esc(l.mj || '')}">`}</td>
          <td class="n">${r ? mnT(r.mn) : ''}</td><td class="n">${r ? mnT(jinde.get(l.r) || 0) : ''}</td><td class="n"><input data-l="mn" inputmode="decimal" value="${esc(l.mn === 0 ? '' : String(l.mn).replace('.', ','))}" placeholder="0"></td><td class="n"><input data-l="jc" inputmode="decimal" value="${esc(String(l.jc).replace('.', ','))}"></td><td class="n"><b>${kc(cl)}</b></td><td class="n">${zb == null ? '' : `<span style="color:${zb < -EPS ? 'var(--bad)' : 'inherit'}">${mnT(zb)}</span>`}</td>
          <td>${w.length ? w.map(x => `<div class="w${x[0] ? ' o' : ''}">⚠ ${esc(x[1])}</div>`).join('') : (Number(l.mn) ? '<span class="rz-ok">✓</span>' : '')}</td><td><button type="button" class="rz-btn mini" data-del="${i}" title="Odebrat řádek">✕</button></td></tr>`;
      }).join('') || '<tr><td colspan="11" style="text-align:center;color:var(--muted);padding:20px">Zatím žádné položky. Klikněte <b>+ Přidat položky z rozpočtu</b> nebo <b>Načíst soupis prací z Excelu</b>.</td></tr>';
      ov.querySelector('#rz-fs').innerHTML = `Celkem <b>${kc(sum)} Kč</b> · ${F.pol.length} položek`;
      ov.querySelector('#rz-fw').innerHTML = nad || cena || mimo ? `<div class="rz-info${nad ? ' cerv' : ''}">⚠ Kontrola: ${[nad ? nad + ' položek přes rozpočet (množství nebo Kč)' : '', cena ? cena + ' s jinou cenou nebo mimo druh prací' : '', mimo ? mimo + ' mimo rozpočet' : ''].filter(Boolean).join(' · ')}</div>` : F.pol.length ? '<div class="rz-info" style="background:#dcefe3;border-color:#9fd1b3;color:#1d4d31">✓ Vše sedí s rozpočtem.</div>' : '';
    };
    kresli();
    ov.querySelectorAll('[data-f]').forEach(i => i.addEventListener('change', () => { F[i.dataset.f] = i.value; if (i.dataset.f === 'kat') kresli(); }));
    const tb = ov.querySelector('#rz-fb');
    tb.addEventListener('change', e => {
      const t = e.target, tr = t.closest('[data-i]'); if (!tr || !t.dataset.l) return;
      const l = F.pol[+tr.dataset.i];
      if (t.dataset.l === 'mn' || t.dataset.l === 'jc') { const v = cislo(t.value); l[t.dataset.l] = v == null ? 0 : v; } else l[t.dataset.l] = t.value;
      const ae = document.activeElement && document.activeElement.dataset ? [document.activeElement.closest('[data-i]') && document.activeElement.closest('[data-i]').dataset.i, document.activeElement.dataset.l] : null;
      kresli();
      if (ae && ae[0] != null) { const n = tb.querySelector(`[data-i="${ae[0]}"] [data-l="${ae[1]}"]`); if (n) n.focus(); }
    });
    tb.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset.l) { e.preventDefault(); const all = [...tb.querySelectorAll('[data-l="mn"]')], k = all.indexOf(e.target); e.target.dispatchEvent(new Event('change', {bubbles: true})); const n = [...tb.querySelectorAll('[data-l="mn"]')][k + 1]; if (n) n.focus(); } });
    tb.addEventListener('click', e => { const d = e.target.closest('[data-del]'); if (d) { F.pol.splice(+d.dataset.del, 1); kresli(); } });
    ov.querySelector('[data-mimo]').onclick = () => { F.pol.push({r: '', t: '', mj: '', mn: 0, jc: 0}); kresli(); };
    ov.querySelector('[data-pridat]').onclick = () => vyberPolozek(F, ids => { ids.forEach(id => { if (F.pol.some(l => l.r === id)) return; const r = R.byId.get(id); F.pol.push({r: id, mn: 0, jc: r.jc || 0}); }); kresli(); });
    ov.querySelector('[data-soupis]').onclick = () => vyberSoubor('soupis', (f, listy, nast) => soupisDoFaktury(F, f, listy, nast, kresli));
    ov.querySelector('[data-xls]').onclick = () => excelFaktura(F);
    const sm = ov.querySelector('[data-smaz]');
    if (sm) sm.onclick = () => { if (!confirm('Smazat fakturaci ' + (F.cislo || '') + '? Smaže se všem kolegům.')) return; H.smaz('faktury', [F.id]); ov.zavri(); };
    ov.querySelector('[data-ok]').onclick = () => {
      if (ro()) return toast('Jen prohlížení: změny se neukládají.');
      F.pol = F.pol.filter(l => l.r || l.t || l.mn);
      const fi = firmy.find(z => z.id === F.firma); F.firmaN = fi ? fi.firma : '';
      F.upr = kdo(); F.uprKdy = new Date().toISOString();
      H.upsert('faktury', [F]); ov.zavri(); S.panel = 'fakturace'; pamSet('rz-panel', 'fakturace'); toast('Fakturace uložena.');
    };
  }
  function vyberPolozek(F, hotovo) {
    const k = F.kat && kategorie(R.rec.id).find(z => z.id === F.kat);
    const zdroj = k ? (k.pol || []).map(id => R.byId.get(id)).filter(Boolean) : R.polozky;
    const C = spocti(R), vybr = new Set();
    const ov = okno('Přidat položky z rozpočtu' + (k ? ' – ' + k.nazev : ''), `<div class="rz-fil"><input class="rz-q" type="search" id="rz-pf" placeholder="Hledat kód nebo popis…" autofocus><span id="rz-pc" style="font-size:13px"></span></div>
      <div class="rz-list" style="max-height:60vh"><table><thead><tr><th></th><th>Obj.</th><th>Kód</th><th>Popis</th><th>MJ</th><th class="n">Množství</th><th class="n">J. cena</th><th class="n">Vyfakturováno</th></tr></thead><tbody id="rz-pb"></tbody></table></div>`,
      `<span class="sp"></span><button type="button" class="rz-btn zl" data-ok>Přidat vybrané</button>`, 'siroky');
    const kresli = () => {
      const sl = norm(ov.querySelector('#rz-pf').value).split(' ').filter(Boolean);
      const vid = zdroj.filter(r => !sl.length || sl.every(s => (r._h || (r._h = norm(r.pc + ' ' + r.k + ' ' + r.d + ' ' + r.mj))).includes(s))).slice(0, 1500);
      ov.querySelector('#rz-pb').innerHTML = vid.map(r => { const x = C.pol.get(r.id); return `<tr><td><input type="checkbox" data-n="${esc(r.id)}"${vybr.has(r.id) ? ' checked' : ''}></td><td>${obBadge(C.obj[r.i])}</td><td>${esc(r.k)}</td><td>${esc(r.d)}</td><td>${esc(r.mj)}</td><td class="n">${mnT(r.mn)}</td><td class="n">${kc(r.jc)}</td><td class="n">${x ? mnT(x.mn) : ''}</td></tr>`; }).join('') + (vid.length >= 1500 ? '<tr><td colspan="8">… zobrazeno prvních 1500, zužte hledání</td></tr>' : '');
      ov.querySelector('#rz-pc').textContent = vybr.size ? 'vybráno ' + vybr.size : '';
    };
    kresli();
    let t = 0; ov.querySelector('#rz-pf').oninput = () => { clearTimeout(t); t = setTimeout(kresli, 200); };
    ov.querySelector('#rz-pb').onchange = e => { const c = e.target.closest('[data-n]'); if (!c) return; c.checked ? vybr.add(c.dataset.n) : vybr.delete(c.dataset.n); ov.querySelector('#rz-pc').textContent = 'vybráno ' + vybr.size; };
    ov.querySelector('[data-ok]').onclick = () => { hotovo([...vybr]); ov.zavri(); };
  }
  // soupis provedených prací od firmy (Excel) → řádky fakturace, spárované s rozpočtem podle kódu a popisu
  function soupisDoFaktury(F, f, listy, nast, kresli) {
    const rows = sestav(listy, nast).filter(r => r.t === 'P');
    if (!rows.length) return toast('V souboru jsem nenašel žádné položky (řádky s MJ a množstvím).');
    const podleKodu = new Map(), podlePopisu = new Map();
    R.polozky.forEach(r => { const k = String(r.k).replace(/\s/g, '').toUpperCase(); if (k) { const a = podleKodu.get(k) || []; a.push(r); podleKodu.set(k, a); } const p = norm(r.d).slice(0, 120); if (p) { const a = podlePopisu.get(p) || []; a.push(r); podlePopisu.set(p, a); } });
    const k = F.kat && kategorie(R.rec.id).find(z => z.id === F.kat), vKat = k ? new Set(k.pol || []) : null;
    let sp = 0, nej = 0, mimo = 0;
    rows.forEach(s => {
      let kand = podleKodu.get(String(s.k).replace(/\s/g, '').toUpperCase()) || [];
      const p = norm(s.d).slice(0, 120);
      if (kand.length > 1) { const z = kand.filter(r => norm(r.d).slice(0, 120) === p); if (z.length) kand = z; }
      if (kand.length > 1 && vKat) { const z = kand.filter(r => vKat.has(r.id)); if (z.length) kand = z; }
      if (kand.length > 1) { const sn = norm(listy[s.s] && listy[s.s].n); const z = kand.filter(r => norm(R.listy && R.listy[r.s] ? R.listy[r.s].n : '') === sn); if (z.length) kand = z; }
      if (!kand.length) kand = podlePopisu.get(p) || [];
      const r = kand[0];
      if (!s.mn) return;
      if (r) { sp++; if (kand.length > 1) nej++; const ex = F.pol.find(l => l.r === r.id); if (ex) { ex.mn = s.mn; if (s.jc != null) ex.jc = s.jc; } else F.pol.push({r: r.id, mn: s.mn, jc: s.jc != null ? s.jc : r.jc || 0}); }
      else { mimo++; F.pol.push({r: '', t: (s.k ? s.k + ' ' : '') + s.d, mj: s.mj, mn: s.mn, jc: s.jc || 0}); }
    });
    kresli();
    toast(`Načteno ze soupisu: ${sp} položek spárováno s rozpočtem${nej ? ` (${nej} nejednoznačně – zkontrolujte)` : ''}${mimo ? `, ${mimo} mimo rozpočet` : ''}.`);
  }

  /* ---------- export do Excelu ---------- */
  async function ulozExcel(nazev, listy) {
    const w = cekej('Připravuji Excel…');
    try {
      const res = await worker({akce: 'zapis', listy});
      const blob = new Blob([res.buf], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
      const u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = nazev.replace(/[\\/:*?"<>|]/g, ' ') + '.xlsx'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 60000);
    } catch (e) { toast('Excel se nepodařilo vytvořit: ' + e.message); }
    finally { w.konec(); }
  }
  function excelRozpocet() {
    if (!R) return;
    const C = spocti(R), vis = filtrAktivni() ? spocitejViditelne(C) : R.rows.map((r, i) => i);
    const rows = [['Řádek v Excelu', 'Typ', 'PČ', 'Kód', 'Popis', 'MJ', 'Množství', 'J. cena', 'Celkem Kč', 'Objekt', 'Druh prací', 'Vyfakturováno MJ', 'Vyfakturováno Kč', 'Zbývá Kč', 'Upozornění']], urov = [0];
    const nm = {L: 'list', S1: 'díl', S2: 'díl', P: 'položka', D: 'podrobnost', T: 'součet'};
    const ks = kategorie(R.rec.id);
    vis.forEach(i => {
      const r = R.rows[i], x = C.pol.get(r.id);
      const sek = r.t === 'L' || r.t[0] === 'S';
      rows.push([r.x || '', nm[r.t], r.pc, r.k, r.d, r.mj, r.mn, r.jc, sek ? Math.round(R.sum[i] * 100) / 100 : r.cc, r.t === 'P' ? C.obj[i] : '', r.t === 'P' ? (C.katPol.get(r.id) || []).map(k => (ks.find(z => z.id === k) || {}).nazev).join(', ') : '', x ? x.mn : null, x ? Math.round(x.kc * 100) / 100 : sek && C.sum[i] ? Math.round(C.sum[i] * 100) / 100 : null, x ? Math.round(((r.cc || 0) - x.kc) * 100) / 100 : sek && C.sum[i] ? Math.round((R.sum[i] - C.sum[i]) * 100) / 100 : null, x ? [x.nad ? 'překročeno množství' : '', x.cena ? 'jiná cena' : ''].filter(Boolean).join(', ') : '']);
      urov.push(Math.min(7, Math.max(0, R.hl[i] - 1)));
    });
    ulozExcel(R.rec.nazev + (filtrAktivni() ? ' – výběr' : '') + ' – čerpání', [{n: 'Rozpočet', rows, urov, sirky: [8, 9, 6, 14, 60, 6, 11, 11, 14, 7, 18, 12, 14, 14, 20]}]);
  }
  function excelFaktura(F) {
    const fi = (H.firmy() || []).find(z => z.id === F.firma);
    const rows = [['Fakturace', F.cislo], ['Firma', fi ? fi.firma : ''], ['Období', [F.od, F.do].filter(Boolean).join(' – ')], ['Rozpočet', R.rec.nazev], [], ['Kód', 'Popis', 'MJ', 'V rozpočtu', 'Tato fakturace', 'J. cena', 'Celkem Kč', 'Cena v rozpočtu', 'Upozornění']];
    let sum = 0;
    F.pol.forEach(l => { const r = l.r && R.byId.get(l.r), cl = Math.round((Number(l.mn) || 0) * (Number(l.jc) || 0) * 100) / 100; sum += cl; rows.push([r ? r.k : '', r ? r.d : l.t || '', r ? r.mj : l.mj || '', r ? r.mn : null, Number(l.mn) || 0, Number(l.jc) || 0, cl, r ? r.jc : null, !r ? 'mimo rozpočet' : r.jc != null && Math.abs((Number(l.jc) || 0) - r.jc) > 0.005 ? 'jiná cena' : '']); });
    rows.push([], ['', 'Celkem', '', '', '', '', Math.round(sum * 100) / 100]);
    ulozExcel('Fakturace ' + (F.cislo || '') + (fi ? ' ' + fi.firma : ''), [{n: 'Fakturace', rows, sirky: [14, 60, 6, 12, 14, 12, 14, 14, 16]}]);
  }

  /* ---------- rozhraní pro Management ---------- */
  window.CXRozp = {
    pripoj(h) { H = h; setTimeout(() => { verzeSkriptu().then(() => prekresli()); dokoncitNahrani(); }, 2500); },
    vykresli(el) { EL = el; vykresli(); verzeSkriptu().then(v => { if (v && v < SKRIPT_MIN) prekresli(); }); },
    obnov() {
      if (!EL || !EL.isConnected) return;
      const a = document.activeElement;
      if (a && EL.contains(a) && (a.tagName === 'INPUT' && a.type !== 'checkbox' || a.tagName === 'SELECT' || a.tagName === 'TEXTAREA')) return;
      vykresli();
    },
    // pro zkoušky
    _rozpoznej: rozpoznej, _sestav: sestav,
  };
})();
