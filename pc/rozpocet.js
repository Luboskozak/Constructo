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
.rz-q{min-width:220px;flex:1;max-width:360px}
.rz-fil select.rz-sel{max-width:270px}
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
.rz-flt{background:var(--card,#fff);border:1px solid var(--line,#ddd);border-radius:10px;padding:6px 10px;gap:10px}.rz-fl-l{display:flex;flex-direction:column;gap:2px;font-size:11.5px;color:var(--muted)}.rz-fl-l select{max-width:230px}.rz-sel.akt{border-color:#e0b400;background:#FFF4BF;color:#16191c}.rz-souhrn{font-size:13.5px;margin-left:auto}
.rz-vyber{display:flex;flex-wrap:wrap;gap:8px;align-items:center;background:#FFF4BF;border:1px solid #f0d36a;border-radius:10px;padding:7px 12px;font-size:14px;color:#16191c}
.rz-tab{border:1px solid var(--line);border-radius:12px;background:var(--panel);overflow:auto;position:relative;height:calc(100vh - 150px);min-height:320px}
.rz-bok{font-size:18px;padding:5px 11px;line-height:1}
body:not(.rz-full) .rz-bok{display:none}
body.rz-full .rz{gap:6px}
body.rz-full .rz-top h2{font-size:17px}
body.rz-full .rz-btn{padding:6px 11px;font-size:13.5px}
body.rz-full .rz-sum{display:flex;flex-wrap:wrap;border-radius:10px}
body.rz-full .rz-sum>div{flex:1 1 auto;padding:4px 12px;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
body.rz-full .rz-sum .k{font-size:10.5px}body.rz-full .rz-sum .v{font-size:15px}body.rz-full .rz-sum .m{display:none}
body.rz-full .rz-sum .rz-bar{flex:1 1 60px;min-width:60px;margin:0;align-self:center}
body.rz-full .rz-tabs button{font-size:14px;padding:5px 13px}
body.rz-full .rz-fil{gap:6px}
body.rz-full .rz-flt{padding:4px 8px;gap:6px}
body.rz-full .rz-fl-l>span{display:none}
body.rz-full .rz-fl-l select{max-width:210px}
body.rz-full .rz-sel,body.rz-full .rz-q{padding:5px 8px;font-size:13.5px}
body.rz-full .rz-seg button{padding:5px 9px}
body.rz-full .rz-napoveda{display:none}
body.rz-full .rz-q{flex:0 1 250px;min-width:200px}
.rz-hd,.rz-r{display:grid;grid-template-columns:var(--g);gap:0;align-items:stretch;padding:0 6px;width:max(100%, var(--gw))}
.rz-hd>span,.rz-r>span{padding:0 5px;display:flex;align-items:center;border-right:1px solid var(--soft);min-width:0}.rz-r>span.n,.rz-hd>span.n{justify-content:flex-end}
.rz-r>span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block;line-height:${ROWH - 1}px}
.rz-r .og{overflow:visible;padding:0;border-right:0}.rz-r .rn{color:var(--muted);font-size:11px;text-align:right;background:var(--soft)}
.rz-r .dot{display:inline-block;width:3px;height:3px;border-radius:2px;background:var(--muted);vertical-align:middle}
.rz-hd .nx,.rz-r>span:nth-last-child(-n+4){background:color-mix(in srgb,#F4D23C 9%,var(--panel))}
.rz-r .rz-ob{vertical-align:middle;height:18px;line-height:18px}
.rz-r .kt{font-style:normal;color:#7c3fd6;margin-left:3px;font-size:10px}
.rz-hd{position:sticky;top:0;z-index:2;background:var(--soft);border-bottom:2px solid var(--ink);height:34px;font-size:12px;color:var(--ink);font-weight:700}
.rz-hd>span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block;line-height:32px}
.rz-r{position:absolute;left:0;height:${ROWH}px;font-size:13px;border-bottom:1px solid var(--soft);white-space:nowrap}
.rz-r>span{overflow:hidden;text-overflow:ellipsis}.rz-r .n{text-align:right;font-variant-numeric:tabular-nums}.rz-hd .n{text-align:right}
.rz-r:hover{background:var(--soft)}
.rz-r.L{background:#16191c;color:#fff;font-weight:800}.rz-r.L>span{background:#16191c !important;border-color:#16191c}.rz-r.L .tg{background:#fff;color:#16191c}
.rz-r.S1{font-weight:800;font-size:14px}.rz-r.S2{font-weight:700}
.rz-r.D{font-size:12px;color:color-mix(in srgb,var(--ink) 80%,#1f5fbf)}
.rz-r.T{color:var(--muted);font-style:italic}
.rz-r.vyb{background:#FFF4BF !important;color:#16191c}
.rz-r .tg{border:1px solid var(--muted);background:var(--panel);font:inherit;font-weight:800;cursor:pointer;color:var(--ink);width:15px;height:15px;border-radius:2px;padding:0;font-size:12px;line-height:12px;vertical-align:middle}
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
.rz-fakl{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;background:#fff5c2;border:2px solid #F4D23C;border-radius:12px;padding:10px 14px;margin:6px 0;font-size:14px;position:sticky;top:0;z-index:5}
.rz-odbs{display:flex;flex-direction:column;gap:6px}.rz-odb{display:flex;gap:10px;align-items:center;border:1px solid var(--line);border-radius:10px;padding:10px 12px;cursor:pointer}.rz-odb:has(input:checked){border:2px solid #F4D23C;background:#fffbe6}.rz-odb span{display:flex;flex-direction:column}.rz-odb small{color:var(--muted);font-size:12.5px}.rz-odbs .rz-btn{align-self:flex-start;margin-top:4px}
.rz-seg{display:inline-flex;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--panel)}.rz-seg button{font:inherit;font-size:13.5px;font-weight:600;border:0;background:none;padding:7px 13px;cursor:pointer;color:var(--ink)}.rz-seg button+button{border-left:1px solid var(--line)}.rz-seg button[aria-pressed=true]{background:#16191c;color:#fff}
.rz-dr table{width:100%}.rz-dr td{vertical-align:middle}.rz-dr td.nm{min-width:220px}.rz-dr td.podil{color:var(--muted)}.rz-dr td.cp{white-space:nowrap;min-width:150px}.rz-dr td.ak{white-space:nowrap;text-align:right}.rz-dr tr.sum td{border-top:2px solid var(--ink);background:rgba(0,0,0,.03)}
.rz-dr-bar{display:inline-block;vertical-align:middle;width:90px;height:8px;border-radius:5px;background:rgba(0,0,0,.08);overflow:hidden}.rz-dr-bar i{display:block;height:100%;background:#2f7d4f}.rz-dr-bar i.nad{background:var(--bad,#c0392b)}.rz-dr-p{font-size:12.5px;color:var(--muted);margin-left:6px}
.rz-dr-a{display:inline-flex;gap:4px;flex-wrap:nowrap}.rz-dr-a .rz-btn.mini{padding:4px 9px;font-size:12.5px}
.rz-zeb{display:flex;flex-direction:column;gap:3px;margin-top:8px}.rz-zeb-r{display:grid;grid-template-columns:minmax(160px,260px) 1fr auto;gap:10px;align-items:center;padding:3px 6px;border-radius:8px}.rz-zeb-r:hover{background:rgba(0,0,0,.035)}
.rz-zeb-r .nm{font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.rz-zeb-r .br{display:flex;align-items:center;gap:8px;min-width:0}.rz-zeb-r .br i{display:block;height:20px;border-radius:5px;background:#F4D23C;flex:none;max-width:70%;overflow:hidden}.rz-zeb-r .br i u{display:block;height:100%;background:#2f7d4f}.rz-zeb-r .br span{font-size:13px;white-space:nowrap;color:var(--muted)}.rz-zeb-r .br span b{color:var(--ink)}
.rz-sg{border:1px solid var(--line);border-radius:12px;background:var(--panel);margin-top:8px;overflow:hidden}.rz-sg-h{display:flex;align-items:center;gap:10px;width:100%;font:inherit;font-size:15px;text-align:left;border:0;background:none;padding:12px 14px;cursor:pointer;color:var(--ink)}.rz-sg-h:hover{background:rgba(0,0,0,.03)}.rz-sg-h .m{font-size:13px;color:var(--muted)}.rz-sg-h .sip{width:14px}.rz-sg-h .sp{flex:1}.rz-sg .rz-list{border:0;border-top:1px solid var(--line);border-radius:0;margin:0}
.rz-sks{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px;margin-top:10px}
.rz-sk{border:1px solid var(--line);border-radius:12px;padding:10px;background:var(--panel);display:flex;flex-direction:column;gap:6px}
.rz-sk.ma{border-color:#9fd1b3;background:#f2faf5}
.rz-sk.otaz{border:2px solid #F4D23C;background:#fffbe6}
.rz-sk-h{display:flex;gap:6px;align-items:baseline;flex-wrap:wrap;font-size:14px}.rz-sk-h span{font-size:12.5px;color:var(--muted)}.rz-sk-h i{font-style:normal;margin-left:auto}
.rz-sk ul{margin:0;padding:6px 8px;list-style:none;background:rgba(0,0,0,.035);border-radius:8px;font-size:13px;min-height:60px}.rz-sk li{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:1px 0}.rz-sk li.pr{color:var(--muted)}
.rz-sk select{font:inherit;font-size:14px;font-weight:600;border:1px solid var(--line);border-radius:8px;padding:6px;background:var(--panel);color:var(--ink)}
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
    pc: /^(p\.? ?c\.?|por\.? ?c\.?|poradove cislo|poradi|c\.|c|cis\.?|#|r\.? ?c\.?|pol\.? ?c\.?|c\. ?pol\.?|cislo radku|radek|poz\.?|pozice|p\.? ?c\.? ?pol\.?|no\.?|item no\.?|pos\.?|nr\.?|pol\.?)$/,
    typ: /^(typ|typ radku|t|druh radku)$/,
    kod: /(^kod|kod polozky|cislo polozky|^c\. ?polozky|^cis\.? ?pol|oznaceni|polozka c|cenova polozka|^ozn\.?$|^kcn$|katalog|^cenik|^urs$|^rts$|^cenova soustava|^item code|^code$|^art\.? ?c|^cislo vyrobku)/,
    popis: /(popis|nazev|^text|specifikace|predmet|^polozka$|^polozky$|^prace$|^nazev prace|^description|^item$|^name$|^oznaceni prace|^druh prace$|^cinnost$|^prace a dodavky$)/,
    mj: /^(m\.? ?j\.?|mj\.?|mer\.? ?j\.?|mer\.? ?jedn\.?|jedn\.?|jednotka|merna jednotka|jed\.?|jednotky|j\.|unit|uom|mj \S+)$/,
    mn: /(mnozstvi|vymer|^pocet|^mn\.?|mnoz\.?|^qty|^kusu?|^quantity|^mnoz$|^vym\.?$)/,
    jc: /(jednotkov\w* cen|jedn\.? ?cen|^j\.? ?cen|cena ?\/ ?m\.? ?j|cena za m\.? ?j|cena za jedn|^jc\.?$|kc ?\/ ?m\.? ?j|^j\.? ?c\.?$|cena jedn|^cena\/j|^cena m\.? ?j|^cena za ks|^unit ?price|^rate$|^price$|^cena ?\/ ?ks|^j\.? ?cena)/,
    cc: /(cena celkem|^celkem|celkova cena|^cena$|^cena (kc|czk|bez dph)|kc celkem|^castka|^cena celk|celkem (kc|czk|bez dph)|^celk\.|^total|^amount|^naklady celkem|^cena za polozku)/,
  };
  const JEDNOTKY = /^(m|m2|m3|m²|m³|bm|km|mm|cm|ks|kus|kusy|t|kg|g|l|kpl|komplet|soub|soubor|hod|h|den|dny|mes|měs|ha|ar|sada|pár|par|bal|%|kč|kc|m\/s|mj|ks\/m|tun|tuna|úsek|usek|bod|místo|misto|osoba|celek|kmpl|kpt|m2\/t|lhůta|paušál|pausal|nh|rok|tis\.? ?ks|lm|cm2|dm3|mm2|m'|kwh|kw|hr|pcs|pc|ea|set|lot|mth|day|týd|tyd|vrt|otvor|okno|dveře|kpl\.)$/i;
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
    return {hlavicka: h.r, map, jak, nazvy, nc, dva: !!h.dva};
  }

  /* ---------- 4.67: jistota rozpoznání, dotaz „Co je v tomto sloupci?“ a zapamatovaná přiřazení ---------- */
  // vrátí role, u kterých si Constructo není jisté (prázdné pole = vše sedí)
  function jistota(l, ns) {
    const nej = new Set(), mp = ns.map, jak = ns.jak || {};
    if (jak._sablona || jak._rucne) return [];
    ['popis', 'mn', 'mj'].forEach(k => { if (mp[k] == null) nej.add(k); });
    if (mp.jc == null && mp.cc == null) { nej.add('jc'); nej.add('cc'); }
    const P = (ns.souhrn ? ns.souhrn.rows : []).filter(r => r.t === 'P');
    if (P.length < 3) ['popis', 'mj', 'mn', 'jc'].forEach(k => nej.add(k));
    if (mp.mn != null && mp.jc != null && mp.cc != null && P.length) {
      let n = 0, ok = 0; P.forEach(r => { if (r.mn != null && r.jc != null && r.cc != null && Math.abs(r.cc) > EPS && r.x) { const row = l.rows[r.x - l.od - 1] || []; if (cislo(row[mp.cc]) == null) return; n++; if (Math.abs(r.mn * r.jc - r.cc) <= Math.max(0.6, Math.abs(r.cc) * 0.002)) ok++; } });
      if (n >= 3 && ok / n < 0.7) ['mn', 'jc', 'cc'].forEach(k => nej.add(k));
    }
    if (jak.mn === 'obsah' && jak.jc === 'obsah' && !(jak.mj === 'nazev')) { nej.add('mn'); nej.add('jc'); }
    ['popis', 'mj'].forEach(k => { if (jak[k] === 'obsah') nej.add(k); });
    if (mp.mj != null && P.length >= 3) { const u = P.filter(r => JEDNOTKY.test(String(r.mj).replace(/\.$/, ''))).length; if (u / P.length < 0.6) nej.add('mj'); }
    if (mp.popis != null && P.length >= 3) { const d = P.reduce((a, r) => a + String(r.d || '').length, 0) / P.length; if (d < 8) nej.add('popis'); }
    return ROLE.map(x => x[0]).filter(k => nej.has(k));
  }
  // podpis hlavičky = stejné názvy sloupců → stejný program/šablona
  const podpis = (l, ns) => {
    if (ns.hlavicka >= 0) return 'h' + hash(hlavickaListu(l, ns).map(norm).join('|') + '#' + ns.nc);
    // bez hlavičky: podle druhu obsahu sloupců (čísla / jednotky / krátký / dlouhý text)
    const {st} = statistikaSloupcu(l.rows, 0);
    return 'b' + hash(st.map(x => !x.cnt ? '_' : x.num > 0.8 ? 'n' : x.jed > 0.5 ? 'u' : x.dl > 20 ? 'T' : 't').join('') + '#' + ns.nc);
  };
  function sablony() {
    let loc = {}; try { loc = JSON.parse(pam('rz-sablony') || '{}') || {}; } catch (e) {}
    rozpocty().forEach(r => (r.mapy || []).forEach(m => { if (m && m.sig && m.map && !loc[m.sig]) loc[m.sig] = {map: m.map}; }));
    return loc;
  }
  function pouzijSablonu(l, ns) {
    const sig = podpis(l, ns); if (!sig) return false;
    const t = sablony()[sig]; if (!t || !t.map) return false;
    const map = {}; Object.keys(t.map).forEach(k => { const c = t.map[k]; if (ROLE_NAZ[k] && Number.isInteger(c) && c >= 0 && c < ns.nc) map[k] = c; });
    if (map.popis == null) return false;
    ns.map = map; ns.jak = {_sablona: 1}; return true;
  }
  function ulozSablony(listy, nast) {
    let loc = {}; try { loc = JSON.parse(pam('rz-sablony') || '{}') || {}; } catch (e) {}
    const out = [];
    listy.forEach((l, i) => { const ns = nast[i]; if (!ns.zahrnout) return; const sig = podpis(l, ns); if (!sig) return; loc[sig] = {map: ns.map, kdy: Date.now()}; out.push({sig, map: ns.map}); });
    const kl = Object.keys(loc).sort((a, b) => (loc[b].kdy || 0) - (loc[a].kdy || 0)); kl.slice(60).forEach(k => delete loc[k]);
    pamSet('rz-sablony', JSON.stringify(loc));
    return out;
  }
  // ukázky hodnot z datových řádků (prednost řádky, které vypadají jako položky)
  function ukazky(l, ns, c) {
    const out = [], vid = new Set();
    const od = ns.hlavicka + 1;
    for (const jenPol of [true, false]) {
      for (let r = od, k = 0; r < l.rows.length && k < 800 && out.length < 4; r++) {
        const row = l.rows[r] || []; if (!row.some(v => v !== '' && v != null)) continue; k++;
        if (jenPol && row.filter(v => cislo(v) != null).length < 2) continue;
        const v = row[c]; if (v === '' || v == null) continue;
        const t = typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000).replace('.', ',')) : txt(v);
        if (!t || vid.has(t)) continue; vid.add(t); out.push(t);
      }
      if (out.length >= 3) break;
    }
    return out;
  }
  function dialogSloupcu(l, ns, nej, hotovo, zrus) {
    const {st} = statistikaSloupcu(l.rows, ns.hlavicka + 1);
    const nazvy = hlavickaListu(l, ns);
    const cols = st.filter(x => x.cnt >= 2).map(x => x.c);
    const roleSl = {}; Object.keys(ns.map).forEach(k => { roleSl[ns.map[k]] = k; });
    const nejSl = new Set(nej.map(k => ns.map[k]).filter(c => c != null));
    const chybi = nej.filter(k => ns.map[k] == null);
    const karta = c => { const uk = ukazky(l, ns, c), r = roleSl[c] || '', otaz = nejSl.has(c) || (!r && chybi.length && st[c] && st[c].cnt > 5);
      return `<div class="rz-sk${otaz ? ' otaz' : ''}${r ? ' ma' : ''}" data-c="${c}"><div class="rz-sk-h"><b>Sloupec ${sloupec(c + (l.odSl || 0))}</b>${nazvy[c] ? `<span>„${esc(nazvy[c].slice(0, 40))}“</span>` : '<span>bez názvu</span>'}${otaz ? '<i title="Tady si Constructo není jisté">❓</i>' : ''}</div>
        <ul>${uk.length ? uk.map(v => `<li>${esc(v.slice(0, 48))}${v.length > 48 ? '…' : ''}</li>`).join('') : '<li class="pr">(prázdný)</li>'}</ul>
        <select data-sk="${c}"><option value="">— nic, nepotřebuji —</option>${ROLE.map(([k, n]) => `<option value="${k}"${r === k ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></div>`; };
    const ov = okno('Co je v těchto sloupcích? – list „' + l.n + '“', `<div class="rz-info">Constructo si u tohoto rozpočtu není úplně jisté${chybi.length ? ' (nenašlo: ' + chybi.map(k => ROLE_NAZ[k]).join(', ') + ')' : ''}. U každého sloupce vidíte <b>ukázku z rozpočtu</b>. Vyberte, co v něm je – stačí zkontrolovat sloupce se žlutým ❓. Přiřazení si Constructo zapamatuje a příště rozpočet ze stejného programu pozná samo.</div>
      <div class="rz-sks">${cols.map(karta).join('')}</div>`,
      `<span id="rz-sk-s" style="font-size:14px"></span><span class="sp"></span><button type="button" class="rz-btn" data-pres>Přeskočit</button><button type="button" class="rz-btn zl" data-ok>Hotovo</button>`, 'siroky');
    const mapa = () => { const m = {}; ov.querySelectorAll('[data-sk]').forEach(s => { if (s.value) m[s.value] = +s.dataset.sk; }); return m; };
    const stav = () => { const m = mapa(), x = Object.assign({}, ns, {map: m}), sh = souhrnListu(l, x); ov.querySelector('#rz-sk-s').innerHTML = `Poznáno <b>${nf0.format(sh.pol)}</b> položek za <b>${kc0(sh.cel)}</b>`; ov.querySelectorAll('.rz-sk').forEach(k => k.classList.toggle('ma', !!k.querySelector('select').value)); };
    ov.addEventListener('change', e => { const t = e.target; if (t.dataset.sk == null) return; if (t.value) ov.querySelectorAll('[data-sk]').forEach(s => { if (s !== t && s.value === t.value) s.value = ''; }); t.closest('.rz-sk').classList.remove('otaz'); stav(); });
    stav();
    let hot = false;
    ov.querySelector('[data-pres]').onclick = () => { hot = true; ov.zavri(); hotovo(false); };
    ov.querySelector('[data-ok]').onclick = () => {
      const m = mapa();
      if (m.popis == null) return toast('Vyberte sloupec s popisem (názvem) položek.');
      if (m.mn == null && m.cc == null) return toast('Vyberte sloupec s množstvím nebo s cenou celkem.');
      hot = true; ns.map = m; ns.jak = {_rucne: 1}; ns.souhrn = souhrnListu(l, ns); ov.zavri(); hotovo(true);
    };
    const x = ov.querySelector('[data-x]'); if (x) x.addEventListener('click', () => { if (!hot && zrus) zrus(); });
  }
  // postupně se doptá u listů, kde si Constructo není jisté; stejnou hlavičku u dalších listů převezme
  function doptejSe(listy, nast, hotovo) {
    const fronta = nast.map((ns, i) => i).filter(i => nast[i].zahrnout);
    const dalsi = () => {
      while (fronta.length) {
        const i = fronta.shift(), ns = nast[i], nej = jistota(listy[i], ns);
        if (!nej.length) continue;
        return dialogSloupcu(listy[i], ns, nej, ok => {
          if (ok) { const sig = podpis(listy[i], ns); nast.forEach((n2, j) => { if (j !== i && sig && podpis(listy[j], n2) === sig && !(n2.jak || {})._rucne) { n2.map = Object.assign({}, ns.map); n2.jak = {_rucne: 1}; n2.souhrn = souhrnListu(listy[j], n2); if (n2.souhrn.pol >= 3) n2.zahrnout = true; } }); }
          dalsi();
        }, () => dalsi());
      }
      hotovo();
    };
    dalsi();
  }

  /* ---------- rozdělení řádků: L list, S1/S2 díl, P položka, D podrobnost (výkaz výměr, popis), T součet ---------- */
  const TYP_P = /^(K|M|PSU|R|H|P\d*|ZL|Z|O)$/, TYP_D = /^(PP|PSC|VV|VT|P|POL|POZN|PV)$/;
  function radek(list, mp, r) {
    const row = list.rows[r] || [];
    const g = k => mp[k] == null ? '' : row[mp[k]];
    return {pc: txt(g('pc')), typ: txt(g('typ')).toUpperCase(), kod: txt(g('kod')), popis: txt(g('popis')), mj: txt(g('mj')), mn: cislo(g('mn')), jc: cislo(g('jc')), cc: cislo(g('cc')), prazdny: !row.some(v => v !== '' && v != null)};
  }
  function druhRadku(x, list, mp, r, vPolozce) {
    if (x.prazdny) return '';
    const p = norm(x.popis);
    const row = list.rows[r] || [];
    // sloupec typu řádku s názvy (např. Obor: „Hlavní nadpis“, „Nadpis“)
    for (let c = 0; c < Math.min(row.length, 4); c++) { const t = norm(row[c]); if (t === 'hlavni nadpis' || t === 'hlavni oddil') return 'S1'; if (t === 'nadpis' || t === 'oddil' || t === 'podnadpis') return 'S'; }
    if (x.typ && mp.typ != null) {
      if (x.typ === 'D') return 'S';
      if (TYP_D.test(x.typ) && x.typ !== 'P') return 'D';
      if (TYP_P.test(x.typ) && (x.mj || x.jc != null)) return 'P';
    }
    const mjOk = x.mj && x.mj.length <= 14 && !/^\d/.test(x.mj);
    if (mjOk && (x.mn != null || x.jc != null || x.cc != null) && (x.popis || x.kod)) return 'P';
    if (/^(celkem|soucet|mezisoucet|cena celkem|celkem za|celkem bez|rekapitulace|cena bez dph|dph|cena s dph|vrn celkem)/.test(p) && !mjOk) return vPolozce && x.cc == null ? 'D' : 'T';   // „Mezisoučet“ ve výkazu výměr patří k položce
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
      const li = zapsatRadek(out, {id: uniq('L' + hash(list.n)), t: 'L', p: -1, s: si, x: 0, h: 0, pc: '', k: '', d: list.n, mj: '', mn: null, jc: null, cc: null, c: null, l: 0, f: null});
      let s1 = -1, s2 = -1, pol = -1, detN = 0;
      const sekce = [];
      for (let r = ns.hlavicka + 1; r < list.rows.length; r++) {
        const x = radek(list, mp, r), t0 = druhRadku(x, list, mp, r, pol >= 0), t = t0 === 'S1' ? 'S' : t0;
        if (!t) continue;
        if (ns.hlavicka >= 0 && r > ns.hlavicka + 2) { let shod = 0; ['popis', 'mj', 'mn', 'jc'].forEach(k => { if (mp[k] != null && roleZnazvu(txt((list.rows[r] || [])[mp[k]])) === k) shod++; }); if (shod >= 2) continue; }   // opakovaná hlavička na další stránce
        const bunky = (list.rows[r] || []).map(v => typeof v === 'number' ? v : v == null ? '' : String(v).trim()); while (bunky.length && bunky[bunky.length - 1] === '') bunky.pop();
        const zakl = {s: si, x: list.od + r + 1, h: list.skryto[r] ? 1 : 0, pc: x.pc, k: x.kod, d: x.popis || bunky.filter(v => typeof v === 'string' && v).sort((a, b) => b.length - a.length)[0] || '', mj: x.mj, mn: x.mn, jc: x.jc, cc: x.cc, c: bunky, l: list.urov[r] || 0, f: list.barvy ? list.barvy[r] || null : null};
        if (t === 'S') {
          const hl = t0 === 'S1' || /^(hsv|psv|m|vrn|on|ost|vedlejsi|ostatni)$/i.test(x.kod) || /^(prace a dodavky|vedlejsi rozpoctove|ostatni naklady|montaze|dodavky)/.test(norm(x.popis));
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
  // názvy sloupců z hlavičky (u dvouřádkové hlavičky spojené)
  function hlavickaListu(l, ns) {
    const h = ns.hlavicka; if (h < 0) return [];
    const a = l.rows[h] || [], b = ns.dva ? l.rows[h - 1] || [] : [];
    const out = []; for (let c = 0; c < Math.max(a.length, ns.nc || 0); c++) out.push([txt(b[c]), txt(a[c])].filter(Boolean).join(' '));
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
  const S = {panel: pam('rz-panel') || 'rozpocet', rp: pam('rz-rp') || '', q: '', obj: '', kat: '', pod: '', dil: '', cast: '', obor: '', uroven: 0, jenUpoz: false, druhyV: '', skOtv: new Set(), fak: null, otev: new Set(), zav: new Set(), vyb: new Set(), nacitam: '', chyba: '', verze: 0, verzeT: 0, aktT: 0};
  const toast = m => H && H.toast ? H.toast(m) : alert(m);
  const ro = () => !!(H && H.ro && H.ro());
  const smi = k => !H || !H.smi || !!H.smi(k);   // 4.61: oprávnění osoby (rozp / fakt / fakU)
  const nefak = () => ro() || !smi('fakt');
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
      H.aktualizujSkript().then(r => { if (r && r.ok) { S.verze = 0; S.verzeT = 0; S.skrDuvod = ''; } else if (r) S.skrDuvod = String(r.duvod || ''); prekresli(); }).catch(e => { S.skrDuvod = e.message || String(e); prekresli(); });
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
  const POLE = ['id', 't', 'p', 's', 'x', 'h', 'pc', 'k', 'd', 'mj', 'mn', 'jc', 'cc', 'c', 'l', 'f'];
  const naPole = rows => rows.map(r => POLE.map(k => r[k] === '' || r[k] == null ? (k === 'p' ? -1 : null) : r[k]));
  const zPole = arr => arr.map(a => { const r = {}; POLE.forEach((k, i) => r[k] = a[i] == null ? (['pc', 'k', 'd', 'mj'].includes(k) ? '' : k === 'h' || k === 'l' ? 0 : a[i] === undefined ? null : a[i]) : a[i]); return r; });
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
  // 4.58: rozpočet uložený v tomto počítači (IndexedDB), který v seznamu chybí (např. ho starší skript Google nepropsal), se vrátí do seznamu
  let OBNOVA = false;
  async function obnovZPocitace() {
    if (OBNOVA || !H || ro()) return; OBNOVA = true;
    try {
      const d = await db();
      const klice = await new Promise((res, rej) => { const q = d.transaction('d').objectStore('d').getAllKeys(); q.onsuccess = () => res(q.result || []); q.onerror = () => rej(q.error); });
      const mam = new Set(sez('rozpocty').map(r => r.id)), nejnovejsi = new Map();
      klice.forEach(k => { const m = /^r:([^:]+):(\d+)$/.exec(String(k)); if (!m || mam.has(m[1]) || (H.smazano && H.smazano('rozpocty', m[1]))) return; const rev = Number(m[2]); if (!(nejnovejsi.get(m[1]) >= rev)) nejnovejsi.set(m[1], rev); });
      const nove = [];
      for (const [id, rev] of nejnovejsi) {
        const c = await idbGet('r:' + id + ':' + rev); if (!c || !c.gz) continue;
        let data; try { data = JSON.parse(await gunzip(c.gz)); } catch (e) { continue; }
        const rows = zPole(data.rows || []), pol = rows.filter(r => r.t === 'P');
        const L = (data.listy || [])[0] || {};
        nove.push({id, nazev: data.nazev || 'Rozpočet' + (L.n ? ' – ' + L.n : ''), soubor: data.soubor || '', rev, gid: '', vel: c.gz.size, pocet: rows.length, polozek: pol.length, celkem: Math.round(pol.reduce((a, r) => a + (r.cc || 0), 0) * 100) / 100, kdo: kdo(), pc: pcId(), kdy: new Date(rev).toISOString(), obj: {}});
      }
      if (nove.length) { H.upsert('rozpocty', nove); toast('Rozpočet obnoven z tohoto počítače a posílá se kolegům.'); dokoncitNahrani(); }
    } catch (e) {} finally { OBNOVA = false; }
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
  /* ---------- rozbor textů: objekty z výkazu výměr („křídlo A“, „objekt D“…) a činnosti / řemesla ---------- */
  const RX_OBJ = /(?:[Kk][řr][íi]dl[a-zěščřžýáíéůú]*|[Oo]bjekt[a-zěščřžýáíéůú]*|[Bb]udov[a-zěščřžýáíéůú]*|[Ss]ekce|SO)\s*[„"]?([A-G])(?![a-zA-Z0-9])/;
  const RX_MC = /(?:^|["„'\s(;,])(?:m\.\s?č\.\s*)?([A-G])\.?(?:\d|PP|NP)\.?\d{2}(?!\d)/;   // číslo místnosti: „D3.03“, m.č. B.2.01
  const objZTextu = t => { const s = String(t || ''); const m = RX_OBJ.exec(s) || RX_MC.exec(s); return m ? m[1] : ''; };
  const RX_SOUCET = /^(mezisoucet|soucet|celkem|mezisouc)/;
  // činnosti podle kódu ÚRS (nejdelší shoda vyhrává) a podle slov v textu položky nebo nadpisu
  const CIN_KOD = [['1', 'Zemní práce'], ['2', 'Zakládání'], ['3', 'Zednické – svislé konstrukce'], ['4', 'Vodorovné konstrukce (stropy, schodiště)'], ['5', 'Komunikace'], ['6', 'Omítky a úpravy povrchů'], ['61', 'Omítky a úpravy povrchů'], ['62', 'Fasády – úpravy povrchů vnějších'], ['63', 'Podlahy a potěry'], ['64', 'Osazování výplní otvorů'], ['9', 'Ostatní konstrukce, lešení, bourání'], ['94', 'Lešení'], ['95', 'Ostatní konstrukce'], ['96', 'Bourání'], ['97', 'Bourání a prorážení'], ['997', 'Přesun sutě'], ['998', 'Přesun hmot'],
    ['711', 'Izolace proti vodě'], ['712', 'Povlakové krytiny'], ['713', 'Tepelné izolace'], ['714', 'Akustické izolace'], ['715', 'Izolace proti chemikáliím'], ['721', 'ZTI – kanalizace'], ['722', 'ZTI – vodovod'], ['723', 'Plynovod'], ['724', 'ZTI – strojní vybavení'], ['725', 'ZTI – zařizovací předměty'], ['726', 'ZTI – předstěnové instalace'], ['727', 'Protipožární ochrana'], ['731', 'Vytápění'], ['732', 'Vytápění'], ['733', 'Vytápění'], ['734', 'Vytápění'], ['735', 'Vytápění – otopná tělesa'], ['741', 'Elektroinstalace'], ['742', 'Elektroinstalace – slaboproud'], ['743', 'Elektromontáže'], ['751', 'Vzduchotechnika'], ['761', 'Konstrukce prosvětlovací'], ['762', 'Tesařské práce'], ['763', 'Suchá výstavba (sádrokarton)'], ['764', 'Klempířské práce'], ['765', 'Pokrývačské práce – krytiny skládané'], ['766', 'Truhlářské práce'], ['767', 'Zámečnické práce'], ['768', 'Vrata'], ['769', 'Otvorové prvky z plastu'], ['771', 'Obkladačské práce'], ['772', 'Kamenické práce'], ['773', 'Podlahy teracové'], ['775', 'Podlahy skládané (parkety)'], ['776', 'Podlahy povlakové (lino, PVC, koberce)'], ['777', 'Podlahy lité'], ['778', 'Podlahy z vláknocementu'], ['781', 'Obkladačské práce'], ['782', 'Kamenické práce'], ['783', 'Malířské a natěračské – nátěry'], ['784', 'Malířské práce – malby a tapety'], ['786', 'Čalounické práce, stínění'], ['787', 'Sklenářské práce'], ['789', 'Povrchové úpravy ocelových konstrukcí']];
  const CIN_KOD_M = new Map(CIN_KOD);
  const CIN_SLOVA = [[/kamen|zula|piskovc|mramor|zulov/, 'Kamenické práce'], [/stuk|stukat|stukov/, 'Štukatérské práce'], [/klemp|oplech|okapn|zlab|svod/, 'Klempířské práce'], [/krytin|bobrov|tasek|taska|pokryv|bridlic/, 'Pokrývačské práce – krytiny skládané'], [/krov|krokv|trám|tram|bedneni|tesar|latovan|kontralat/, 'Tesařské práce'], [/sadrokart|sdk|podhled|predstena/, 'Suchá výstavba (sádrokarton)'],
    [/strecni okn|vylez/, 'Střešní okna a výlezy'], [/okn|dver|zarub|vyplni otvor|vykladc|truhl|oblozeni|regal|kuchyn/, 'Truhlářské práce'], [/zamecn|zabradl|ocelov|kovov|mriz/, 'Zámečnické práce'], [/kerami/, 'Keramické prvky'], [/vytah/, 'Výtahy'], [/svitid|elektro|kabel|zasuv/, 'Elektroinstalace'], [/malb|maliv|tapet/, 'Malířské práce – malby a tapety'], [/nater/, 'Malířské a natěračské – nátěry'], [/omitk/, 'Omítky a úpravy povrchů'], [/dlazb|obklad/, 'Obkladačské práce'], [/izolac/, 'Izolace'], [/bour|vybour|demont/, 'Bourání'], [/azbest/, 'Odstranění azbestu'], [/restaur|umelecko/, 'Umělecko-řemeslné práce'], [/rolet|zatemn|stinic/, 'Stínění a rolety'], [/ptactv/, 'Sítě proti ptactvu'], [/zdiv|pricky|preklad/, 'Zednické – svislé konstrukce'], [/podlah/, 'Podlahy a potěry']];
  function cinnost(r, rows) {
    const k = String(r.k || '').replace(/\s/g, '');
    if (/^\d{3,}/.test(k)) for (const n of [3, 2, 1]) { const x = CIN_KOD_M.get(k.slice(0, n)); if (x) return x; }
    const t = ' ' + norm(r.d);
    for (const [rx, n] of CIN_SLOVA) if (rx.test(t)) return n;
    let p = r.p;
    while (p >= 0 && rows[p].t !== 'L') {
      const s = rows[p], sk = String(s.k || '').replace(/\s/g, '');
      if (/^\d{1,3}$/.test(sk) && CIN_KOD_M.get(sk)) return CIN_KOD_M.get(sk);
      const st = ' ' + norm(s.d); for (const [rx, n] of CIN_SLOVA) if (rx.test(st)) return n;
      p = s.p;
    }
    const sek = r.p >= 0 && rows[r.p].t !== 'L' ? rows[r.p].d : '';
    return sek ? String(sek).replace(/\s+-\s+.*$/, '').slice(0, 60) : 'Ostatní';
  }
  const RX_NP = /(?:^|[^\d.,])(\d{1,2})\s?\.?\s?(NP|PP)\b/;   // podlaží: 1.NP, 2.PP, „Skladby podlah 1PP“
  const RX_PODL2 = /podla[žz][ií]\s+(\d{1,2})\b/i;   // „sekce A podlaží 5“
  const podlZTextu = t => { const m = RX_NP.exec(String(t || '')); if (m) return Number(m[1]) + '.' + m[2]; const n = RX_PODL2.exec(String(t || '')); return n ? Number(n[1]) + '.NP' : ''; };
  const RX_CAST = /^((?:D|SO|IO|PS|E|F|B|C)[\s.\-_]?\d[\w.\-_]*)\s*-\s*\S/;   // část projektu: D.1.1 - Architektonicko…, IO.411 - Přeložka…, PS.01 - Trafostanice
  const RADA_PODL = p => { const m = /^(\d+)\.(NP|PP)$/.exec(p); return m ? (m[2] === 'PP' ? -Number(m[1]) : Number(m[1])) : 99; };
  function analyza(Rx) {
    if (Rx.vv) return;
    const rows = Rx.rows, n = rows.length, vv = new Array(n), txtO = new Array(n).fill(''), txtP = new Array(n).fill(''), cin = new Array(n).fill(''), dil = new Array(n).fill(''), cast = new Array(n).fill(''), obor = new Array(n).fill('');
    // sloupec s obory / řemesly (např. sloupec B „Obor“: Zakládání, S.K Konstrukce …) – textový sloupec s málo různými hodnotami u položek
    const L0 = rows.find(r => r.t === 'L'), li = (Rx.listy || [])[L0 ? L0.s : 0] || {}, mp = li.map || {}, role = new Set(Object.values(mp));
    let oborSl = -1, oborN = '';
    if (rows.some(r => r.c)) {
      const st = {};
      Rx.polozky.forEach(r => (r.c || []).forEach((v, c) => { if (role.has(c) || typeof v !== 'string' || !v || v.length > 40) return; (st[c] ||= new Map()).set(v, ((st[c].get(v)) || 0) + 1); }));
      let best = 0;
      Object.entries(st).forEach(([c, m]) => { const cov = [...m.values()].reduce((a, b) => a + b, 0) / Math.max(1, Rx.polozky.length); if (m.size >= 2 && m.size <= 200 && cov > 0.6 && cov * 100 - m.size > best) { best = cov * 100 - m.size; oborSl = +c; } });
      if (oborSl >= 0) oborN = (li.nazvy || [])[oborSl] || 'Obor';
    }
    let akt = '';
    for (let i = 0; i < n; i++) { const r = rows[i]; if (r.t === 'L') akt = ''; else if (r.t !== 'D' && r.t !== 'P') { const m = RX_CAST.exec(String(r.d || '')); if (m) akt = String(r.d).slice(0, 80); } cast[i] = akt; }
    Rx.polozky.forEach(r => {
      // objekt a podlaží uvedené v textu položky nebo v nadpisech nad ní
      let o = objZTextu(r.d), pd = podlZTextu(r.d), p = r.p;
      while ((!o || !pd) && p >= 0) { if (!o) o = objZTextu(rows[p].d); if (!pd) pd = podlZTextu(rows[p].d); p = rows[p].p; }
      txtO[r.i] = o; txtP[r.i] = pd;
      // výkaz výměr: řádky po štítku „křídlo A“ / „1.NP“ patří tomu objektu / podlaží, dokud nepřijde další štítek
      const m = new Map(); let co = '', cp = '', nasel = false;
      for (const di of Rx.deti[r.i]) {
        const d = rows[di]; if (d.t !== 'D') continue;
        const oo = objZTextu(d.d); if (oo) { co = oo; nasel = true; }
        const pp = podlZTextu(d.d); if (pp) { cp = pp; nasel = true; }
        if (d.mn == null || RX_SOUCET.test(norm(d.d))) continue;
        const k = co + '|' + cp; m.set(k, (m.get(k) || 0) + d.mn);
      }
      if (nasel) vv[r.i] = [...m.entries()].filter(([, q]) => Math.abs(q) > EPS).map(([k, q]) => { const [a, b] = k.split('|'); return [a, b, q]; });
      cin[r.i] = cinnost(r, rows);
      // díl = nejbližší nadpis nad položkou (ÚRS díl s číslem má přednost: 2 Zakládání, 3 Svislé a kompletní konstrukce)
      let x = r.p, prvni = '';
      while (x >= 0 && rows[x].t !== 'L') { const s = rows[x]; if (s.t === 'S2') { const nm = ((s.k ? s.k + ' ' : '') + s.d).slice(0, 70); if (!prvni) prvni = nm; if (/^\d{1,3}$/.test(String(s.k).trim())) { prvni = nm; break; } } x = s.p; }
      dil[r.i] = prvni;
      if (oborSl >= 0) obor[r.i] = r.c && typeof r.c[oborSl] === 'string' ? r.c[oborSl] : '';
    });
    Object.assign(Rx, {vv, objTxt: txtO, podlTxt: txtP, cin, dil, cast, obor, oborN});
    const cm = new Map(); Rx.polozky.forEach(r => { const a = cm.get(cin[r.i]) || []; a.push(r.id); cm.set(cin[r.i], a); });
    Rx.cinnosti = [...cm.entries()].sort((a, b) => a[0].localeCompare(b[0], 'cs')).map(([nm, pol]) => ({id: 'c:' + nm, nazev: nm, pol, virt: true}));
    const sezn = arr => { const m = new Map(); Rx.polozky.forEach(r => { const v = arr[r.i]; if (v) m.set(v, (m.get(v) || 0) + (r.cc || 0)); }); return [...m.entries()].map(([v, kc]) => ({v, kc})); };
    Rx.seznamy = {cast: sezn(cast), dil: sezn(dil).sort((a, b) => a.v.localeCompare(b.v, 'cs', {numeric: true})), obor: sezn(obor).sort((a, b) => b.kc - a.kc)};
  }
  // druhy prací = vlastní (uložené) + automatické činnosti
  const vsechnyKat = rp => kategorie(rp).concat(R && R.rec.id === rp && R.cinnosti ? R.cinnosti : []);
  const najdiKat = (rp, id) => vsechnyKat(rp).find(k => k.id === id) || null;
  const obBadges = pod => (pod || []).filter(x => x[0]).map(x => obBadge(x[0])).join('');
  const obText = pod => (pod || []).filter(x => x[0]).map(x => x[0] + (pod.length > 1 ? ' ' + Math.round(x[1] * 100) + ' %' : '')).join(', ');
  function objPolozky(Rx, r) { const o = Rx.rec.obj || {}; let x = r; while (x) { if (o[x.id]) return o[x.id]; x = x.p >= 0 ? Rx.rows[x.p] : null; } return ''; }
  // podíl položky na objektech a podlažích [[objekt, podlaží, podíl]]: ruční přiřazení položky > výkaz výměr (křídlo A, 1.NP …) > ruční přiřazení nadpisu či listu > text
  function podilObjektu(Rx, r) {
    const ruc = (Rx.rec.obj || {})[r.id], vys = objPolozky(Rx, r);
    const zo = ruc || vys || Rx.objTxt[r.i] || '', zp = Rx.podlTxt[r.i] || '';
    const v = Rx.vv[r.i];
    if (v && v.length) {
      const m = new Map(); v.forEach(([o, pd, q]) => { const k = (ruc || o || zo) + '|' + (pd || zp); m.set(k, (m.get(k) || 0) + q); });
      const sum = [...m.values()].reduce((a, b) => a + b, 0);
      if (sum > EPS) return [...m.entries()].map(([k, q]) => { const [o, pd] = k.split('|'); return [o, pd, q / sum]; }).sort((a, b) => b[2] - a[2]);
    }
    return [[zo, zp, 1]];
  }
  const souhrnObj = j => { const m = new Map(); j.forEach(([o, , sh]) => m.set(o, (m.get(o) || 0) + sh)); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
  function spocti(Rx) {
    const fs = faktury(Rx.rec.id), ks = kategorie(Rx.rec.id);
    const sig = Rx.rec.id + Rx.rec.rev + '|' + JSON.stringify(Rx.rec.obj || {}).length + '|' + fs.map(f => f.id + (f._ts || 0)).join(',') + '|' + ks.map(k => k.id + (k._ts || 0)).join(',');
    if (CERP && CERP_SIG === sig && CERP.R === Rx) return CERP;
    analyza(Rx);
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
    const sum = new Float64Array(Rx.rows.length), obj = new Array(Rx.rows.length).fill(null), jo = new Array(Rx.rows.length).fill(null);
    const objSum = {}, mat = {};
    Rx.polozky.forEach(r => {
      const j = podilObjektu(Rx, r); jo[r.i] = j; const pod = souhrnObj(j); obj[r.i] = pod;
      const x = pol.get(r.id);
      pod.forEach(([o, sh]) => { const os = objSum[o] ||= {roz: 0, cer: 0, n: 0}; os.roz += (r.cc || 0) * sh; os.n++; if (x) os.cer += x.kc * sh; });
      j.forEach(([o, pd, sh]) => { const k = (pd || '–') + '|' + (o || '–'); mat[k] = (mat[k] || 0) + (r.cc || 0) * sh; });
      if (!x) return;
      x.nad = r.mn != null && x.mn > r.mn + Math.max(EPS, Math.abs(r.mn) * 1e-9);
      x.nadKc = r.cc != null && x.kc > r.cc + 0.5;
      if (x.nad || x.cena || x.nadKc) upoz++;
      let p = r.p; while (p >= 0) { sum[p] += x.kc; p = Rx.rows[p].p; }
    });
    const katPol = new Map(), katSum = {};
    ks.concat(Rx.cinnosti || []).forEach(k => { const s = katSum[k.id] = {roz: 0, cer: 0, n: 0}; (k.pol || []).forEach(id => { const r = Rx.byId.get(id); if (!r || r.t !== 'P') return; s.n++; s.roz += r.cc || 0; const x = pol.get(id); if (x) s.cer += x.kc; const a = katPol.get(id) || []; a.push(k.id); katPol.set(id, a); }); });
    let roz = 0; Rx.polozky.forEach(r => roz += r.cc || 0);
    const zam = new Map(); fs.forEach(f => { if (f.uzavreno) (f.pol || []).forEach(l => { if (l.r && Number(l.mn)) zam.set(l.r, (zam.get(l.r) || 0) + (Number(l.mn) || 0)); }); });
    CERP = {R: Rx, pol, sum, obj, jo, mat, objSum, katPol, katSum, celkem, mimo, upoz, roz, zam};
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
    if (!smi('rozp')) { EL.innerHTML = '<div class="rz"><div class="rz-empty"><b>Rozpočet nemáte povolený</b>Rozpočet a ceny vidí jen kolegové, kterým to správce zaškrtl v kartě osoby (Lidé → Upravit kartu → Oprávnění).</div></div>'; return; }
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
    if (S.panel === 'rozpocet') { const t = EL.querySelector('.rz-tab'); if (t) { vyska(t); t.scrollTop = SCROLL; kresliRadky(); } }
  }
  // tabulka vyplní obrazovku až dolů (Luboš 19. 11.: rozpočet je hlavní, má být vidět co nejvíc řádků)
  function vyska(t) { t = t || (EL && EL.querySelector('.rz-tab')); if (!t || !t.isConnected) return; const top = t.getBoundingClientRect().top + window.scrollY; t.style.height = Math.max(320, window.innerHeight - top - 22) + 'px'; }
  window.addEventListener('resize', () => { vyska(); if (EL && EL.querySelector('.rz-tab')) kresliRadky(); });
  function prazdne() {
    return `<div class="rz"><div class="rz-top"><button type="button" class="rz-btn rz-bok" data-a="bok" aria-label="Nabídka">☰</button><h2>Rozpočet</h2><span class="sp"></span><button type="button" class="rz-btn" data-a="zavrit">✕ Zavřít</button></div>
      <div class="rz-empty"><b>Zatím tu není žádný rozpočet</b>
        <ol><li>Klikněte na žluté tlačítko <b>Nahrát rozpočet z Excelu</b>.</li><li>Vyberte soubor rozpočtu (.xlsx nebo .xls) – klidně se 40 000 řádky.</li><li>Constructo samo pozná sloupce (číslo, popis, MJ, množství, ceny). Zkontrolujte a klikněte <b>Uložit rozpočet</b>.</li></ol>
        <div><button type="button" class="rz-btn zl" data-a="import"${ro() ? ' disabled' : ''}>⬆ Nahrát rozpočet z Excelu</button></div>
        <p style="margin-top:12px;font-size:13px">Soubor můžete také přetáhnout myší sem do okna.</p></div>${skriptInfo()}</div>`;
  }
  function skriptInfo() {
    if (!H.pripojeno()) return '<div class="rz-info">Bez připojení ke Googlu zůstane rozpočet jen v tomto počítači. Pro sdílení s kolegy zapněte Data → Automatická synchronizace.</div>';
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
    return `<div class="rz-top"><button type="button" class="rz-btn rz-bok" data-a="bok" title="Ukázat nebo schovat boční nabídku (Harmonogram, Úkoly…)" aria-label="Nabídka">☰</button>${sel}<span class="rz-inf" style="font-size:12.5px;color:var(--muted)">${esc(rec.soubor || '')}${rec.kdo ? ' · nahrál(a) ' + esc(rec.kdo) : ''}${rec.kdy ? ' ' + new Date(rec.kdy).toLocaleDateString('cs-CZ') : ''}${rec.gid ? '' : H.pripojeno() ? ' · <b style="color:#a96a00">ukládá se na Disk Google…</b>' : ''}</span><span class="sp"></span>
      <button type="button" class="rz-btn" data-a="xls-roz" title="Stáhnout rozpočet s čerpáním do Excelu (jen to, co je právě vyfiltrované)">⬇ Excel</button>
      <button type="button" class="rz-btn" data-a="menu-rp">Rozpočet ▾</button>
      <button type="button" class="rz-btn zl" data-a="import"${ro() ? ' disabled' : ''}>⬆ Nahrát rozpočet z Excelu</button>
      <button type="button" class="rz-btn cr" data-a="fak-vytvor"${nefak() ? ' disabled' : ''} title="${nefak() && !ro() ? 'Připravovat faktury vám správce nepovolil' : 'Vybrat položky, zadat rozsah v jednotkách nebo v procentech a vytvořit fakturu s logem'}">🧾 Vytvořit fakturu</button>
      <button type="button" class="rz-btn" data-a="zavrit" title="Zavřít rozpočet a vrátit se na úvodní stránku">✕ Zavřít</button></div>${sum}${S.chyba ? `<div class="rz-info">${esc(S.chyba)}</div>` : ''}`;
  }

  /* ----- panel Rozpočet: stejná tabulka jako v Excelu (všechny sloupce, barvy, seskupení), kreslí se jen viditelné řádky ----- */
  let VIS = [];
  // úrovně seskupení: z Excelu (outline 1–7), a když je Excel nemá, podle dílů / položek / výkazu výměr
  function obrys(Rx) {
    const rows = Rx.rows, n = rows.length, lv = new Uint8Array(n), head = new Uint8Array(n), skr0 = new Uint8Array(n);
    const maOutline = new Set(); rows.forEach(r => { if (r.t !== 'L' && r.l > 0) maOutline.add(r.s); });
    rows.forEach((r, i) => { lv[i] = r.t === 'L' ? 0 : maOutline.has(r.s) ? Math.min(7, r.l || 0) : Math.max(0, Rx.hl[i] - 1); });
    let max = 0;
    for (let i = 0; i < n; i++) {
      if (rows[i].t === 'L') continue;
      if (lv[i] > max) max = lv[i];
      const j = i + 1;
      if (j < n && rows[j].t !== 'L' && lv[j] > lv[i]) { head[i] = 1; skr0[i] = maOutline.has(rows[i].s) ? (rows[j].h ? 1 : 0) : (rows[i].t === 'P' ? 1 : 0); }
    }
    Rx.lv = lv; Rx.head = head; Rx.skr0 = skr0; Rx.maxLv = max;
    Rx.vicListu = rows.filter(r => r.t === 'L').length > 1;
    // sloupce: podle prvního listu (u starších uložených rozpočtů bez buněk jen hlavní sloupce)
    const L0 = rows.find(r => r.t === 'L'), li = (Rx.listy || [])[L0 ? L0.s : 0] || {};
    Rx.v2 = rows.some(r => r.c);
    let nc = 0;
    if (Rx.v2) rows.forEach(r => { if (r.c && r.c.length > nc) nc = r.c.length; });
    const cols = [];
    if (Rx.v2) {
      for (let c = 0; c < nc; c++) {
        const cl = (li.cols || [])[c] || {}; if (cl.h) continue;
        let w = Math.round((cl.w || 64) * 1.05);
        // čísla se nesmí useknout: sloupec s čísly je aspoň tak široký, aby se vešla nejdelší hodnota
        let mx = 0; for (let i = 0; i < rows.length && i < 6000; i++) { const v = rows[i].c && rows[i].c[c]; if (typeof v === 'number') { const d = (li.dec || [])[c]; const t = d >= 0 ? v.toFixed(Math.min(d, 6)) : String(Math.round(v * 1000) / 1000); const l = t.length + Math.floor(t.split('.')[0].length / 3); if (l > mx) mx = l; } }
        if (mx) w = Math.max(w, mx * 7.6 + 14);
        // krátké texty (číslo položky, P.č.) se také nesmí useknout – sloupec se rozšíří, nejvýš na 170 px
        if (!(li.map && li.map.popis === c)) { let ml = 0; for (let i = 0; i < rows.length && i < 6000; i++) { const v = rows[i].c && rows[i].c[c]; if (typeof v === 'string' && v.length <= 22 && v.length > ml && rows[i].t === 'P') ml = v.length; } if (ml) w = Math.max(w, Math.min(170, ml * 7.4 + 14)); }
        if (li.map && li.map.popis === c) w = Math.max(w, 280);
        cols.push({popis: !!(li.map && li.map.popis === c), c, w: Math.max(26, Math.min(700, w)), n: (li.nazvy || [])[c] || sloupec(c + (li.odSl || 0)), dec: (li.dec || [])[c], fill: (li.colFill || [])[c] || ''});
      }
    } else {
      [['pc', 'PČ', 44], ['k', 'Kód', 100], ['d', 'Popis', 360], ['mj', 'MJ', 44], ['mn', 'Množství', 90], ['jc', 'J. cena', 90], ['cc', 'Celkem', 110]].forEach(([k, nm, w]) => cols.push({popis: k === 'd', k, w, n: nm, dec: k === 'mn' ? -1 : k === 'pc' ? 0 : 2, fill: ''}));
    }
    Rx.cols = cols;
    const gut = 16 + Math.max(1, max) * 11;
    Rx.grid = [gut, 46, 24].concat(cols.map(c => c.w), [72, 104, 104, 24]);
    Rx.gridW = Rx.grid.reduce((a, b) => a + b, 0) + 12;
  }
  function zavreno(i) {
    const r = R.rows[i];
    if (S.zav.has(r.id)) return true;
    if (S.otev.has(r.id)) return false;
    if (filtrAktivni()) return true;
    if (S.uroven) { const j = i + 1; return j < R.rows.length && R.lv[j] >= S.uroven; }
    return !!R.skr0[i];
  }
  function filtrAktivni() { return !!(S.q.trim() || S.obj || S.kat || S.jenUpoz || S.pod || S.dil || S.cast || S.obor); }
  // podíl položky, který odpovídá vybranému objektu a podlaží (např. 40 % výkazu výměr je v křídle A)
  function podilVyberu(C, r) {
    if (!S.obj && !S.pod) return 1;
    let sh = 0; (C.jo[r.i] || [['', '', 1]]).forEach(([o, pd, x]) => { if (S.obj && (o || '-') !== S.obj) return; if (S.pod && (pd || '-') !== S.pod) return; sh += x; });
    return sh;
  }
  function spocitejViditelne(C) {
    const rows = R.rows, out = [];
    if (!filtrAktivni()) {
      let skrList = false, hideLv = -1;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (r.t === 'L') { skrList = S.zav.has(r.id); hideLv = -1; if (R.vicListu) out.push(i); continue; }
        if (skrList) continue;
        if (hideLv >= 0) { if (R.lv[i] > hideLv) continue; hideLv = -1; }
        if (S.uroven && R.lv[i] >= S.uroven && !S.otev.size && !S.zav.size) continue;
        out.push(i);
        if (R.head[i] && zavreno(i)) hideLv = R.lv[i];
      }
      return out;
    }
    const slova = norm(S.q).split(' ').filter(Boolean);
    const kat = S.kat && (najdiKat(R.rec.id, S.kat) || {pol: []});
    const katSet = kat ? new Set(kat.pol || []) : null;
    const ok = new Uint8Array(rows.length);
    let kc = 0, np = 0; const ids = [];
    R.polozky.forEach(r => {
      if (S.cast && R.cast[r.i] !== S.cast) return;
      if (S.dil && R.dil[r.i] !== S.dil) return;
      if (S.obor && R.obor[r.i] !== S.obor) return;
      const sh = podilVyberu(C, r); if (sh <= EPS) return;
      if (katSet && !katSet.has(r.id)) return;
      if (S.jenUpoz) { const x = C.pol.get(r.id); if (!x || !(x.nad || x.cena || x.nadKc)) return; }
      if (slova.length) { const h = r._h || (r._h = norm(r.pc + ' ' + r.k + ' ' + r.d + ' ' + r.mj)); if (!slova.every(s => h.includes(s))) { const ph = norm(rows[r.p] ? rows[r.p].d : ''); if (!slova.every(s => h.includes(s) || ph.includes(s))) return; } }
      ok[r.i] = 1; kc += (r.cc || 0) * sh; np++; ids.push([r.id, sh]); let p = r.p; while (p >= 0 && ok[p] !== 1) { ok[p] = 2; p = rows[p].p; }
    });
    out._kc = kc; out._n = np; out._ids = ids;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (ok[i]) { if (r.t !== 'L' || R.vicListu) out.push(i); continue; }
      if (r.t === 'D' && ok[r.p] === 1 && S.otev.has(rows[r.p].id)) out.push(i);
    }
    return out;
  }
  function panelRozpocet(C) {
    if (!R.lv) obrys(R);
    VIS = spocitejViditelne(C);
    const ks = kategorie(R.rec.id), cs = R.cinnosti || [];
    const nV = S.vyb.size;
    let vybKc = 0; if (nV) S.vyb.forEach(id => { const r = R.byId.get(id); if (r) vybKc += r.cc || 0; });
    const objs = OBJEKTY.concat(Object.keys(C.objSum).filter(o => o && !OBJEKTY.includes(o)));
    const urovne = []; for (let k = 1; k <= R.maxLv + 1; k++) urovne.push(k);
    const pi = R.cols.findIndex(c => c.popis);   // sloupec s popisem dostane zbytek šířky obrazovky
    const g = R.grid.map((w, i) => i === pi + 3 && pi >= 0 ? `minmax(${w}px, 1fr)` : w + 'px').join(' ');
    const sz = R.seznamy || {cast: [], dil: [], obor: []};
    const podl = [...new Set(Object.keys(C.mat).map(k => k.split('|')[0]))].filter(p => p !== '–').sort((x, y) => RADA_PODL(x) - RADA_PODL(y) || x.localeCompare(y));
    const opt = (v, t, akt) => `<option value="${esc(v)}"${akt === v ? ' selected' : ''}>${esc(t)}</option>`;
    const sel = (k, lab, vse, items, akt) => `<label class="rz-fl-l"><span>${lab}</span><select class="rz-sel${akt ? ' akt' : ''}" data-fk="${k}" aria-label="${lab}"><option value="">${vse}</option>${items}</select></label>`;
    const zk = t => t.length > 60 ? t.slice(0, 58) + '…' : t;
    const sKc = x => opt(x.v, zk(x.v) + ' · ' + kc0(x.kc), null);
    const selS = (k, lab, vse, list, akt) => sel(k, lab, vse, list.map(x => opt(x.v, zk(x.v) + ' · ' + kc0(x.kc), akt)).join(''), akt);
    const katOpts = (ks.length ? `<optgroup label="Moje druhy prací">${ks.map(k => opt(k.id, k.nazev, S.kat)).join('')}</optgroup>` : '') + `<optgroup label="Řemesla – poznáno automaticky z kódu ÚRS a textu">${cs.map(k => opt(k.id, k.nazev + ' (' + k.pol.length + ')', S.kat)).join('')}</optgroup>`;
    const objOpts = objs.map(o => opt(o, 'Objekt ' + o, S.obj)).join('') + opt('-', 'Bez objektu', S.obj);
    const podOpts = podl.map(p => opt(p, p, S.pod)).join('') + opt('-', 'Bez podlaží', S.pod);
    const nF = [S.cast, S.dil, S.obor, S.kat, S.obj, S.pod].filter(Boolean).length;
    return `<div class="rz-fil rz-flt">
        <input class="rz-q" type="search" placeholder="Hledat v rozpočtu (kód, popis, např. krokve)…" value="${esc(S.q)}" data-a="q">
        ${sz.cast.length > 1 ? selS('cast', 'Část projektu', 'Všechny části', sz.cast, S.cast) : ''}
        ${sz.dil.length ? selS('dil', 'Díl (nadpis)', 'Všechny díly', sz.dil, S.dil) : ''}
        ${R.oborN && sz.obor.length > 1 ? selS('obor', esc(R.oborN), 'Vše', sz.obor, S.obor) : ''}
        ${sel('kat', 'Druh prací / řemeslo', 'Všechna řemesla', katOpts, S.kat)}
        ${sel('obj', 'Objekt', 'Všechny objekty', objOpts, S.obj)}
        ${sel('pod', 'Podlaží', 'Všechna podlaží', podOpts, S.pod)}
        <label class="rz-chk"><input type="checkbox" data-a="upoz"${S.jenUpoz ? ' checked' : ''}> Jen s upozorněním</label>
        ${nF ? `<button type="button" class="rz-btn mini" data-a="f-zrus">✕ Zrušit filtry</button>` : ''}
        ${filtrAktivni() && VIS._n ? `<button type="button" class="rz-btn mini zl" data-a="poptat" title="Stáhne Excel jen s vyfiltrovanými položkami ve stejné podobě jako rozpočet, ale bez cen – k poslání firmě na poptávku">📨 Poptat vybrané (Excel bez cen)</button><button type="button" class="rz-btn mini" data-a="fak-filtr"${nefak() ? ' disabled' : ''} title="Založí fakturaci se všemi vyfiltrovanými položkami – pak stačí zadat procento">Fakturovat vybrané %…</button>` : ''}
        ${filtrAktivni() ? `<span class="rz-souhrn">Vybráno <b>${nf0.format(VIS._n || 0)}</b> položek za <b>${kc0(VIS._kc || 0)}</b>${S.obj || S.pod ? ' <span title="U položek, kde výkaz výměr dělí množství mezi více objektů nebo podlaží, se počítá jen jejich podíl.">(podíl podle výkazu výměr)</span>' : ''}</span>` : ''}
        <span class="sp" style="flex:1"></span>
        <span style="font-size:12.5px;color:var(--muted)">Seskupení:</span>
        <div class="rz-seg" role="group" aria-label="Úroveň seskupení jako v Excelu"><button type="button" data-ur="0" aria-pressed="${!S.uroven}" title="Rozbaleno a schováno přesně jako v nahraném Excelu">Jako v Excelu</button>${urovne.map(k => `<button type="button" data-ur="${k}" aria-pressed="${S.uroven === k}" title="${k === 1 ? 'Sbalit vše' : k === R.maxLv + 1 ? 'Rozbalit vše' : 'Ukázat úrovně 1 až ' + k}">${k}</button>`).join('')}</div>
      </div>
      ${S.fak ? listaFaktury(C) : nV ? `<div class="rz-vyber"><b>Vybráno ${nf0.format(nV)} položek · ${kc0(vybKc)}</b>
        <button type="button" class="rz-btn mini" data-a="v-kat"${ro() ? ' disabled' : ''}>Zařadit do druhu prací…</button>
        ${S.kat ? `<button type="button" class="rz-btn mini" data-a="v-kat-pryc"${ro() ? ' disabled' : ''}>Odebrat z tohoto druhu</button>` : ''}
        <button type="button" class="rz-btn mini" data-a="v-obj"${ro() ? ' disabled' : ''}>Přiřadit objekt…</button>
        <button type="button" class="rz-btn mini" data-a="v-fak"${ro() ? ' disabled' : ''}>Vyfakturovat…</button>
        <span style="flex:1"></span><button type="button" class="rz-btn mini" data-a="v-zrus">Zrušit výběr</button></div>` : ''}
      <div class="rz-tab" tabindex="0" style="--g:${g};--gw:${R.gridW}px">
        <div class="rz-hd"><span></span><span></span><span><input type="checkbox" data-a="vyb-vse" title="Vybrat všechny zobrazené položky"></span>${R.cols.map(c => `<span class="${c.dec != null && c.dec !== -2 && /mno|cen|celk|vym|kc|pocet/i.test(bezDia(c.n)) ? 'n' : ''}" title="${esc(c.n)}">${esc(c.n)}</span>`).join('')}<span class="nx">Obj.</span><span class="n nx">Čerpáno Kč</span><span class="n nx">Zbývá Kč</span><span class="nx"></span></div>
        <div class="rz-in-tab" style="position:relative;height:${VIS.length * ROWH}px"></div>
      </div>
      <div class="rz-napoveda" style="font-size:12.5px;color:var(--muted)">${filtrAktivni() ? `Nalezeno ${nf0.format(VIS.filter(i => R.rows[i].t === 'P').length)} položek. ` : ''}Tlačítka 1–${R.maxLv + 1} fungují jako čísla seskupení vlevo nahoře v Excelu. Klik na − schová skupinu řádků, klik na + ji zase ukáže. Zaškrtnutím vyberete položky – nadpis vybere vše pod ním.</div>`;
  }
  const svetla = hex => { const n = parseInt(hex, 16); return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 > 140; };
  function bunka(v, col) {
    if (v === '' || v == null) return '';
    if (typeof v === 'number') { const d = col.dec; return d >= 0 ? v.toLocaleString('cs-CZ', {minimumFractionDigits: Math.min(d, 6), maximumFractionDigits: Math.min(d, 6)}) : nf3.format(v); }
    return esc(v);
  }
  function radekHtml(i, C) {
    const r = R.rows[i], top = VIS._pos[i] * ROWH;
    if (r.t === 'L') {
      const sk = S.zav.has(r.id);
      return `<div class="rz-r L" style="top:${top}px"><span><button type="button" class="tg" data-tg="${i}">${sk ? '+' : '−'}</button></span><span></span><span><input type="checkbox" data-vs="${i}"></span><span style="grid-column:4 / span ${R.cols.length}">List „${esc(r.d)}“ · ${kc(R.sum[i])} Kč</span><span>${obBadge(objPolozky(R, r))}</span><span class="n">${C.sum[i] ? kc(C.sum[i]) : ''}</span><span class="n">${C.sum[i] ? kc(R.sum[i] - C.sum[i]) : ''}</span><span></span></div>`;
    }
    const lv = R.lv[i], hd = R.head[i] && !(filtrAktivni() && r.t !== 'P');
    const tg = hd || (filtrAktivni() && r.t === 'P' && R.deti[i].length) ? `<button type="button" class="tg" data-tg="${i}" style="margin-left:${lv * 11}px" aria-label="${zavreno(i) ? 'Ukázat skupinu' : 'Schovat skupinu'}">${zavreno(i) ? '+' : '−'}</button>` : `<i class="dot" style="margin-left:${lv * 11 + 9}px"></i>`;
    const fr = {}; if (r.f) r.f.forEach(([c, col]) => fr[c] = col);
    const sek = r.t === 'S1' || r.t === 'S2';
    const cells = R.cols.map(col => {
      let v, bg = '';
      if (R.v2) { v = r.c ? r.c[col.c] : ''; bg = fr[col.c] || col.fill; } else v = r[col.k];
      const num = typeof v === 'number';
      const st = bg ? ` style="background:#${bg};color:${svetla(bg) ? '#16191c' : '#fff'}"` : '';
      const t = !num && v ? ` title="${esc(v)}"` : '';
      return `<span class="${num ? 'n' : ''}"${st}${t}>${bunka(v, col)}</span>`;
    }).join('');
    const vyb = r.t === 'P' && S.vyb.has(r.id);
    let pr = '<span></span><span class="n"></span><span class="n"></span><span></span>';
    if (r.t === 'P') {
      const x = C.pol.get(r.id);
      const w = x ? [x.nad ? `překročeno množství: vyfakturováno ${mnT(x.mn)} ${r.mj}, v rozpočtu ${mnT(r.mn)}` : '', x.nadKc ? 'vyfakturováno víc Kč než v rozpočtu' : '', x.cena ? 've fakturaci jiná jednotková cena než v rozpočtu' : ''].filter(Boolean) : [];
      const kats = C.katPol.get(r.id), kt = kats ? kats.map(k => (kategorie(R.rec.id).find(z => z.id === k) || {}).nazev || '').join(', ') : '';
      pr = `<span title="${esc(kt ? 'Druh prací: ' + kt : '')}"><span title="${esc('Objekt: ' + obText(C.obj[i]) + (R.cin[i] ? '\nČinnost: ' + R.cin[i] : ''))}">${obBadges(C.obj[i])}</span>${kats ? '<i class="kt" title="' + esc('Druh prací: ' + kt) + '">●</i>' : ''}</span><span class="n"${C.zam.has(r.id) ? ' title="Vyfakturováno uzavřenou fakturou – množství je zamčené"' : ''}>${C.zam.has(r.id) ? '🔒 ' : ''}${x ? kc(x.kc) : ''}</span><span class="n">${x ? kc((r.cc || 0) - x.kc) : ''}</span><span>${w.length ? `<span class="rz-war${x.nad || x.nadKc ? '' : ' o'}" title="${esc(w.join('\n'))}">⚠</span>` : x ? '<span class="rz-ok" title="Fakturace v pořádku">✓</span>' : ''}</span>`;
    } else if (sek) {
      const cer = C.sum[i];
      pr = `<span>${(R.rec.obj || {})[r.id] ? obBadge(objPolozky(R, r)) : ''}</span><span class="n">${cer ? kc(cer) : ''}</span><span class="n">${cer ? kc(R.sum[i] - cer) : ''}</span><span></span>`;
    }
    const chk = r.t === 'P' ? `<input type="checkbox" data-vp="${i}"${vyb ? ' checked' : ''}>` : sek ? `<input type="checkbox" data-vs="${i}">` : '';
    return `<div class="rz-r ${r.t}${vyb ? ' vyb' : ''}" style="top:${top}px"><span class="og">${tg}</span><span class="rn">${r.x || ''}</span><span>${chk}</span>${cells}${pr}</div>`;
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
      <div style="font-size:13px;color:var(--muted)">Objekty Constructo bere samo z výkazu výměr: řádky za štítkem „křídlo A“, „objekt D“ apod. patří tomu objektu, takže jedna položka se může rozdělit na více objektů (v tabulce pak vidíte např. A D G a po najetí myší procenta). Pokud v textu objekt není, můžete ho nastavit celému listu níže. Jednotlivé díly nebo položky můžete přiřadit jinému objektu v záložce Rozpočet: zaškrtněte je a klikněte <b>Přiřadit objekt…</b></div>`;
  }

  /* ----- panel Druhy prací ----- */
  const VYCHOZI_DRUHY = [
    ['Střecha', 'krov, krokev, krokve, trám, pozednic, vaznic, kleštin, sloupek krovu, bednění střech, pobití, prkn, laťován, latí, latě, kontralat, krytin, tašk, bobrovk, břidlic, plechová krytina, střeš, hřeben, úžlab, okap, žlab, svod, klemp, oplech, hromosvod, pojistná hydroizolace, difuzní fóli, parozábran, střešní okn, vikýř, sněhový zachytač, nadkrokevn', '762, 764, 765, 712'],
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
  function kartaDruhu(k, C, virt) {
    const s = C.katSum[k.id] || {roz: 0, cer: 0, n: 0};
    return `<div class="rz-card"><h3>${esc(k.nazev)}</h3>
        <div class="r"><span>Rozpočet</span><b>${kc0(s.roz)}</b></div><div class="r"><span>Vyfakturováno</span><b>${kc0(s.cer)}</b></div><div class="r"><span>Zbývá</span><b>${kc0(s.roz - s.cer)}</b></div>
        <div class="rz-bar"><i class="${s.cer > s.roz + 1 ? 'nad' : ''}" style="width:${Math.min(100, pct(s.cer, s.roz))}%"></i></div><div class="m">${nf0.format(s.n)} položek · čerpáno ${pct(s.cer, s.roz)} %</div>
        <div class="a"><button type="button" class="rz-btn mini" data-ukaz-kat="${esc(k.id)}">Zobrazit položky</button><button type="button" class="rz-btn mini" data-fak-kat="${esc(k.id)}"${ro() ? ' disabled' : ''}>Nová fakturace</button>${virt ? `<button type="button" class="rz-btn mini" data-cin-ulozit="${esc(k.id)}"${ro() ? ' disabled' : ''} title="Vytvoří z této činnosti vlastní druh prací, který můžete upravovat">Uložit jako druh prací</button>` : `<button type="button" class="rz-btn mini zl" data-navrh="${esc(k.id)}"${ro() ? ' disabled' : ''}>Najít položky…</button><button type="button" class="rz-btn mini" data-upr-kat="${esc(k.id)}"${ro() ? ' disabled' : ''}>Upravit</button>`}</div></div>`;
  }
  /* 4.72: přehlednější zobrazení činností a druhů prací – tabulka / žebříček / skupiny / karty */
  const DRUHY_V = [['tabulka', 'Tabulka'], ['zebricek', 'Žebříček'], ['skupiny', 'Skupiny'], ['karty', 'Karty']];
  const druhyV = () => DRUHY_V.some(x => x[0] === S.druhyV) ? S.druhyV : (S.druhyV = pam('rz-druhyV') || 'tabulka', DRUHY_V.some(x => x[0] === S.druhyV) ? S.druhyV : (S.druhyV = 'tabulka'));
  const SKUPINY = [
    ['Příprava, zařízení a přesuny', /zarizeni stavenist|inzenyrsk|ostatni naklad|vedlejsi|lesen|presun|bourani|sut|demontaz|vrn|projekt|dokumentac|geodet|zkousk|revize/],
    ['Hrubá stavba', /zemni|zaklad|zednick|svisl|vodorovn|strop|schodist|komunikac|beton|zelezobet|izolac|hydroizol|ostatni konstrukce|sanac|zdivo|piloty|kanalizace venk/],
    ['Střecha a fasáda', /strech|krytin|pokryv|tesar|klemp|fasad|vnejsi|zatepl|bleskosvod|hromosvod/],
    ['Dokončovací práce', /omit|podlah|potery|obklad|dlazb|malb|nater|truhlar|zamecn|sadrokart|sucha vystavba|vyplni|okna|dvere|kamen|stuk|sklen|parket|tapet|restaur|interier|nabytek|kovov/],
    ['Technika budovy (TZB)', /elektro|silnoproud|slaboproud|vzducho|vzt|vytap|topen|zdravot|zti|plyn|audio|chlaz|klimat|vytah|vodovod|kanaliz|mar\b|eps|sprinkl|hasic|osvetl|zabezpec|datov|fotovolt|tzb/],
  ];
  const skupinaCin = nazev => { const n = bezDia(String(nazev)).toLowerCase(); const g = SKUPINY.find(([, rx]) => rx.test(n)); return g ? g[0] : 'Ostatní'; };
  function akceDruhu(k, virt) {
    return `<span class="rz-dr-a"><button type="button" class="rz-btn mini" data-ukaz-kat="${esc(k.id)}" title="Zobrazit položky v rozpočtu">Položky</button><button type="button" class="rz-btn mini" data-fak-kat="${esc(k.id)}"${nefak() ? ' disabled' : ''} title="Nová fakturace z této činnosti">Fakturovat</button>${virt ? `<button type="button" class="rz-btn mini" data-cin-ulozit="${esc(k.id)}"${ro() ? ' disabled' : ''} title="Vytvoří z této činnosti vlastní druh prací, který můžete upravovat">+ Druh</button>` : `<button type="button" class="rz-btn mini" data-navrh="${esc(k.id)}"${ro() ? ' disabled' : ''} title="Najít další položky">Najít…</button><button type="button" class="rz-btn mini" data-upr-kat="${esc(k.id)}"${ro() ? ' disabled' : ''}>Upravit</button>`}</span>`;
  }
  const cerpTd = s => `<div class="rz-dr-bar" title="čerpáno ${pct(s.cer, s.roz)} %"><i class="${s.cer > s.roz + 1 ? 'nad' : ''}" style="width:${Math.min(100, pct(s.cer, s.roz))}%"></i></div><span class="rz-dr-p">${pct(s.cer, s.roz)} %</span>`;
  function radkyDruhu(list, C, virt, celkem) {
    return list.map(k => { const s = C.katSum[k.id] || {roz: 0, cer: 0, n: 0}; return `<tr><td class="nm"><b>${esc(k.nazev)}</b></td><td class="n">${nf0.format(s.n)}</td><td class="n"><b>${kc0(s.roz)}</b></td><td class="n podil">${celkem ? (Math.round(s.roz / celkem * 1000) / 10).toLocaleString('cs-CZ') + ' %' : ''}</td><td class="n">${kc0(s.cer)}</td><td class="n">${kc0(s.roz - s.cer)}</td><td class="cp">${cerpTd(s)}</td><td class="ak">${akceDruhu(k, virt)}</td></tr>`; }).join('');
  }
  const hlavaTab = `<thead><tr><th>Činnost</th><th class="n">Položek</th><th class="n">Rozpočet</th><th class="n">Podíl</th><th class="n">Vyfakturováno</th><th class="n">Zbývá</th><th>Čerpání</th><th></th></tr></thead>`;
  function zobrazDruhy(list, C, virt) {
    const v = druhyV(), sum = k => (C.katSum[k.id] || {}).roz || 0;
    const srt = list.slice().sort((a, b) => sum(b) - sum(a));
    const celkem = srt.reduce((a, k) => a + sum(k), 0);
    if (v === 'karty') return `<div class="rz-cards">${srt.map(k => kartaDruhu(k, C, virt)).join('')}</div>`;
    if (v === 'zebricek') {
      const max = Math.max(1, ...srt.map(sum));
      return `<div class="rz-zeb">${srt.map(k => { const s = C.katSum[k.id] || {roz: 0, cer: 0, n: 0}; return `<div class="rz-zeb-r"><div class="nm" title="${esc(k.nazev)}">${esc(k.nazev)}</div><div class="br"><i style="width:${Math.max(0.5, s.roz / max * 100)}%"><u style="width:${Math.min(100, pct(s.cer, s.roz))}%"></u></i><span><b>${kc0(s.roz)}</b> · ${celkem ? (Math.round(s.roz / celkem * 1000) / 10).toLocaleString('cs-CZ') : 0} % · ${nf0.format(s.n)} pol.${s.cer ? ' · vyfakt. ' + kc0(s.cer) : ''}</span></div>${akceDruhu(k, virt)}</div>`; }).join('')}</div>`;
    }
    if (v === 'skupiny') {
      const g = new Map(); SKUPINY.map(x => x[0]).concat('Ostatní').forEach(n => g.set(n, []));
      srt.forEach(k => g.get(skupinaCin(k.nazev)).push(k));
      return [...g.entries()].filter(([, a]) => a.length).map(([n, a]) => { const r = a.reduce((x, k) => x + sum(k), 0), c = a.reduce((x, k) => x + ((C.katSum[k.id] || {}).cer || 0), 0), pol = a.reduce((x, k) => x + ((C.katSum[k.id] || {}).n || 0), 0), otv = S.skOtv.has(n);
        return `<div class="rz-sg${otv ? ' otv' : ''}"><button type="button" class="rz-sg-h" data-sg="${esc(n)}"><span class="sip">${otv ? '▾' : '▸'}</span><b>${esc(n)}</b><span class="m">${a.length} činností · ${nf0.format(pol)} položek</span><span class="sp"></span><b>${kc0(r)}</b><span class="m">${celkem ? Math.round(r / celkem * 100) : 0} %</span>${cerpTd({roz: r, cer: c})}</button>${otv ? `<div class="rz-list rz-dr"><table>${hlavaTab}<tbody>${radkyDruhu(a, C, virt, celkem)}</tbody></table></div>` : ''}</div>`; }).join('');
    }
    return `<div class="rz-list rz-dr"><table>${hlavaTab}<tbody>${radkyDruhu(srt, C, virt, celkem)}<tr class="sum"><td><b>Celkem</b></td><td class="n">${nf0.format(srt.reduce((a, k) => a + ((C.katSum[k.id] || {}).n || 0), 0))}</td><td class="n"><b>${kc0(celkem)}</b></td><td></td><td class="n">${kc0(srt.reduce((a, k) => a + ((C.katSum[k.id] || {}).cer || 0), 0))}</td><td colspan="3"></td></tr></tbody></table></div>`;
  }
  function panelDruhy(C) {
    const ks = kategorie(R.rec.id), cs = R.cinnosti || [];
    const prep = `<span class="rz-seg" role="group" aria-label="Zobrazení">${DRUHY_V.map(([k, n]) => `<button type="button" data-dv="${k}" aria-pressed="${druhyV() === k}">${n}</button>`).join('')}</span>`;
    const cin = `<div class="rz-top" style="margin-top:6px"><h3 style="margin:0;font-size:17px">Činnosti (řemesla) – roztříděno automaticky</h3><span style="font-size:13px;color:var(--muted)">${nf0.format(R.polozky.length)} položek v ${cs.length} činnostech, seřazeno podle objemu</span><span class="sp"></span>${prep}</div>
      ${zobrazDruhy(cs, C, true)}`;
    return `${cin}<h3 style="margin:14px 0 0;font-size:17px">Moje druhy prací</h3><div class="rz-top"><span style="font-size:14px">Druh prací = skupina položek z celého rozpočtu (např. Střecha: krokve, bednění, izolace, krytina, okna). Z druhu prací se pak dělá fakturace.</span><span class="sp"></span>
        ${ks.length ? '' : `<button type="button" class="rz-btn" data-a="druhy-vychozi"${ro() ? ' disabled' : ''}>Vytvořit běžné druhy prací</button>`}
        <button type="button" class="rz-btn zl" data-a="druh-novy"${ro() ? ' disabled' : ''}>+ Nový druh prací</button></div>
      ${ks.length ? zobrazDruhy(ks, C, false)
      : `<div class="rz-empty"><b>Zatím žádné druhy prací</b>Klikněte <b>Vytvořit běžné druhy prací</b> (Střecha, Okna a dveře, Fasáda, Bourání …) – Constructo je rovnou naplní položkami. Nebo <b>+ Nový druh prací</b> se svými slovy (např. Střecha: krokve, bednění, krytina, oplechování, střešní okna).</div>`}`;
  }

  /* ----- panel Fakturace ----- */
  function stavFaktury(f, C) {
    let nad = 0, cena = 0, mimo = 0, kcF = 0;
    (f.pol || []).forEach(l => { kcF += (Number(l.mn) || 0) * (Number(l.jc) || 0); const r = l.r && R.byId.get(l.r); if (!r) { mimo++; return; } const x = C.pol.get(l.r); if (x && (x.nad || x.nadKc)) nad++; if (r.jc != null && Math.abs((Number(l.jc) || 0) - r.jc) > 0.005) cena++; });
    return {nad, cena, mimo, kc: kcF};
  }
  function panelFakturace(C) {
    const fs = faktury(R.rec.id), ks = vsechnyKat(R.rec.id);
    return `<div class="rz-top"><span style="font-size:14px">Fakturace se počítá přímo z rozpočtu: hlídá čerpané a zbývající množství, jinou jednotkovou cenu a položky mimo rozpočet.</span><span class="sp"></span>
        <button type="button" class="rz-btn" data-a="fak-firma"${nefak() ? ' disabled' : ''} title="Obvyklý odběratel faktur (investor). Kdo fakturuje se nastavuje v Údajích o stavbě.">Komu fakturovat…</button>
        <button type="button" class="rz-btn zl" data-a="fak-vytvor"${nefak() ? ' disabled' : ''}>🧾 Vytvořit fakturu</button></div>
      ${fs.length ? `<div class="rz-list"><table><thead><tr><th>Číslo</th><th>Firma</th><th>Druh prací</th><th>Období</th><th class="n">Položek</th><th class="n">Částka Kč</th><th>Kontrola</th><th>Stav</th></tr></thead><tbody>
        ${fs.map(f => { const s = stavFaktury(f, C), k = ks.find(z => z.id === f.kat); const fi = (H.firmy() || []).find(z => z.id === f.firma); return `<tr class="kl" data-fak="${esc(f.id)}"><td><b>${esc(f.cislo || '(bez čísla)')}</b></td><td>${esc(fi ? fi.firma : f.firmaN || '')}</td><td>${esc(k ? k.nazev : '')}</td><td>${esc([f.od, f.do].filter(Boolean).map(d => new Date(d).toLocaleDateString('cs-CZ')).join(' – '))}</td><td class="n">${(f.pol || []).length}</td><td class="n"><b>${kc(s.kc)}</b></td>
          <td>${s.nad || s.cena || s.mimo ? `<span class="rz-war">⚠</span> ${[s.nad ? s.nad + '× nad rozpočet' : '', s.cena ? s.cena + '× jiná cena' : '', s.mimo ? s.mimo + '× mimo rozpočet' : ''].filter(Boolean).join(', ')}` : '<span class="rz-ok">✓ v pořádku</span>'}</td><td>${f.uzavreno ? '<b style="color:#2f7d4f">🔒 uzavřeno</b>' + (f.uzavreno.pdf ? ` · <a href="${esc(f.uzavreno.pdf.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">PDF</a>` : '') : f.keSchvaleni ? `<b style="color:#b26a00">⏳ čeká na schválení</b><div style="font-size:12px;color:var(--muted)">poslal(a) ${esc(f.keSchvaleni.kdo || '')}</div>` : f.stav === 'schvaleno' ? '<b style="color:#2f7d4f">schváleno</b>' : 'rozpracováno'}</td></tr>`; }).join('')}
        <tr><td colspan="5"><b>Celkem</b></td><td class="n"><b>${kc(fs.reduce((a, f) => a + stavFaktury(f, C).kc, 0))}</b></td><td colspan="2"></td></tr></tbody></table></div>`
      : `<div class="rz-empty"><b>Zatím žádná fakturace</b><ol><li>Klikněte <b>🧾 Vytvořit fakturu</b> (poprvé vyplňte <b>Firma a logo na faktuře</b>).</li><li>Vyberte firmu a případně druh prací (např. Střecha).</li><li>Přidejte položky z rozpočtu, nebo načtěte soupis provedených prací od firmy z Excelu.</li><li>Constructo hned ukáže, kolik je čerpáno, kolik zbývá a co nesedí.</li></ol></div>`}`;
  }

  /* ---------- obsluha ---------- */
  function vazby() {
    const $$ = s => EL.querySelectorAll(s), on = (s, ev, f) => $$(s).forEach(e => e.addEventListener(ev, f));
    on('[data-a="import"]', 'click', () => vyberSoubor());
    on('[data-a="znovu"]', 'click', () => { S.chyba = ''; prekresli(); });
    on('[data-a="rp"]', 'change', e => { S.rp = e.target.value; pamSet('rz-rp', S.rp); S.vyb.clear(); prekresli(); });
    on('[data-p]', 'click', e => { S.panel = e.currentTarget.dataset.p; pamSet('rz-panel', S.panel); prekresli(); });
    on('[data-a="bok"]', 'click', () => H.bok && H.bok());
    on('[data-a="zavrit"]', 'click', () => H.domu && H.domu());
    on('[data-a="fak-vytvor"]', 'click', () => vytvorFakturu());
    on('[data-a="fak-firma"]', 'click', () => komuFakturovat(() => prekresli()));
    on('[data-a="menu-rp"]', 'click', e => menuRozpoctu(e.currentTarget));
    on('[data-a="xls-roz"]', 'click', () => excelRozpocet());
    on('[data-ur]', 'click', e => { S.uroven = +e.currentTarget.dataset.ur || 0; S.otev.clear(); S.zav.clear(); SCROLL = 0; prekresli(); });
    const q = EL.querySelector('[data-a="q"]');
    if (q) { let t = 0; q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { S.q = q.value; SCROLL = 0; const pos = q.selectionStart; prekresli(); const n = EL.querySelector('[data-a="q"]'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} } }, 250); }); }
    on('[data-fk]', 'change', e => { S[e.currentTarget.dataset.fk] = e.currentTarget.value; S.otev.clear(); S.zav.clear(); SCROLL = 0; prekresli(); });
    on('[data-a="poptat"]', 'click', () => excelPoptavka());
    on('[data-a="fak-filtr"]', 'click', () => vytvorFakturu());
    on('[data-a="f-zrus"]', 'click', () => { Object.assign(S, {cast: '', dil: '', obor: '', kat: '', obj: '', pod: ''}); S.otev.clear(); S.zav.clear(); SCROLL = 0; prekresli(); });
    on('[data-a="upoz"]', 'change', e => { S.jenUpoz = e.target.checked; SCROLL = 0; prekresli(); });
    on('[data-a="v-zrus"]', 'click', () => { S.vyb.clear(); prekresli(); });
    on('[data-a="v-kat"]', 'click', () => zaraditDoDruhu([...S.vyb]));
    on('[data-a="v-kat-pryc"]', 'click', () => { const k = kategorie(R.rec.id).find(z => z.id === S.kat); if (!k) return; const x = new Set(S.vyb); H.upsert('rozpKat', [Object.assign({}, k, {pol: (k.pol || []).filter(id => !x.has(id))})]); toast('Odebráno z druhu ' + k.nazev + '.'); S.vyb.clear(); });
    on('[data-a="v-obj"]', 'click', () => priraditObjekt([...S.vyb]));
    on('[data-a="v-fak"]', 'click', () => vytvorFakturu());
    on('[data-a="fak-dal"]', 'click', () => dokonciVyber());
    on('[data-a="fak-zrus"]', 'click', () => { if (S.fak && S.fak.F.pol.length && !confirm('Zrušit rozpracovanou fakturu?')) return; S.fak = null; S.vyb.clear(); prekresli(); });
    on('[data-a="fak-vlastni"]', 'click', () => vlastniPolozka(l => { if (S.fak) { S.fak.F.pol.push(l); prekresli(); toast('Vlastní položka přidána.'); } }));
    on('[data-a="vyb-vse"]', 'change', e => { VIS.forEach(i => { const r = R.rows[i]; if (r.t === 'P') e.target.checked ? S.vyb.add(r.id) : S.vyb.delete(r.id); }); prekresli(); });
    const tab = EL.querySelector('.rz-tab');
    if (tab) {
      tab.addEventListener('scroll', () => { if (rafK) return; rafK = requestAnimationFrame(() => { rafK = 0; SCROLL = tab.scrollTop; kresliRadky(); }); });
      tab.addEventListener('click', e => {
        const tg = e.target.closest('[data-tg]');
        if (tg) { const i = +tg.dataset.tg, r = R.rows[i]; const skryto = r.t === 'L' ? S.zav.has(r.id) : zavreno(i); if (!skryto) { S.otev.delete(r.id); S.zav.add(r.id); } else { S.zav.delete(r.id); S.otev.add(r.id); } SCROLL = tab.scrollTop; prekresli(); return; }
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
    on('[data-fak-kat]', 'click', e => { S.kat = e.currentTarget.dataset.fakKat; S.vyb.clear(); vytvorFakturu(); });
    on('[data-dv]', 'click', e => { S.druhyV = e.currentTarget.dataset.dv; pamSet('rz-druhyV', S.druhyV); prekresli(); });
    on('[data-sg]', 'click', e => { const n = e.currentTarget.dataset.sg; S.skOtv.has(n) ? S.skOtv.delete(n) : S.skOtv.add(n); prekresli(); });
    on('[data-a="druh-novy"]', 'click', () => upravitDruh(''));
    on('[data-a="druhy-vychozi"]', 'click', () => { const now = new Date().toISOString(); const recs = VYCHOZI_DRUHY.map(([n, s, k]) => { const rec = {id: 'rk' + uid(), rp: R.rec.id, nazev: n, slova: s, kody: k, pol: [], kdo: kdo(), kdy: now}; rec.pol = navrhPolozek(rec).map(x => x.r.id); return rec; }); H.upsert('rozpKat', recs); toast('Druhy prací vytvořeny a rovnou naplněné položkami. Zkontrolovat je můžete tlačítkem Najít položky…'); });
    on('[data-cin-ulozit]', 'click', e => { const c = najdiKat(R.rec.id, e.currentTarget.dataset.cinUlozit); if (!c) return; H.upsert('rozpKat', [{id: 'rk' + uid(), rp: R.rec.id, nazev: c.nazev, slova: '', kody: '', pol: c.pol.slice(), kdo: kdo(), kdy: new Date().toISOString()}]); toast('Uloženo jako druh prací „' + c.nazev + '“. Můžete ho upravit a přidávat položky.'); });
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
      if (faktury(rec.id).some(f => f.uzavreno)) { toast('Rozpočet má uzavřené faktury, nejde smazat.'); return; }
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
  // návrh položek do druhu prací: slova v popisu (i v nadpisu nad ní) a začátky kódů ÚRS
  function navrhPolozek(k) {
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
    return nal;
  }
  function najitPolozky(kid) {
    const k = kategorie(R.rec.id).find(z => z.id === kid); if (!k) return;
    const C = spocti(R);
    const nal = navrhPolozek(k);
    const uz = new Set(k.pol || []);
    const vybr = new Set(nal.map(x => x.r.id));
    const ov = okno('Najít položky: ' + k.nazev, `<p style="margin:0">Constructo našlo <b>${nal.length}</b> položek, které se hodí do druhu <b>${esc(k.nazev)}</b>${uz.size ? ` (dalších ${uz.size} už v něm je)` : ''}. Odškrtněte ty, které tam nepatří, a klikněte <b>Přidat vybrané</b>.</p>
      <div class="rz-fil"><input class="rz-q" type="search" id="rz-nf" placeholder="Zúžit seznam…"><button type="button" class="rz-btn mini" data-vse>Vybrat vše</button><button type="button" class="rz-btn mini" data-nic>Zrušit vše</button><span id="rz-nc" style="font-size:13px"></span></div>
      <div class="rz-list" style="max-height:55vh"><table><thead><tr><th></th><th>Obj.</th><th>Kód</th><th>Popis</th><th>MJ</th><th class="n">Množství</th><th class="n">Celkem Kč</th><th>Proč</th></tr></thead><tbody id="rz-nb"></tbody></table></div>`,
      `<span class="sp"></span><button type="button" class="rz-btn zl" data-ok>Přidat vybrané</button>`, 'siroky');
    const kresli = () => {
      const q = norm(ov.querySelector('#rz-nf').value), sl = q.split(' ').filter(Boolean);
      const vid = nal.filter(x => !sl.length || sl.every(s => norm(x.r.k + ' ' + x.r.d).includes(s))).slice(0, 3000);
      ov.querySelector('#rz-nb').innerHTML = vid.map(x => `<tr><td><input type="checkbox" data-n="${esc(x.r.id)}"${vybr.has(x.r.id) ? ' checked' : ''}></td><td>${obBadges(C.obj[x.r.i])}</td><td>${esc(x.r.k)}</td><td>${esc(x.r.d)}</td><td>${esc(x.r.mj)}</td><td class="n">${mnT(x.r.mn)}</td><td class="n">${kc(x.r.cc)}</td><td style="font-size:12px;color:var(--muted)">${esc(x.d)}</td></tr>`).join('') + (vid.length >= 3000 ? '<tr><td colspan="8">… zobrazeno prvních 3000, zužte hledání</td></tr>' : '');
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
      const nast = listy.map(l => { const r = Object.assign(rozpoznej(l), {zahrnout: false}); pouzijSablonu(l, r); return r; });
      listy.forEach((l, i) => { const s = souhrnListu(l, nast[i]); nast[i].souhrn = s; nast[i].zahrnout = s.pol >= 3 && !/rekapitul|kryci list|krycí list|souhrn/i.test(bezDia(l.n)); nast[i].obj = odhadObjektu(l); });
      if (!nast.some(n => n.zahrnout)) { let m = -1, mi = 0; nast.forEach((n, i) => { if (n.souhrn.pol > m) { m = n.souhrn.pol; mi = i; } }); nast[mi].zahrnout = true; }
      w.konec();
      if (ucel === 'soupis') doptejSe(listy, nast, () => hotovo(f, listy, nast)); else doptejSe(listy, nast, () => dialogImportu(f, listy, nast));
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
          <span style="flex:1"></span>${ns.zahrnout ? `<button type="button" class="rz-btn mini" data-upr="${i}" title="Ukáže každý sloupec s ukázkou z rozpočtu a zeptá se, co v něm je">❓ Upřesnit sloupce s ukázkou…</button>` : ''}<label style="font-size:13px;font-weight:600">Objekt <select class="rz-sel" data-lo="${i}"><option value="">— bez objektu —</option>${OBJEKTY.map(o => `<option value="${esc(o)}"${ns.obj === o ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></label></h4>
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
    telo.addEventListener('click', e => { const b = e.target.closest('[data-upr]'); if (!b) return; const i = +b.dataset.upr; dialogSloupcu(listy[i], nast[i], jistota(listy[i], Object.assign({}, nast[i], {jak: {}})), () => kresli()); });
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
      if (stary) {
        const zm = new Map(); faktury(stary.id).forEach(fa => { if (fa.uzavreno) (fa.pol || []).forEach(l => { if (l.r) zm.set(l.r, (zm.get(l.r) || 0) + (Number(l.mn) || 0)); }); });
        if (zm.size) {
          const nove = new Map(rows.filter(r => r.t === 'P').map(r => [r.id, r])), stare = NACTENO.get(stary.id) && NACTENO.get(stary.id).R, chyby = [];
          zm.forEach((mn, id) => { const n = nove.get(id); if (!n || (n.mn != null && n.mn < mn - EPS)) { const o = stare && stare.byId.get(id); chyby.push((o ? (o.k ? o.k + ' ' : '') + String(o.d).slice(0, 60) : id) + (n ? ` (nové množství ${mnT(n.mn)}, vyfakturováno ${mnT(mn)})` : ' (v nové verzi chybí nebo se změnila)')); } });
          if (chyby.length) { w.konec(); alert('Novou verzi rozpočtu nejde uložit: tyto položky jsou už vyfakturované uzavřenou fakturou a v nové verzi chybí, změnily se nebo mají menší množství:\n\n• ' + chyby.slice(0, 12).join('\n• ') + (chyby.length > 12 ? '\n… a dalších ' + (chyby.length - 12) : '')); return; }
        }
      }
      const id = stary ? stary.id : 'rp' + uid(), rev = Date.now();
      const obj = Object.assign({}, stary ? stary.obj || {} : {});
      rows.forEach(r => { if (r.t === 'L') { const o = nast[r.s].obj; if (o) obj[r.id] = o; else if (!stary) delete obj[r.id]; } });
      const ids = new Set(rows.map(r => r.id)); Object.keys(obj).forEach(k => { if (!ids.has(k)) delete obj[k]; });
      const pol = rows.filter(r => r.t === 'P');
      const data = {v: 2, nazev, soubor: f.name, listy: listy.map((l, i) => ({n: l.n, map: nast[i].map, hlavicka: nast[i].hlavicka, zahrnout: nast[i].zahrnout, nazvy: hlavickaListu(l, nast[i]), cols: l.cols || [], dec: l.dec || [], colFill: l.colFill || [], hlBarvy: nast[i].hlavicka >= 0 && l.barvy ? l.barvy[nast[i].hlavicka] : null})), rows: naPole(rows)};
      w.text('Komprimuji ' + nf0.format(rows.length) + ' řádků…', 40);
      const gz = await gzip(JSON.stringify(data));
      await idbPut('r:' + id + ':' + rev, {gz, kdy: Date.now()});
      const mapy = ulozSablony(listy, nast);
      const rec = Object.assign({}, stary || {}, {id, nazev, soubor: f.name, rev, mapy, gid: '', vel: gz.size, pocet: rows.length, polozek: pol.length, celkem: Math.round(pol.reduce((a, r) => a + (r.cc || 0), 0) * 100) / 100, kdo: kdo(), pc: pcId(), kdy: new Date().toISOString(), obj, listy: listy.map((l, i) => nast[i].zahrnout ? l.n : null).filter(Boolean)});
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
    if (!smi('fakt')) return toast('Připravovat faktury vám správce nepovolil.');
    const f = {id: 'fa' + uid(), rp: R.rec.id, cislo: '', firma: '', kat: o.kat || '', od: '', do: '', datum: new Date().toISOString().slice(0, 10), pozn: '', stav: 'rozpracovano', pol: [], kdo: kdo(), kdy: new Date().toISOString()};
    const n = faktury(R.rec.id).length + 1, FU = udaje();
    f.cislo = new Date().getFullYear() + String(n).padStart(3, '0');
    f.duzp = f.datum; f.splatnost = plusDni(f.datum, FU.splatnost || 14); f.dph = FU.dph || '21';
    if (o.popis) f.pozn = o.popis;
    (o.polozky || []).forEach(id => { const r = R.byId.get(id); if (!r || r.t !== 'P') return; const l = {r: id, mn: 0, jc: r.jc || 0}; const p = o.podil && o.podil.get(id); if (p != null && p < 0.9999) l.p = Math.round(p * 10000) / 10000; f.pol.push(l); });
    S.vyb.clear();
    editorFaktury(null, f);
  }
  function editorFaktury(fid, nova) {
    const puv = nova || faktury(R.rec.id).find(f => f.id === fid); if (!puv) return;
    const F = JSON.parse(JSON.stringify(puv));
    if (nova && faktury(R.rec.id).some(f => f.id === F.id)) nova = null;   // uložená faktura vrácená z výběru v rozpočtu
    const uzav = !!F.uzavreno, zam = uzav || nefak(), dis = zam ? ' disabled' : '';
    if (!F.duzp) F.duzp = F.datum; if (!F.dph) F.dph = udaje().dph || '21'; if (!F.splatnost) F.splatnost = plusDni(F.datum, udaje().splatnost || 14);
    const C0 = spocti(R);
    const ks = vsechnyKat(R.rec.id), firmy = H.firmy() || [];
    // dříve vyfakturováno (jiné fakturace) po položkách
    const jinde = new Map();
    faktury(R.rec.id).forEach(f => { if (f.id === F.id) return; (f.pol || []).forEach(l => { if (l.r) jinde.set(l.r, (jinde.get(l.r) || 0) + (Number(l.mn) || 0)); }); });
    const jindeKc = new Map();
    faktury(R.rec.id).forEach(f => { if (f.id === F.id) return; (f.pol || []).forEach(l => { if (l.r) jindeKc.set(l.r, (jindeKc.get(l.r) || 0) + (Number(l.mn) || 0) * (Number(l.jc) || 0)); }); });
    const ov = okno(nova ? 'Nová faktura' : 'Faktura ' + (F.cislo || '') + (uzav ? ' – uzavřená 🔒' : ''), `${!uzav && F.keSchvaleni ? `<div class="rz-info" style="background:#fff3d6;border-color:#f0c96b;color:#6b4500">⏳ Faktura čeká na schválení (poslal(a) ${esc(F.keSchvaleni.kdo || '')}, ${esc(new Date(F.keSchvaleni.kdy).toLocaleString('cs-CZ'))}).${smi('fakU') ? ' Zkontrolujte ji a klikněte 🧾 Vytvořit fakturu (PDF) → Uzavřít a uložit.' : ''}</div>` : ''}${!uzav && zam ? '<div class="rz-info">Fakturu můžete jen prohlížet – připravovat faktury vám správce nepovolil.</div>' : ''}${uzav ? `<div class="rz-info" style="background:#dcefe3;border-color:#9fd1b3;color:#1d4d31">🔒 Faktura je uzavřená (${esc(new Date(F.uzavreno.kdy).toLocaleString('cs-CZ'))}, ${esc(F.uzavreno.kdo || '')}). Nejde měnit ani smazat a vyfakturované množství je v rozpočtu zamčené.</div>` : ''}
      <div class="rz-pole"><label>Komu fakturovat<select data-f="odbV"${dis}><option value="">${esc((udaje().odb || {}).firma ? (udaje().odb.firma + ' (obvyklý odběratel)') : 'Obvyklý odběratel – zatím nevyplněn')}</option>${firmy.filter(z => z.firma).map(z => `<option value="f:${esc(z.id)}"${F.odbV === 'f:' + z.id ? ' selected' : ''}>${esc(z.firma)}</option>`).join('')}${dis ? '' : '<option value="__jiny">Jiný / upravit obvyklého…</option>'}</select></label>
        <label>Číslo faktury<input data-f="cislo" value="${esc(F.cislo)}"${dis}></label>
        <label>Firma (provádí práce)<select data-f="firma"${dis}><option value="">— nevybráno —</option>${firmy.map(z => `<option value="${esc(z.id)}"${F.firma === z.id ? ' selected' : ''}>${esc(z.firma)}</option>`).join('')}</select></label>
        <label>Druh prací / činnost<select data-f="kat"${dis}><option value="">— celý rozpočet —</option>${ks.map(k => `<option value="${esc(k.id)}"${F.kat === k.id ? ' selected' : ''}>${k.virt ? 'Činnost: ' : ''}${esc(k.nazev)}</option>`).join('')}</select></label>
        <label>Období od<input type="date" data-f="od" value="${esc(F.od)}"${dis}></label><label>Období do<input type="date" data-f="do" value="${esc(F.do)}"${dis}></label>
        <label>Datum vystavení<input type="date" data-f="datum" value="${esc(F.datum)}"${dis}></label>
        <label>Datum zdaň. plnění<input type="date" data-f="duzp" value="${esc(F.duzp)}"${dis}></label>
        <label>Splatnost<input type="date" data-f="splatnost" value="${esc(F.splatnost)}"${dis}></label>
        <label>DPH<select data-f="dph"${dis}>${DPH.map(([k, t]) => `<option value="${k}"${F.dph === k ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
        <label>Poznámka<input data-f="pozn" value="${esc(F.pozn)}"${dis}></label></div>
      ${zam ? '' : `<div class="rz-fil"><button type="button" class="rz-btn zl" data-pridat title="Vrátí vás do rozpočtu, kde položky přehledně zaškrtnete (s filtry)">+ Přidat položky z rozpočtu</button><button type="button" class="rz-btn" data-soupis>⬆ Načíst soupis prací z Excelu</button><button type="button" class="rz-btn" data-mimo>+ Vlastní položka (vícepráce…)</button><span class="sp" style="flex:1"></span><button type="button" class="rz-btn" data-xls>⬇ Excel</button></div>`}
      <div class="rz-fil rz-pct"${zam ? ' hidden' : ''}><b>Fakturovat procentem:</b> <input id="rz-pct" inputmode="decimal" placeholder="např. 30" style="width:80px"> %
        <button type="button" class="rz-btn mini" data-pct="tato" title="Každá položka: tato fakturace = zadané % z množství v rozpočtu">tato fakturace = % z rozpočtu</button>
        <button type="button" class="rz-btn mini" data-pct="celkem" title="Každá položka: hotovo celkem zadané % – dříve vyfakturované se odečte">hotovo celkem % (odečte dřívější)</button>
        <span style="font-size:12.5px;color:var(--muted)">Platí pro všechny položky v této fakturaci. Jednotlivé řádky jde potom upravit ručně.</span></div>
      <div id="rz-fw"></div>
      <div class="rz-list rz-fl"><table><thead><tr><th>Kód</th><th>Popis</th><th>MJ</th><th class="n">V rozpočtu</th><th class="n">Dříve vyfakt.</th><th class="n">Tato faktura MJ</th><th class="n">nebo %</th><th class="n">J. cena</th><th class="n">Celkem Kč</th><th class="n">Zbývá MJ</th><th>Kontrola</th><th></th></tr></thead><tbody id="rz-fb"></tbody></table></div>`,
      zam ? `<span id="rz-fs" style="font-size:15px"></span><span class="sp"></span><button type="button" class="rz-btn" data-xls>⬇ Excel</button><button type="button" class="rz-btn zl" data-pdf>⬇ Faktura PDF</button>`
        : `${nova ? '' : '<button type="button" class="rz-btn del" data-smaz>Smazat</button>'}<span id="rz-fs" style="font-size:15px"></span><span class="sp"></span><button type="button" class="rz-btn" data-ok>Uložit rozpracovanou</button><button type="button" class="rz-btn cr" data-faktura>🧾 Vytvořit fakturu (PDF)</button>`, 'siroky');
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
        return `<tr class="${w.some(x => !x[0]) ? 'nad' : w.length ? 'cena' : ''}" data-i="${i}"><td>${esc(r ? r.k : '')}</td><td>${r ? esc(r.d) + (C0.obj[r.i] ? ' ' + obBadges(C0.obj[r.i]) : '') : `<input class="t" data-l="t" value="${esc(l.t || '')}" placeholder="popis práce">`}</td><td>${r ? esc(r.mj) : `<input class="t" style="min-width:50px" data-l="mj" value="${esc(l.mj || '')}">`}</td>
          <td class="n">${r ? mnT(r.mn) + (l.p ? `<div style="font-size:11.5px;color:var(--muted)" title="Výběr podle objektu/podlaží: patří sem jen tento podíl z výkazu výměr">z toho výběr ${mnT(r.mn * l.p)} (${Math.round(l.p * 100)} %)</div>` : '') : ''}</td><td class="n">${r ? mnT(jinde.get(l.r) || 0) : ''}</td><td class="n"><input data-l="mn" inputmode="decimal" value="${esc(l.mn === 0 ? '' : String(l.mn).replace('.', ','))}" placeholder="0"${dis}></td><td class="n"><input data-l="pct" inputmode="decimal" style="min-width:58px" value="${r && r.mn && l.mn ? esc(String(Math.round(l.mn / (r.mn * (l.p || 1)) * 1000) / 10).replace('.', ',')) : ''}" placeholder="%"${dis}></td><td class="n"><input data-l="jc" inputmode="decimal" value="${esc(String(l.jc).replace('.', ','))}"${dis}></td><td class="n"><b>${kc(cl)}</b></td><td class="n">${zb == null ? '' : `<span style="color:${zb < -EPS ? 'var(--bad)' : 'inherit'}">${mnT(zb)}</span>`}</td>
          <td>${w.length ? w.map(x => `<div class="w${x[0] ? ' o' : ''}">⚠ ${esc(x[1])}</div>`).join('') : (Number(l.mn) ? '<span class="rz-ok">✓</span>' : '')}</td><td>${zam ? '' : `<button type="button" class="rz-btn mini" data-del="${i}" title="Odebrat řádek">✕</button>`}</td></tr>`;
      }).join('') || '<tr><td colspan="12" style="text-align:center;color:var(--muted);padding:20px">Zatím žádné položky. Klikněte <b>+ Přidat položky z rozpočtu</b> nebo <b>Načíst soupis prací z Excelu</b>.</td></tr>';
      ov.querySelector('#rz-fs').innerHTML = `Celkem <b>${kc(sum)} Kč</b> · ${F.pol.length} položek`;
      ov.querySelector('#rz-fw').innerHTML = nad || cena || mimo ? `<div class="rz-info${nad ? ' cerv' : ''}">⚠ Kontrola: ${[nad ? nad + ' položek přes rozpočet (množství nebo Kč)' : '', cena ? cena + ' s jinou cenou nebo mimo druh prací' : '', mimo ? mimo + ' mimo rozpočet' : ''].filter(Boolean).join(' · ')}</div>` : F.pol.length ? '<div class="rz-info" style="background:#dcefe3;border-color:#9fd1b3;color:#1d4d31">✓ Vše sedí s rozpočtem.</div>' : '';
    };
    kresli();
    ov.querySelectorAll('[data-f]').forEach(i => i.addEventListener('change', () => {
      if (i.dataset.f === 'odbV' && i.value === '__jiny') { i.value = F.odbV || ''; komuFakturovat(() => { const o = i.querySelector('option'); if (o) o.textContent = (udaje().odb || {}).firma + ' (obvyklý odběratel)'; i.value = ''; F.odbV = ''; }); return; }
      F[i.dataset.f] = i.value; if (i.dataset.f === 'odbV') F.odb = odbFaktury(F); if (i.dataset.f === 'kat') kresli(); }));
    const tb = ov.querySelector('#rz-fb');
    tb.addEventListener('change', e => {
      const t = e.target, tr = t.closest('[data-i]'); if (!tr || !t.dataset.l) return;
      const l = F.pol[+tr.dataset.i];
      if (t.dataset.l === 'pct') { const v = cislo(t.value), r = l.r && R.byId.get(l.r); if (r && r.mn != null) l.mn = v == null ? 0 : Math.round(r.mn * (l.p || 1) * v / 100 * 1000) / 1000; }
      else if (t.dataset.l === 'mn' || t.dataset.l === 'jc') { const v = cislo(t.value); l[t.dataset.l] = v == null ? 0 : v; } else l[t.dataset.l] = t.value;
      const ae = document.activeElement && document.activeElement.dataset ? [document.activeElement.closest('[data-i]') && document.activeElement.closest('[data-i]').dataset.i, document.activeElement.dataset.l] : null;
      kresli();
      if (ae && ae[0] != null) { const n = tb.querySelector(`[data-i="${ae[0]}"] [data-l="${ae[1]}"]`); if (n) n.focus(); }
    });
    tb.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.dataset.l) { e.preventDefault(); const all = [...tb.querySelectorAll('[data-l="mn"]')], k = all.indexOf(e.target); e.target.dispatchEvent(new Event('change', {bubbles: true})); const n = [...tb.querySelectorAll('[data-l="mn"]')][k + 1]; if (n) n.focus(); } });
    tb.addEventListener('click', e => { const d = e.target.closest('[data-del]'); if (d) { F.pol.splice(+d.dataset.del, 1); kresli(); } });
    ov.querySelectorAll('[data-pct]').forEach(b => b.onclick = () => {
      const p = cislo(ov.querySelector('#rz-pct').value);
      if (p == null || p < 0) return toast('Zadejte procento, např. 30.');
      let n = 0;
      F.pol.forEach(l => { const r = l.r && R.byId.get(l.r); if (!r || r.mn == null) return; const zakl = r.mn * (l.p || 1); let v = zakl * p / 100; if (b.dataset.pct === 'celkem') v = Math.max(0, v - (jinde.get(l.r) || 0)); l.mn = Math.round(v * 1000) / 1000; n++; });
      kresli(); toast(`Nastaveno u ${n} položek.`);
    });
    const pdfBtn = ov.querySelector('[data-pdf]');
    if (pdfBtn) pdfBtn.onclick = async () => { if (F.uzavreno && F.uzavreno.pdf && F.uzavreno.pdf.url) { window.open(F.uzavreno.pdf.url, '_blank', 'noopener'); return; } const b = await fakturaPdf(F); stahni(b, nazevPdf(F)); };
    if (zam) { const x = ov.querySelector('[data-xls]'); if (x) x.onclick = () => excelFaktura(F); return; }
    ov.querySelector('[data-faktura]').onclick = async () => {
      if (ro()) return toast('Jen prohlížení.');
      if (!F.pol.some(l => Number(l.mn))) return toast('Zadejte u položek množství nebo procento.');
      F.pol = F.pol.filter(l => Number(l.mn));   // na fakturu jdou jen položky s množstvím
      const U = udaje(); if (!U.dod || !U.dod.firma) { toast('Nejdřív vyplňte, kdo fakturuje (vaše firma) – jednou pro celou stavbu.'); udajeDodavatele(); return; }
      if (!odbFaktury(F).firma) { toast('Vyberte, komu fakturovat.'); komuFakturovat(); return; }
      F.odb = odbFaktury(F);
      const fi = firmy.find(z => z.id === F.firma); F.firmaN = fi ? fi.firma : ''; F.upr = kdo(); F.uprKdy = new Date().toISOString();
      H.upsert('faktury', [F]); ov.zavri();
      nahledFaktury(F);
    };
    ov.querySelector('[data-mimo]').onclick = () => vlastniPolozka(l => { F.pol.push(l); kresli(); });
    ov.querySelector('[data-pridat]').onclick = () => { ov.zavri(); rezimVyberu(F); };
    ov.querySelector('[data-soupis]').onclick = () => vyberSoubor('soupis', (f, listy, nast) => soupisDoFaktury(F, f, listy, nast, kresli));
    ov.querySelector('[data-xls]').onclick = () => excelFaktura(F);
    const sm = ov.querySelector('[data-smaz]');
    if (sm) sm.onclick = () => { if (!confirm('Smazat fakturaci ' + (F.cislo || '') + '? Smaže se všem kolegům.')) return; H.smaz('faktury', [F.id]); ov.zavri(); };
    ov.querySelector('[data-ok]').onclick = () => {
      if (ro()) return toast('Jen prohlížení: změny se neukládají.');
      if (faktury(R.rec.id).some(x => x.id === F.id && x.uzavreno)) { ov.zavri(); return toast('Faktura už je uzavřená.'); }
      F.pol = F.pol.filter(l => l.r || l.t || l.mn);
      const fi = firmy.find(z => z.id === F.firma); F.firmaN = fi ? fi.firma : '';
      F.upr = kdo(); F.uprKdy = new Date().toISOString();
      H.upsert('faktury', [F]); ov.zavri(); S.panel = 'fakturace'; pamSet('rz-panel', 'fakturace'); toast('Fakturace uložena.');
    };
  }
  function vyberPolozek(F, hotovo) {
    const k = F.kat && najdiKat(R.rec.id, F.kat);
    const zdroj = k ? (k.pol || []).map(id => R.byId.get(id)).filter(Boolean) : R.polozky;
    const C = spocti(R), vybr = new Set();
    const ov = okno('Přidat položky z rozpočtu' + (k ? ' – ' + k.nazev : ''), `<div class="rz-fil"><input class="rz-q" type="search" id="rz-pf" placeholder="Hledat kód nebo popis…" autofocus><span id="rz-pc" style="font-size:13px"></span></div>
      <div class="rz-list" style="max-height:60vh"><table><thead><tr><th></th><th>Obj.</th><th>Kód</th><th>Popis</th><th>MJ</th><th class="n">Množství</th><th class="n">J. cena</th><th class="n">Vyfakturováno</th></tr></thead><tbody id="rz-pb"></tbody></table></div>`,
      `<span class="sp"></span><button type="button" class="rz-btn zl" data-ok>Přidat vybrané</button>`, 'siroky');
    const kresli = () => {
      const sl = norm(ov.querySelector('#rz-pf').value).split(' ').filter(Boolean);
      const vid = zdroj.filter(r => !sl.length || sl.every(s => (r._h || (r._h = norm(r.pc + ' ' + r.k + ' ' + r.d + ' ' + r.mj))).includes(s))).slice(0, 1500);
      ov.querySelector('#rz-pb').innerHTML = vid.map(r => { const x = C.pol.get(r.id); return `<tr><td><input type="checkbox" data-n="${esc(r.id)}"${vybr.has(r.id) ? ' checked' : ''}></td><td>${obBadges(C.obj[r.i])}</td><td>${esc(r.k)}</td><td>${esc(r.d)}</td><td>${esc(r.mj)}</td><td class="n">${mnT(r.mn)}</td><td class="n">${kc(r.jc)}</td><td class="n">${x ? mnT(x.mn) : ''}</td></tr>`; }).join('') + (vid.length >= 1500 ? '<tr><td colspan="8">… zobrazeno prvních 1500, zužte hledání</td></tr>' : '');
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
    const k = F.kat && najdiKat(R.rec.id, F.kat), vKat = k ? new Set(k.pol || []) : null;
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

  /* ---------- 4.60: Faktura z rozpočtu – údaje firmy s logem, PDF, uzavření kódem z e-mailu ---------- */
  const DPH = [['21', 'DPH 21 %'], ['12', 'DPH 12 %'], ['pdp', 'Přenesená daňová povinnost (§ 92e)'], ['0', 'Bez DPH (neplátce)']];
  const udaje = () => (H && H.udajeFaktury && H.udajeFaktury()) || {};
  const plusDni = (d, n) => { const x = new Date((d || new Date().toISOString().slice(0, 10)) + 'T12:00:00'); x.setDate(x.getDate() + (Number(n) || 0)); return x.toISOString().slice(0, 10); };
  const datCz = d => d ? String(d).slice(0, 10).split('-').reverse().map(Number).join('. ') : '';
  const nazevPdf = F => 'Faktura ' + (F.cislo || '') + '.pdf';
  function stahni(blob, jm) { const u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = jm.replace(/[\\/:*?"<>|]/g, ' '); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 60000); }
  function vytvorFakturu() {
    if (!R) return toast('Nejdřív nahrajte rozpočet.');
    if (ro()) return toast('Jen prohlížení.');
    if (!smi('fakt')) return toast('Připravovat faktury vám správce nepovolil.');
    if (!udaje().dod || !udaje().dod.firma) { toast('Nejdřív vyplňte, kdo fakturuje (vaše firma a logo) – zadává se jednou pro celou stavbu.'); udajeDodavatele(() => vytvorFakturu()); return; }
    vyberOdberatele('', odbV => {
      const f = {id: 'fa' + uid(), rp: R.rec.id, cislo: '', firma: '', kat: S.kat || '', od: '', do: '', datum: new Date().toISOString().slice(0, 10), pozn: '', stav: 'rozpracovano', pol: [], kdo: kdo(), kdy: new Date().toISOString(), odbV};
      const FU = udaje(); f.cislo = new Date().getFullYear() + String(faktury(R.rec.id).length + 1).padStart(3, '0');
      f.duzp = f.datum; f.splatnost = plusDni(f.datum, FU.splatnost || 14); f.dph = FU.dph || '21'; f.odb = odbFaktury(f);
      rezimVyberu(f);
    });
  }
  // 4.74: komu fakturovat – obvyklý odběratel (investor), firma z Firem, nebo jiný (IČO → ARES)
  function vyberOdberatele(akt, hotovo) {
    const o = udaje().odb || {}, firmy = ((H.firmy && H.firmy()) || []).filter(z => z.firma);
    const radek = (v, t, pod) => `<label class="rz-odb"><input type="radio" name="rz-odb" value="${esc(v)}"${(akt || '') === v ? ' checked' : ''}><span><b>${esc(t)}</b>${pod ? `<small>${esc(pod)}</small>` : ''}</span></label>`;
    const ov = okno('Komu fakturovat?', `<div class="rz-odbs">
        ${o.firma ? radek('', o.firma, 'obvyklý odběratel' + (o.ico ? ' · IČO ' + o.ico : '')) : ''}
        ${firmy.map(z => radek('f:' + z.id, z.firma, z.ico ? 'IČO ' + z.ico : 'z Firem')).join('')}
        <button type="button" class="rz-btn" data-jiny>+ ${o.firma ? 'Jiný odběratel' : 'Zadat odběratele'} (IČO → ARES)…</button></div>
      <p style="font-size:13.5px;color:var(--muted);margin:10px 0 0">Pak se vrátíte do rozpočtu a položky k fakturaci zaškrtnete přímo v něm (pomohou filtry řemeslo, objekt, podlaží). Přidat jde i vlastní položky, např. vícepráce.</p>`,
      `<span class="sp"></span><button type="button" class="rz-btn zl" data-ok>Vybrat položky v rozpočtu →</button>`);
    if (!ov.querySelector('input[name=rz-odb]:checked')) { const x = ov.querySelector('input[name=rz-odb]'); if (x) x.checked = true; }
    ov.querySelector('[data-jiny]').onclick = () => { ov.zavri(); komuFakturovat(() => vyberOdberatele('', hotovo)); };
    ov.querySelector('[data-ok]').onclick = () => {
      const x = ov.querySelector('input[name=rz-odb]:checked');
      if (!x) return toast('Vyberte, komu fakturovat.');
      ov.zavri(); hotovo(x.value);
    };
  }
  // fakturační režim: rozpočet s lištou nahoře, položky se zaškrtávají přímo v tabulce
  function rezimVyberu(F) {
    S.fak = {F: JSON.parse(JSON.stringify(F))};
    S.panel = 'rozpocet'; pamSet('rz-panel', 'rozpocet');
    prekresli();
    setTimeout(() => toast('Zaškrtněte položky k fakturaci v rozpočtu. Pomohou filtry nahoře.'), 200);
  }
  function listaFaktury(C) {
    const F = S.fak.F, nV = S.vyb.size, uz = new Set(F.pol.filter(l => l.r).map(l => l.r)), vl = F.pol.filter(l => !l.r).length;
    let kcV = 0; S.vyb.forEach(id => { const r = R.byId.get(id); if (r) kcV += r.cc || 0; });
    const odb = odbFaktury(F).firma || '';
    const filtr = !nV && filtrAktivni() && VIS && VIS._n;
    return `<div class="rz-fakl"><b>🧾 Faktura ${esc(F.cislo || '')}${odb ? ' pro ' + esc(odb) : ''}</b>
      <span>${nV ? `Zaškrtnuto <b>${nf0.format(nV)}</b> položek · ${kc0(kcV)}` : filtr ? `Nic nezaškrtnuto – vezme se všech <b>${nf0.format(VIS._n)}</b> vyfiltrovaných položek` : 'Zaškrtněte položky v rozpočtu (☐ vlevo u řádku, ☐ v záhlaví = všechny zobrazené)'}${uz.size ? ` · ve faktuře už ${nf0.format(uz.size)}` : ''}${vl ? ` · vlastních ${vl}` : ''}</span>
      <span class="sp" style="flex:1"></span>
      <button type="button" class="rz-btn" data-a="fak-vlastni">+ Vlastní položka (vícepráce…)</button>
      <button type="button" class="rz-btn" data-a="fak-zrus">Zrušit</button>
      <button type="button" class="rz-btn cr" data-a="fak-dal">Pokračovat – rozsah v MJ nebo % →</button></div>`;
  }
  function vlastniPolozka(hotovo) {
    const ov = okno('Vlastní položka (mimo rozpočet)', `<div class="rz-pole"><label style="grid-column:1/-1">Popis práce<input data-v="t" placeholder="např. Vícepráce – oprava stropu v 2.NP"></label>
      <label>MJ<input data-v="mj" placeholder="ks, m2, hod…"></label><label>Množství<input data-v="mn" inputmode="decimal" placeholder="1"></label><label>Jednotková cena Kč<input data-v="jc" inputmode="decimal" placeholder="0"></label></div>`,
      `<span class="sp"></span><button type="button" class="rz-btn zl" data-ok>Přidat do faktury</button>`);
    setTimeout(() => ov.querySelector('[data-v=t]').focus(), 50);
    ov.querySelector('[data-ok]').onclick = () => {
      const g = k => ov.querySelector(`[data-v=${k}]`).value.trim();
      if (!g('t')) return toast('Napište popis práce.');
      ov.zavri(); hotovo({r: '', t: g('t'), mj: g('mj'), mn: cislo(g('mn')) == null ? 1 : cislo(g('mn')), jc: cislo(g('jc')) || 0});
    };
  }
  function dokonciVyber() {
    if (!S.fak) return;
    const F = S.fak.F;
    let ids = [...S.vyb], podil = null;
    if (!ids.length && filtrAktivni()) { const v = spocitejViditelne(spocti(R)); ids = v._ids.map(x => x[0]); podil = new Map(v._ids); if (!F.pozn) F.pozn = popisFiltru(); }
    ids.forEach(id => { const r = R.byId.get(id); if (!r || r.t !== 'P' || F.pol.some(l => l.r === id)) return; const l = {r: id, mn: 0, jc: r.jc || 0}; const p = podil && podil.get(id); if (p != null && p < 0.9999) l.p = Math.round(p * 10000) / 10000; F.pol.push(l); });
    if (!F.pol.length) return toast('Zaškrtněte aspoň jednu položku, nebo přidejte vlastní.');
    if (!F.kat && S.kat) F.kat = S.kat;
    S.fak = null; S.vyb.clear(); prekresli();
    editorFaktury(null, F);
  }
  // logo: zmenšené na nejvýš 600 × 240 px, uložené jako obrázek v údajích stavby (propíše se všem)
  function nactiLogo(file) {
    return new Promise((res, rej) => {
      const u = URL.createObjectURL(file), i = new Image();
      i.onload = () => {
        const sc = Math.min(1, 600 / i.naturalWidth, 240 / i.naturalHeight), c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(i.naturalWidth * sc)); c.height = Math.max(1, Math.round(i.naturalHeight * sc));
        c.getContext('2d').drawImage(i, 0, 0, c.width, c.height); URL.revokeObjectURL(u);
        let d = c.toDataURL('image/png');
        if (d.length > 160000) { const c2 = document.createElement('canvas'); c2.width = c.width; c2.height = c.height; const g = c2.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(c, 0, 0); d = c2.toDataURL('image/jpeg', .9); }
        res(d);
      };
      i.onerror = () => { URL.revokeObjectURL(u); rej(new Error('Obrázek se nepodařilo otevřít.')); };
      i.src = u;
    });
  }
  // 4.74: kdo fakturuje (dodavatel) se zadává jednou v Údajích o stavbě; v Rozpočtu se jen vybírá, komu fakturovat
  function udajeFaktury(hotovo) { return udajeDodavatele(hotovo); }
  function aresDo(ov, p, b) {
    const ico = ov.querySelector(`[data-${p}="ico"]`).value;
    if (!H || !H.ares) return toast('ARES teď není k dispozici.');
    b.disabled = true; const t0 = b.textContent; b.textContent = 'Hledám…';
    H.ares(ico).then(x => { [['firma', x.firma], ['dic', x.dic], ['adresa', x.adresa], ['ico', x.ico], ['rejstrik', x.rejstrik]].forEach(([k, v]) => { const el = ov.querySelector(`[data-${p}="${k}"]`); if (v && el) el.value = v; }); toast(p === 'd' && !x.rejstrik ? 'Načteno z ARES (zápis v rejstříku ARES neuvádí – firma v obchodním rejstříku není, nebo ho doplňte ručně).' : 'Načteno z ARES.'); })
      .catch(x => toast(x.message || String(x))).finally(() => { b.disabled = false; b.textContent = t0; });
  }
  const poleF = (p, k, l, v, ph, typ) => `<label>${l}<input data-${p}="${k}" value="${esc(v || '')}" placeholder="${esc(ph || '')}"${typ ? ' type="' + typ + '"' : ''}></label>`;
  function udajeDodavatele(hotovo) {
    const U = JSON.parse(JSON.stringify(udaje())), d = U.dod || {};
    let logo = d.logo || '';
    const ov = okno('Kdo fakturuje – vaše firma', `
      <p style="margin:0 0 8px;font-size:13.5px;color:var(--muted)">Zadává se jednou pro celou stavbu (Údaje o stavbě). Objeví se na každé faktuře. Po zadání IČO klikněte <b>Načíst z ARES</b> – název, DIČ, adresa i zápis v obchodním rejstříku se doplní samy.</p>
      <div class="rz-pole"><label>Splatnost faktur (dní)<input data-u="splatnost" inputmode="numeric" value="${esc(U.splatnost || 14)}"></label>
        <label>DPH obvykle<select data-u="dph">${DPH.map(([k, t]) => `<option value="${k}"${(U.dph || '21') === k ? ' selected' : ''}>${t}</option>`).join('')}</select></label></div>
      <h4 style="margin:12px 0 6px">Vaše firma (dodavatel – hlavní firma, která stavbu spravuje)</h4>
      <div class="rz-pole">${poleF('d', 'ico', 'IČO', d.ico, '8 číslic')}<label>&nbsp;<button type="button" class="rz-btn" data-ares="d">Načíst z ARES</button></label>
        ${poleF('d', 'firma', 'Název firmy', d.firma, 'např. Stavby Kozák s.r.o.')}${poleF('d', 'dic', 'DIČ', d.dic, 'CZ…')}
        ${poleF('d', 'adresa', 'Adresa', d.adresa, 'ulice, PSČ město')}${poleF('d', 'rejstrik', 'Zápis v obchodním rejstříku (z ARES)', d.rejstrik, 'doplní se z ARES')}
        ${poleF('d', 'ucet', 'Bankovní účet', d.ucet, 'např. 123456789/0100')}${poleF('d', 'email', 'E-mail', d.email, '', 'email')}${poleF('d', 'tel', 'Telefon', d.tel)}</div>
      <div style="display:flex;gap:12px;align-items:center;margin:8px 0 4px;flex-wrap:wrap"><b>Logo:</b><span id="fk-lg" style="display:inline-flex;align-items:center;justify-content:center;min-width:180px;height:70px;border:1px dashed var(--line);border-radius:10px;padding:4px"></span>
        <label class="rz-btn" style="cursor:pointer">Vybrat obrázek s logem…<input type="file" accept="image/*" id="fk-lgf" hidden></label><button type="button" class="rz-btn" id="fk-lgx">Bez loga</button></div>`,
      `<span class="sp"></span><button type="button" class="rz-btn zl" data-ok>Uložit</button>`, 'siroky');
    const ukazLogo = () => { ov.querySelector('#fk-lg').innerHTML = logo ? `<img src="${logo}" alt="Logo" style="max-height:62px;max-width:260px">` : '<span style="color:var(--muted);font-size:13px">bez loga</span>'; };
    ukazLogo();
    ov.querySelector('#fk-lgf').onchange = async e => { const fl = e.target.files[0]; if (!fl) return; try { logo = await nactiLogo(fl); ukazLogo(); } catch (x) { toast(x.message); } };
    ov.querySelector('#fk-lgx').onclick = () => { logo = ''; ukazLogo(); };
    ov.querySelector('[data-ares="d"]').onclick = e => aresDo(ov, 'd', e.currentTarget);
    ov.querySelector('[data-ok]').onclick = () => {
      if (ro()) return toast('Jen prohlížení.');
      const x = {}; ov.querySelectorAll('[data-d]').forEach(i => { x[i.dataset.d] = i.value.trim(); });
      if (!x.firma) return toast('Vyplňte aspoň název vaší firmy.');
      const akt = udaje();
      H.ulozUdajeFaktury(Object.assign({}, akt, {dod: Object.assign(x, {logo}), splatnost: Number(ov.querySelector('[data-u="splatnost"]').value) || 14, dph: ov.querySelector('[data-u="dph"]').value}));
      ov.zavri(); toast('Údaje pro faktury uloženy.');
      if (hotovo) hotovo();
    };
  }
  function komuFakturovat(hotovo) {
    const o = udaje().odb || {};
    const ov = okno('Komu fakturovat (odběratel)', `
      <p style="margin:0 0 8px;font-size:13.5px;color:var(--muted)">Obvyklý odběratel faktur na této stavbě (většinou investor). U každé faktury ho jde změnit na jinou firmu z Firem. Kdo fakturuje (vaše firma, logo, účet) se nastavuje v <b>Údajích o stavbě</b>.</p>
      <div class="rz-pole">${poleF('o', 'ico', 'IČO', o.ico, '8 číslic')}<label>&nbsp;<button type="button" class="rz-btn" data-ares="o">Načíst z ARES</button></label>
        ${poleF('o', 'firma', 'Název firmy', o.firma)}${poleF('o', 'dic', 'DIČ', o.dic)}${poleF('o', 'adresa', 'Adresa', o.adresa)}</div>`,
      `<button type="button" class="rz-btn" data-dod>Kdo fakturuje (vaše firma)…</button><span class="sp"></span><button type="button" class="rz-btn zl" data-ok>Uložit</button>`, 'siroky');
    ov.querySelector('[data-ares="o"]').onclick = e => aresDo(ov, 'o', e.currentTarget);
    ov.querySelector('[data-dod]').onclick = () => { ov.zavri(); udajeDodavatele(); };
    ov.querySelector('[data-ok]').onclick = () => {
      if (ro()) return toast('Jen prohlížení.');
      const x = {}; ov.querySelectorAll('[data-o]').forEach(i => { x[i.dataset.o] = i.value.trim(); });
      if (!x.firma) return toast('Vyplňte název odběratele.');
      H.ulozUdajeFaktury(Object.assign({}, udaje(), {odb: x})); ov.zavri(); toast('Odběratel uložen.');
      if (hotovo) hotovo();
    };
  }
  // odběratel konkrétní faktury: F.odbV = '' (obvyklý / investor) nebo 'f:<id firmy>'
  function odbFaktury(F) {
    const v = F.odbV || '';
    if (v.startsWith('f:')) { const z = ((H && H.firmy && H.firmy()) || []).find(x => x.id === v.slice(2)); if (z) return {ico: z.ico || '', firma: z.firma || '', dic: z.dic || '', adresa: z.adresa || z.sidlo || ''}; if (F.odb) return F.odb; }
    return udaje().odb || {};
  }
  function soucty(F) {
    let zakl = 0; (F.pol || []).forEach(l => { zakl += Math.round((Number(l.mn) || 0) * (Number(l.jc) || 0) * 100) / 100; });
    zakl = Math.round(zakl * 100) / 100;
    const sazba = F.dph === '21' ? 21 : F.dph === '12' ? 12 : 0, dan = Math.round(zakl * sazba) / 100;
    return {zakl, sazba, dan, celkem: Math.round((zakl + dan) * 100) / 100};
  }
  // faktura jako PDF (stránky A4 kreslené do obrázku – stejný způsob jako zprávy pro firmy)
  async function fakturaPdf(F) {
    const U = udaje(), dod = U.dod || {}, odb = odbFaktury(F), P = (H.projekt && H.projekt()) || {};
    const W = 1190, Hh = 1684, M = 70, FONT = 'Helvetica, Arial, sans-serif';
    let logoImg = null;
    if (dod.logo) logoImg = await new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = dod.logo; });
    const mer = document.createElement('canvas').getContext('2d');
    const zalom = (t, font, maxW, maxL) => { mer.font = font; const out = []; let line = ''; String(t || '').replace(/\s+/g, ' ').trim().split(' ').forEach(w => { const x = line ? line + ' ' + w : w; if (line && mer.measureText(x).width > maxW) { out.push(line); line = w; } else line = x; }); if (line) out.push(line); if (maxL && out.length > maxL) { out.length = maxL; out[maxL - 1] = out[maxL - 1].replace(/\s*\S*$/, '') + '…'; } return out; };
    const nf2 = new Intl.NumberFormat('cs-CZ', {minimumFractionDigits: 2, maximumFractionDigits: 2});
    const nfM = new Intl.NumberFormat('cs-CZ', {maximumFractionDigits: 3});
    const S_ = soucty(F), kat = F.kat && najdiKat(R.rec.id, F.kat);
    // sloupce tabulky
    const K = [{k: 'Kód', x: M, w: 150}, {k: 'Popis položky', x: M + 156, w: 456}, {k: 'MJ', x: M + 618, w: 46}, {k: 'Množství', x: M + 670, w: 112, r: 1}, {k: '%', x: M + 788, w: 56, r: 1}, {k: 'J. cena', x: M + 850, w: 96, r: 1}, {k: 'Celkem Kč', x: M + 952, w: 98, r: 1}];
    const FR = '19px ' + FONT, LH = 23;
    const radky = (F.pol || []).filter(l => Number(l.mn)).map(l => {
      const r = l.r && R.byId.get(l.r), zakl = r && r.mn ? r.mn * (l.p || 1) : 0;
      return {kod: r ? String(r.k || '') : '', d: zalom(r ? r.d : l.t || '', FR, K[1].w - 8, 3), mj: r ? r.mj || '' : l.mj || '', mn: Number(l.mn) || 0, pct: zakl ? Math.round(l.mn / zakl * 1000) / 10 : null, jc: Number(l.jc) || 0, cc: Math.round((Number(l.mn) || 0) * (Number(l.jc) || 0) * 100) / 100};
    });
    // rozdělení na stránky
    const HLAVA1 = 820, HLAVA = 200, PATA = Hh - 120, SOUCTY = 300, stranky = [[]];
    let y = HLAVA1 + 44;
    radky.forEach(rw => { const h = rw.d.length * LH + 14; if (y + h > PATA) { stranky.push([]); y = HLAVA + 44; } stranky[stranky.length - 1].push(rw); y += h; });
    if (y + SOUCTY > PATA) stranky.push([]);
    const pages = [];
    for (let pi = 0; pi < stranky.length; pi++) {
      const c = document.createElement('canvas'); c.width = W; c.height = Hh; const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, W, Hh); g.textBaseline = 'alphabetic';
      const txt = (t, x, yy, font, col, al) => { g.font = font; g.fillStyle = col || '#16191c'; g.textAlign = al || 'left'; g.fillText(String(t == null ? '' : t), x, yy); g.textAlign = 'left'; };
      let yy;
      if (pi === 0) {
        if (logoImg) { const sc = Math.min(380 / logoImg.naturalWidth, 130 / logoImg.naturalHeight); g.drawImage(logoImg, M, 56, logoImg.naturalWidth * sc, logoImg.naturalHeight * sc); }
        else txt(dod.firma || '', M, 110, 'bold 34px ' + FONT);
        txt('FAKTURA', W - M, 100, 'bold 52px ' + FONT, '#16191c', 'right');
        txt((F.dph === '0' ? 'číslo ' : 'daňový doklad č. ') + (F.cislo || ''), W - M, 140, '24px ' + FONT, '#444', 'right');
        g.fillStyle = '#F4D23C'; g.fillRect(M, 200, W - 2 * M, 8);
        const box = (x, nad, o, extra) => {
          txt(nad, x, 250, 'bold 16px ' + FONT, '#7a828a'); let yb = 286;
          zalom(o.firma, 'bold 25px ' + FONT, 500, 2).forEach(l => { txt(l, x, yb, 'bold 25px ' + FONT); yb += 31; });
          zalom(o.adresa, '20px ' + FONT, 500, 3).forEach(l => { txt(l, x, yb, '20px ' + FONT, '#333'); yb += 26; });
          yb += 6; if (o.ico) { txt('IČO: ' + o.ico, x, yb, '20px ' + FONT); yb += 26; } if (o.dic) { txt('DIČ: ' + o.dic, x, yb, '20px ' + FONT); yb += 26; }
          (extra || []).filter(Boolean).forEach(t => { zalom(t, '17px ' + FONT, 500, 2).forEach(l => { txt(l, x, yb, '17px ' + FONT, '#555'); yb += 22; }); });
        };
        box(M, 'DODAVATEL', dod, [dod.email ? 'E-mail: ' + dod.email : '', dod.tel ? 'Tel.: ' + dod.tel : '', dod.rejstrik]);
        box(W / 2 + 20, 'ODBĚRATEL', odb, []);
        const vs = String(F.cislo || '').replace(/\D/g, '');
        const info = [['Datum vystavení', datCz(F.datum)], ['Datum zdanitelného plnění', datCz(F.duzp || F.datum)], ['Datum splatnosti', datCz(F.splatnost)], ['Forma úhrady', 'převodem'],
          ['Bankovní účet', dod.ucet || ''], ['Variabilní symbol', vs], ['Stavba', P.name || ''], ['Plnění', [kat ? kat.nazev : '', F.od || F.do ? 'za období ' + [datCz(F.od), datCz(F.do)].filter(Boolean).join(' – ') : ''].filter(Boolean).join(', ') || 'práce podle rozpočtu']];
        g.fillStyle = '#f6f6f3'; g.fillRect(M, 560, W - 2 * M, 200);
        info.forEach(([k, v], i) => { const x = M + 20 + (i % 2) * ((W - 2 * M) / 2), yb = 600 + Math.floor(i / 2) * 44; txt(k, x, yb, '16px ' + FONT, '#7a828a'); txt(zalom(v, 'bold 19px ' + FONT, 300, 1)[0] || '', x + 215, yb, 'bold 19px ' + FONT); });
        if (F.pozn) txt(zalom('Poznámka: ' + F.pozn, '17px ' + FONT, W - 2 * M, 1)[0], M, 790, '17px ' + FONT, '#555');
        yy = HLAVA1;
      } else {
        txt('Faktura ' + (F.cislo || '') + ' – pokračování', M, 100, 'bold 26px ' + FONT); txt(dod.firma || '', W - M, 100, '18px ' + FONT, '#555', 'right');
        g.fillStyle = '#F4D23C'; g.fillRect(M, 130, W - 2 * M, 6);
        yy = HLAVA;
      }
      // hlavička tabulky
      g.fillStyle = '#16191c'; g.fillRect(M, yy, W - 2 * M, 40);
      K.forEach(k => txt(k.k, k.r ? k.x + k.w - 4 : k.x + 4, yy + 27, 'bold 15px ' + FONT, '#fff', k.r ? 'right' : 'left'));
      yy += 40;
      stranky[pi].forEach((rw, j) => {
        const h = rw.d.length * LH + 14;
        if (j % 2) { g.fillStyle = '#f7f7f4'; g.fillRect(M, yy, W - 2 * M, h); }
        const yt = yy + 26;
        txt(zalom(rw.kod, '17px ' + FONT, K[0].w - 6, 1)[0] || '', K[0].x + 4, yt, '17px ' + FONT, '#444');
        rw.d.forEach((l, i) => txt(l, K[1].x, yt + i * LH, FR));
        txt(rw.mj, K[2].x, yt, FR);
        txt(nfM.format(rw.mn), K[3].x + K[3].w, yt, FR, '#16191c', 'right');
        txt(rw.pct == null ? '' : String(rw.pct).replace('.', ',') + ' %', K[4].x + K[4].w, yt, '17px ' + FONT, '#555', 'right');
        txt(nf2.format(rw.jc), K[5].x + K[5].w, yt, FR, '#16191c', 'right');
        txt(nf2.format(rw.cc), K[6].x + K[6].w, yt, 'bold 19px ' + FONT, '#16191c', 'right');
        yy += h;
        g.fillStyle = '#e4e4df'; g.fillRect(M, yy - 1, W - 2 * M, 1);
      });
      if (pi === stranky.length - 1) {
        yy += 30; const xL = W / 2 + 40, xR = W - M;
        const rad = (k, v, b) => { txt(k, xL, yy, (b ? 'bold ' : '') + '21px ' + FONT, '#333'); txt(v, xR, yy, (b ? 'bold ' : '') + '21px ' + FONT, '#16191c', 'right'); yy += 34; };
        rad('Základ daně', nf2.format(S_.zakl) + ' Kč');
        if (F.dph === 'pdp') rad('DPH', 'přenesená povinnost'); else if (S_.sazba) rad('DPH ' + S_.sazba + ' %', nf2.format(S_.dan) + ' Kč');
        yy += 6; g.fillStyle = '#16191c'; g.fillRect(xL - 16, yy - 6, xR - xL + 16, 64);
        txt('Celkem k úhradě', xL, yy + 36, 'bold 24px ' + FONT, '#F4D23C'); txt(nf2.format(S_.celkem) + ' Kč', xR - 16, yy + 38, 'bold 30px ' + FONT, '#F4D23C', 'right');
        yy += 100;
        if (F.dph === 'pdp') zalom('Daň odvede zákazník – přenesená daňová povinnost podle § 92e zákona č. 235/2004 Sb., o dani z přidané hodnoty.', '18px ' + FONT, W - 2 * M, 3).forEach(l => { txt(l, M, yy, '18px ' + FONT, '#333'); yy += 24; });
        if (F.dph === '0') { txt('Dodavatel není plátcem DPH.', M, yy, '18px ' + FONT, '#333'); yy += 24; }
        yy += 40; txt('Vystavil(a): ' + (F.uzavreno ? F.uzavreno.kdo : kdo()) + (dod.firma ? ', ' + dod.firma : ''), M, yy, '18px ' + FONT, '#333');
      }
      txt('Faktura ' + (F.cislo || '') + ' · strana ' + (pi + 1) + ' z ' + stranky.length, M, Hh - 50, '15px ' + FONT, '#8a929a');
      txt('Vystaveno v Constructo', W - M, Hh - 50, '15px ' + FONT, '#8a929a', 'right');
      pages.push(c);
    }
    const jpgs = [];
    for (const c of pages) { const b = await new Promise(res => c.toBlob(res, 'image/jpeg', .9)); jpgs.push({jpg: new Uint8Array(await b.arrayBuffer()), w: W, h: Hh}); }
    const pdf = window.CXZprava.jpegPdf(jpgs);
    pdf.nahled = pages.map(c => c.toDataURL('image/jpeg', .8));   // náhled jako obrázky (PDF v okně Safari/Chrome nemusí jít zobrazit)
    return pdf;
  }
  async function nahledFaktury(F) {
    const w = cekej('Připravuji fakturu…');
    let blob; try { blob = await fakturaPdf(F); } catch (e) { w.konec(); toast('Fakturu se nepodařilo vytvořit: ' + (e.message || e)); return; }
    w.konec();
    const S_ = soucty(F);
    const ov = okno('Faktura ' + (F.cislo || '') + ' – ' + kc(S_.celkem) + ' Kč', `<div style="max-height:68vh;overflow:auto;background:#e9e9e4;border-radius:10px;padding:14px;display:flex;flex-direction:column;align-items:center;gap:14px">${(blob.nahled || []).map((src, i) => `<img src="${src}" alt="Faktura, strana ${i + 1}" style="width:min(100%,760px);box-shadow:0 2px 12px rgba(0,0,0,.18);background:#fff">`).join('')}</div>
      ${smi('fakU') ? '<p style="margin:8px 0 0;font-size:14px">Zkontrolujte fakturu. Když je v pořádku, klikněte <b>Uzavřít a uložit</b>: na váš e-mail přijde kód a faktura v PDF. Po zadání kódu se faktura uzavře a vyfakturované položky se v rozpočtu zamknou.</p>' : '<p style="margin:8px 0 0;font-size:14px">Zkontrolujte fakturu. Uzavírat faktury smí jen ten, komu to správce povolil (manažer projektu, stavbyvedoucí). Klikněte <b>Poslat ke schválení</b>: dostanou e-mail s fakturou v PDF a uzavřou ji kódem.</p>'}`,
      `<button type="button" class="rz-btn" data-upravit>Upravit</button><button type="button" class="rz-btn" data-st>⬇ Stáhnout PDF</button><span class="sp"></span>${smi('fakU') ? '<button type="button" class="rz-btn zl" data-uz>🔒 Uzavřít a uložit fakturu…</button>' : '<button type="button" class="rz-btn zl" data-ks>📨 Poslat ke schválení</button>'}`, 'siroky');
    ov.querySelector('[data-st]').onclick = () => stahni(blob, nazevPdf(F));
    ov.querySelector('[data-upravit]').onclick = () => { ov.zavri(); editorFaktury(F.id); };
    const uz = ov.querySelector('[data-uz]'); if (uz) uz.onclick = () => { ov.zavri(); uzavritFakturu(F, blob); };
    const ks = ov.querySelector('[data-ks]'); if (ks) ks.onclick = () => { ov.zavri(); keSchvaleni(F, blob); };
  }
  // 4.61: kdo nesmí uzavírat, pošle fakturu ke schválení těm, kdo smí (e-mail s PDF, v Fakturaci „čeká na schválení“)
  async function keSchvaleni(F, blob) {
    if (!H.pripojeno() || !H.posliMail) return toast('Poslat ke schválení jde jen s připojením ke Googlu.');
    const kdoSmi = (H.schvalovatele && H.schvalovatele()) || [], sMail = kdoSmi.filter(x => x.email);
    if (!kdoSmi.length) return toast('Nikdo v týmu zatím nesmí uzavírat faktury. Správce to zaškrtne v Lidech → Upravit kartu → Oprávnění.');
    if (!sMail.length) return toast('Kdo smí uzavírat faktury (' + kdoSmi.map(x => x.n).join(', ') + '), nemá v kartě e-mail.');
    const w = cekej('Posílám fakturu ke schválení…');
    try {
      const pdfB = await window.CXZprava.b64(blob), S_ = soucty(F), P = (H.projekt && H.projekt()) || {};
      const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#16191c"><p>Dobrý den,</p><p><b>${esc(kdo())}</b> připravil(a) fakturu <b>${esc(F.cislo || '')}</b> (${esc(P.name || '')}, ${esc(kc(S_.celkem))} Kč) a posílá ji ke schválení. Faktura je v příloze.</p><p>Schválení: otevřete Constructo → <b>Rozpočet</b> → <b>Fakturace</b> → faktura ${esc(F.cislo || '')} → <b>🧾 Vytvořit fakturu (PDF)</b> → <b>Uzavřít a uložit</b>. Na váš e-mail pak přijde kód.</p></div>`;
      let ok = 0;
      for (const x of sMail) { const r = await H.posliMail({komu: x.email, predmet: 'Constructo – faktura ' + (F.cislo || '') + ' ke schválení', html, text: 'Faktura ' + (F.cislo || '') + ' čeká na schválení v Constructu.', pdf: pdfB, pdfJmeno: nazevPdf(F).replace(/\s/g, '_')}); if (r && r.ok) ok++; }
      if (!ok) throw new Error('e-mail se nepodařilo odeslat');
      const akt = faktury(R.rec.id).find(x => x.id === F.id) || F;
      H.upsert('faktury', [Object.assign({}, akt, {keSchvaleni: {kdo: kdo(), kdy: new Date().toISOString(), komu: sMail.map(x => x.n)}})]);
      w.konec(); S.panel = 'fakturace'; pamSet('rz-panel', 'fakturace'); prekresli();
      toast('Faktura ' + (F.cislo || '') + ' odešla ke schválení: ' + sMail.map(x => x.n).join(', ') + '.');
    } catch (e) { w.konec(); toast('Nepodařilo se poslat: ' + (e.message || e)); }
  }
  async function uzavritFakturu(F, blob) {
    if (!smi('fakU')) return toast('Uzavírat faktury vám správce nepovolil.');
    const email = (H.mujEmail && H.mujEmail()) || (udaje().dod || {}).email || '';
    if (!H.pripojeno() || !H.posliMail) return toast('Uzavření s kódem jde jen s připojením ke Googlu (Data → Automatická synchronizace).');
    if (!email) return toast('U vašeho jména chybí e-mail (doplňte ho v Lidech), kód není kam poslat.');
    const kod = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
    const w = cekej('Posílám kód a fakturu na ' + email + '…');
    let pdfB = '';
    try {
      pdfB = await window.CXZprava.b64(blob);
      const S_ = soucty(F), P = (H.projekt && H.projekt()) || {};
      const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#16191c"><p>Dobrý den,</p><p>kód pro uzavření faktury <b>${esc(F.cislo || '')}</b> (${esc(P.name || '')}, ${esc(kc(S_.celkem))} Kč) je:</p><p style="font-size:30px;font-weight:bold;letter-spacing:6px;background:#F4D23C;display:inline-block;padding:8px 18px;border-radius:8px">${kod}</p><p>Zadejte ho v Constructu. Faktura je v příloze.</p><p style="color:#777">Pokud jste o uzavření faktury nežádal(a), kód nikam nezadávejte.</p></div>`;
      const r = await H.posliMail({komu: email, predmet: 'Constructo – kód pro uzavření faktury ' + (F.cislo || ''), html, text: 'Kód pro uzavření faktury ' + (F.cislo || '') + ': ' + kod, pdf: pdfB, pdfJmeno: nazevPdf(F).replace(/\s/g, '_')});
      if (!r || !r.ok) throw new Error((r && r.error) || 'e-mail se nepodařilo odeslat');
    } catch (e) { w.konec(); toast('Kód se nepodařilo poslat: ' + (e.message || e)); return; }
    w.konec();
    let pokusu = 0;
    const ov = okno('Uzavřít fakturu ' + (F.cislo || ''), `<p style="margin:0 0 10px">Na <b>${esc(email)}</b> jsme poslali šestimístný kód a fakturu v PDF. Opište kód sem:</p>
      <input id="fk-kod" inputmode="numeric" maxlength="6" autocomplete="one-time-code" style="font-size:28px;letter-spacing:8px;width:220px;text-align:center;padding:8px;border:2px solid var(--ink);border-radius:10px">
      <p style="font-size:13px;color:var(--muted)">Po uzavření už fakturu nepůjde změnit ani smazat a vyfakturované množství se v rozpočtu zamkne.</p>`,
      `<span class="sp"></span><button type="button" class="rz-btn zl" data-ok>Uzavřít fakturu</button>`);
    const inp = ov.querySelector('#fk-kod'); setTimeout(() => inp.focus(), 50);
    const ok = async () => {
      if (inp.value.replace(/\D/g, '') !== kod) { pokusu++; toast(pokusu >= 5 ? 'Příliš mnoho chybných pokusů. Zkuste uzavřít znovu, přijde nový kód.' : 'Kód nesedí, zkuste to znovu.'); if (pokusu >= 5) ov.zavri(); return; }
      const w2 = cekej('Ukládám uzavřenou fakturu…');
      let pdf = null; try { pdf = H.ulozPdf ? await H.ulozPdf(nazevPdf(F).replace(/\s/g, '_'), pdfB, F.datum) : null; } catch (e) {}
      const akt = faktury(R.rec.id).find(x => x.id === F.id) || F;
      H.upsert('faktury', [Object.assign({}, akt, {uzavreno: {kdy: new Date().toISOString(), kdo: kdo(), email, pdf}, stav: 'schvaleno'})]);
      w2.konec(); ov.zavri(); S.panel = 'fakturace'; pamSet('rz-panel', 'fakturace'); prekresli();
      toast('Faktura ' + (F.cislo || '') + ' je uzavřená' + (pdf ? ' a PDF je uložené na Disku Google.' : '.'));
    };
    ov.querySelector('[data-ok]').onclick = ok;
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); });
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
    if (!R.lv) obrys(R);
    const C = spocti(R), vis = filtrAktivni() ? spocitejViditelne(C) : R.rows.map((r, i) => i);
    const ks = kategorie(R.rec.id);
    const hl = R.cols.map(c => c.n).concat(['Objekt', 'Druh prací', 'Vyfakturováno MJ', 'Vyfakturováno Kč', 'Zbývá Kč', 'Upozornění']);
    const rows = [hl], urov = [0];
    vis.forEach(i => {
      const r = R.rows[i], x = C.pol.get(r.id);
      if (r.t === 'L') { if (R.vicListu) { rows.push(['List: ' + r.d]); urov.push(0); } return; }
      const sek = r.t[0] === 'S';
      const b = R.cols.map(c => R.v2 ? (r.c ? r.c[c.c] : '') : r[c.k]);
      rows.push(b.concat([r.t === 'P' ? obText(C.obj[i]) : '', r.t === 'P' ? (C.katPol.get(r.id) || []).map(k => (ks.find(z => z.id === k) || {}).nazev).join(', ') : '', x ? x.mn : null, x ? Math.round(x.kc * 100) / 100 : sek && C.sum[i] ? Math.round(C.sum[i] * 100) / 100 : null, x ? Math.round(((r.cc || 0) - x.kc) * 100) / 100 : sek && C.sum[i] ? Math.round((R.sum[i] - C.sum[i]) * 100) / 100 : null, x ? [x.nad ? 'překročeno množství' : '', x.cena ? 'jiná cena' : ''].filter(Boolean).join(', ') : '']));
      urov.push(R.lv[i]);
    });
    ulozExcel(R.rec.nazev + (filtrAktivni() ? ' – výběr' : '') + ' – čerpání', [{n: 'Rozpočet', rows, urov, sirky: R.cols.map(c => Math.round(c.w / 7)).concat([7, 18, 12, 14, 14, 20])}]);
  }
  function popisFiltru() {
    const k = S.kat && najdiKat(R.rec.id, S.kat);
    return [S.cast, S.dil, S.obor, k ? k.nazev : '', S.obj ? (S.obj === '-' ? 'bez objektu' : 'objekt ' + S.obj) : '', S.pod ? (S.pod === '-' ? 'bez podlaží' : S.pod) : '', S.q.trim() ? '„' + S.q.trim() + '“' : ''].filter(Boolean).join(' · ');
  }
  // poptávka: vyfiltrované položky ve stejných sloupcích jako nahraný rozpočet, s nadpisy a výkazem výměr, ale bez cen
  function excelPoptavka() {
    if (!R) return;
    if (!R.lv) obrys(R);
    const C = spocti(R), v = spocitejViditelne(C), sh = new Map(v._ids), rows = R.rows;
    const ok = new Uint8Array(rows.length);
    v._ids.forEach(([id]) => { const r = R.byId.get(id); ok[r.i] = 1; R.deti[r.i].forEach(d => ok[d] = 1); let p = r.p; while (p >= 0) { ok[p] = 1; p = rows[p].p; } });
    const cenaSl = new Set();
    (R.listy || []).forEach(li => { const m = li.map || {}; if (m.jc != null) cenaSl.add(m.jc); if (m.cc != null) cenaSl.add(m.cc); });
    R.cols.forEach(c => { if (/cen|kc\b|celk/i.test(bezDia(c.n)) && !/^mno/i.test(bezDia(c.n))) cenaSl.add(R.v2 ? c.c : c.k); });
    const dilek = S.obj || S.pod;
    const hl = R.cols.map(c => c.n).concat(dilek ? ['Množství pro výběr'] : []);
    const out = [['Poptávka – ' + R.rec.nazev], ['Výběr: ' + (popisFiltru() || 'celý rozpočet')], ['Ceny prosíme doplnit. Položek: ' + v._ids.length], [], hl], urov = [0, 0, 0, 0, 0];
    for (let i = 0; i < rows.length; i++) {
      if (!ok[i]) continue;
      const r = rows[i];
      if (r.t === 'L') { if (R.vicListu) { out.push(['List: ' + r.d]); urov.push(0); } continue; }
      const b = R.cols.map(c => { const key = R.v2 ? c.c : c.k, x = R.v2 ? (r.c ? r.c[c.c] : '') : r[c.k]; return cenaSl.has(key) && typeof x === 'number' ? null : x; });
      if (dilek) b.push(r.t === 'P' && r.mn != null ? Math.round(r.mn * (sh.get(r.id) || 0) * 1000) / 1000 : null);
      out.push(b); urov.push(R.lv[i]);
    }
    ulozExcel('Poptávka – ' + (popisFiltru() || R.rec.nazev).slice(0, 80), [{n: 'Poptávka', rows: out, urov, sirky: R.cols.map(c => Math.round(c.w / 7)).concat(dilek ? [14] : [])}]);
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
    udajeDodavatele: hotovo => { if (!H) return; styl(); udajeDodavatele(hotovo); },
    pripoj(h) { H = h; setTimeout(() => { verzeSkriptu().then(() => prekresli()); obnovZPocitace().then(dokoncitNahrani); }, 2500); },
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
