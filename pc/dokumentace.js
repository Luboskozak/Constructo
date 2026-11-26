/* Constructo – Dokumentace: projektová dokumentace (složky, soubory, výkresy PDF/DWG) a prohlížeč výkresů
   se zvětšením, kreslením (tužka, kolečko, šipka, text) a výřezem, který jde zkopírovat, uložit nebo poslat ve zprávě.
   Používá Management (/pc/, záložka Dokumentace) i Deník (/dokumentace/ uvnitř Deníku). Data = D.dokumenty (synchronizace
   jako ostatní data), soubory na Disku Google ve složce „Constructo – dokumentace“ (skript Google od verze 13: akce dok_*),
   kopie otevřených souborů v prohlížeči (IndexedDB), aby se velké výkresy podruhé otevřely hned. */
(() => {
  'use strict';
  const BASE = '/dokumentace/';
  const KUS = 5 * 1024 * 1024;               // velikost dílu při nahrávání/stahování přes skript Google (násobek 256 KiB)
  const SKRIPT_MIN = 13;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const pripona = n => { const m = /\.([a-z0-9]{1,6})$/i.exec(n || ''); return m ? m[1].toLowerCase() : ''; };
  const velTxt = b => !b && b !== 0 ? '' : b < 1024 ? b + ' B' : b < 1048576 ? Math.round(b / 1024) + ' kB' : b < 1073741824 ? (b / 1048576).toFixed(b < 10485760 ? 1 : 0).replace('.', ',') + ' MB' : (b / 1073741824).toFixed(2).replace('.', ',') + ' GB';
  const datTxt = s => { if (!s) return ''; const d = new Date(s); return isNaN(d) ? '' : d.toLocaleDateString('cs-CZ', {day: 'numeric', month: 'numeric', year: 'numeric'}); };
  const cmp = (a, b) => String(a).localeCompare(String(b), 'cs', {numeric: true, sensitivity: 'base'});
  const bezDia = s => String(s || '').normalize('NFD').replace(/[̀-ͯˇ˘´˚¨]/g, '').toLowerCase();
  const druh = n => { const p = pripona(n); return p === 'pdf' ? 'pdf' : p === 'dwg' ? 'dwg' : p === 'dxf' ? 'dxf' : /^(jpe?g|png|gif|webp|bmp)$/.test(p) ? 'obr' : /^(docx?|odt|rtf|txt)$/.test(p) ? 'text' : /^(xlsx?|ods|csv)$/.test(p) ? 'tab' : /^(zip|rar|7z)$/.test(p) ? 'zip' : 'jiny'; };
  const IKONA = {slozka: '📁', pdf: 'PDF', dwg: 'DWG', dxf: 'DXF', obr: 'IMG', text: 'DOC', tab: 'XLS', zip: 'ZIP', jiny: '…'};
  const dotyk = () => matchMedia('(pointer:coarse)').matches;
  const bezPripony = n => String(n || '').replace(/\.(pdf|dwg|dxf|jpe?g|png|gif|webp|bmp)$/i, '');
  const pam = k => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
  const pamSet = (k, v) => { try { localStorage.setItem(k, String(v)); } catch (e) {} };
  const lzeOtevrit = n => ['pdf', 'dwg', 'dxf', 'obr'].includes(druh(n));

  /* ---------- styl ---------- */
  const CSS = `
.dk{display:flex;flex-direction:column;gap:10px;position:relative}
.dk-top{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.dk-top .sp{flex:1}
.dk-cesta{display:flex;flex-wrap:wrap;gap:2px;align-items:center;font-size:15px;font-weight:700;min-height:36px}
.dk-cesta button{border:0;background:none;font:inherit;padding:4px 6px;border-radius:6px;cursor:pointer;color:var(--ink)}
.dk-cesta button:hover{background:var(--soft)}.dk-cesta .sep{color:var(--muted);font-weight:400}
.dk-cesta button:last-child{background:var(--accent,#F4D23C);color:#16191c}
.dk-q{font:inherit;font-size:14px;border:1px solid var(--line);border-radius:10px;padding:8px 11px;min-width:220px;background:var(--panel);color:var(--ink)}
.dk-btn{display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:14px;font-weight:700;border:1px solid var(--line);border-radius:10px;padding:8px 13px;background:var(--panel);color:var(--ink);cursor:pointer;white-space:nowrap}
.dk-btn:hover{border-color:#16191c}.dk-btn.hl{background:#16191c;color:#fff;border-color:#16191c}.dk-btn.hl b{background:#F4D23C;color:#16191c;border-radius:5px;width:20px;height:20px;display:inline-grid;place-items:center}
.dk-btn.zl{background:#F4D23C;border-color:#F4D23C;color:#16191c}.dk-btn[disabled]{opacity:.45;cursor:default}
.dk-btn.mini{font-size:12.5px;padding:5px 9px;font-weight:600}
.dk-drop{border:2px dashed var(--line);border-radius:14px;padding:14px;text-align:center;color:var(--muted);font-size:13.5px;background:var(--panel)}
.dk.tahne .dk-drop{border-color:#16191c;background:#FFF8D6;color:#16191c}
.dk-tahne-pl{display:none;position:absolute;inset:0;z-index:5;border:3px dashed #16191c;border-radius:16px;background:rgba(244,210,60,.25);place-items:center;font-size:20px;font-weight:800;color:#16191c;pointer-events:none}
.dk.tahne .dk-tahne-pl{display:grid}
.dk-list{border:1px solid var(--line);border-radius:14px;background:var(--panel);overflow:hidden}
.dk-hd,.dk-row{display:grid;grid-template-columns:44px minmax(0,1fr) 96px 150px 96px 150px;gap:10px;align-items:center;padding:7px 12px}
.dk-hd{font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--line);font-weight:700}
.dk-hd button{border:0;background:none;font:inherit;color:inherit;letter-spacing:inherit;text-transform:inherit;cursor:pointer;padding:0;text-align:left}
.dk-row{border-bottom:1px solid var(--line);font-size:14px;cursor:pointer}.dk-row:last-child{border-bottom:0}
.dk-row:hover{background:var(--soft)}
.dk-ik{width:38px;height:30px;border-radius:7px;display:grid;place-items:center;font-size:10.5px;font-weight:800;letter-spacing:.02em;background:#eceae3;color:#16191c}
.dk-ik.slozka{background:none;font-size:24px}.dk-ik.pdf{background:#e34b3f;color:#fff}.dk-ik.dwg,.dk-ik.dxf{background:#2f6fb5;color:#fff}.dk-ik.obr{background:#6aa84f;color:#fff}.dk-ik.tab{background:#1f7a46;color:#fff}.dk-ik.text{background:#3b5da8;color:#fff}
.dk-n b{display:block;font-weight:600;word-break:break-word}.dk-n small{display:block;color:var(--muted);font-size:12px}
.dk-m{font-size:12.5px;color:var(--muted)}
.dk-a{display:flex;gap:4px;justify-content:flex-end}
.dk-a button{border:1px solid transparent;background:none;border-radius:7px;padding:4px 7px;cursor:pointer;font-size:14px;color:var(--ink)}
.dk-a button:hover{border-color:var(--line);background:var(--panel)}
.dk-row.ceka{opacity:.65;cursor:default}
.dk-empty{padding:34px 16px;text-align:center;color:var(--muted)}.dk-empty b{display:block;color:var(--ink);font-size:16px;margin-bottom:4px}
.dk-fronta{position:fixed;right:18px;bottom:18px;z-index:1500;width:min(400px,calc(100vw - 36px));background:#16191c;color:#fff;border-radius:14px;padding:12px 14px;box-shadow:0 10px 30px rgba(0,0,0,.3);font-size:13.5px}
.dk-fronta b{display:block;font-size:14px;margin-bottom:6px}.dk-fronta .bar{height:6px;border-radius:3px;background:#3a3f45;overflow:hidden;margin:6px 0}
.dk-fronta .bar i{display:block;height:100%;background:#F4D23C;width:0;transition:width .3s}.dk-fronta small{color:#c9c9c9;display:block}
.dk-fronta button{background:none;border:1px solid #555;color:#fff;border-radius:8px;padding:3px 9px;font:inherit;font-size:12.5px;cursor:pointer;margin-top:6px}
.dk-info{font-size:13px;color:#7a5600;background:#FFF4BF;border:1px solid #f0d36a;border-radius:10px;padding:8px 12px}
@media (max-width:900px){.dk-hd{display:none}.dk-row{grid-template-columns:44px minmax(0,1fr) auto}.dk-row .dk-m{display:none}}
/* prohlížeč */
.dkv{position:fixed;inset:0;z-index:3000;background:#2a2d31;display:grid;grid-template-rows:auto minmax(0,1fr);grid-template-columns:78px minmax(0,1fr);font-family:inherit;color:#16191c}
.dkv-r1,.dkv-r2{display:contents}
.dkv-nas{grid-column:1;grid-row:2;background:#16191c;border-top:1px solid #2a2d31;overflow-y:auto;overflow-x:hidden;display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 4px 14px;scrollbar-width:thin}
.dkv-stage{grid-column:2;grid-row:2}
.dkv-t{width:68px;min-height:45px;flex:none;border-radius:10px;border:1px solid transparent;background:none;color:#e9ebed;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;font:inherit;font-size:10.5px;font-weight:600;line-height:1.1;cursor:pointer;padding:4px 2px;text-align:center}
.dkv-t svg{width:21px;height:21px;stroke:currentColor;fill:none;stroke-width:2.1;stroke-linecap:round;stroke-linejoin:round}
.dkv-t:hover{background:#24282d}.dkv-t[aria-pressed=true]{background:#F4D23C;color:#16191c}
.dkv-nas hr{width:56px;border:0;border-top:1px solid #3a3f45;margin:5px 0;flex:none}
.dkv-bv{display:grid;grid-template-columns:repeat(3,20px);gap:4px;padding:3px 0;flex:none}.dkv-bv .dkv-barva{width:20px;height:20px}
.dkv-tl{display:flex;gap:3px;flex:none;margin-top:3px}
.dkv-tl button{width:20px;height:26px;border-radius:7px;border:1px solid #3a3f45;background:#24282d;display:grid;place-items:center;cursor:pointer;padding:0}
.dkv-tl button i{display:block;width:4px;background:#fff;border-radius:3px}
.dkv-tl button[aria-pressed=true]{border-color:#F4D23C;box-shadow:0 0 0 1px #F4D23C}
.dkv-menu{position:fixed;z-index:3080;background:#fff;border-radius:12px;box-shadow:0 10px 34px rgba(0,0,0,.4);padding:6px;display:flex;flex-direction:column;gap:2px;min-width:190px;max-height:70vh;overflow:auto}
.dkv-menu button{border:0;background:none;text-align:left;padding:9px 12px;border-radius:8px;font:inherit;font-size:14.5px;font-weight:600;cursor:pointer;color:#16191c;display:flex;align-items:center;gap:9px}
.dkv-menu button:hover,.dkv-menu button[aria-pressed=true]{background:#f4f1e2}
.dkv-menu small{color:#666;font-size:12px;padding:6px 12px 4px}
.dkv-menu .rz{display:inline-block;border:2.5px solid currentColor;border-radius:6px;padding:1px 7px;font-weight:800;font-size:13px}
.dkv-dlg{position:fixed;inset:0;z-index:3110;background:rgba(0,0,0,.5);display:grid;place-items:center;padding:16px}
.dkv-dlg .bx{background:#fff;border-radius:16px;padding:18px;width:min(420px,100%);display:flex;flex-direction:column;gap:12px;color:#16191c}
.dkv-dlg h3{margin:0;font-size:18px}.dkv-dlg p{margin:0;line-height:1.45;color:#333}
.dkv-dlg input{font:inherit;font-size:18px;padding:10px 12px;border:1px solid #bbb;border-radius:10px;width:100%;box-sizing:border-box}
.dkv-dlg .ak{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
.dkv-bar{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:8px 10px;background:#16191c;color:#fff}
.dkv-bar .nm{font-weight:700;font-size:14.5px;line-height:1.25;max-width:34vw;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;margin:0 6px;word-break:break-word}
.dkv-bar .sp{flex:1}
.dkv-b{display:inline-flex;align-items:center;justify-content:center;gap:5px;min-width:38px;height:38px;padding:0 10px;border-radius:9px;border:1px solid #3a3f45;background:#24282d;color:#fff;font:inherit;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap}
.dkv-b:hover{border-color:#8a8f96}.dkv-b[aria-pressed=true]{background:#F4D23C;border-color:#F4D23C;color:#16191c}
.dkv-b.zl{background:#F4D23C;border-color:#F4D23C;color:#16191c}.dkv-b[disabled]{opacity:.4;cursor:default}
.dkv-b svg{width:19px;height:19px;stroke:currentColor;fill:none;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.dkv-g{display:flex;gap:4px;align-items:center;padding:0 6px;border-left:1px solid #3a3f45}
.dkv-bar .zoom{min-width:56px;text-align:center;font-size:13px;font-variant-numeric:tabular-nums}
.dkv-barva{width:24px;height:24px;border-radius:50%;border:2px solid #16191c;box-shadow:0 0 0 2px #3a3f45;cursor:pointer;padding:0}
.dkv-barva[aria-pressed=true]{box-shadow:0 0 0 2px #fff}
.dkv-stage{position:relative;overflow:hidden;background:#5b5f64;touch-action:none;user-select:none;-webkit-user-select:none;min-height:0}
.dkv-stage canvas,.dkv-stage svg.ann{position:absolute;left:0;top:0;transform-origin:0 0}
.dkv-stage canvas.zakl{background:#fff;box-shadow:0 4px 24px rgba(0,0,0,.35);image-rendering:auto}
.dkv-stage .vyb{position:absolute;border:2px dashed #F4D23C;background:rgba(244,210,60,.15);pointer-events:none;display:none;box-shadow:0 0 0 9999px rgba(0,0,0,.25)}
.dkv-stage[data-n=posun]{cursor:grab}.dkv-stage[data-n=posun].drz{cursor:grabbing}.dkv-stage.nad{cursor:move!important}.dkv-stage.rotk{cursor:alias!important}.dkv-stage.tah{cursor:grabbing!important}
.dkv-stage:not([data-n=posun]):not([data-n=text]){cursor:crosshair}.dkv-stage[data-n=text]{cursor:text}.dkv-stage[data-n=guma]{cursor:cell}.dkv-stage[data-n=razitko]{cursor:copy}
.dkv-msg{position:absolute;inset:0;display:grid;place-items:center;color:#fff;font-size:16px;text-align:center;padding:20px}
.dkv-msg .bx{background:#16191c;border-radius:14px;padding:20px 24px;max-width:520px;line-height:1.5}
.dkv-msg .bar{height:8px;border-radius:4px;background:#3a3f45;overflow:hidden;margin-top:12px}.dkv-msg .bar i{display:block;height:100%;background:#F4D23C;width:0}
.dkv-hint{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);background:rgba(22,25,28,.9);color:#fff;border-radius:10px;padding:7px 13px;font-size:13px;pointer-events:none;white-space:nowrap;max-width:calc(100% - 20px);overflow:hidden;text-overflow:ellipsis}
.dkv-txt{position:absolute;z-index:3;font:inherit;font-size:16px;padding:4px 7px;border:2px solid #F4D23C;border-radius:6px;min-width:160px;background:#fff}
.dkv-out{position:fixed;inset:0;z-index:3100;background:rgba(0,0,0,.55);display:grid;place-items:center;padding:16px}
.dkv-out .bx{background:#fff;border-radius:16px;padding:16px;max-width:min(920px,100%);max-height:calc(100vh - 32px);display:flex;flex-direction:column;gap:12px;color:#16191c}
.dkv-out h3{margin:0;font-size:18px}.dkv-out img{max-width:100%;max-height:calc(100vh - 230px);object-fit:contain;border:1px solid #ddd;border-radius:8px;align-self:center;background:#fff}
.dkv-out .ak{display:flex;flex-wrap:wrap;gap:8px}.dkv-out .ak .dk-btn{font-size:14.5px}
.dkv-out small{color:#666}
.dk-kop{background:#e6f4ea;color:#11602b;border:1px solid #b9dfc4;border-radius:10px;padding:9px 12px;font-size:14px;line-height:1.4}
.dk-kop.blik{animation:dkblik .9s}@keyframes dkblik{0%{background:#b6e4c3}100%{background:#e6f4ea}}
.dk-btn.ok{background:#11873a!important;color:#fff!important;border-color:#11873a!important}
@media (max-width:900px){
.dkv{grid-template-columns:minmax(0,1fr);grid-template-rows:auto minmax(0,1fr) auto}
.dkv-stage{grid-column:1;grid-row:2}
.dkv-nas{grid-column:1;grid-row:3;flex-direction:row;overflow-x:auto;overflow-y:hidden;border-top:1px solid #3a3f45;padding:5px 6px calc(6px + env(safe-area-inset-bottom,0px));-webkit-overflow-scrolling:touch;scrollbar-width:none}
.dkv-nas::-webkit-scrollbar{display:none}
.dkv-t{width:58px;min-height:50px}.dkv-nas hr{width:0;height:40px;border-top:0;border-left:1px solid #3a3f45;margin:0 4px}
.dkv-bv{grid-template-columns:repeat(5,24px);align-self:center;padding:0 4px}.dkv-tl{flex-direction:row;align-self:center}.dkv-tl button{width:30px;height:36px}.dkv-tl button i{width:5px}.dkv-bv .dkv-barva{width:24px;height:24px}
.dkv-bar{display:flex;flex-direction:column;flex-wrap:nowrap;align-items:stretch;gap:6px;padding:6px 8px;padding-top:max(6px,env(safe-area-inset-top,0px));min-width:0}
.dkv-r1{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-width:0}.dkv-r1 .nm{order:5;flex-basis:100%;min-width:0;max-width:none;font-size:14px;margin:0 2px}.dkv-r1 .dkv-g{margin-left:auto;padding:0;border:0}.dkv-r1 .dkv-b{padding:0 9px}
.dkv-r2{display:flex;align-items:center;gap:4px;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;padding-bottom:2px}
.dkv-r2::-webkit-scrollbar{display:none}.dkv-r2 .sp{display:none}.dkv-r2>*{flex:none}
.dkv-g{padding:0 4px}.dkv-b{min-width:40px;height:40px}.dkv-tisk{display:none}}
`;
  function styl() { if (document.getElementById('dk-styl')) return; const s = document.createElement('style'); s.id = 'dk-styl'; s.textContent = CSS; document.head.appendChild(s); }

  /* ---------- úložiště souborů v prohlížeči (IndexedDB) ---------- */
  let dbP = null;
  function idb() {
    if (dbP) return dbP;
    dbP = new Promise((res, rej) => {
      try {
        const r = indexedDB.open('cx-dokumentace', 1);
        r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains('soubory')) d.createObjectStore('soubory'); if (!d.objectStoreNames.contains('fronta')) d.createObjectStore('fronta'); };
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      } catch (e) { rej(e); }
    });
    dbP.catch(() => { dbP = null; });
    return dbP;
  }
  async function idbOp(st, mode, fn) {
    const d = await idb();
    return new Promise((res, rej) => { const t = d.transaction(st, mode), s = t.objectStore(st); const r = fn(s); t.oncomplete = () => res(r && 'result' in r ? r.result : undefined); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
  }
  const cacheGet = k => idbOp('soubory', 'readonly', s => s.get(k)).then(x => x || null).catch(() => null);
  const cachePut = (k, blob) => idbOp('soubory', 'readwrite', s => s.put({blob, kdy: Date.now(), vel: blob.size}, k)).then(() => uklidCache()).catch(() => {});
  const cacheDel = k => idbOp('soubory', 'readwrite', s => s.delete(k)).catch(() => {});
  let uklidT = 0;
  async function uklidCache() {   // drží nejvýš ~1,5 GB naposledy otevřených souborů (místní soubory bez Disku se nemažou)
    if (Date.now() - uklidT < 60000) return; uklidT = Date.now();
    try {
      const d = await idb(), vse = [];
      await new Promise(res => { const c = d.transaction('soubory').objectStore('soubory').openCursor(); c.onsuccess = () => { const x = c.result; if (!x) return res(); vse.push({k: x.key, kdy: x.value.kdy, vel: x.value.vel || 0}); x.continue(); }; c.onerror = () => res(); });
      let sum = vse.reduce((a, x) => a + x.vel, 0);
      vse.filter(x => !String(x.k).startsWith('mistni:')).sort((a, b) => a.kdy - b.kdy).forEach(x => { if (sum > 1.5e9) { sum -= x.vel; cacheDel(x.k); } });
    } catch (e) {}
  }
  const frontaVse = () => idb().then(d => new Promise(res => { const out = []; const c = d.transaction('fronta').objectStore('fronta').openCursor(); c.onsuccess = () => { const x = c.result; if (!x) return res(out); out.push(x.value); x.continue(); }; c.onerror = () => res(out); })).catch(() => []);
  const frontaPut = q => idbOp('fronta', 'readwrite', s => s.put(q, q.qid));
  const frontaDel = qid => idbOp('fronta', 'readwrite', s => s.delete(qid)).catch(() => {});

  const b64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
  const z64 = s => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };

  /* ---------- stav modulu ---------- */
  let H = null, EL = null;
  const S = {slozka: '', q: '', raz: 'nazev', smer: 1, fronta: [], bezi: false, verze: 0, verzeT: 0, chyba: '', skript: '', hotovo: 0, aktT: 0, aktDuvod: ''};
  const seznam = () => (H && H.seznam() || []).filter(r => r && r.id && !/^(rz|st|sp)~/.test(String(r.id)));   // rz~ = rozpočty přenášené přes dokumenty, st~/sp~ = seznam staveb
  const najdi = id => seznam().find(r => r.id === id);
  const deti = id => seznam().filter(r => (r.rodic || '') === (id || ''));
  const cestaZaznamu = id => { const out = []; let r = najdi(id), n = 0; while (r && n++ < 50) { out.unshift(r); r = r.rodic ? najdi(r.rodic) : null; } return out; };
  function potomci(id) { const out = [], fr = [id]; while (fr.length) { const x = fr.shift(); deti(x).forEach(r => { out.push(r); if (r.typ === 'slozka') fr.push(r.id); }); } return out; }
  const kdo = () => (H && H.kdo && H.kdo()) || '';
  const toast = m => H && H.toast ? H.toast(m) : console.log(m);
  const ro = () => !!(H && H.ro && H.ro());

  function ulozZaznamy(recs) { if (!recs.length) return; H.upsert(recs.map(r => Object.assign({}, r))); }
  function zalozSlozku(nazev, rodic) {
    nazev = String(nazev || '').trim().slice(0, 200); if (!nazev) return null;
    const ex = deti(rodic).find(r => r.typ === 'slozka' && bezDia(r.nazev) === bezDia(nazev));
    if (ex) return ex;
    const r = {id: 'dk' + uid(), typ: 'slozka', nazev, rodic: rodic || '', kdo: kdo(), kdy: new Date().toISOString()};
    ulozZaznamy([r]);
    return najdi(r.id) || r;
  }

  /* ---------- skript Google ---------- */
  async function verzeSkriptu() {
    if (!H.pripojeno()) return 0;
    if (S.verze >= SKRIPT_MIN || Date.now() - S.verzeT < 120000) return S.verze;
    S.verzeT = Date.now();
    try { const r = await H.volej({akce: 'verze'}); S.verze = Number(r && r.verze) || 0; } catch (e) {}
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

  /* ---------- nahrávání (fronta v prohlížeči, přežije zavření okna) ---------- */
  async function pridejDoFronty(polozky) {   // polozky: [{file, rodic, nahradit}]
    if (ro()) { toast('Jen prohlížení: nahrávat nejde.'); return; }
    for (const p of polozky) {
      const q = {qid: 'q' + uid(), nazev: p.file.name, vel: p.file.size, mime: p.file.type || '', rodic: p.rodic || '', nahradit: p.nahradit || '', blob: p.file, kdo: kdo(), kdy: new Date().toISOString(), hotovo: 0, up: '', chyba: ''};
      try { await frontaPut(q); } catch (e) { q.jenPamet = true; }
      S.fronta.push(q);
    }
    prekresli(); zpracujFrontu();
  }
  // 4.53: nahrává se 3 soubory najednou; malé soubory jedním voláním (dok_maly). Dokud skript Google není ve verzi 13,
  // nahrávají se soubory do 20 MB přes starou akci „foto“ (umí ji i skript 12) a Management mezitím skript sám aktualizuje.
  const SOUBEH = 3, MALY = 6 * 1024 * 1024, FOTO_MAX = 20 * 1024 * 1024;
  const spi = ms => new Promise(res => setTimeout(res, ms));
  function dalsiVeFronte(rezim) {
    const t = Date.now();
    const q = S.fronta.find(x => !x.bezi && !(x.pauza > t) && !(rezim === 'foto' && x.vel > FOTO_MAX));
    if (q) q.bezi = true;
    return q || null;
  }
  async function nahrajJeden(q, rezim) {
    try {
      let gid = '', url = '';
      if (rezim === 'foto') {
        const r = await volejOk({akce: 'foto', name: q.qid + '-' + q.nazev, mime: q.mime || 'application/octet-stream', den: new Date().toISOString().slice(0, 10), data: await b64(q.blob)});
        gid = r.id; url = r.url; q.hotovo = q.vel;
      } else if (rezim === 'dok' && q.vel <= MALY && !q.up) {
        const cesta = q.rodic ? cestaZaznamu(q.rodic).map(r => r.nazev) : [];
        const r = await volejOk({akce: 'dok_maly', nazev: q.nazev, mime: q.mime || 'application/octet-stream', cesta, data: await b64(q.blob)});
        gid = r.id; url = r.url; q.hotovo = q.vel;
      } else if (rezim === 'dok') {
        if (!q.up) {
          const cesta = q.rodic ? cestaZaznamu(q.rodic).map(r => r.nazev) : [];
          const r = await volejOk({akce: 'dok_start', nazev: q.nazev, mime: q.mime || 'application/octet-stream', vel: q.vel, cesta});
          q.up = r.up; q.hotovo = 0; if (!q.jenPamet) frontaPut(q).catch(() => {});
        }
        if (q.vel === 0) { const r = await volejOk({akce: 'dok_cast', up: q.up, od: 0, celkem: 0, data: ''}); gid = r.id; url = r.url; }
        while (!gid) {
          const kus = q.blob.slice(q.hotovo, Math.min(q.vel, q.hotovo + KUS));
          const r = await volejOk({akce: 'dok_cast', up: q.up, od: q.hotovo, celkem: q.vel, data: await b64(kus)});
          if (r.restart) { q.up = ''; throw new Error('Nahrávání vypršelo, začínám znovu.'); }
          if (r.id) { gid = r.id; url = r.url; q.hotovo = q.vel; }
          else { q.hotovo = r.dalsi != null ? Number(r.dalsi) : q.hotovo + kus.size; }
          if (!q.jenPamet) frontaPut(q).catch(() => {});
          prekresliFrontu();
        }
      }
      // hotovo: záznam do dat (nebo nová verze stávajícího souboru)
      const zaklad = {nazev: q.nazev, vel: q.vel, mime: q.mime, kdo: q.kdo, kdy: new Date().toISOString(), gid, url};
      let rec;
      const st = q.nahradit && najdi(q.nahradit);
      if (st) {
        const starsi = (st.starsi || []).concat(st.gid || st.mistni ? [{gid: st.gid || '', url: st.url || '', kdo: st.kdo, kdy: st.kdy, vel: st.vel, verze: st.verze || 1}] : []).slice(-20);
        rec = Object.assign({}, st, zaklad, {verze: (st.verze || 1) + 1, starsi});
      } else rec = Object.assign({id: 'dk' + uid(), typ: 'soubor', rodic: q.rodic || ''}, zaklad);
      if (rezim === 'mistni') rec.mistni = H.zkouska ? 'zkouska' : 'pc';
      else delete rec.mistni;
      await cachePut(gid ? 'g:' + gid : 'mistni:' + rec.id, q.blob);
      ulozZaznamy([rec]);
      S.fronta = S.fronta.filter(x => x !== q); frontaDel(q.qid);
      S.hotovo++; S.chyba = '';
    } catch (e) {
      q.chyba = String(e && e.message || e); q.pauza = Date.now() + 20000;
      S.chyba = 'Soubor ' + q.nazev + ': ' + q.chyba + ' Zkusím to znovu za chvíli.';
      if (/heslo/.test(q.chyba)) { S.chyba = 'Heslo synchronizace nesedí. Nahrávání je pozastavené.'; S.stop = true; }
      if (!q.jenPamet) frontaPut(Object.assign({}, q, {bezi: false})).catch(() => {});
    } finally { q.bezi = false; prekresliFrontu(); }
  }
  async function zpracujFrontu() {
    if (S.bezi || !H) return;
    S.bezi = true; S.stop = false;
    try {
      while (S.fronta.length && !S.stop) {
        let rezim = 'mistni';
        if (H.pripojeno() && !H.zkouska) {
          const v = await verzeSkriptu();
          if (v >= SKRIPT_MIN) { rezim = 'dok'; S.skript = ''; }
          else {
            rezim = 'foto';
            S.skript = 'Skript Google se aktualizuje na verzi ' + SKRIPT_MIN + '. Zatím nahrávám soubory do 20 MB náhradní cestou' + (S.aktDuvod ? ' (aktualizace zatím neprošla: ' + S.aktDuvod + ')' : '') + '.';
            if (H.aktualizujSkript && Date.now() - (S.aktT || 0) > 180000) {
              S.aktT = Date.now();
              H.aktualizujSkript().then(r => { if (r && r.ok) { S.verze = 0; S.verzeT = 0; S.aktDuvod = ''; } else if (r && r.duvod) S.aktDuvod = String(r.duvod).slice(0, 160); prekresliFrontu(); }).catch(() => {});
            }
          }
        }
        prekresliFrontu();
        const prace = async () => { for (;;) { if (S.stop) return; const q = dalsiVeFronte(rezim); if (!q) return; await nahrajJeden(q, rezim); if (rezim === 'foto' && Date.now() - S.verzeT > 120000) return; } };
        await Promise.all(Array.from({length: SOUBEH}, prace));
        if (S.fronta.length && !S.stop && !S.fronta.some(x => !(x.pauza > Date.now()) && !(rezim === 'foto' && x.vel > FOTO_MAX))) { await spi(rezim === 'foto' ? 30000 : 5000); S.verzeT = 0; }
      }
    } finally { S.bezi = false; prekresli(); }
  }
  function prekresliFrontu() {
    let el = document.getElementById('dk-fronta');
    if (!S.fronta.length) { if (el) el.remove(); S.hotovo = 0; return; }
    if (!el) { el = document.createElement('div'); el.id = 'dk-fronta'; el.className = 'dk-fronta'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    const bezi = S.fronta.filter(x => x.bezi), celk = S.fronta.reduce((a, x) => a + x.vel, 0), hot = S.fronta.reduce((a, x) => a + (x.hotovo || 0), 0);
    const n = S.fronta.length, pct = celk ? Math.round(hot / celk * 100) : 0;
    const vel = S.fronta.filter(x => x.vel > FOTO_MAX).length;
    el.innerHTML = `<b>Nahrávám dokumentaci · zbývá ${n} ${n === 1 ? 'soubor' : n < 5 ? 'soubory' : 'souborů'} (${velTxt(celk)})${S.hotovo ? ' · hotovo ' + S.hotovo : ''}</b>
      <small>${bezi.length ? bezi.map(q => esc(q.nazev)).join('<br>') : 'Připravuji…'}</small><div class="bar"><i style="width:${pct}%"></i></div>
      <small>${S.chyba ? esc(S.chyba) : S.skript ? esc(S.skript) + (vel ? ` ${vel} větších souborů počká na aktualizaci.` : '') : 'Okno nechte otevřené, můžete mezitím pracovat. Když ho zavřete, nahrávání pokračuje při dalším otevření.'}</small>`;
  }
  /* ---------- stažení souboru (z prohlížeče, nebo po dílech z Disku Google) ---------- */
  const klicCache = r => r.gid ? 'g:' + r.gid : 'mistni:' + r.id;
  async function nactiSoubor(r, prubeh) {
    const c = await cacheGet(klicCache(r));
    if (c && c.blob) return c.blob;
    if (!r.gid) throw new Error(r.mistni === 'zkouska' ? 'Soubor je jen ve zkušební verzi na počítači, kde se nahrál.' : 'Soubor se ještě nenahrál na Disk Google (je jen v počítači, odkud ho nahrál ' + (r.kdo || 'kolega') + ').');
    if (!H.pripojeno()) throw new Error('Pro otevření je potřeba připojení ke Googlu (Data → Automatická synchronizace).');
    const prvni = await volejOk({akce: 'dok_cti', id: r.gid, od: 0, do: KUS - 1});
    const celkem = Number(prvni.celkem) || r.vel || 0;
    const dily = [z64(prvni.data || '')];
    let mam = dily[0].length; prubeh && prubeh(mam, celkem);
    const zbyva = [];
    for (let od = mam; od < celkem; od += KUS) zbyva.push(od);
    const vysl = new Array(zbyva.length);
    let i = 0;
    const pracovnik = async () => { while (i < zbyva.length) { const k = i++, od = zbyva[k]; const x = await volejOk({akce: 'dok_cti', id: r.gid, od, do: Math.min(celkem, od + KUS) - 1}); vysl[k] = z64(x.data || ''); mam += vysl[k].length; prubeh && prubeh(mam, celkem); } };
    await Promise.all([pracovnik(), pracovnik(), pracovnik()]);
    const blob = new Blob(dily.concat(vysl), {type: r.mime || ''});
    cachePut(klicCache(r), blob);
    return blob;
  }
  async function stahnout(r) {
    toast('Připravuji ' + r.nazev + '…');
    try { const b = await nactiSoubor(r); const u = URL.createObjectURL(b), a = document.createElement('a'); a.href = u; a.download = r.nazev; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 60000); }
    catch (e) { if (r.url) window.open(r.url, '_blank', 'noopener'); else toast(e.message); }
  }

  /* ---------- výběr souborů a složek (tlačítka i přetažení) ---------- */
  function vyberSoubory(slozky) {
    const i = document.createElement('input'); i.type = 'file'; i.multiple = true;
    if (slozky) { i.webkitdirectory = true; i.setAttribute('webkitdirectory', ''); i.setAttribute('directory', ''); }
    i.style.display = 'none'; document.body.appendChild(i);   // Safari a některé prohlížeče chtějí pole v dokumentu
    i.onchange = () => { const f = [...i.files].map(file => ({file, cesta: slozky ? (file.webkitRelativePath || file.name).split('/').slice(0, -1) : []})); i.remove(); prijmi(f); };
    i.click();
  }
  async function zPretazeni(dt) {
    const out = [];
    const items = [...(dt.items || [])].filter(x => x.kind === 'file');
    const entries = items.map(x => x.webkitGetAsEntry ? x.webkitGetAsEntry() : null);
    if (!entries.some(Boolean)) return [...(dt.files || [])].map(file => ({file, cesta: []}));
    const soubor = en => new Promise((res, rej) => en.file(res, rej));
    const cti = rd => new Promise((res, rej) => rd.readEntries(res, rej));
    async function projdi(en, cesta) {
      if (!en) return;
      if (en.isFile) { try { out.push({file: await soubor(en), cesta}); } catch (e) {} return; }
      if (en.isDirectory) {
        const rd = en.createReader(); let davka;
        do { davka = await cti(rd); for (const x of davka) await projdi(x, cesta.concat(en.name)); } while (davka.length);
      }
    }
    for (const en of entries) await projdi(en, []);
    return out;
  }
  async function prijmi(seznamSouboru) {
    const f = seznamSouboru.filter(x => x.file && !/^(\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(x.file.name) && !x.file.name.startsWith('~$'));
    if (!f.length) return;
    if (ro()) { toast('Jen prohlížení: nahrávat nejde.'); return; }
    // podsložky založit hned (stejná struktura jako na disku)
    const mapa = new Map();
    const slozkaPro = cesta => { let rod = S.slozka; let k = ''; for (const n of cesta) { k += '/' + n; if (!mapa.has(k)) { const s = zalozSlozku(n, rod); mapa.set(k, s ? s.id : rod); } rod = mapa.get(k); } return rod; };
    const polozky = f.map(x => ({file: x.file, rodic: slozkaPro(x.cesta)}));
    const dup = polozky.filter(p => deti(p.rodic).some(r => r.typ === 'soubor' && r.nazev === p.file.name) || S.fronta.some(q => q.rodic === p.rodic && q.nazev === p.file.name));
    const celk = polozky.reduce((a, p) => a + p.file.size, 0);
    const pokracuj = rezim => {
      const vyb = polozky.filter(p => {
        const st = deti(p.rodic).find(r => r.typ === 'soubor' && r.nazev === p.file.name);
        if (!st) return !S.fronta.some(q => q.rodic === p.rodic && q.nazev === p.file.name);
        if (rezim === 'preskocit') return false;
        p.nahradit = st.id; return true;
      });
      if (!vyb.length) { toast('Nic nového k nahrání.'); prekresli(); return; }
      pridejDoFronty(vyb);
      toast(`Nahrávám ${vyb.length} ${vyb.length === 1 ? 'soubor' : vyb.length < 5 ? 'soubory' : 'souborů'} (${velTxt(vyb.reduce((a, p) => a + p.file.size, 0))}).`);
    };
    if (dup.length) {
      dialog('Některé soubory už v Dokumentaci jsou', `<p>${dup.length} ${dup.length === 1 ? 'soubor se stejným názvem už ve složce je' : 'souborů se stejným názvem už ve složkách je'}${dup.length <= 6 ? ': <b>' + dup.map(p => esc(p.file.name)).join(', ') + '</b>' : ''}.</p><p><b>Nahradit novou verzí</b> = otevře se nový soubor, předchozí verze zůstanou uložené u souboru.</p>`,
        [['Nahradit novou verzí', () => pokracuj('nahradit'), 'hl'], ['Přeskočit stejné', () => pokracuj('preskocit')], ['Zrušit', () => prekresli()]]);
    } else pokracuj('');
    prekresli();
    if (celk > 2e9) toast('Pozor, je to hodně dat (' + velTxt(celk) + '). Nahrávání potrvá déle.');
  }

  /* ---------- jednoduché dialogy ---------- */
  function dialog(nadpis, html, tlac) {
    const o = document.createElement('div'); o.className = 'dkv-out';
    o.innerHTML = `<div class="bx" role="dialog" aria-modal="true"><h3>${esc(nadpis)}</h3><div>${html}</div><div class="ak">${tlac.map((t, i) => `<button type="button" class="dk-btn ${t[2] || ''}" data-i="${i}">${esc(t[0])}</button>`).join('')}</div></div>`;
    document.body.appendChild(o);
    o.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { const t = tlac[Number(b.dataset.i)]; if (t[1] && t[1](o) === 'keep') return; o.remove(); });
    o.onclick = e => { if (e.target === o) o.remove(); };
    const inp = o.querySelector('input'); if (inp) { inp.focus(); inp.select(); inp.onkeydown = e => { if (e.key === 'Enter') o.querySelector('[data-i="0"]').click(); }; }
    return o;
  }
  function zadejText(nadpis, popis, hodnota, ok) {
    dialog(nadpis, `<label style="display:block;font-size:13px;margin-bottom:6px">${esc(popis)}</label><input class="dk-q" style="width:100%;min-width:300px" value="${esc(hodnota || '')}">`,
      [['Uložit', o => { const v = o.querySelector('input').value.trim(); if (!v) return 'keep'; ok(v); }, 'hl'], ['Zrušit', null]]);
  }

  /* ---------- seznam ---------- */
  function prekresli() { if (EL && EL.isConnected) vykresli(); prekresliFrontu(); }
  function vykresli() {
    styl();
    if (S.slozka && !najdi(S.slozka)) S.slozka = '';
    const vse = seznam(), q = bezDia(S.q.trim());
    let polozky;
    if (q) polozky = vse.filter(r => bezDia(r.nazev).includes(q));
    else polozky = deti(S.slozka);
    const raz = (a, b) => (a.typ === b.typ ? 0 : a.typ === 'slozka' ? -1 : 1) || S.smer * (S.raz === 'vel' ? (a.vel || 0) - (b.vel || 0) : S.raz === 'kdy' ? String(a.kdy || '').localeCompare(String(b.kdy || '')) : cmp(a.nazev, b.nazev));
    polozky = polozky.slice().sort(raz);
    const cekaji = q ? [] : S.fronta.filter(x => x.rodic === S.slozka && !x.nahradit);
    const cesta = cestaZaznamu(S.slozka);
    const pocet = id => { const p = potomci(id).filter(r => r.typ === 'soubor'); return p.length; };
    const pripoj = H.pripojeno(), ri = ro();
    const zk = H.zkouska ? '<div class="dk-info">Zkušební verze: soubory se ukládají jen v tomto prohlížeči (na Disk Google se nic neposílá). Vyzkoušejte nahrání, složky i prohlížeč výkresů.</div>'
      : !pripoj ? '<div class="dk-info">Tento počítač není připojený ke sdíleným datům. Soubory se uloží jen v tomto prohlížeči. Připojení: Data → Automatická synchronizace.</div>' : '';
    const sipka = k => S.raz === k ? (S.smer > 0 ? ' ▲' : ' ▼') : '';
    EL.innerHTML = `<div class="dk">
      <div class="dk-tahne-pl">Pusťte soubory nebo složky sem</div>
      <div class="dk-top">
        <div class="dk-cesta" aria-label="Složka"><button type="button" data-cesta="">Dokumentace</button>${cesta.map(r => `<span class="sep">›</span><button type="button" data-cesta="${esc(r.id)}">${esc(r.nazev)}</button>`).join('')}</div>
        <span class="sp"></span>
        <input class="dk-q" type="search" placeholder="Hledat v celé dokumentaci" value="${esc(S.q)}" aria-label="Hledat v dokumentaci">
        ${ri ? '' : `<button type="button" class="dk-btn" data-a="slozka">+ Nová složka</button>
        <button type="button" class="dk-btn" data-a="nahratSlozku" title="Nahraje celou složku i s podsložkami">+ Nahrát složku</button>
        <button type="button" class="dk-btn hl" data-a="nahrat"><b>+</b> Nahrát soubory</button>`}
      </div>
      ${zk}
      ${ri ? '' : '<div class="dk-drop">Soubory i celé složky (s podsložkami) sem můžete <b>přetáhnout myší</b> z počítače, nebo použijte tlačítka <b>+ Nahrát</b>. Velké PDF a DWG nevadí.</div>'}
      <div class="dk-list" role="table">
        <div class="dk-hd" role="row"><span></span><button type="button" data-raz="nazev">Název${sipka('nazev')}</button><button type="button" data-raz="vel">Velikost${sipka('vel')}</button><span>Nahrál</span><button type="button" data-raz="kdy">Datum${sipka('kdy')}</button><span></span></div>
        ${S.slozka && !q ? `<div class="dk-row" data-nahoru="1" role="row"><span class="dk-ik slozka">↩</span><div class="dk-n"><b>.. o úroveň výš</b></div><span></span><span></span><span></span><span></span></div>` : ''}
        ${polozky.map(r => {
          const d = r.typ === 'slozka' ? 'slozka' : druh(r.nazev), n = r.typ === 'slozka' ? pocet(r.id) : 0;
          const kde = q && r.rodic ? cestaZaznamu(r.rodic).map(x => x.nazev).join(' › ') : '';
          return `<div class="dk-row" role="row" data-id="${esc(r.id)}" title="${r.typ === 'slozka' ? 'Otevřít složku' : lzeOtevrit(r.nazev) ? 'Otevřít v prohlížeči výkresů' : 'Stáhnout'}">
            <span class="dk-ik ${d}">${IKONA[d]}</span>
            <div class="dk-n"><b>${esc(r.nazev)}</b>${r.typ === 'slozka' ? `<small>${n} ${n === 1 ? 'soubor' : n > 1 && n < 5 ? 'soubory' : 'souborů'}</small>` : ''}${kde ? `<small>${esc(kde)}</small>` : ''}${r.verze > 1 ? `<small>verze ${r.verze}</small>` : ''}${r.mistni && !H.zkouska ? '<small>jen v počítači, kde se nahrál</small>' : ''}</div>
            <span class="dk-m">${r.typ === 'slozka' ? '' : velTxt(r.vel)}</span><span class="dk-m">${esc(r.kdo || '')}</span><span class="dk-m">${datTxt(r.kdy)}</span>
            <span class="dk-a">${r.typ === 'soubor' ? `<button type="button" data-st="${esc(r.id)}" title="Stáhnout">⬇</button>` : ''}${ri ? '' : `<button type="button" data-pr="${esc(r.id)}" title="Přejmenovat">✎</button><button type="button" data-sm="${esc(r.id)}" title="Smazat">🗑</button>`}</span>
          </div>`;
        }).join('')}
        ${cekaji.map(x => `<div class="dk-row ceka" role="row"><span class="dk-ik ${druh(x.nazev)}">${IKONA[druh(x.nazev)]}</span><div class="dk-n"><b>${esc(x.nazev)}</b><small>nahrává se…</small></div><span class="dk-m">${velTxt(x.vel)}</span><span class="dk-m">${esc(x.kdo || '')}</span><span></span><span></span></div>`).join('')}
        ${!polozky.length && !cekaji.length ? `<div class="dk-empty">${q ? '<b>Nic nenalezeno</b>Zkuste jiné slovo.' : S.slozka ? '<b>Složka je prázdná</b>Přetáhněte sem soubory nebo klikněte na + Nahrát soubory.' : '<b>Zatím žádná dokumentace</b>Přetáhněte sem složku s projektovou dokumentací (třeba celou „DPS“ i s podsložkami), nebo klikněte na + Nahrát.'}</div>` : ''}
      </div>
    </div>`;
    EL.querySelectorAll('[data-cesta]').forEach(b => b.onclick = () => { S.slozka = b.dataset.cesta; S.q = ''; vykresli(); });
    const qi = EL.querySelector('.dk-q'); qi.oninput = () => { S.q = qi.value; const pos = qi.selectionStart; vykresli(); const n = EL.querySelector('.dk-q'); n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} };
    EL.querySelectorAll('[data-raz]').forEach(b => b.onclick = () => { if (S.raz === b.dataset.raz) S.smer = -S.smer; else { S.raz = b.dataset.raz; S.smer = b.dataset.raz === 'nazev' ? 1 : -1; } vykresli(); });
    EL.querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
      const a = b.dataset.a;
      if (a === 'nahrat') vyberSoubory(false);
      else if (a === 'nahratSlozku') vyberSoubory(true);
      else if (a === 'slozka') zadejText('Nová složka', 'Název složky' + (S.slozka ? ' (vytvoří se uvnitř „' + (najdi(S.slozka) || {}).nazev + '“)' : ''), '', v => { zalozSlozku(v, S.slozka); prekresli(); });
    });
    const up = EL.querySelector('[data-nahoru]'); if (up) up.onclick = () => { const r = najdi(S.slozka); S.slozka = r ? r.rodic || '' : ''; vykresli(); };
    EL.querySelectorAll('.dk-row[data-id]').forEach(row => row.onclick = e => {
      if (e.target.closest('.dk-a')) return;
      const r = najdi(row.dataset.id); if (!r) return;
      if (r.typ === 'slozka') { S.slozka = r.id; S.q = ''; vykresli(); }
      else if (lzeOtevrit(r.nazev)) otevri(r);
      else stahnout(r);
    });
    EL.querySelectorAll('[data-st]').forEach(b => b.onclick = () => { const r = najdi(b.dataset.st); if (r) stahnout(r); });
    EL.querySelectorAll('[data-pr]').forEach(b => b.onclick = () => { const r = najdi(b.dataset.pr); if (!r) return; zadejText('Přejmenovat', 'Nový název', r.nazev, v => { if (r.typ === 'soubor' && pripona(r.nazev) && !pripona(v)) v += '.' + pripona(r.nazev); ulozZaznamy([Object.assign({}, r, {nazev: v})]); prekresli(); }); });
    EL.querySelectorAll('[data-sm]').forEach(b => b.onclick = () => smazat(najdi(b.dataset.sm)));
    napojTazeni();
  }
  // přetažení z počítače: kamkoli do okna, když je otevřená Dokumentace (jinak by prohlížeč soubor sám otevřel)
  let tazeniOk = false, hloubka = 0;
  function napojTazeni() {
    if (tazeniOk) return; tazeniOk = true;
    // jen když je Dokumentace opravdu na obrazovce (ne v jiné záložce ani v otevřeném okně, např. ve zprávě)
    const aktivni = () => EL && EL.isConnected && EL.querySelector('.dk') && !V && !ro() && !document.querySelector('#overlay:not([hidden]) .modal, .dkv-out, .dkv-dlg');
    const jeSoubor = e => [...((e.dataTransfer && e.dataTransfer.types) || [])].includes('Files');
    const zvyrazni = on => { const r = EL && EL.querySelector('.dk'); if (r) r.classList.toggle('tahne', on); };
    window.addEventListener('dragenter', e => { if (!jeSoubor(e) || !aktivni()) return; e.preventDefault(); hloubka++; zvyrazni(true); });
    window.addEventListener('dragover', e => { if (!jeSoubor(e) || !aktivni()) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    window.addEventListener('dragleave', () => { if (--hloubka <= 0) { hloubka = 0; zvyrazni(false); } });
    window.addEventListener('drop', async e => {
      if (!jeSoubor(e) || !aktivni()) return;
      e.preventDefault(); hloubka = 0; zvyrazni(false);
      const p = zPretazeni(e.dataTransfer);   // položky se musí přečíst hned při puštění
      toast('Načítám přetažené soubory…');
      prijmi(await p);
    });
  }
  function smazat(r) {
    if (!r) return;
    const pod = r.typ === 'slozka' ? potomci(r.id) : [], soubory = pod.filter(x => x.typ === 'soubor').length;
    dialog(r.typ === 'slozka' ? 'Smazat složku?' : 'Smazat soubor?', `<p><b>${esc(r.nazev)}</b>${r.typ === 'slozka' ? ` i se vším uvnitř (${soubory} ${soubory === 1 ? 'soubor' : soubory > 1 && soubory < 5 ? 'soubory' : 'souborů'})` : ''} zmizí z Dokumentace u všech kolegů i v Deníku.</p><p>Na Disku Google se soubory přesunou do koše, odkud je jde 30 dní obnovit.</p>`,
      [['Smazat', () => {
        const vse = [r].concat(pod), gidy = [];
        vse.forEach(x => { if (x.gid) gidy.push(x.gid); (x.starsi || []).forEach(s => s.gid && gidy.push(s.gid)); cacheDel(klicCache(x)); });
        H.smaz(vse.map(x => x.id));
        if (gidy.length && H.pripojeno() && !H.zkouska) H.volej({akce: 'dok_smaz', ids: gidy}).catch(() => {});
        toast('Smazáno.'); prekresli();
      }, 'hl'], ['Zrušit', null]]);
  }

  /* =================================================================================================
     PROHLÍŽEČ VÝKRESŮ
     ================================================================================================= */
  const IK = {
    posun: '<svg viewBox="0 0 24 24"><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11.5v-8a1.5 1.5 0 0 1 3 0V12M14 5.5a1.5 1.5 0 0 1 3 0V12M17 7.5a1.5 1.5 0 0 1 3 0V16a6 6 0 0 1-6 6h-2a6 6 0 0 1-5-2.7L4.3 15a1.6 1.6 0 0 1 2.6-1.8L8 15"/></svg>',
    tuzka: '<svg viewBox="0 0 24 24"><path d="M17 3l4 4L8 20H4v-4z"/><path d="M14 6l4 4"/></svg>',
    kolecko: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="9" ry="7"/></svg>',
    sipka: '<svg viewBox="0 0 24 24"><path d="M5 19L19 5M9 5h10v10"/></svg>',
    text: '<svg viewBox="0 0 24 24"><path d="M5 6V4h14v2M12 4v16M9 20h6"/></svg>',
    vyrez: '<svg viewBox="0 0 24 24"><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/></svg>',
    zpet: '<svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>',
    zvyraz: '<svg viewBox="0 0 24 24"><path d="M9 11l-5 5v4h4l5-5"/><path d="M9 11l4 4 7-7-4-4z"/></svg>',
    cara: '<svg viewBox="0 0 24 24"><path d="M4 20L20 4"/></svg>',
    mnoho: '<svg viewBox="0 0 24 24"><path d="M12 3l9 6.5-3.5 10.5h-11L3 9.5z"/></svg>',
    oblouk: '<svg viewBox="0 0 24 24"><path d="M3 18a9.5 9.5 0 0 1 18 0"/></svg>',
    obdelnik: '<svg viewBox="0 0 24 24"><rect x="3.5" y="6" width="17" height="12" rx="1"/></svg>',
    mrak: '<svg viewBox="0 0 24 24"><path d="M7 18a4 4 0 0 1-1-7.9A5 5 0 0 1 15.5 8 4 4 0 0 1 18 15.9 3 3 0 0 1 16 18z"/></svg>',
    razitko: '<svg viewBox="0 0 24 24"><path d="M9 3h6v5l-1.5 3h3A2.5 2.5 0 0 1 19 13.5V16H5v-2.5A2.5 2.5 0 0 1 7.5 11h3L9 8z"/><path d="M4 20h16"/></svg>',
    meritko: '<svg viewBox="0 0 24 24"><path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/></svg>',
    guma: '<svg viewBox="0 0 24 24"><path d="M16 3l5 5-11 11H5l-2-2z"/><path d="M10 9l5 5M9 21h12"/></svg>',
    otocit: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 1-2.3-5.7"/><path d="M20 3v5h-5"/></svg>',
    tisk: '<svg viewBox="0 0 24 24"><path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/></svg>',
    smazat: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  };
  const RAZITKA = [['✓ OK', '#11873a'], ['✗ CHYBA', '#e0201b'], ['? DOTAZ', '#1f5fd1'], ['! POZOR', '#e8710a'], ['OPRAVIT', '#e0201b'], ['ZKONTROLOVAT', '#1f5fd1'], ['HOTOVO', '#11873a'], ['NEPLATÍ', '#e0201b']];
  const MERITKA = [20, 50, 100, 200, 250, 500, 1000];
  const TLOUSTKY = [[1, 'Tenká'], [2, 'Střední'], [4, 'Silná']];
  const BARVY = ['#e0201b', '#1f5fd1', '#11873a', '#16191c', '#f2b705'];
  let V = null;   // stav otevřeného prohlížeče

  function otevri(r) {
    styl();
    if (V) zavri();
    const sour = deti(r.rodic || '').filter(x => x.typ === 'soubor' && lzeOtevrit(x.nazev)).sort((a, b) => cmp(a.nazev, b.nazev));
    const el = document.createElement('div'); el.className = 'dkv';
    const T = (n, ik, l, tit) => `<button type="button" class="dkv-t" data-n="${n}" title="${esc(tit || l)}">${ik}<span>${l}</span></button>`;
    el.innerHTML = `
      <div class="dkv-bar">
        <div class="dkv-r1">
        <button type="button" class="dkv-b zl" data-v="zavrit" title="Zavřít výkres">✕ Zavřít</button>
        <span class="nm" id="dkv-nm"></span>
        ${sour.length > 1 ? `<span class="dkv-g"><button type="button" class="dkv-b" data-v="vpred" title="Předchozí výkres ve složce (Alt+↑)">▲</button><span class="zoom" id="dkv-poradi"></span><button type="button" class="dkv-b" data-v="vdal" title="Další výkres ve složce (Alt+↓)">▼</button></span>` : ''}
        </div><div class="dkv-r2">
        <span class="dkv-g" id="dkv-str"><button type="button" class="dkv-b" data-v="pred" title="Předchozí list">‹</button><span class="zoom" id="dkv-list">1 / 1</span><button type="button" class="dkv-b" data-v="dal" title="Další list">›</button></span>
        <span class="dkv-g"><button type="button" class="dkv-b" data-v="minus" title="Zmenšit">−</button><span class="zoom" id="dkv-zoom">100 %</span><button type="button" class="dkv-b" data-v="plus" title="Zvětšit">+</button><button type="button" class="dkv-b" data-v="cele" title="Celý výkres na obrazovku">Celý</button><button type="button" class="dkv-b" data-v="otocit" title="Otočit výkres o 90°">${IK.otocit}</button></span>
        <span class="dkv-g"><button type="button" class="dkv-b" data-v="zpet" title="Vrátit poslední značku (Ctrl+Z)">${IK.zpet} Zpět</button><button type="button" class="dkv-b" data-v="smazat" title="Smazat všechno nakreslené na tomto listu">${IK.smazat} Smazat vše</button></span>
        <span class="sp"></span>
        <button type="button" class="dkv-b zl" data-n="vyrez" title="Označte obdélník – výřez jde zkopírovat, uložit nebo poslat ve zprávě">${IK.vyrez} Výřez</button>
        <button type="button" class="dkv-b dkv-tisk" data-v="tisk" title="Vytisknout list i s nakreslenými značkami">${IK.tisk} Tisk</button>
        <button type="button" class="dkv-b" data-v="stahnout" title="Stáhnout původní soubor">⬇</button>
        </div>
      </div>
      <div class="dkv-nas" role="toolbar" aria-label="Nástroje">
        ${T('posun', IK.posun, 'Posun', 'Posun výkresu (táhnout)')}
        <hr>
        ${T('tuzka', IK.tuzka, 'Tužka')}
        ${T('zvyraz', IK.zvyraz, 'Zvýraznit', 'Zvýrazňovač (průhledný)')}
        ${T('cara', IK.cara, 'Čára')}
        ${T('sipka', IK.sipka, 'Šipka')}
        ${T('obdelnik', IK.obdelnik, 'Obdélník')}
        ${T('mnoho', IK.mnoho, 'Mnohoúhel.', 'Mnohoúhelník – klikejte body, uzavřete klikem na první bod, dvojklikem nebo Enter')}
        ${T('kolecko', IK.kolecko, 'Kolečko', 'Kolečko – zakroužkovat')}
        ${T('oblouk', IK.oblouk, 'Oblouk', 'Oblouk – táhněte od začátku do konce')}
        ${T('mrak', IK.mrak, 'Mráček', 'Mráček – označit změnu nebo vadu')}
        ${T('text', IK.text, 'Text')}
        ${T('razitko', IK.razitko, 'Razítko', 'Razítko: OK, CHYBA, DOTAZ, POZOR…')}
        <hr>
        ${T('meritko', IK.meritko, 'Měřit', 'Změřit vzdálenost podle měřítka výkresu')}
        <button type="button" class="dkv-t" data-v="meritko" title="Nastavit měřítko výkresu"><b id="dkv-mer" style="font-size:12.5px">1:100</b><span>Měřítko</span></button>
        <hr>
        <div class="dkv-bv" role="group" aria-label="Barva">${BARVY.map(b => `<button type="button" class="dkv-barva" data-b="${b}" style="background:${b}" title="Barva"></button>`).join('')}</div>
        <div class="dkv-tl" role="group" aria-label="Tloušťka čáry">${TLOUSTKY.map(([k, l]) => `<button type="button" data-tl="${k}" title="${l} čára"><i style="width:${k + 1}px;height:14px"></i></button>`).join('')}</div>
        <hr>
        ${T('guma', IK.guma, 'Guma', 'Guma – klepněte na značku, která se má smazat')}
      </div>
      <div class="dkv-stage" data-n="posun"><canvas class="zakl"></canvas><canvas class="det" style="display:none"></canvas><svg class="ann" xmlns="http://www.w3.org/2000/svg"></svg><div class="vyb"></div><div class="dkv-msg" hidden></div><div class="dkv-hint" hidden></div></div>`;
    document.body.appendChild(el);
    const st = el.querySelector('.dkv-stage');
    V = {sour, el, st, zakl: st.querySelector('canvas.zakl'), det: st.querySelector('canvas.det'), svg: st.querySelector('svg.ann'), vyb: st.querySelector('.vyb'), msg: st.querySelector('.dkv-msg'), hint: st.querySelector('.dkv-hint'),
      rec: null, typ: '', doc: null, img: null, str: 1, pocet: 1, w: 1, h: 1, w0: 1, h0: 1, rot: 0, rotace: {}, s: 1, tx: 0, ty: 0, n: 'posun', barva: BARVY[0], tl: Number(pam('cx-dkv-tl')) || 2, razitko: RAZITKA[0], kresby: {}, det0: null, detUloha: null, detT: 0, gen: 0, ptr: new Map()};
    el.querySelectorAll('button[data-n]').forEach(b => b.onclick = () => b.dataset.n === 'razitko' ? menuRazitek(b) : nastroj(b.dataset.n));
    el.querySelectorAll('[data-b]').forEach(b => b.onclick = () => { V.barva = b.dataset.b; el.querySelectorAll('[data-b]').forEach(x => x.setAttribute('aria-pressed', x === b)); if (vybrana()) { zapamatuj(); V.sel.b = V.sel.t === 'zvyraz' && V.barva === '#16191c' ? '#f2b705' : V.barva; kresliAnn(); return; } if (['posun', 'vyrez', 'guma', 'razitko'].includes(V.n)) nastroj('tuzka'); });
    el.querySelector('[data-b]').setAttribute('aria-pressed', 'true');
    const tlUi = () => el.querySelectorAll('[data-tl]').forEach(x => x.setAttribute('aria-pressed', Number(x.dataset.tl) === V.tl));
    el.querySelectorAll('[data-tl]').forEach(b => b.onclick = () => { V.tl = Number(b.dataset.tl); pamSet('cx-dkv-tl', V.tl); tlUi(); if (vybrana()) { zapamatuj(); zmenTl(V.sel, V.tl); kresliAnn(); return; } if (['posun', 'vyrez', 'guma'].includes(V.n)) nastroj('tuzka'); });
    tlUi();
    el.querySelector('[data-v="zavrit"]').onclick = zavri;
    const vp = el.querySelector('[data-v="vpred"]'), vd = el.querySelector('[data-v="vdal"]');
    if (vp) vp.onclick = () => dalsiVykres(-1); if (vd) vd.onclick = () => dalsiVykres(1);
    el.querySelector('[data-v="plus"]').onclick = () => zoomKolem(1.4);
    el.querySelector('[data-v="minus"]').onclick = () => zoomKolem(1 / 1.4);
    el.querySelector('[data-v="cele"]').onclick = () => { prizpusob(); };
    el.querySelector('[data-v="otocit"]').onclick = () => otocit();
    el.querySelector('[data-v="pred"]').onclick = () => list(V.str - 1);
    el.querySelector('[data-v="dal"]').onclick = () => list(V.str + 1);
    el.querySelector('[data-v="zpet"]').onclick = zpet;
    el.querySelector('[data-v="smazat"]').onclick = () => { if (!kresbyListu().length) return; zapamatuj(); V.kresby[klicListu()] = []; kresliAnn(); napoveda('Kresba smazána. Vrátit ji jde tlačítkem Zpět.'); };
    el.querySelector('[data-v="meritko"]').onclick = e => menuMeritek(e.currentTarget);
    el.querySelector('[data-v="tisk"]').onclick = () => tisk();
    el.querySelector('[data-v="stahnout"]').onclick = () => V.rec && stahnout(V.rec);
    napojUdalosti();
    nastroj('posun');
    document.addEventListener('keydown', klavesy, true);   // 4.94: zachytit dřív než okna pod výkresem (Esc je nezavře)
    window.addEventListener('resize', naResize);
    nacti(r);
  }
  function dalsiVykres(o) { if (!V || !V.rec) return; const i = V.sour.findIndex(x => x.id === V.rec.id), x = V.sour[i + o]; if (x) nacti(x); }
  function zavri() {
    if (!V) return;
    zavriMenu();
    document.removeEventListener('keydown', klavesy, true); window.removeEventListener('resize', naResize);
    try { if (V.doc) V.doc.destroy(); } catch (e) {}
    if (V.imgUrl) URL.revokeObjectURL(V.imgUrl);
    V.el.remove(); V = null;
  }
  function klavesy(e) {
    if (!V || e.target.closest('input,textarea')) return;
    if (V.poly && (e.key === 'Escape' || e.key === 'Enter')) { e.preventDefault(); e.stopImmediatePropagation(); e.key === 'Enter' ? polyHotovo() : (V.poly = null, kresliAnn()); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && vybrana()) { e.preventDefault(); zapamatuj(); kresbyListu().splice(kresbyListu().indexOf(V.sel), 1); V.sel = null; kresliAnn(); return; }
    if (e.key === 'Escape') { if (document.querySelector('.dkv-menu')) { e.stopImmediatePropagation(); zavriMenu(); return; } if (document.querySelector('.dkv-out,.dkv-dlg')) return; e.preventDefault(); e.stopImmediatePropagation(); if (!zpet()) napoveda('Není co vrátit. Výkres zavřete žlutým tlačítkem ✕ Zavřít vlevo nahoře.'); }   // 4.94: Esc = Zpět (dřív zavřel výkres)
    else if (e.key === '+' || e.key === '=') zoomKolem(1.4);
    else if (e.key === '-') zoomKolem(1 / 1.4);
    else if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); zpet(); }
    else if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); dalsiVykres(1); }
    else if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); dalsiVykres(-1); }
    else if (e.key === 'PageDown' || e.key === 'ArrowRight' && e.altKey) list(V.str + 1);
    else if (e.key === 'PageUp' || e.key === 'ArrowLeft' && e.altKey) list(V.str - 1);
  }
  let resT = 0;
  function naResize() { clearTimeout(resT); resT = setTimeout(() => { if (V) { pozice(); planujDetail(); } }, 120); }
  function nastroj(n) {
    if (V.poly) polyHotovo(); if (n !== V.n) V.sel = null;
    V.n = n; V.st.dataset.n = n; kresliAnn();
    V.el.querySelectorAll('[data-n]').forEach(b => b.setAttribute('aria-pressed', b.dataset.n === n));
    const D_ = dotyk(), m = D_ ? 'prstem' : 'myší';
    const t = {posun: D_ ? 'Posun prstem · dvěma prsty zvětšíte · značku chytíte prstem a přesunete' : 'Táhněte myší pro posun · nakreslenou značku chytíte a přesunete · kolečko myši zvětšuje · Esc = Zpět',
      tuzka: 'Kreslete ' + m, zvyraz: 'Přejeďte ' + m + ' přes místo – zvýrazní se průhlednou barvou', cara: 'Táhněte ' + m + ' rovnou čáru', sipka: 'Táhněte od začátku ke špičce šipky',
      obdelnik: 'Táhněte ' + m + ' obdélník', mnoho: (D_ ? 'Klepejte' : 'Klikejte') + ' body mnohoúhelníku – uzavřete ' + (D_ ? 'klepnutím' : 'klikem') + ' na první bod' + (D_ ? '' : ', dvojklikem nebo Enter'),
      oblouk: 'Táhněte ' + m + ' od začátku do konce oblouku (otočením kolečkem se dá obrátit)', kolecko: 'Táhněte ' + m + ' přes místo, které chcete zakroužkovat', mrak: 'Táhněte ' + m + ' obdélník – nakreslí se mráček (označení změny nebo vady)',
      text: (D_ ? 'Klepněte' : 'Klikněte') + ', kam chcete napsat text', razitko: (D_ ? 'Klepněte' : 'Klikněte') + ', kam dát razítko „' + V.razitko[0] + '“',
      meritko: 'Táhněte ' + m + ' od bodu k bodu – ukáže se vzdálenost (měřítko ' + merTxt() + ')', guma: (D_ ? 'Klepněte' : 'Klikněte') + ' na značku, která se má smazat',
      vyrez: 'Táhněte ' + m + ' obdélník výřezu (i s nakreslenými značkami)'}[n];
    napoveda(t);
  }
  let hintT = 0;
  function napoveda(t, ms) { if (!V) return; V.hint.textContent = t; V.hint.hidden = !t; clearTimeout(hintT); if (t) hintT = setTimeout(() => { if (V) V.hint.hidden = true; }, ms || 4000); }
  function zprava(html, pct) { V.msg.hidden = !html; V.msg.innerHTML = html ? `<div class="bx">${html}${pct != null ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}</div>` : ''; }

  /* ---------- načtení souboru do prohlížeče ---------- */
  let pdfjsP = null;
  function pdfjs() {
    if (!pdfjsP) pdfjsP = import(BASE + 'pdfjs/pdf.min.mjs').then(m => { m.GlobalWorkerOptions.workerSrc = BASE + 'pdfjs/pdf.worker.min.mjs'; return m; });
    pdfjsP.catch(() => { pdfjsP = null; });
    return pdfjsP;
  }
  async function nacti(r) {
    const gen = ++V.gen;
    [V.zaklUloha, V.detUloha].forEach(u => { try { u && u.cancel(); } catch (e) {} }); clearTimeout(V.detT);
    try { V.doc && V.doc.destroy(); } catch (e) {}
    V.rec = r; V.rot = V.rotace[r.id] || 0; V.doc = null; V.page = null; V.img = null; V.vektor = false; V.det0 = null; V.det.style.display = 'none'; V.str = 1; V.pocet = 1;
    V.el.querySelector('#dkv-nm').textContent = r.nazev; V.el.querySelector('#dkv-nm').title = r.nazev; merUi();
    V.el.querySelectorAll('[data-f]').forEach(b => { b.classList.toggle('on', b.dataset.f === r.id); if (b.dataset.f === r.id) b.scrollIntoView({block: 'nearest'}); });
    { const i = V.sour.findIndex(x => x.id === r.id), po = V.el.querySelector('#dkv-poradi'); if (po) po.textContent = (i + 1) + ' / ' + V.sour.length;
      const vp = V.el.querySelector('[data-v="vpred"]'), vd = V.el.querySelector('[data-v="vdal"]'); if (vp) vp.disabled = i <= 0; if (vd) vd.disabled = i >= V.sour.length - 1; }
    V.zakl.width = V.zakl.height = 1; V.det.width = V.det.height = 1; V.svg.innerHTML = '';
    zprava(`Otevírám <b>${esc(r.nazev)}</b>${r.vel ? ' (' + velTxt(r.vel) + ')' : ''}…`, 0);
    try {
      const blob = await nactiSoubor(r, (m, c) => { if (V && V.gen === gen) zprava(`Stahuji <b>${esc(r.nazev)}</b><br>${velTxt(m)} z ${velTxt(c)}<br><small>Podruhé se otevře hned (zůstane uložený v tomto prohlížeči).</small>`, c ? Math.round(m / c * 100) : 0); });
      if (!V || V.gen !== gen) return;
      const d = druh(r.nazev);
      V.typ = d; merUi();
      if (d === 'pdf') {
        zprava('Připravuji výkres…');
        const lib = await pdfjs();
        const data = new Uint8Array(await blob.arrayBuffer());
        V.doc = await lib.getDocument({data, standardFontDataUrl: BASE + 'pdfjs/standard_fonts/', wasmUrl: BASE + 'pdfjs/wasm/', isEvalSupported: false}).promise;
        if (!V || V.gen !== gen) return;
        V.pocet = V.doc.numPages;
      } else if (d === 'obr') {
        V.imgUrl && URL.revokeObjectURL(V.imgUrl); V.imgUrl = URL.createObjectURL(blob);
        V.img = await nactiObr(V.imgUrl);
      } else if (d === 'dwg' || d === 'dxf') {
        zprava(`Převádím ${d.toUpperCase()} na obrázek…<br><small>Velké výkresy to může trvat i minutu. Program pro DWG se stahuje jen poprvé.</small>`);
        const svg = await dwgNaSvg(blob, d);
        if (!V || V.gen !== gen) return;
        V.imgUrl && URL.revokeObjectURL(V.imgUrl);
        V.imgUrl = URL.createObjectURL(new Blob([svg.svg], {type: 'image/svg+xml'}));
        V.img = await nactiObr(V.imgUrl); V.img.w = svg.w; V.img.h = svg.h; V.vektor = true;
      }
      await list(1, true);
      zprava('');
      napoveda(V.n === 'posun' ? (dotyk() ? 'Dvěma prsty zvětšíte, jedním posunete. Výřez = žluté tlačítko v liště.' : 'Kolečkem myši zvětšíte, tažením posunete. Výřez = žluté tlačítko vpravo nahoře.') : '', 5000);
    } catch (e) {
      if (!V || V.gen !== gen) return;
      console.error(e);
      const dwg = /^(dwg|dxf)$/.test(druh(r.nazev));
      zprava(`<b>${esc(r.nazev)}</b> se nepodařilo otevřít.<br><small>${esc(e && e.message || e)}</small>${dwg ? '<br><br><small>Tip: u DWG je nejjistější nahrát vedle i PDF vytištěné z AutoCADu. Původní DWG můžete stáhnout tlačítkem ⬇ a otevřít v programu (např. DWG TrueView).</small>' : ''}`);
    }
  }
  const nactiObr = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Obrázek se nepodařilo načíst.')); i.src = src; });
  function dwgNaSvg(blob, d) {
    return new Promise(async (res, rej) => {
      let w;
      try { w = new Worker(BASE + 'dwg-worker.js', {type: 'module'}); } catch (e) { rej(new Error('Prohlížeč neumí spustit převod DWG.')); return; }
      const t = setTimeout(() => { w.terminate(); rej(new Error('Převod trval příliš dlouho.')); }, 180000);
      w.onmessage = e => { clearTimeout(t); w.terminate(); e.data && e.data.svg ? res(e.data) : rej(new Error((e.data && e.data.chyba) || 'Převod se nepovedl.')); };
      w.onerror = e => { clearTimeout(t); w.terminate(); rej(new Error('Převod DWG selhal' + (e && e.message ? ': ' + e.message : '.'))); };
      w.postMessage({data: await blob.arrayBuffer(), druh: d, zaklad: new URL(BASE + 'dwg/', location.href).href});
    });
  }
  async function list(n, prvni) {
    if (!V) return;
    n = Math.max(1, Math.min(V.pocet, n));
    if (n === V.str && !prvni) return;
    V.str = n;
    V.el.querySelector('#dkv-str').style.display = V.pocet > 1 ? '' : 'none';
    V.el.querySelector('#dkv-list').textContent = n + ' / ' + V.pocet;
    if (V.doc) {
      const gen = V.gen, page = await V.doc.getPage(n);
      if (!V || V.gen !== gen) return;
      V.page = page; const vp0 = page.getViewport({scale: 1}), vp = page.getViewport({scale: 1, rotation: rotPdf()});
      V.w0 = vp0.width; V.h0 = vp0.height; V.w = vp.width; V.h = vp.height;
      // základní obrázek celého listu (rozmazaný při velkém zvětšení, ostrý detail se dokreslí)
      const k = Math.min(2600 / Math.max(V.w, V.h), 4);
      const c = V.zakl; c.width = Math.round(V.w * k); c.height = Math.round(V.h * k);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      if (V.zaklUloha) { try { V.zaklUloha.cancel(); } catch (e) {} }
      V.zaklUloha = page.render({canvas: c, canvasContext: g, viewport: page.getViewport({scale: k, rotation: rotPdf()})});
      prizpusob();
      try { await V.zaklUloha.promise; } catch (e) {}
    } else if (V.img) {
      V.w0 = V.img.w || V.img.naturalWidth || 1000; V.h0 = V.img.h || V.img.naturalHeight || 1000;
      const ot = V.rot % 180 !== 0; V.w = ot ? V.h0 : V.w0; V.h = ot ? V.w0 : V.h0;
      const k = Math.min(V.vektor ? 3000 / Math.max(V.w, V.h) : 1, 4096 / Math.max(V.w, V.h));
      const c = V.zakl; c.width = Math.max(1, Math.round(V.w * k)); c.height = Math.max(1, Math.round(V.h * k));
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.setTransform(k, 0, 0, k, 0, 0); g.transform(...rotM()); g.drawImage(V.img, 0, 0, V.w0, V.h0); g.setTransform(1, 0, 0, 1, 0, 0);
      prizpusob();
    }
    kresliAnn();
  }
  /* ---------- zvětšení a posun ---------- */
  function prizpusob() {
    const r = V.st.getBoundingClientRect(), m = 16;
    V.s = V.fit = Math.max(0.0001, Math.min((r.width - 2 * m) / V.w, (r.height - 2 * m) / V.h));
    V.tx = (r.width - V.w * V.s) / 2; V.ty = (r.height - V.h * V.s) / 2;
    pozice(); planujDetail();
  }
  function zoomKolem(f, cx, cy) {
    const r = V.st.getBoundingClientRect();
    if (cx == null) { cx = r.width / 2; cy = r.height / 2; }
    const min = (V.fit || V.s) * 0.5, max = (V.fit || V.s) * 120;
    const ns = Math.max(min, Math.min(max, V.s * f)), k = ns / V.s;
    V.tx = cx - (cx - V.tx) * k; V.ty = cy - (cy - V.ty) * k; V.s = ns;
    pozice(); planujDetail();
  }
  function pozice() {
    const t = `translate(${V.tx}px,${V.ty}px)`;
    V.zakl.style.width = V.w * V.s + 'px'; V.zakl.style.height = V.h * V.s + 'px'; V.zakl.style.transform = t;
    V.svg.setAttribute('viewBox', `0 0 ${V.w} ${V.h}`); V.svg.style.width = V.w * V.s + 'px'; V.svg.style.height = V.h * V.s + 'px'; V.svg.style.transform = t;
    V.el.querySelector('#dkv-zoom').textContent = Math.round(V.s / (V.fit || V.s) * 100) + ' %';
    // ostrý detail z minula posunout/zvětšit podle nového pohledu, než se překreslí
    if (V.det0) { const k = V.s / V.det0.s; V.det.style.transform = `translate(${V.tx - V.det0.tx * k}px,${V.ty - V.det0.ty * k}px) scale(${k})`; }
  }
  function planujDetail() { clearTimeout(V.detT); V.detT = setTimeout(kresliDetail, 180); }
  async function kresliDetail() {
    if (!V) return;
    const r = V.st.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    // když je celý list vidět v rozlišení základního obrázku, detail není potřeba
    const kZakl = V.zakl.width / V.w;
    if (V.s * dpr <= kZakl * 1.05 && !V.vektor) { V.det.style.display = 'none'; V.det0 = null; return; }
    const W = Math.ceil(r.width * dpr), Ht = Math.ceil(r.height * dpr);
    const c = document.createElement('canvas'); c.width = W; c.height = Ht;
    const g = c.getContext('2d');
    const pohled = {s: V.s, tx: V.tx, ty: V.ty};
    if (V.page) {
      if (V.detUloha) { try { V.detUloha.cancel(); } catch (e) {} }
      const vp = V.page.getViewport({scale: V.s * dpr, rotation: rotPdf()});
      g.fillStyle = '#fff'; g.fillRect(V.tx * dpr, V.ty * dpr, V.w * V.s * dpr, V.h * V.s * dpr);
      V.detUloha = V.page.render({canvas: c, canvasContext: g, viewport: vp, transform: [1, 0, 0, 1, V.tx * dpr, V.ty * dpr], background: 'rgba(0,0,0,0)'});
      try { await V.detUloha.promise; } catch (e) { return; }
    } else if (V.img) {
      g.setTransform(V.s * dpr, 0, 0, V.s * dpr, V.tx * dpr, V.ty * dpr);
      g.fillStyle = '#fff'; g.fillRect(0, 0, V.w, V.h);
      g.transform(...rotM()); g.drawImage(V.img, 0, 0, V.w0, V.h0);
    }
    if (!V || V.s !== pohled.s || V.tx !== pohled.tx || V.ty !== pohled.ty) return;
    V.det.width = W; V.det.height = Ht; V.det.getContext('2d').drawImage(c, 0, 0);
    V.det.style.width = r.width + 'px'; V.det.style.height = r.height + 'px'; V.det.style.transform = 'none'; V.det.style.display = '';
    V.det0 = pohled;
  }
  /* ---------- kresba (souřadnice v jednotkách listu, takže drží při zvětšení i ve výřezu) ---------- */
  const klicListu = () => (V.rec ? V.rec.id : '') + ':' + V.str;
  const kresbyListu = () => (V.kresby[klicListu()] ||= []);
  // 4.94: historie pro Zpět / Esc – před každou změnou kresby se uloží stav listu (přidání, guma, přesun, smazat vše)
  const zapamatuj = () => { (V.hist ||= []).push({k: klicListu(), a: JSON.stringify(kresbyListu())}); if (V.hist.length > 200) V.hist.shift(); };
  function posunTvar(k, dx, dy) {
    if (k.p) k.p = k.p.map(q => [q[0] + dx, q[1] + dy]);
    if (k.r) k.r = [k.r[0] + dx, k.r[1] + dy, k.r[2] + dx, k.r[3] + dy];
    if (k.x != null) { k.x += dx; k.y += dy; }
  }
  // 4.54: tvary jsou uložené v souřadnicích neotočeného listu; při otočení se jen přepočítají (rotM)
  function rotM() { const w = V.w0, h = V.h0; return V.rot === 90 ? [0, 1, -1, 0, h, 0] : V.rot === 180 ? [-1, 0, 0, -1, w, h] : V.rot === 270 ? [0, -1, 1, 0, 0, w] : [1, 0, 0, 1, 0, 0]; }
  const rotPdf = () => ((V.page ? V.page.rotate : 0) + V.rot) % 360;
  function zListu(x, y) { const w = V.w0, h = V.h0; return V.rot === 90 ? [y, h - x] : V.rot === 180 ? [w - x, h - y] : V.rot === 270 ? [w - y, x] : [x, y]; }
  const f1 = n => Math.round(n * 10) / 10;
  function mrakD(x0, y0, x1, y1, r) {
    const a = Math.min(x0, x1), b = Math.min(y0, y1), c = Math.max(x0, x1), d = Math.max(y0, y1);
    const body = [[a, b], [c, b], [c, d], [a, d], [a, b]]; let out = `M${f1(a)},${f1(b)}`;
    for (let i = 0; i < 4; i++) { const [p, q] = [body[i], body[i + 1]], L = Math.hypot(q[0] - p[0], q[1] - p[1]), n = Math.max(1, Math.round(L / (2 * r)));
      for (let j = 1; j <= n; j++) { const x = p[0] + (q[0] - p[0]) * j / n, y = p[1] + (q[1] - p[1]) * j / n; out += `A${f1(L / n / 2)},${f1(L / n / 2)} 0 0 1 ${f1(x)},${f1(y)}`; } }
    return out + 'Z';
  }
  // 4.95: oblouk = kruhový oblouk nad tětivou r, vyboulení 30 % délky (strana podle směru tažení)
  function obloukGeo(k) {
    const [x0, y0, x1, y1] = k.r, dx = x1 - x0, dy = y1 - y0, c = Math.hypot(dx, dy); if (c < 1e-6) return null;
    const h = c * 0.3, R = (c * c / 4 + h * h) / (2 * h), n = [dy / c, -dx / c], m = [(x0 + x1) / 2, (y0 + y1) / 2], C = [m[0] - n[0] * (R - h), m[1] - n[1] * (R - h)];
    const a0 = Math.atan2(y0 - C[1], x0 - C[0]); let da = Math.atan2(y1 - C[1], x1 - C[0]) - a0; while (da <= 0) da += 2 * Math.PI;
    return {R, C, a0, da, body: Array.from({length: 25}, (_, i) => [C[0] + R * Math.cos(a0 + da * i / 24), C[1] + R * Math.sin(a0 + da * i / 24)])};
  }
  function obal(k) {   // [x0, y0, x1, y1] značky bez vlastního otočení
    let b = [];
    if (k.t === 'oblouk') { const g = obloukGeo(k); b = g ? g.body : [[k.r[0], k.r[1]]]; }
    else if (k.p) b = k.p; else if (k.r) b = [[k.r[0], k.r[1]], [k.r[2], k.r[3]]];
    popisky(k).forEach(t => { if (t.stred) return; const sir = t.s.length * t.v * 0.66 + t.v * 0.9; b = b.concat([[t.x - t.v * 0.45, t.y - t.v * 1.08], [t.x - t.v * 0.45 + sir, t.y + t.v * 0.37]]); });
    if (!b.length) return [0, 0, 0, 0];
    return [Math.min(...b.map(q => q[0])), Math.min(...b.map(q => q[1])), Math.max(...b.map(q => q[0])), Math.max(...b.map(q => q[1]))];
  }
  const stred = k => { const o = obal(k); return [(o[0] + o[2]) / 2, (o[1] + o[3]) / 2]; };
  const otocBod = (q, c, deg) => { const a = deg * Math.PI / 180, dx = q[0] - c[0], dy = q[1] - c[1]; return [c[0] + dx * Math.cos(a) - dy * Math.sin(a), c[1] + dx * Math.sin(a) + dy * Math.cos(a)]; };
  function uchytOtoceni(k) { const o = obal(k), c = stred(k); return otocBod([c[0], o[1] - 26 / V.s], c, k.ot || 0); }
  const TLF = {tuzka: tl => 1.5 * tl, zvyraz: tl => 8 + 4 * tl, razitko: tl => 1 + tl / 2, text: tl => 0.75 + tl / 4};
  function zmenTl(k, tl) {   // nová tloušťka úměrně původní (nezávisle na zvětšení)
    const f = TLF[k.t] || (x => 1.75 * x), o = k.tl || 2, q = f(tl) / f(o);
    if (k.t === 'text' || k.t === 'razitko') k.v *= q; else k.w *= q;
    k.tl = tl;
  }
  const vybrana = () => V && V.sel && kresbyListu().includes(V.sel);
  function polyHotovo() {
    const P = V.poly; V.poly = null; if (!P) return;
    const b = P.p.slice(0, -1).filter((q, i, a) => !i || Math.hypot(q[0] - a[i - 1][0], q[1] - a[i - 1][1]) * V.s > 3);
    if (b.length >= 3) { zapamatuj(); kresbyListu().push({t: 'mnoho', b: P.b, w: P.w, tl: P.tl, p: b, z: true}); }
    else if (b.length === 2) { zapamatuj(); kresbyListu().push({t: 'cara', b: P.b, w: P.w, tl: P.tl, r: [b[0][0], b[0][1], b[1][0], b[1][1]]}); }
    kresliAnn();
  }
  function cestaD(k) {
    if (k.t === 'mnoho') return 'M' + k.p.map(p => f1(p[0]) + ',' + f1(p[1])).join('L') + (k.z ? 'Z' : '');
    if (k.t === 'oblouk') { const g = obloukGeo(k); if (!g) return ''; const [x0, y0, x1, y1] = k.r; return `M${f1(x0)},${f1(y0)}A${f1(g.R)},${f1(g.R)} 0 0 1 ${f1(x1)},${f1(y1)}`; }
    if (k.t === 'tuzka' || k.t === 'zvyraz') return 'M' + k.p.map(p => f1(p[0]) + ',' + f1(p[1])).join('L');
    const [x0, y0, x1, y1] = k.r || [0, 0, 0, 0];
    if (k.t === 'cara' || k.t === 'meritko') return `M${f1(x0)},${f1(y0)}L${f1(x1)},${f1(y1)}`;
    if (k.t === 'obdelnik') return `M${f1(x0)},${f1(y0)}H${f1(x1)}V${f1(y1)}H${f1(x0)}Z`;
    if (k.t === 'kolecko') { const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = Math.abs(x1 - x0) / 2 || 0.01, ry = Math.abs(y1 - y0) / 2 || 0.01; return `M${f1(cx - rx)},${f1(cy)}A${f1(rx)},${f1(ry)} 0 1 0 ${f1(cx + rx)},${f1(cy)}A${f1(rx)},${f1(ry)} 0 1 0 ${f1(cx - rx)},${f1(cy)}Z`; }
    if (k.t === 'mrak') return mrakD(x0, y0, x1, y1, Math.max(k.w * 3.2, Math.min(Math.abs(x1 - x0), Math.abs(y1 - y0)) / 8));
    if (k.t === 'sipka') { const a = Math.atan2(y1 - y0, x1 - x0), L = k.w * 5; return `M${f1(x0)},${f1(y0)}L${f1(x1)},${f1(y1)}M${f1(x1 - L * Math.cos(a - 0.45))},${f1(y1 - L * Math.sin(a - 0.45))}L${f1(x1)},${f1(y1)}L${f1(x1 - L * Math.cos(a + 0.45))},${f1(y1 - L * Math.sin(a + 0.45))}`; }
    return '';
  }
  // měření: délka v metrech podle měřítka výkresu (u PDF jsou jednotky body = 1/72 palce papíru)
  function delka(k) { const [x0, y0, x1, y1] = k.r, L = Math.hypot(x1 - x0, y1 - y0), m = mpj(); return m ? L * m : null; }
  const delkaTxt = m => m == null ? '? (nastavte měřítko)' : m < 1 ? (m * 100).toFixed(m < 0.1 ? 1 : 0).replace('.', ',') + ' cm' : m.toFixed(m < 10 ? 2 : 1).replace('.', ',') + ' m';
  function popisky(k) {   // text a razítka: [{x, y, s, v, b, ram}]
    if (k.t === 'text') return [{x: k.x, y: k.y, s: k.s, v: k.v, b: k.b, a: k.a || 0}];
    if (k.t === 'razitko') return [{x: k.x, y: k.y, s: k.s, v: k.v, b: k.b, a: k.a || 0, ram: true}];
    if (k.t === 'meritko') { const [x0, y0, x1, y1] = k.r; return [{x: (x0 + x1) / 2, y: (y0 + y1) / 2 - k.w * 2.2, s: delkaTxt(delka(k)), v: k.w * 5.5, b: k.b, a: -V.rot, stred: true}]; }
    return [];
  }
  function tvarSvg(k) {
    const b = esc(k.b), d = cestaD(k);
    let out = d ? `<path d="${d}" fill="none" stroke="${b}" stroke-width="${f1(k.w * 100) / 100}" stroke-linecap="${k.t === 'zvyraz' ? 'butt' : 'round'}" stroke-linejoin="round"${k.t === 'zvyraz' ? ' stroke-opacity=".38"' : ''}/>` : '';
    if (k.t === 'meritko') { const [x0, y0, x1, y1] = k.r, a = Math.atan2(y1 - y0, x1 - x0) + Math.PI / 2, L = k.w * 2.5; out += [[x0, y0], [x1, y1]].map(([x, y]) => `<path d="M${f1(x - L * Math.cos(a))},${f1(y - L * Math.sin(a))}L${f1(x + L * Math.cos(a))},${f1(y + L * Math.sin(a))}" stroke="${b}" stroke-width="${k.w}" stroke-linecap="round"/>`).join(''); }
    popisky(k).forEach(t => {
      const tr = t.a ? ` transform="rotate(${t.a} ${f1(t.x)} ${f1(t.y)})"` : '', anch = t.stred ? ' text-anchor="middle"' : '';
      if (t.ram) { const sir = t.s.length * t.v * 0.66 + t.v * 0.9, vys = t.v * 1.45;
        out += `<g${tr}><rect x="${f1(t.x - t.v * 0.45)}" y="${f1(t.y - t.v * 1.08)}" width="${f1(sir)}" height="${f1(vys)}" rx="${f1(t.v * 0.25)}" fill="#fff" fill-opacity=".85" stroke="${esc(t.b)}" stroke-width="${f1(t.v * 0.16)}"/><text x="${f1(t.x)}" y="${f1(t.y)}" font-size="${f1(t.v)}" font-family="Hanken Grotesk, Arial, sans-serif" font-weight="800" fill="${esc(t.b)}">${esc(t.s)}</text></g>`; }
      else out += `<text x="${f1(t.x)}" y="${f1(t.y)}"${anch}${tr} font-size="${f1(t.v)}" font-family="Hanken Grotesk, Arial, sans-serif" font-weight="700" fill="${esc(t.b)}" stroke="#fff" stroke-width="${f1(t.v / 7)}" paint-order="stroke">${esc(t.s)}</text>`;
    });
    return out;
  }
  function tvarSvgO(k) { if (!k.ot) return tvarSvg(k); const c = stred(k); return `<g transform="rotate(${f1(k.ot)} ${f1(c[0])} ${f1(c[1])})">${tvarSvg(k)}</g>`; }
  function vyberSvg(k) {   // 4.95: rámeček vybrané značky + modré kolečko pro otočení
    const o = obal(k), c = stred(k), pd = 5 / V.s, u = 26 / V.s, sw = f1(1.4 / V.s * 100) / 100;
    return `<g transform="rotate(${f1(k.ot || 0)} ${f1(c[0])} ${f1(c[1])})" pointer-events="none"><rect x="${f1(o[0] - pd)}" y="${f1(o[1] - pd)}" width="${f1(o[2] - o[0] + 2 * pd)}" height="${f1(o[3] - o[1] + 2 * pd)}" fill="none" stroke="#1f6fd1" stroke-width="${sw}" stroke-dasharray="${f1(5 / V.s)} ${f1(4 / V.s)}"/>`
      + `<path d="M${f1(c[0])},${f1(o[1] - pd)}V${f1(o[1] - u)}" stroke="#1f6fd1" stroke-width="${sw}"/><circle cx="${f1(c[0])}" cy="${f1(o[1] - u)}" r="${f1(7 / V.s)}" fill="#fff" stroke="#1f6fd1" stroke-width="${f1(2.2 / V.s * 100) / 100}"/>`
      + `<path d="M${f1(c[0] - 3.2 / V.s)},${f1(o[1] - u - 1.5 / V.s)}A${f1(3.4 / V.s)},${f1(3.4 / V.s)} 0 1 1 ${f1(c[0] + 1 / V.s)},${f1(o[1] - u + 3.3 / V.s)}" fill="none" stroke="#1f6fd1" stroke-width="${f1(1.5 / V.s * 100) / 100}"/></g>`;
  }
  function kresliAnn(navic) {
    if (!V) return; if (navic === undefined && V.poly) navic = V.poly;
    V.svg.innerHTML = `<g transform="matrix(${rotM().join(' ')})">` + kresbyListu().map(tvarSvgO).join('') + (navic ? tvarSvg(navic) : '') + (vybrana() ? vyberSvg(V.sel) : '') + '</g>';
  }
  function kresliNaCanvas(g, k) {
    g.save(); if (k.ot) { const c = stred(k); g.translate(c[0], c[1]); g.rotate(k.ot * Math.PI / 180); g.translate(-c[0], -c[1]); } g.strokeStyle = g.fillStyle = k.b; g.lineWidth = k.w; g.lineCap = k.t === 'zvyraz' ? 'butt' : 'round'; g.lineJoin = 'round';
    const d = cestaD(k);
    if (d) { if (k.t === 'zvyraz') g.globalAlpha = 0.38; g.stroke(new Path2D(d)); g.globalAlpha = 1; }
    if (k.t === 'meritko') { const [x0, y0, x1, y1] = k.r, a = Math.atan2(y1 - y0, x1 - x0) + Math.PI / 2, L = k.w * 2.5; g.beginPath(); [[x0, y0], [x1, y1]].forEach(([x, y]) => { g.moveTo(x - L * Math.cos(a), y - L * Math.sin(a)); g.lineTo(x + L * Math.cos(a), y + L * Math.sin(a)); }); g.stroke(); }
    popisky(k).forEach(t => {
      g.save(); g.translate(t.x, t.y); if (t.a) g.rotate(t.a * Math.PI / 180);
      g.font = `${t.ram ? 800 : 700} ${t.v}px "Hanken Grotesk", Arial, sans-serif`; g.textAlign = t.stred ? 'center' : 'left';
      if (t.ram) { const sir = t.s.length * t.v * 0.66 + t.v * 0.9; g.fillStyle = 'rgba(255,255,255,.85)'; g.beginPath(); g.roundRect ? g.roundRect(-t.v * 0.45, -t.v * 1.08, sir, t.v * 1.45, t.v * 0.25) : g.rect(-t.v * 0.45, -t.v * 1.08, sir, t.v * 1.45); g.fill(); g.lineWidth = t.v * 0.16; g.strokeStyle = t.b; g.stroke(); g.fillStyle = t.b; g.fillText(t.s, 0, 0); }
      else { g.lineWidth = t.v / 7; g.strokeStyle = '#fff'; g.strokeText(t.s, 0, 0); g.fillStyle = t.b; g.fillText(t.s, 0, 0); }
      g.restore();
    });
    g.restore();
  }
  // guma: najde značku nejblíž bodu (v souřadnicích listu)
  function najdiTvar(p0, tol) {
    const kk = kresbyListu(); let nej = -1, nd = tol, p = p0;
    const dSeg = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0; return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); };
    kk.forEach((k, i) => {
      let d = Infinity; p = k.ot ? otocBod(p0, stred(k), -k.ot) : p0;
      if (k.p) { const q = k.z ? k.p.concat([k.p[0]]) : k.p; for (let j = 1; j < q.length; j++) d = Math.min(d, dSeg(q[j - 1], q[j]) - k.w / 2); }
      else if (k.t === 'oblouk') { const g = obloukGeo(k); if (g) for (let j = 1; j < g.body.length; j++) d = Math.min(d, dSeg(g.body[j - 1], g.body[j])); }
      else if (k.r) { const [x0, y0, x1, y1] = k.r;
        if (k.t === 'cara' || k.t === 'sipka' || k.t === 'meritko') d = dSeg([x0, y0], [x1, y1]);
        else if (k.t === 'kolecko') { const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = Math.abs(x1 - x0) / 2 || 1, ry = Math.abs(y1 - y0) / 2 || 1; d = Math.abs(Math.hypot((p[0] - cx) / rx, (p[1] - cy) / ry) - 1) * Math.min(rx, ry); }
        else { const a = Math.min(x0, x1), b = Math.min(y0, y1), c = Math.max(x0, x1), e = Math.max(y0, y1); d = Math.min(dSeg([a, b], [c, b]), dSeg([c, b], [c, e]), dSeg([c, e], [a, e]), dSeg([a, e], [a, b])); } }
      popisky(k).forEach(t => { if (t.stred) return; const sir = t.s.length * t.v * 0.66 + t.v; const q = t.a ? (() => { const r = -t.a * Math.PI / 180, dx = p[0] - t.x, dy = p[1] - t.y; return [t.x + dx * Math.cos(r) - dy * Math.sin(r), t.y + dx * Math.sin(r) + dy * Math.cos(r)]; })() : p;
        if (q[0] >= t.x - t.v && q[0] <= t.x + sir && q[1] >= t.y - t.v * 1.3 && q[1] <= t.y + t.v * 0.5) d = 0; });
      if (d < nd) { nd = d; nej = i; }
    });
    return nej;
  }
  function zpet() {
    if (!V) return false;
    const h = V.hist || [], kl = klicListu();
    V.sel = null;
    for (let i = h.length - 1; i >= 0; i--) if (h[i].k === kl) { V.kresby[kl] = JSON.parse(h.splice(i, 1)[0].a); kresliAnn(); return true; }
    const k = kresbyListu();
    if (k.length) { k.pop(); kresliAnn(); return true; }
    return false;
  }
  function otocit() {
    if (!V || !V.rec) return;
    V.rot = (V.rot + 90) % 360; V.rotace[V.rec.id] = V.rot;
    V.det.style.display = 'none'; V.det0 = null;
    list(V.str, true);
  }
  /* ---------- měřítko ---------- */
  const merKlic = () => 'cx-dk-mer:' + (V.rec ? V.rec.gid || V.rec.id : '');
  function merStav() { try { return JSON.parse(pam(merKlic()) || 'null'); } catch (e) { return null; } }
  function mpj() {   // metrů na jednotku listu
    const m = merStav();
    if (m && m.mpj) return m.mpj;
    const M = m && m.M ? m.M : V.typ === 'pdf' ? 100 : 0;
    return M ? 25.4 / 72 / 1000 * M : 0;
  }
  function merTxt() { const m = merStav(); return m && m.mpj ? 'podle známé délky' : '1:' + (m && m.M ? m.M : V && V.typ === 'pdf' ? 100 : '?'); }
  function merUi() { const e = V && V.el.querySelector('#dkv-mer'); if (e) { const m = merStav(); e.textContent = m && m.mpj ? 'vlastní' : '1:' + (m && m.M ? m.M : V.typ === 'pdf' || !V.typ ? 100 : '?'); } }
  function zavriMenu() { document.querySelectorAll('.dkv-menu').forEach(x => x.remove()); document.removeEventListener('pointerdown', menuVen, true); }
  function menuVen(e) { if (!e.target.closest('.dkv-menu')) zavriMenu(); }
  function menu(u, html, nastav) {
    zavriMenu();
    const m = document.createElement('div'); m.className = 'dkv-menu'; m.innerHTML = html; document.body.appendChild(m);
    const r = u.getBoundingClientRect(), mr = m.getBoundingClientRect();
    let x = r.right + 6, y = r.top; if (x + mr.width > innerWidth - 8) { x = Math.max(8, Math.min(r.left, innerWidth - mr.width - 8)); y = r.top - mr.height - 6; if (y < 8) y = r.bottom + 6; }
    if (y + mr.height > innerHeight - 8) y = Math.max(8, innerHeight - mr.height - 8);
    m.style.left = x + 'px'; m.style.top = y + 'px';
    nastav(m); setTimeout(() => document.addEventListener('pointerdown', menuVen, true), 0);
  }
  function menuRazitek(u) {
    menu(u, '<small>Vyberte razítko a klikněte do výkresu</small>' + RAZITKA.map(([t, b], i) => `<button type="button" data-rz="${i}" aria-pressed="${V.razitko[0] === t}"><span class="rz" style="color:${b}">${esc(t)}</span></button>`).join(''), m => {
      m.querySelectorAll('[data-rz]').forEach(b => b.onclick = () => { V.razitko = RAZITKA[Number(b.dataset.rz)]; zavriMenu(); nastroj('razitko'); });
    });
  }
  function menuMeritek(u) {
    const m0 = merStav(), akt = m0 && m0.mpj ? 'x' : String(m0 && m0.M ? m0.M : 100);
    menu(u, '<small>Měřítko výkresu (je v rohovém razítku)</small>' + MERITKA.map(M => `<button type="button" data-m="${M}" aria-pressed="${akt === String(M)}">1 : ${M}</button>`).join('') + `<button type="button" data-m="x" aria-pressed="${akt === 'x'}">📏 Podle známé délky…</button>`, m => {
      m.querySelectorAll('[data-m]').forEach(b => b.onclick = () => {
        zavriMenu();
        if (b.dataset.m === 'x') { V.kalibrace = true; nastroj('meritko'); napoveda('Natáhněte čáru přes kótu nebo rozměr, který znáte (např. šířku dveří). Pak zadáte skutečnou délku.', 7000); return; }
        pamSet(merKlic(), JSON.stringify({M: Number(b.dataset.m)})); merUi(); kresliAnn(); nastroj('meritko');
      });
    });
  }
  function kalibruj(k) {
    const L = Math.hypot(k.r[2] - k.r[0], k.r[3] - k.r[1]);
    const o = document.createElement('div'); o.className = 'dkv-dlg';
    o.innerHTML = `<div class="bx" role="dialog" aria-modal="true"><h3>Jak dlouhá je ta čára ve skutečnosti?</h3><p>Zadejte délku v metrech (např. 0,9 pro dveře nebo 3,45 podle kóty). Podle ní se nastaví měřítko tohoto výkresu.</p>
      <input id="dkv-kal" inputmode="decimal" placeholder="např. 3,45" autocomplete="off"><div class="ak"><button type="button" class="dk-btn" data-k="ne">Zrušit</button><button type="button" class="dk-btn zl" data-k="ok">Nastavit měřítko</button></div></div>`;
    document.body.appendChild(o);
    const inp = o.querySelector('input'); setTimeout(() => inp.focus(), 30);
    const ok = () => { const m = parseFloat(String(inp.value).replace(',', '.').replace(/[^\d.]/g, '')); if (!(m > 0) || !(L > 0)) { inp.focus(); return; } pamSet(merKlic(), JSON.stringify({mpj: m / L})); o.remove(); merUi(); kresliAnn(); napoveda('Měřítko nastaveno. Teď můžete měřit.'); };
    o.querySelector('[data-k="ok"]').onclick = ok; o.querySelector('[data-k="ne"]').onclick = () => o.remove();
    inp.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') ok(); if (e.key === 'Escape') o.remove(); };
  }
  const naList = (cx, cy) => zListu((cx - V.tx) / V.s, (cy - V.ty) / V.s);
  const naPohled = (cx, cy) => [(cx - V.tx) / V.s, (cy - V.ty) / V.s];   // otočený pohled (výřez)
  const UCHOP = {posun: 10, cara: 6, sipka: 6, obdelnik: 6, kolecko: 6, mrak: 6, meritko: 6, oblouk: 6, text: 8, razitko: 8};   // tolerance chycení značky v px
  function napojUdalosti() {
    const st = V.st;
    let akce = null;
    const bod = e => { const r = st.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    st.addEventListener('wheel', e => {
      e.preventDefault();
      const [cx, cy] = bod(e);
      const mys = e.deltaMode === 1 || (Math.abs(e.deltaY) >= 50 && e.deltaX === 0 && Number.isInteger(e.deltaY));
      if (e.ctrlKey || e.metaKey || mys) zoomKolem(Math.exp(-e.deltaY * (e.ctrlKey && !mys ? 0.01 : 0.0022)), cx, cy);
      else { V.tx -= e.deltaX; V.ty -= e.deltaY; pozice(); planujDetail(); }
    }, {passive: false});
    st.addEventListener('dblclick', e => { if (V.n === 'mnoho' && V.poly) { e.preventDefault(); polyHotovo(); return; } if (V.n !== 'posun') return; const [cx, cy] = bod(e); zoomKolem(e.shiftKey ? 1 / 2 : 2, cx, cy); });
    st.addEventListener('pointerdown', e => {
      if (e.button > 1) return;
      st.setPointerCapture(e.pointerId);
      V.ptr.set(e.pointerId, bod(e));
      if (V.ptr.size === 2) {   // dva prsty = zvětšení a posun (iPad, dotyková obrazovka)
        if (akce && akce.tvar) { /* rozkreslené zahodit */ }
        const [a, b] = [...V.ptr.values()]; akce = {pinch: true, d: Math.hypot(a[0] - b[0], a[1] - b[1]), c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]}; kresliAnn(); return;
      }
      const [cx, cy] = bod(e), p = naList(cx, cy), n = e.button === 1 ? 'posun' : V.n;
      if (e.button === 0 && vybrana()) { const u = uchytOtoceni(V.sel); if (Math.hypot(p[0] - u[0], p[1] - u[1]) * V.s < 14) { zapamatuj(); const c = stred(V.sel); akce = {otoc: V.sel, c, a0: Math.atan2(p[1] - c[1], p[0] - c[0]), ot0: V.sel.ot || 0}; st.classList.add('tah'); e.preventDefault(); return; } }
      if (n === 'mnoho' && e.button === 0) {   // 4.95: mnohoúhelník bod po bodu
        e.preventDefault(); V.sel = null;
        if (!V.poly) V.poly = {t: 'mnoho', b: V.barva, w: 1.75 * V.tl / V.s, tl: V.tl, p: [p, p]};
        else { const f = V.poly.p[0]; if (V.poly.p.length >= 4 && Math.hypot(p[0] - f[0], p[1] - f[1]) * V.s < 12) { polyHotovo(); return; } V.poly.p[V.poly.p.length - 1] = p; V.poly.p.push(p); }
        akce = {poly: true}; kresliAnn(); return;
      }
      // 4.94: klik na nakreslenou značku = chytit a posunout (v Posunu i u nástrojů tvarů, textu, razítka a měření)
      const ti = e.button === 0 && UCHOP[n] ? najdiTvar(p, UCHOP[n] / V.s) : -1;
      if (ti >= 0) { zapamatuj(); const k = kresbyListu()[ti]; akce = {tah: k, p0: p}; if (V.sel !== k) { V.sel = k; napoveda('Vybráno: táhnout = přesun · modré kolečko = otočit · barva a tloušťka vlevo změní tuto značku · Delete = smazat', 6000); } kresliAnn(); st.classList.add('tah'); e.preventDefault(); return; }
      if (V.sel) { V.sel = null; kresliAnn(); }
      if (n === 'posun') { akce = {posun: true, x: cx, y: cy}; st.classList.add('drz'); }
      else if (n === 'tuzka') akce = {tvar: {t: 'tuzka', b: V.barva, w: 1.5 * V.tl / V.s, tl: V.tl, p: [p]}};
      else if (n === 'zvyraz') akce = {tvar: {t: 'zvyraz', b: V.barva === '#16191c' ? '#f2b705' : V.barva, w: (8 + 4 * V.tl) / V.s, tl: V.tl, p: [p]}};
      else if (['kolecko', 'sipka', 'cara', 'obdelnik', 'mrak', 'meritko', 'oblouk'].includes(n)) akce = {tvar: {t: n, b: V.barva, w: 1.75 * V.tl / V.s, tl: V.tl, r: [p[0], p[1], p[0], p[1]]}};
      else if (n === 'guma') { const i = najdiTvar(p, 10 / V.s); if (i >= 0) { zapamatuj(); kresbyListu().splice(i, 1); kresliAnn(); } else napoveda('Tady žádná značka není – klepněte přímo na čáru nebo text.'); }
      else if (n === 'razitko') { const [t, b] = V.razitko; zapamatuj(); kresbyListu().push({t: 'razitko', b, s: t, x: p[0], y: p[1], v: 7 * (1 + V.tl / 2) / V.s, tl: V.tl, a: -V.rot}); kresliAnn(); }
      else if (n === 'vyrez') { akce = {vyrez: true, x: cx, y: cy}; Object.assign(V.vyb.style, {display: 'block', left: cx + 'px', top: cy + 'px', width: '0px', height: '0px'}); }
      else if (n === 'text') { e.preventDefault(); textNa(cx, cy); }
    });
    st.addEventListener('pointermove', e => {
      if (!V.ptr.has(e.pointerId)) {
        if (e.pointerType !== 'mouse') return;
        const [cx, cy] = bod(e), q = naList(cx, cy);
        if (V.poly) { V.poly.p[V.poly.p.length - 1] = q; kresliAnn(); return; }
        const u = vybrana() ? uchytOtoceni(V.sel) : null, nadU = !!u && Math.hypot(q[0] - u[0], q[1] - u[1]) * V.s < 14;
        st.classList.toggle('rotk', nadU); st.classList.toggle('nad', !nadU && !!UCHOP[V.n] && najdiTvar(q, UCHOP[V.n] / V.s) >= 0); return;
      }
      V.ptr.set(e.pointerId, bod(e));
      if (!akce) return;
      const [cx, cy] = bod(e);
      if (akce.pinch && V.ptr.size >= 2) {
        const [a, b] = [...V.ptr.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        V.tx += c[0] - akce.c[0]; V.ty += c[1] - akce.c[1]; akce.c = c;
        if (akce.d > 0) zoomKolem(d / akce.d, c[0], c[1]); akce.d = d; return;
      }
      if (akce.posun) { V.tx += cx - akce.x; V.ty += cy - akce.y; akce.x = cx; akce.y = cy; pozice(); planujDetail(); return; }
      const p = naList(cx, cy);
      if (akce.tah) { posunTvar(akce.tah, p[0] - akce.p0[0], p[1] - akce.p0[1]); akce.p0 = p; akce.hnul = true; kresliAnn(); return; }
      if (akce.otoc) {   // 4.95: otočení kolem středu; přichytí se k násobkům 15° (Shift = jen 15° kroky)
        let a = akce.ot0 + (Math.atan2(p[1] - akce.c[1], p[0] - akce.c[0]) - akce.a0) * 180 / Math.PI; a = ((a % 360) + 540) % 360 - 180;
        const r15 = Math.round(a / 15) * 15; if (e.shiftKey || Math.abs(a - r15) < 3) a = r15;
        akce.otoc.ot = a; akce.hnul = true; napoveda('Otočení ' + Math.round(a) + '°', 1500); kresliAnn(); return;
      }
      if (akce.poly) { if (V.poly) { V.poly.p[V.poly.p.length - 1] = p; kresliAnn(); } return; }
      if (akce.tvar) {
        if (akce.tvar.p) { const l = akce.tvar.p[akce.tvar.p.length - 1]; if (Math.hypot(p[0] - l[0], p[1] - l[1]) * V.s > 1.5) akce.tvar.p.push(p); }
        else { akce.tvar.r[2] = p[0]; akce.tvar.r[3] = p[1]; }
        kresliAnn(akce.tvar); return;
      }
      if (akce.vyrez) { Object.assign(V.vyb.style, {left: Math.min(cx, akce.x) + 'px', top: Math.min(cy, akce.y) + 'px', width: Math.abs(cx - akce.x) + 'px', height: Math.abs(cy - akce.y) + 'px'}); }
    });
    const konec = e => {
      V.ptr.delete(e.pointerId);
      if (!akce) return;
      st.classList.remove('drz', 'tah');
      if (akce.tah || akce.otoc) { if (!akce.hnul && V.hist) V.hist.pop(); akce = null; return; }
      if (akce.poly) { akce = null; return; }
      if (akce.pinch) { if (V.ptr.size < 2) akce = null; return; }
      if (akce.tvar) {
        const t = akce.tvar, mal = t.p ? t.p.length < 2 : Math.hypot(t.r[2] - t.r[0], t.r[3] - t.r[1]) * V.s < 6;
        if (t.p && t.p.length === 1) t.p.push([t.p[0][0] + 0.5 / V.s, t.p[0][1]]);
        if (t.t === 'meritko' && !mal && (V.kalibrace || !mpj())) { V.kalibrace = false; kresliAnn(); kalibruj(t); }
        else { if (!mal || t.p) { zapamatuj(); kresbyListu().push(t); } kresliAnn(); }
      }
      if (akce.vyrez) {
        const [cx, cy] = bod(e); V.vyb.style.display = 'none';
        const a = naPohled(Math.min(cx, akce.x), Math.min(cy, akce.y)), b = naPohled(Math.max(cx, akce.x), Math.max(cy, akce.y));
        const x0 = Math.max(0, a[0]), y0 = Math.max(0, a[1]), x1 = Math.min(V.w, b[0]), y1 = Math.min(V.h, b[1]);
        if ((x1 - x0) * V.s > 8 && (y1 - y0) * V.s > 8) vytvorVyrez([x0, y0, x1, y1]);
        else napoveda('Výřez je moc malý – táhněte myší přes větší plochu.');
      }
      akce = null;
    };
    st.addEventListener('pointerup', konec); st.addEventListener('pointercancel', konec);
  }
  function textNa(cx, cy) {
    const st = V.st, inp = document.createElement('input'); inp.className = 'dkv-txt'; inp.placeholder = 'Napište text a Enter';
    inp.style.left = cx + 'px'; inp.style.top = (cy - 18) + 'px'; inp.style.color = V.barva;
    st.appendChild(inp); inp.focus(); setTimeout(() => inp.focus(), 0);
    const p = naList(cx, cy + 8), vel = 18 / V.s;
    let hotovo = false;
    const ok = () => { if (hotovo) return; hotovo = true; const s = inp.value.trim(); inp.remove(); if (s && V) { zapamatuj(); kresbyListu().push({t: 'text', b: V.barva, x: p[0], y: p[1], v: vel * (0.75 + V.tl / 4), tl: V.tl, s, a: -V.rot}); kresliAnn(); } };
    inp.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') ok(); if (e.key === 'Escape') { hotovo = true; inp.remove(); } };
    inp.onblur = ok;
    inp.onpointerdown = e => e.stopPropagation();
  }

  /* ---------- výřez ---------- */
  async function vytvorVyrez(obl) {
    napoveda('Připravuji výřez…', 2500);
    const o = await obrazOblasti(obl, 3000); if (!o) return;
    vyrezDialog(o.c, o.blob, o.popis);
  }
  async function obrazOblasti(obl, maxPx, celek) {
    const [x0, y0, x1, y1] = obl, w = x1 - x0, h = y1 - y0;
    // rozlišení: ostré i při malém výřezu, nejvýš ~maxPx na delší straně
    const k = celek ? maxPx / Math.max(w, h) : Math.max(1, Math.min(maxPx / Math.max(w, h), Math.max(V.s * 2, 2400 / Math.max(w, h)), 12));
    const W = Math.round(w * k), Hh = Math.round(h * k), pata = Math.max(26, Math.round(W / 55));
    const c = document.createElement('canvas'); c.width = W; c.height = Hh + pata;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    try {
      if (V.page) await V.page.render({canvas: c, canvasContext: g, viewport: V.page.getViewport({scale: k, rotation: rotPdf()}), transform: [1, 0, 0, 1, -x0 * k, -y0 * k]}).promise;
      else if (V.img) { g.save(); g.beginPath(); g.rect(0, 0, W, Hh); g.clip(); g.setTransform(k, 0, 0, k, -x0 * k, -y0 * k); g.transform(...rotM()); g.drawImage(V.img, 0, 0, V.w0, V.h0); g.restore(); }
    } catch (e) { toast('Obrázek výkresu se nepodařilo připravit.'); return null; }
    g.save(); g.beginPath(); g.rect(0, 0, W, Hh); g.clip(); g.setTransform(k, 0, 0, k, -x0 * k, -y0 * k); g.transform(...rotM()); kresbyListu().forEach(t => kresliNaCanvas(g, t)); g.restore();
    // popisek dole: odkud výřez je
    g.fillStyle = '#16191c'; g.fillRect(0, Hh, W, pata);
    g.fillStyle = '#F4D23C'; g.fillRect(0, Hh, Math.round(pata * 0.35), pata);
    g.fillStyle = '#fff'; g.font = `600 ${Math.round(pata * 0.5)}px "Hanken Grotesk", Arial, sans-serif`; g.textBaseline = 'middle';
    const popis = `${V.rec.nazev}${V.pocet > 1 ? ' · list ' + V.str : ''} · ${celek ? 'vytištěno' : 'výřez'} ${new Date().toLocaleDateString('cs-CZ')}${kdo() ? ' · ' + kdo() : ''}`;
    let t = popis; while (g.measureText(t).width > W - pata && t.length > 10) t = t.slice(0, -2);
    g.fillText(t === popis ? t : t + '…', Math.round(pata * 0.7), Hh + pata / 2);
    const blob = await new Promise(res => c.toBlob(res, 'image/png'));
    return {c, blob, popis};
  }
  // tisk: celý list (v otočení, jak je na obrazovce) i s nakreslenými značkami
  async function tisk() {
    if (!V || !V.rec) return;
    napoveda('Připravuji tisk…', 4000);
    const o = await obrazOblasti([0, 0, V.w, V.h], 4200, true); if (!o) return;
    const url = URL.createObjectURL(o.blob), f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;width:0;height:0;border:0;left:-10px;top:-10px';
    document.body.appendChild(f);
    const d = f.contentDocument;
    d.open(); d.write(`<!doctype html><html><head><title>${esc(V.rec.nazev)}</title><style>@page{size:${V.w >= V.h ? 'landscape' : 'portrait'};margin:8mm}html,body{margin:0;height:100%}img{display:block;max-width:100%;max-height:100%;margin:auto;object-fit:contain}</style></head><body><img alt=""></body></html>`); d.close();
    const img = d.querySelector('img');
    img.onload = () => { setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { toast('Tisk se nepodařilo spustit.'); } setTimeout(() => { f.remove(); URL.revokeObjectURL(url); }, 60000); }, 100); };
    img.src = url;
  }
  function vyrezDialog(c, blob, popis) {
    const url = URL.createObjectURL(blob);
    const jmeno = 'vyrez-' + (V.rec.nazev || 'vykres').replace(/\.[^.]+$/, '').replace(/[^\wÀ-ſ-]+/g, '-').slice(0, 50) + (V.pocet > 1 ? '-list' + V.str : '') + '-' + new Date().toISOString().slice(0, 10) + '.png';
    const o = document.createElement('div'); o.className = 'dkv-out';
    const zpravaOk = H && typeof H.zprava === 'function';
    // 4.60: výřez se hned uloží do schránky Constructa (a zkusí se i do schránky počítače) – ve zprávě ho vložíte Ctrl+V nebo tlačítkem
    const dataUrl = (() => { const k = Math.min(1, 1800 / Math.max(c.width, c.height)), j = document.createElement('canvas'); j.width = Math.round(c.width * k); j.height = Math.round(c.height * k);
      const g = j.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, j.width, j.height); g.drawImage(c, 0, 0, j.width, j.height); return j.toDataURL('image/jpeg', 0.85); })();
    ulozSchranku(dataUrl, popis);
    o.innerHTML = `<div class="bx" role="dialog" aria-modal="true"><h3>Výřez z výkresu</h3><img src="${url}" alt="Výřez"><small>${esc(popis)}</small>
      <div class="dk-kop" id="dk-kop" role="status">✓ Zkopírováno do schránky Constructa. Ve zprávě ho vložíte tlačítkem <b>📋 Vložit zkopírovaný výřez</b>.</div>
      <div class="ak">
        <button type="button" class="dk-btn hl" data-o="kop"><b>⧉</b> Kopírovat</button>
        ${zpravaOk ? `<button type="button" class="dk-btn zl" data-o="zprava">${esc(H.zpravaText || 'Poslat ve zprávě (kolegům / firmě)')}</button>` : ''}
        ${ro() ? '' : '<button type="button" class="dk-btn" data-o="ulozit">Uložit do Dokumentace › Výřezy</button>'}
        <button type="button" class="dk-btn" data-o="stahnout">⬇ Stáhnout obrázek</button>
        <button type="button" class="dk-btn" data-o="zavrit">Zavřít</button>
      </div><small>${dotyk() ? 'Zkopírovaný výřez vložíte do WhatsAppu, e-mailu nebo zprávy (podržet prst → Vložit).' : 'Zkopírovaný výřez vložíte kamkoli: do e-mailu, Wordu, WhatsAppu nebo do záznamu (Ctrl+V, na Macu ⌘+V).'}</small></div>`;
    document.body.appendChild(o);
    const pryc = () => { o.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
    o.onclick = e => { if (e.target === o) pryc(); };
    o.querySelector('[data-o="zavrit"]').onclick = pryc;
    const kopBtn = o.querySelector('[data-o="kop"]'), kopInfo = o.querySelector('#dk-kop');
    const kopiruj = async ruc => {
      try {
        if (!navigator.clipboard || !window.ClipboardItem) throw new Error('neumí');
        await navigator.clipboard.write([new ClipboardItem({'image/png': blob})]);
        kopBtn.innerHTML = '<b>✓</b> Zkopírováno'; kopBtn.classList.add('ok');
        kopInfo.innerHTML = '✓ <b>Zkopírováno.</b> Vložíte ho kamkoli: do zprávy v Constructu, e-mailu, Wordu nebo WhatsAppu (' + (dotyk() ? 'podržet prst → Vložit' : 'Ctrl+V, na Macu ⌘+V') + ').';
      } catch (e) { if (ruc) kopInfo.innerHTML = '✓ Zkopírováno do schránky Constructa – ve zprávě dejte <b>📋 Vložit zkopírovaný výřez</b>. (Do schránky počítače tento prohlížeč kopírovat nedovolil, do jiných programů použijte ⬇ Stáhnout obrázek.)'; }
      kopInfo.classList.remove('blik'); void kopInfo.offsetWidth; kopInfo.classList.add('blik');
    };
    kopBtn.onclick = () => kopiruj(true);
    kopiruj(false);
    o.querySelector('[data-o="stahnout"]').onclick = () => { const a = document.createElement('a'); a.href = url; a.download = jmeno; document.body.appendChild(a); a.click(); a.remove(); };
    const ul = o.querySelector('[data-o="ulozit"]');
    if (ul) ul.onclick = () => {
      const s = zalozSlozku('Výřezy', '');
      pridejDoFronty([{file: new File([blob], jmeno, {type: 'image/png'}), rodic: s ? s.id : ''}]);
      toast('Výřez se ukládá do Dokumentace › Výřezy. Uvidí ho i kolegové.'); pryc();
    };
    const zp = o.querySelector('[data-o="zprava"]');
    if (zp) zp.onclick = () => { pryc(); zavri(); H.zprava(dataUrl, popis); };
  }
  /* ---------- schránka Constructa: poslední výřez (pro vložení do zprávy i bez schránky počítače) ---------- */
  let SCHR = null;
  function ulozSchranku(dataUrl, popis) {
    SCHR = {dataUrl, popis: popis || '', kdy: Date.now()};
    try { localStorage.setItem('cx-schranka', JSON.stringify(SCHR)); } catch (e) {}
  }
  function schranka() {
    if (!SCHR) { try { SCHR = JSON.parse(localStorage.getItem('cx-schranka') || 'null'); } catch (e) {} }
    return SCHR && Date.now() - SCHR.kdy < 7 * 864e5 ? SCHR : null;
  }
  // první strana PDF jako obrázek (pro vložení PDF do zprávy)
  async function pdfNaObrazek(file, max) {
    const lib = await pdfjs();
    const doc = await lib.getDocument({data: new Uint8Array(await file.arrayBuffer()), standardFontDataUrl: BASE + 'pdfjs/standard_fonts/', wasmUrl: BASE + 'pdfjs/wasm/', isEvalSupported: false}).promise;
    try {
      const pg = await doc.getPage(1), v1 = pg.getViewport({scale: 1}), k = (max || 2000) / Math.max(v1.width, v1.height);
      const c = document.createElement('canvas'), vp = pg.getViewport({scale: k}); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      await pg.render({canvas: c, canvasContext: g, viewport: vp}).promise;
      return c.toDataURL('image/jpeg', 0.85);
    } finally { try { doc.destroy(); } catch (e) {} }
  }

  /* ---------- veřejné rozhraní ---------- */
  // všechny strany PDF (soubor z Disku Google podle id) jako obrázky – Detail zprávy
  async function pdfStrany(r, max) {
    const blob = await nactiSoubor(r), lib = await pdfjs();
    const doc = await lib.getDocument({data: new Uint8Array(await blob.arrayBuffer()), standardFontDataUrl: BASE + 'pdfjs/standard_fonts/', wasmUrl: BASE + 'pdfjs/wasm/', isEvalSupported: false}).promise;
    const out = [];
    try {
      for (let n = 1; n <= Math.min(doc.numPages, 12); n++) {
        const pg = await doc.getPage(n), v1 = pg.getViewport({scale: 1}), k = (max || 1100) / Math.max(v1.width, v1.height), vp = pg.getViewport({scale: k});
        const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        await pg.render({canvas: c, canvasContext: g, viewport: vp}).promise; out.push(c.toDataURL('image/jpeg', 0.82));
      }
    } finally { try { doc.destroy(); } catch (e) {} }
    return out;
  }
  window.CXDok = {
    schranka, pdfNaObrazek, pdfStrany,
    // host: {seznam(), upsert(recs), smaz(ids), kdo(), volej(body)→Promise, pripojeno(), ro(), toast(m), zprava?(dataUrl, popis), zkouska?}
    async pripoj(host) {
      H = host; styl();
      if (!S.fronta.length) { try { S.fronta = (await frontaVse()).sort((a, b) => String(a.kdy).localeCompare(String(b.kdy))); S.fronta.forEach(q => { q.bezi = false; q.pauza = 0; }); } catch (e) {} }
      if (S.fronta.length) { prekresliFrontu(); zpracujFrontu(); }
    },
    vykresli(el) { EL = el; vykresli(); },
    nahraj(soubory) { return prijmi(soubory || []); },   // [{file, cesta: ['Složka', 'Podsložka']}] do právě otevřené složky
    // 5.13: nahrání do pevné složky od kořene (Předání díla → ČSN), nezávisle na tom, co je v Dokumentaci otevřené
    nahrajDo(koren, soubory) { const s0 = S.slozka; S.slozka = ''; try { return prijmi((soubory || []).map(x => ({file: x.file, cesta: [...(koren || []), ...(x.cesta || [])]}))); } finally { S.slozka = s0; } },
    obnov() { if (EL && EL.isConnected && !document.querySelector('.dkv-out')) { const q = EL.querySelector('.dk-q'), f = q && document.activeElement === q; if (!f) vykresli(); } prekresliFrontu(); },
    otevri(id) { const r = najdi(id); if (r) otevri(r); },
    zavri,
    get otevreno() { return !!V; },
  };
})();
