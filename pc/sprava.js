/* Constructo – Správa stavby: jedno místo pro nastavení stavby, stejné v Managementu (/pc/) i v Deníku (/denik/).
   Záložky: Údaje o stavbě · Firmy / osoby na projektu · Kolegové · Lidé a role.
   Všechno se ukládá do údajů stavby (D.project) a odtud se propisuje do všech částí Constructa
   (úkoly, záznamy, zprávy, docházka, fakturace, mobil, Deník).
   Použití: CXSprava.panel(element, host, zalozka)
     host.projekt()        → aktuální D.project (jen čtení)
     host.uloz(fn)         → fn(P) upraví kopii údajů stavby, host ji uloží (může vrátit Promise)
     host.ro(), host.admin(), host.ja(), host.toast(t), host.prepni(zalozka)
     nepovinné: host.ares(ico), host.prejmenuj(stare, nove), host.pozvat(jmeno), host.fakturace(po),
                host.poUlozeniUdaju(vals), host.firmy (další volby pro CXFirmy: pocetZprav, zpravy), host.misto (Management / Deník) */
const CXSprava = (() => {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯˇ´˘˚¨]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const EMAIL_RE = /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/;
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // 4.83: stejně jako v Deníku – Správa stavby → Detail a Role a lidé (Firmy / osoby na projektu mají vlastní položku v nabídce)
  const ZALOZKY = [['detail', 'Detail'], ['lide', 'Role a lidé']];
  const ALIAS = {udaje: 'detail', kolegove: 'lide'};
  // ikony – stejné obrázky v Managementu i Deníku (data-URI pro CSS masku)
  const svg = p => `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E${p}%3C/svg%3E")`;
  const IKONY = {
    sprava: svg("%3Cpath d='M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h2a2 2 0 0 1 2 2v10M3 21h18M8 7h4M8 11h4M8 15h4'/%3E"),
    detail: svg("%3Crect x='4' y='3' width='16' height='18' rx='2'/%3E%3Cpath d='M8 8h8M8 12h8M8 16h5'/%3E"),
    udaje: svg("%3Crect x='4' y='3' width='16' height='18' rx='2'/%3E%3Cpath d='M8 8h8M8 12h8M8 16h5'/%3E"),
    firmy: svg("%3Crect x='3' y='7' width='18' height='13' rx='2'/%3E%3Cpath d='M8 7V4h8v3M3 13h18'/%3E"),
    kolegove: svg("%3Ccircle cx='9' cy='8' r='3.5'/%3E%3Cpath d='M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5'/%3E%3Ccircle cx='17' cy='9' r='2.8'/%3E%3Cpath d='M17.5 14.6c2.2.4 3.6 2.2 4 5.4'/%3E"),
    lide: svg("%3Ccircle cx='12' cy='7' r='3.5'/%3E%3Cpath d='M5 21c.8-4 3.6-6 7-6s6.2 2 7 6'/%3E%3Cpath d='M17 4.5l1.5 1.5L21 3.5'/%3E"),
  };

  // pozice a oprávnění kolegů (stejná pravidla v Managementu i Deníku)
  const POZICE = ['Mistr', 'Stavbyvedoucí', 'Přípravář', 'Rozpočtář', 'Manažer projektu'];
  const PRAVA = [['rozp', 'Vidí rozpočet a ceny', 'záložka Rozpočet, ceny, fakturace'], ['fakt', 'Připravuje faktury', 'vybírá položky, rozsah v MJ nebo %, vytvoří fakturu'], ['fakU', 'Uzavírá faktury kódem z e-mailu', 'jen manažer projektu, případně stavbyvedoucí'], ['doch', 'Vidí docházku', 'záložka Docházka: kdo je na stavbě, poloha, přehledy, denní PDF e-mailem v 19:00'], ['adm', 'Administrace', 'mazání z Harmonogramu, seznam podlaží, role a oprávnění, Správa stavby a nastavení – jen manažer projektu']];
  const PRAVA_VYCH = {rozp: true, fakt: true, fakU: false};
  const PRAVA_POZICE = {'Manažer projektu': {rozp: true, fakt: true, fakU: true, doch: true, adm: true}, 'Stavbyvedoucí': {rozp: true, fakt: true, fakU: true, doch: true}, 'Rozpočtář': {rozp: true, fakt: true, fakU: false, doch: false}, 'Přípravář': {rozp: true, fakt: true, fakU: false, doch: false}, 'Mistr': {rozp: false, fakt: false, fakU: false, doch: false}};
  const ACCESS = {zapisuje: ['Zapisuje', 'zadává úkoly, píše záznamy'], nahlizi: ['Jen nahlíží', 'vidí vše, nic nemění']};
  // role na stavbě: kdo smí do Managementu a jak do Deníku
  const DENIK_PR = {zapis: 'Zapisuje', cteni: 'Jen čte', ne: 'Bez přístupu'};
  const NIC = {rozp: false, fakt: false, fakU: false, doch: false, adm: false};
  const ROLE_DEF = [
    {id: 'spravce', nazev: 'Správce stavby', mgmt: true, denik: 'zapis', prava: {rozp: true, fakt: true, fakU: true, doch: true, adm: true}},
    {id: 'vedeni', nazev: 'Vedení stavby', mgmt: true, denik: 'zapis', prava: {rozp: true, fakt: true, fakU: false, doch: true}},
    {id: 'subdodavatel', nazev: 'Subdodavatel (firma)', mgmt: false, denik: 'zapis', prava: NIC},
    {id: 'dozor', nazev: 'TDS, investor, BOZP', mgmt: false, denik: 'cteni', prava: NIC}];
  // 4.92: přístup do Deníku zvlášť pro vlastní deník (deník své firmy) a pro deníky ostatních firem – nahlíží / zapisuje.
  // Uloženo u role jako denikPr {svC, svZ, ostC, ostZ}; r.denik (zapis / cteni / ne) zůstává pro starší verze.
  // Příklad (Luboš 23. 11. 2026): GD (vedení) vše; TDS / investor svůj píše i čte, ostatní jen čte; subdodavatel jen svůj.
  const DEN_SL = [['svC', 'Nahlíží'], ['svZ', 'Zapisuje'], ['ostC', 'Nahlíží'], ['ostZ', 'Zapisuje']];
  const DEN_VSE = {svC: true, svZ: true, ostC: true, ostZ: true};
  const DEN_VYCH = {spravce: DEN_VSE, vedeni: DEN_VSE, subdodavatel: {svC: true, svZ: true, ostC: false, ostZ: false}, dozor: {svC: true, svZ: true, ostC: true, ostZ: false}};
  const denZeStareho = d => d === 'zapis' ? {svC: true, svZ: true, ostC: false, ostZ: false} : d === 'cteni' ? {svC: true, svZ: false, ostC: false, ostZ: false} : {svC: false, svZ: false, ostC: false, ostZ: false};
  const denKod = x => x.svZ || x.ostZ ? 'zapis' : x.svC || x.ostC ? 'cteni' : 'ne';
  // sloupce „co vidí“ v tabulce rolí (krátké názvy)
  const PRAVA_KRATCE = {rozp: 'Rozpočet a ceny', fakt: 'Připravuje faktury', fakU: 'Uzavírá faktury', doch: 'Docházka', adm: 'Administrace'};
  const STAV = {aktivni: 'Probíhá', priprava: 'V přípravě', pozastavena: 'Pozastavená', dokoncena: 'Dokončená'};

  const ADMINS = P => [...new Set(['Luboš Kozák', ...(Array.isArray(P.admins) ? P.admins : [])])]; // autor Luboš Kozák je správce vždy
  const tym = P => Array.isArray(P.team) ? P.team.filter(n => n && n !== 'Bez přiřazení') : [];
  const osoba = (P, n) => (P.people && P.people[n]) || {};
  function emaily(p) {
    const rep = String(p.email || '').split(/[,;\s]+/).filter(Boolean), list = Array.isArray(p.emails) ? p.emails.filter(x => x && x.a) : [];
    if (list.filter(x => x.rep).map(x => x.a).join(',') === rep.join(',')) return list.map(x => ({a: x.a, rep: !!x.rep}));
    return [...rep.map(a => ({a, rep: true})), ...list.filter(x => !rep.includes(x.a)).map(x => ({a: x.a, rep: false}))];
  }
  function pravaOf(P, n) {
    if (n && ADMINS(P).includes(n)) return {rozp: true, fakt: true, fakU: true, doch: true, adm: true};
    const p = n ? osoba(P, n) : {}, x = Object.assign({}, PRAVA_VYCH, p.prava || {});
    if (!(p.prava && 'doch' in p.prava)) x.doch = ['Manažer projektu', 'Stavbyvedoucí'].includes(p.role);
    if (!(p.prava && 'adm' in p.prava)) x.adm = p.role === 'Manažer projektu';
    if (p.access === 'nahlizi') x.adm = false;
    if (p.access === 'nahlizi') { x.fakt = false; x.fakU = false; }
    if (x.fakU) x.fakt = true; if (x.fakt) x.rozp = true;
    return x;
  }
  const rolesOf = P => (Array.isArray(P.roleStavby) && P.roleStavby.length ? P.roleStavby : ROLE_DEF).map(r => {
    const d = ROLE_DEF.find(x => x.id === r.id), x = Object.assign({}, r);
    x.prava = Object.assign({}, NIC, (d && d.prava) || {}, r.prava || {}); if (x.id === 'spravce') x.prava = Object.assign({}, ROLE_DEF[0].prava);
    x.denikPr = Object.assign({}, r.denikPr ? {} : DEN_VYCH[x.id] || denZeStareho(r.denik), r.denikPr || {}); if (x.id === 'spravce') x.denikPr = Object.assign({}, DEN_VSE);
    x.denik = denKod(x.denikPr);
    return x;
  });
  // oprávnění role se propíšou kolegům s touto rolí (pak je jde u člověka ještě upravit v Upravit)
  function pravaRoleKolegum(P, lide, roles) {
    const pp = Object.assign({}, P.people || {}), adm = ADMINS(P);
    lide.filter(x => x.skup === 'kolegove' && !adm.includes(x.jmeno)).forEach(x => { const r = roles.find(y => y.id === x.role); if (!r) return; const fx = Object.assign({}, r.prava); if (fx.fakU) fx.fakt = true; if (fx.fakt) fx.rozp = true; pp[x.jmeno] = Object.assign({}, pp[x.jmeno] || {}, {prava: fx, _ts: Date.now()}); });
    P.people = pp;
  }
  const smazano = (P, k, id) => { const s = Object.assign({}, P.smazane || {}); s[k] = Object.assign({}, s[k] || {}, {[id]: Date.now()}); P.smazane = s; };

  // všichni lidé na stavbě – sestaveno z Kolegů, pracovníků firem (Dodavatel), Objednatele a ručně přidaných
  function lideNaStavbe(P) {
    const cl = Array.isArray(P.clenove) ? P.clenove : [], out = [], vzaty = new Set();
    const najdi = (zdroj, jmeno, firma) => {
      let c = cl.find(x => x.zdroj === zdroj);
      if (!c && jmeno) c = cl.find(x => !x.zdroj && !vzaty.has(x) && fold(x.jmeno) === fold(jmeno) && (!firma || !x.firma || fold(x.firma) === fold(firma)));
      if (c) vzaty.add(c); return c;
    };
    const adm = ADMINS(P), zh = P.company || '';
    tym(P).forEach(n => { const p = osoba(P, n), c = najdi('k:' + n, n, p.company || zh); out.push({skup: 'kolegove', zdroj: 'k:' + n, jmeno: n, firma: p.company || zh, email: emaily(p).map(x => x.a)[0] || '', tel: p.phone || '', pozice: p.role || '', role: (c && c.role) || (adm.includes(n) ? 'spravce' : 'vedeni')}); });
    (Array.isArray(P.firmy) ? P.firmy : []).filter(f => f && f.id).sort((a, b) => String(a.firma).localeCompare(String(b.firma), 'cs')).forEach(f => {
      const ks = window.CXFirmy ? CXFirmy.kontakty(f) : (f.kontakty || []);
      if (!ks.length) { const c = najdi('f:' + f.id, '', f.firma); out.push({skup: 'dod', zdroj: 'f:' + f.id, jmeno: '', firma: f.firma, email: f.email || '', tel: f.tel || '', pozice: 'firma', role: (c && c.role) || 'subdodavatel'}); return; }
      ks.forEach(k => { const z = 'f:' + f.id + ':' + k.id, c = najdi(z, k.jmeno, f.firma); out.push({skup: 'dod', zdroj: z, jmeno: k.jmeno || '', firma: f.firma, email: k.email || '', tel: k.tel || '', pozice: k.funkce || '', role: (c && c.role) || 'subdodavatel'}); });
    });
    (Array.isArray(P.prijemci) ? P.prijemci : []).filter(x => x && x.id).forEach(x => { const c = najdi('p:' + x.id, x.jmeno, x.firma); out.push({skup: 'obj', zdroj: 'p:' + x.id, jmeno: x.jmeno || '', firma: x.firma || '', email: x.email || '', tel: x.tel || '', pozice: x.kdo || '', role: (c && c.role) || 'dozor'}); });
    cl.filter(c => !vzaty.has(c) && (c.zdroj === 'ruc' || !c.zdroj) && (c.jmeno || c.firma)).forEach(c => out.push({skup: 'ruc', zdroj: 'ruc', id: c.id, jmeno: c.jmeno || '', firma: c.firma || '', email: c.email || '', tel: c.tel || '', pozice: c.pozice || '', role: c.role || 'subdodavatel'}));
    return out;
  }
  // uloží role všech lidí do P.clenove (+ správci stavby = role Správce stavby)
  function zapisClenove(P, lide) {
    P.clenove = lide.map(x => ({id: x.id || 'c' + uid(), zdroj: x.zdroj, jmeno: x.jmeno, firma: x.firma, role: x.role, email: x.email, tel: x.tel, pozice: x.pozice}));
    const spr = lide.filter(x => x.skup === 'kolegove' && x.role === 'spravce').map(x => x.jmeno);
    if (spr.length) P.admins = spr;
  }

  let cssOk = false;
  function css() {
    if (cssOk) return; cssOk = true;
    const s = document.createElement('style'); s.id = 'cxs-css';
    s.textContent = `
.cxs{--k:#131518;--y:#F4D23C;--l:#dcdcd5;--m:#5f676d;--b:#fff;--r:#c0332b;font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:var(--k);max-width:1400px}
.cxs *{box-sizing:border-box}.cxs button{font:inherit;cursor:pointer}
.cxs-tabs{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 16px;background:var(--b);border:1px solid var(--l);border-radius:14px;padding:8px}
.cxs-tab{border:1px solid transparent;background:none;color:var(--k);border-radius:10px;padding:9px 14px 9px 40px;font-weight:700;font-size:14.5px;position:relative}
.cxs-tab::before{content:"";position:absolute;left:13px;top:50%;width:19px;height:19px;margin-top:-9.5px;background:currentColor;-webkit-mask:var(--ico) center/contain no-repeat;mask:var(--ico) center/contain no-repeat}
.cxs-tab:hover{border-color:var(--l)}
.cxs-tab[aria-pressed="true"]{background:var(--k);color:#fff}
.cxs-card{background:var(--b);border:1px solid var(--l);border-radius:14px;margin-bottom:16px;overflow:hidden}
.cxs-h{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;padding:12px 14px;border-bottom:1px solid var(--l);background:#fafaf7}
.cxs-h b{font-size:17px;font-weight:800}.cxs-h span{font-size:12.5px;color:var(--m)}.cxs-h .sp{flex:1}
.cxs-body{padding:14px}
.cxs-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.cxs-grid .full{grid-column:1/-1}.cxs-grid .half{grid-column:span 2}
.cxs label.l{display:block;font-size:12.5px;font-weight:700;margin-bottom:5px}
.cxs input:not([type=checkbox]):not([type=radio]),.cxs select,.cxs textarea{width:100%;min-width:0;font:inherit;font-size:15px;padding:9px 11px;border:1px solid #c9c9c1;border-radius:10px;background:#fff;color:var(--k)}
.cxs input:disabled,.cxs select:disabled,.cxs textarea:disabled{background:#f4f4f1;color:#333}
.cxs-b{border:1px solid var(--l);background:var(--b);color:var(--k);border-radius:10px;padding:7px 13px;font-weight:600;font-size:13.5px;white-space:nowrap}
.cxs-b:hover{border-color:var(--k)}
.cxs-b.pri{background:var(--k);color:#fff;border-color:var(--k)}
.cxs-b.add{background:var(--y);border-color:var(--k);font-weight:700}
.cxs-b.del{color:var(--r)}.cxs-b.del.arm{background:var(--r);color:#fff;border-color:var(--r)}
.cxs-foot{display:flex;gap:8px;justify-content:flex-end;padding:12px 14px;border-top:1px solid var(--l);flex-wrap:wrap;align-items:center}
.cxs-foot .hint{flex:1;font-size:12.5px;color:var(--m)}
.cxs-row{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1.4fr) minmax(0,1fr) auto;gap:6px 14px;padding:11px 14px;border-bottom:1px solid #eeeee8;align-items:center}
.cxs-row:last-child{border-bottom:0}
.cxs-row.r5{grid-template-columns:minmax(0,1.3fr) minmax(0,1.4fr) minmax(0,1fr) 200px auto}
.cxs-row select{font-size:14px;padding:7px 9px}
.cxs-row b.n{display:block;font-size:15px}.cxs-row small{display:block;font-size:12px;color:var(--m);margin-top:2px}
.cxs-row a{color:var(--k)!important}
.cxs-a{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
.cxs-av{display:inline-flex;width:30px;height:30px;border-radius:50%;background:var(--k);color:var(--y);font-weight:800;font-size:12px;align-items:center;justify-content:center;margin-right:9px;flex:none}
.cxs-nm{display:flex;align-items:center}
.cxs-tag{display:inline-block;font-size:11.5px;font-weight:700;border-radius:8px;padding:2px 8px;background:#f1f1ec;margin:2px 4px 0 0}
.cxs-tag.y{background:var(--y)}
.cxs-tab-r{width:100%;border-collapse:collapse}
.cxs-tab-r th{text-align:left;font-size:11.5px;color:var(--m);font-weight:700;padding:6px 8px;border-bottom:1px solid var(--l)}
.cxs-tab-r th.cxs-dg{border-bottom:0;text-align:center;background:rgba(244,210,60,.14)}.cxs-tab-r th.cxs-dg small{display:block;font-weight:500;font-size:10.5px}.cxs-tab-r th.cxs-ds{background:rgba(244,210,60,.14);font-weight:600}
.cxs-tab-r td{padding:6px 8px;border-bottom:1px solid #eeeee8;vertical-align:middle}
.cxs-tab-r td.c,.cxs-tab-r th.c{text-align:center}
.cxs-tab-r input[type=checkbox]{width:18px;height:18px;accent-color:#131518}
.cxs-lr{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1.1fr) minmax(0,1.3fr) 220px auto;gap:6px 12px;padding:9px 14px;border-bottom:1px solid #eeeee8;align-items:center}
.cxs-lr:last-child{border-bottom:0}
.cxs-lr select{font-size:14px;padding:7px 9px}
.cxs-sub{padding:8px 14px;background:#fafaf7;border-bottom:1px solid #eeeee8;font-weight:800;font-size:14px}
.cxs-empty{padding:14px;color:var(--m)}
.cxs-note{margin:0 0 14px;padding:10px 14px;border-radius:12px;background:#FFF7D1;border:1px solid #E8D27A;font-size:13.5px}
.cxs-ov{position:fixed;inset:0;background:rgba(19,21,24,.55);z-index:100000;display:flex;align-items:flex-start;justify-content:center;padding:4vh 12px;overflow:auto}
.cxs-m{background:#fff;color:#131518;border-radius:16px;width:min(720px,100%);box-shadow:0 20px 60px rgba(0,0,0,.35)}
.cxs-mh{display:flex;align-items:center;gap:10px;padding:16px 18px;border-bottom:1px solid #dcdcd5}.cxs-mh h3{margin:0;font-size:19px;font-weight:800;flex:1}
.cxs-mb{padding:16px 18px;display:flex;flex-direction:column;gap:12px}
.cxs-mf{display:flex;gap:8px;justify-content:flex-end;padding:14px 18px;border-top:1px solid #dcdcd5}
.cxs-x{border:0;background:none;font-size:22px;line-height:1;padding:4px 8px;cursor:pointer}
.cxs-opt{display:flex;flex-direction:column;gap:6px}
.cxs-opt label{display:flex;gap:9px;align-items:flex-start;font-weight:600;font-size:14px}
.cxs-opt label span{display:block;font-weight:400;font-size:12px;color:#5f676d}
.cxs-opt input{width:18px;height:18px;margin-top:2px;accent-color:#131518;flex:none}
.cxs .hint{font-size:12.5px;color:var(--m);margin:0}
@media (max-width:900px){.cxs-grid{grid-template-columns:1fr 1fr}.cxs-row,.cxs-row.r5,.cxs-lr{grid-template-columns:1fr}.cxs-a{justify-content:flex-start}}
@media (max-width:560px){.cxs-grid{grid-template-columns:1fr}.cxs-grid .half{grid-column:auto}.cxs-ov{padding:0}.cxs-m{border-radius:0;min-height:100%}}`;
    document.head.appendChild(s);
  }

  function okno(titul, telo, ok, onOk, toast) {
    const ov = document.createElement('div'); ov.className = 'cxs-ov cxs';
    ov.style.maxWidth = 'none';
    ov.innerHTML = `<div class="cxs-m" role="dialog" aria-modal="true" aria-label="${esc(titul)}"><div class="cxs-mh"><h3>${esc(titul)}</h3><button type="button" class="cxs-x" data-z aria-label="Zavřít">✕</button></div>
      <div class="cxs-mb">${telo}</div><div class="cxs-mf"><button type="button" class="cxs-b" data-z>Zrušit</button><button type="button" class="cxs-b pri" data-ok>${esc(ok)}</button></div></div>`;
    const zavri = () => { ov.remove(); document.removeEventListener('keydown', k); };
    const k = e => { if (e.key === 'Escape') zavri(); };
    document.addEventListener('keydown', k);
    ov.querySelectorAll('[data-z]').forEach(b => b.onclick = zavri);
    ov.querySelector('[data-ok]').onclick = async () => {
      const b = ov.querySelector('[data-ok]'); if (b.disabled) return; b.disabled = true;
      try { if (await onOk(ov) !== 'keep') zavri(); } catch (e) { toast(e && e.message ? e.message : String(e)); }
      b.disabled = false;
    };
    document.body.appendChild(ov);
    return ov;
  }

  function panel(el, host, zal) {
    css();
    const toast = t => host.toast ? host.toast(t) : console.warn(t);
    const ro = () => !!(host.ro && host.ro());
    const admin = () => !ro() && !!(host.admin && host.admin());
    const P = () => host.projekt() || {};
    zal = ALIAS[zal] || zal; if (!ZALOZKY.some(z => z[0] === zal) && zal !== 'firmy') zal = 'detail';
    const uloz = async fn => { await host.uloz(fn); };

    function render() {
      const tabs = `<div class="cxs-tabs" role="tablist">${ZALOZKY.map(([k, n]) => `<button type="button" class="cxs-tab" role="tab" data-z="${k}" aria-pressed="${zal === k}">${n}</button>`).join('')}</div>`;
      el.innerHTML = `<div class="cxs">${zal === 'firmy' ? '' : tabs}<div class="cxs-obsah"></div></div>`;
      el.querySelectorAll('.cxs-tab[data-z]').forEach(b => b.style.setProperty('--ico', IKONY[b.dataset.z]));
      el.querySelectorAll('[data-z]').forEach(b => b.onclick = () => { if (host.prepni) host.prepni(b.dataset.z); else { zal = b.dataset.z; render(); } });
      const box = el.querySelector('.cxs-obsah');
      if (zal === 'detail') udaje(box);
      else if (zal === 'firmy') firmy(box);
      else lide(box);
    }

    /* ---------- 1. Údaje o stavbě ---------- */
    function udaje(box) {
      const p = P(), R = !admin();
      const f = (id, label, v, extra = '', cls = '') => `<div class="${cls}"><label class="l" for="cxs-${id}">${label}</label><input id="cxs-${id}" value="${esc(v || '')}" ${extra}${R ? ' disabled' : ''}></div>`;
      const fak = (p.fakturace && p.fakturace.dod) || {};
      box.innerHTML = `${R ? '<p class="cxs-note">Údaje o stavbě upravuje správce stavby. Vy je vidíte jen pro čtení.</p>' : ''}
        <section class="cxs-card"><div class="cxs-h"><b>Základní údaje</b><span>název a adresa – ukazují se v Managementu, Deníku, mobilu, PDF i e-mailech</span></div><div class="cxs-body cxs-grid">
          ${f('name', 'Název stavby', p.name, 'placeholder="např. Hybernská 1000/8"', 'full')}
          ${f('ulice', 'Ulice a číslo', p.ulice, 'placeholder="Ulice"', 'half')}
          ${f('mesto', 'Město', p.mesto, 'placeholder="Město"')}
          ${f('psc', 'PSČ', p.psc, 'placeholder="PSČ" inputmode="numeric"')}
          ${f('stat', 'Stát', p.stat || 'Česká republika', 'list="cxs-staty"')}
          <datalist id="cxs-staty"><option value="Česká republika"><option value="Slovensko"><option value="Německo"><option value="Rakousko"><option value="Polsko"></datalist>
          <div class="full"><label class="l" for="cxs-popis">Popis</label><textarea id="cxs-popis" rows="2" placeholder="Krátký popis stavby"${R ? ' disabled' : ''}>${esc(p.popis || '')}</textarea></div>
        </div></section>
        <section class="cxs-card"><div class="cxs-h"><b>Řízení stavby</b><span>termíny, investor, zhotovitel</span></div><div class="cxs-body cxs-grid">
          ${f('zacatek', 'Odhadovaný začátek', p.zacatek, 'type="date"')}
          ${f('konec', 'Odhadovaný konec', p.konec, 'type="date"')}
          <div><label class="l" for="cxs-stav">Stav stavby</label><select id="cxs-stav"${R ? ' disabled' : ''}>${Object.entries(STAV).map(([k, v]) => `<option value="${k}"${(p.stav || 'aktivni') === k ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
          <div></div>
          ${f('investor', 'Investor', p.investor, 'placeholder="Investor"', 'half')}
          ${f('company', 'Zhotovitel', p.company, 'placeholder="Zhotovitel"', 'half')}
        </div></section>
        <section class="cxs-card"><div class="cxs-h"><b>Fakturace – kdo fakturuje</b><span>údaje vaší firmy na faktury (logo, účet, splatnost)</span><span class="sp"></span>${host.fakturace && !R ? `<button type="button" class="cxs-b" id="cxs-fak">${fak.firma ? 'Upravit…' : 'Vyplnit (IČO → ARES)…'}</button>` : ''}</div>
          <div class="cxs-body">${fak.firma ? `<b>${esc(fak.firma)}</b>${fak.ico ? ' · IČO ' + esc(fak.ico) : ''}${fak.ucet ? `<div class="hint">účet ${esc(fak.ucet)}</div>` : ''}` : '<span class="hint">Zatím nevyplněno – bez toho nejde vytvořit fakturu.</span>'}${host.fakturace ? '' : '<div class="hint" style="margin-top:6px">Údaje pro faktury se vyplňují v Managementu (Správa stavby → Údaje o stavbě).</div>'}</div></section>
        ${R ? '' : '<div class="cxs-foot" style="border:0;padding:0"><span class="hint">Uloží se pro všechny a hned se propíše do Managementu, Deníku i mobilu.</span><button type="button" class="cxs-b pri" id="cxs-ulozit">Uložit údaje o stavbě</button></div>'}`;
      const fb = box.querySelector('#cxs-fak'); if (fb) fb.onclick = () => host.fakturace(render);
      const ub = box.querySelector('#cxs-ulozit'); if (!ub) return;
      ub.onclick = async () => {
        const v = k => (box.querySelector('#cxs-' + k).value || '').trim();
        const vals = {}; ['name', 'ulice', 'mesto', 'psc', 'stat', 'popis', 'zacatek', 'konec', 'investor', 'company', 'stav'].forEach(k => vals[k] = v(k));
        if (!vals.name) { box.querySelector('#cxs-name').focus(); toast('Napište název stavby.'); return; }
        if (vals.zacatek && vals.konec && vals.konec < vals.zacatek) { toast('Konec je dřív než začátek.'); return; }
        ub.disabled = true;
        try { await uloz(p0 => Object.assign(p0, vals)); toast('Údaje o stavbě uloženy'); if (host.poUlozeniUdaju) host.poUlozeniUdaju(vals); }
        catch (e) { toast('Nepodařilo se uložit: ' + (e.message || e)); }
        ub.disabled = false;
      };
    }

    /* ---------- 2. Firmy / osoby na projektu (společný panel pc/firmy.js) ---------- */
    function firmy(box) {
      if (!window.CXFirmy) { box.innerHTML = '<p>Firmy se nenačetly. Obnovte stránku.</p>'; return; }
      const d = document.createElement('div'); box.appendChild(d);
      CXFirmy.panel(d, Object.assign({nadpis: false, toast, ares: host.ares, aresHledej: host.aresHledej, ro, data: () => ({firmy: P().firmy || [], prijemci: P().prijemci || []}),
        uloz: (k, x, ed) => uloz(p => { if (host.firmy && host.firmy.poUprave) host.firmy.poUprave(k, x, ed); p[k] = (Array.isArray(p[k]) ? p[k] : []).filter(y => y && y.id !== x.id).concat(x); }),
        odeber: (k, id) => uloz(p => { smazano(p, k, id); p[k] = (Array.isArray(p[k]) ? p[k] : []).filter(y => y && y.id !== id); })}, host.firmy || {}));
    }

    /* ---------- 3. Kolegové (tým stavby: kdo pracuje v Constructu) ---------- */
    function kolegove(box, roleSel, L) {
      const p = P(), A = admin(), adm = ADMINS(p), lidi = tym(p).slice().sort((a, b) => a.localeCompare(b, 'cs'));
      const ri = n => L.findIndex(x => x.skup === 'kolegove' && x.jmeno === n);
      const ini = n => n.split(/\s+/).map(x => x[0] || '').join('').slice(0, 2).toUpperCase();
      box.innerHTML = `<section class="cxs-card"><div class="cxs-h"><b>Kolegové</b><span>tým stavby – přihlašují se do Constructa, přidělují se jim úkoly · ${lidi.length} ${lidi.length === 1 ? 'kolega' : lidi.length < 5 ? 'kolegové' : 'kolegů'}</span><span class="sp"></span>${A ? '<button type="button" class="cxs-b add" id="cxs-kadd">+ Přidat</button>' : ''}</div>
        ${lidi.length ? lidi.map(n => { const o = osoba(p, n), em = emaily(o), pr = pravaOf(p, n);
          return `<div class="cxs-row r5"><div class="cxs-nm"><span class="cxs-av">${esc(ini(n))}</span><div><b class="n">${esc(n)}</b><small>${esc([o.role, o.company].filter(Boolean).join(' · ') || '–')}</small></div></div>
            <div>${em.length ? em.map(x => `<a href="mailto:${esc(x.a)}">${esc(x.a)}</a>${x.rep ? '' : ' <small style="display:inline">(bez reportů)</small>'}`).join('<br>') : '<small>bez e-mailu</small>'}${o.phone ? `<br><a href="tel:${esc(String(o.phone).replace(/\s/g, ''))}">${esc(o.phone)}</a>` : ''}</div>
            <div>${adm.includes(n) ? '<span class="cxs-tag y">Správce</span>' : ''}<span class="cxs-tag">${o.access === 'nahlizi' ? 'Jen nahlíží' : 'Zapisuje'}</span>${PRAVA.filter(([k]) => pr[k]).map(([k, l]) => `<span class="cxs-tag">${esc(l)}</span>`).join('')}</div>
            <div>${ri(n) >= 0 ? roleSel(L[ri(n)], ri(n)) : ''}</div>
            <div class="cxs-a">${A ? `${host.pozvat ? `<button type="button" class="cxs-b" data-poz="${esc(n)}">Pozvat</button>` : ''}<button type="button" class="cxs-b" data-ed="${esc(n)}">Upravit</button>${adm.includes(n) ? '' : `<button type="button" class="cxs-b del" data-od="${esc(n)}">Odebrat</button>`}` : ''}</div></div>`; }).join('')
          : '<div class="cxs-empty">Zatím žádný kolega. Klikněte na + Přidat.</div>'}</section>
        <p class="hint" style="margin:-8px 0 16px">Odebraný kolega zůstane u svých úkolů a záznamů, jen už nebude v týmu.</p>`;
      const ka = box.querySelector('#cxs-kadd'); if (ka) ka.onclick = () => upravKolegu(null);
      box.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => upravKolegu(b.dataset.ed));
      box.querySelectorAll('[data-poz]').forEach(b => b.onclick = () => host.pozvat(b.dataset.poz));
      box.querySelectorAll('[data-od]').forEach(b => b.onclick = async () => {
        if (!b.classList.contains('arm')) { b.classList.add('arm'); b.textContent = 'Opravdu odebrat?'; return; }
        const n = b.dataset.od;
        try { await uloz(p0 => { p0.team = tym(p0).filter(x => x !== n); smazano(p0, 'team', n); }); toast('Odebráno z týmu: ' + n); } catch (e) { toast('Nepodařilo se: ' + (e.message || e)); }
        render();
      });

    }
    function upravKolegu(n) {
      const p = P(), o = n ? osoba(p, n) : {}, adm = n && ADMINS(p).includes(n), pr = pravaOf(p, n);
      const em = emaily(o), hl = (em.find(x => x.rep) || em[0] || {}).a || '', dal = em.filter(x => x.a !== hl).map(x => x.a).join(', ');
      const firmy = [...new Set([p.company, o.company, ...(Array.isArray(p.firmy) ? p.firmy.map(f => f.firma) : [])].filter(Boolean))];
      const acc = o.access === 'nahlizi' ? 'nahlizi' : 'zapisuje', lzePrejm = !n || !!host.prejmenuj;
      const ov = okno(n ? 'Upravit kolegu' : 'Přidat kolegu', `
        <div><label class="l" for="cxs-kn">Jméno a příjmení</label><input id="cxs-kn" value="${esc(n || '')}" placeholder="např. Jan Novák"${lzePrejm ? '' : ' disabled'}>${lzePrejm ? '' : '<p class="hint">Jméno se mění v Managementu (promítne se do všech úkolů).</p>'}</div>
        <div class="cxs-grid" style="grid-template-columns:1fr 1fr">
          <div><label class="l" for="cxs-kp">Pozice</label><select id="cxs-kp"><option value="">– vyberte –</option>${[...new Set([...POZICE, ...(o.role ? [o.role] : [])])].map(r => `<option${o.role === r ? ' selected' : ''}>${esc(r)}</option>`).join('')}</select></div>
          <div><label class="l" for="cxs-kt">Telefon</label><input id="cxs-kt" type="tel" value="${esc(o.phone || '')}" placeholder="+420 …"></div>
          <div><label class="l" for="cxs-kf">Firma</label><input id="cxs-kf" value="${esc(o.company || p.company || '')}" list="cxs-kfl" placeholder="za kterou firmu"><datalist id="cxs-kfl">${firmy.map(f => `<option value="${esc(f)}">`).join('')}</datalist></div>
          <div><label class="l" for="cxs-ke">E-mail (chodí na něj reporty)</label><input id="cxs-ke" type="email" value="${esc(hl)}" placeholder="jmeno@firma.cz"></div>
        </div>
        <div><label class="l" for="cxs-ke2">Další e-maily bez reportů <span class="hint" style="display:inline;font-weight:400">(nepovinné, oddělte čárkou)</span></label><input id="cxs-ke2" value="${esc(dal)}"></div>
        <div><label class="l">Přístup do aplikace</label><div class="cxs-opt">${Object.entries(ACCESS).map(([k, [l, d]]) => `<label><input type="radio" name="cxs-acc" value="${k}"${acc === k ? ' checked' : ''}${adm && k === 'nahlizi' ? ' disabled' : ''}><div>${l}<span>${d}</span></div></label>`).join('')}</div></div>
        <div><label class="l">Oprávnění</label>${adm ? '<p class="hint">Správce stavby smí všechno.</p>' : `<div class="cxs-opt" id="cxs-pr">${PRAVA.map(([k, l, d]) => `<label><input type="checkbox" data-pr="${k}"${pr[k] ? ' checked' : ''}><div>${l}<span>${d}</span></div></label>`).join('')}</div>`}</div>`, n ? 'Uložit' : 'Přidat kolegu', async ov => {
        const g = id => ov.querySelector('#' + id).value.trim();
        const jm = (lzePrejm ? g('cxs-kn') : n).replace(/\s+/g, ' ');
        if (!jm) { toast('Vyplňte jméno.'); return 'keep'; }
        const hlm = g('cxs-ke'), dm = g('cxs-ke2').split(/[,;\s]+/).filter(Boolean);
        const bad = [hlm, ...dm].find(a => a && !EMAIL_RE.test(a)); if (bad) { toast('E-mail nevypadá správně: ' + bad); return 'keep'; }
        if (tym(p).some(x => x !== n && fold(x) === fold(jm))) { toast(jm + ' už mezi kolegy je.'); return 'keep'; }
        const emails = [...(hlm ? [{a: hlm, rep: true}] : []), ...dm.filter(a => a.toLowerCase() !== hlm.toLowerCase()).map(a => ({a, rep: false}))];
        const access = (ov.querySelector('input[name="cxs-acc"]:checked') || {}).value === 'nahlizi' && !adm ? 'nahlizi' : 'zapisuje';
        const prava = adm ? undefined : Object.fromEntries(PRAVA.map(([k]) => [k, !!(ov.querySelector(`[data-pr="${k}"]`) || {}).checked]));
        if (n && jm !== n) await host.prejmenuj(n, jm);
        await uloz(p0 => {
          const pp = Object.assign({}, p0.people || {});
          if (n && n !== jm) { delete pp[n]; smazano(p0, 'people', n); smazano(p0, 'team', n); }
          pp[jm] = Object.assign({}, pp[jm] || (n ? o : {}), {emails, email: emails.filter(x => x.rep).map(x => x.a).join(','), role: g('cxs-kp'), phone: g('cxs-kt'), access, company: g('cxs-kf')}, prava ? {prava} : {}, {_ts: Date.now()});
          p0.people = pp;
          const t = tym(p0).filter(x => x !== n); if (!t.includes(jm)) t.push(jm); p0.team = t;
          ['team', 'people'].forEach(k => { if (p0.smazane && p0.smazane[k] && p0.smazane[k][jm]) { const s = Object.assign({}, p0.smazane); s[k] = Object.assign({}, s[k]); delete s[k][jm]; p0.smazane = s; } });
        });
        toast(n ? 'Uloženo' : 'Kolega přidán: ' + jm); render();
      }, toast);
      const ps = ov.querySelector('#cxs-kp');
      if (ps && !adm) ps.onchange = () => { const x = PRAVA_POZICE[ps.value]; if (x) PRAVA.forEach(([k]) => { const c = ov.querySelector(`[data-pr="${k}"]`); if (c) c.checked = !!x[k]; }); };
      const prBox = ov.querySelector('#cxs-pr');
      if (prBox) prBox.onchange = e => { const k = e.target.dataset.pr, c = x => ov.querySelector(`[data-pr="${x}"]`);
        if (e.target.checked && k === 'fakU') { c('fakt').checked = true; c('rozp').checked = true; } if (e.target.checked && k === 'fakt') c('rozp').checked = true;
        if (!e.target.checked && k === 'rozp') { c('fakt').checked = false; c('fakU').checked = false; } if (!e.target.checked && k === 'fakt') c('fakU').checked = false; };
      setTimeout(() => { const i = ov.querySelector('#cxs-kn'); if (i && !i.disabled) i.focus(); }, 30);
    }

    /* ---------- Role a lidé: role (co kdo vidí a kam smí), kolegové, lidé z firem a objednatele ---------- */
    function lide(box) {
      const p = P(), A = admin(), roles = rolesOf(p), L = lideNaStavbe(p);
      const roleSel = (x, i) => `<select data-ri="${i}"${A ? '' : ' disabled'} aria-label="Role">${roles.map(r => `<option value="${esc(r.id)}"${r.id === x.role ? ' selected' : ''}>${esc(r.nazev)}</option>`).join('')}</select>`;
      const SK = [['dod', '1. Dodavatel – pracovníci firem'], ['obj', '2. Objednatel – Investor, TDS, BOZP, Architekt, Ostatní'], ['ruc', 'Další lidé']];
      const pocet = id => L.filter(x => x.role === id).length;
      const radek = (x, i) => `<div class="cxs-lr"><div><b>${esc(x.jmeno || x.firma)}</b>${x.pozice ? `<small style="display:block;font-size:12px;color:#5f676d">${esc(x.pozice)}</small>` : ''}</div><div>${esc(x.jmeno ? x.firma : '')}</div>
        <div style="font-size:13px">${[x.email ? `<a href="mailto:${esc(x.email)}">${esc(x.email)}</a>` : '', x.tel ? esc(x.tel) : ''].filter(Boolean).join(' · ') || '<span class="hint">bez kontaktu</span>'}</div>
        <div>${roleSel(x, i)}</div><div class="cxs-a">${A ? (x.skup === 'ruc' ? `<button type="button" class="cxs-b" data-red="${i}">Upravit</button><button type="button" class="cxs-b del" data-rod="${i}">Odebrat</button>` : `<button type="button" class="cxs-b" data-kde="firmy" title="Kontakt se upravuje ve Firmy / osoby na projektu">Upravit</button>`) : ''}</div></div>`;
      const ch = (r, i, k, dis) => `<td class="c"><input type="checkbox" data-k="${k}"${(k === 'mgmt' ? r.mgmt : r.prava[k]) ? ' checked' : ''}${dis ? ' disabled' : ''} aria-label="${esc(r.nazev)}: ${k === 'mgmt' ? 'Management' : PRAVA_KRATCE[k]}"></td>`;
      box.innerHTML = `<section class="cxs-card"><div class="cxs-h"><b>Role – co kdo vidí a kam smí</b><span>zaškrtněte, co role smí; platí pro všechny lidi s touto rolí (kolegy i firmy)</span><span class="sp"></span>${A ? '<button type="button" class="cxs-b add" id="cxs-radd">+ Přidat roli</button>' : ''}</div>
          <div class="cxs-body" style="padding:6px 8px;overflow-x:auto"><table class="cxs-tab-r"><thead><tr><th rowspan="2">Role</th><th class="c" rowspan="2">Lidí</th><th class="c" rowspan="2">Management</th><th class="c cxs-dg" colspan="2">Deník – svůj<small>deník své firmy</small></th><th class="c cxs-dg" colspan="2">Deník – ostatních<small>deníky ostatních firem</small></th>${Object.values(PRAVA_KRATCE).map(l => `<th class="c" rowspan="2">${l}</th>`).join('')}<th rowspan="2"></th></tr><tr>${DEN_SL.map(([, l]) => `<th class="c cxs-ds">${l}</th>`).join('')}</tr></thead><tbody>${roles.map((r, i) => { const z = r.id === 'spravce' || !A; return `<tr data-r="${i}">
            <td style="min-width:170px"><input data-k="nazev" value="${esc(r.nazev)}" aria-label="Název role"${A ? '' : ' disabled'}></td>
            <td class="c">${pocet(r.id)}</td>
            ${ch(r, i, 'mgmt', z)}
            ${DEN_SL.map(([k, l]) => `<td class="c"><input type="checkbox" data-d="${k}"${r.denikPr[k] ? ' checked' : ''}${z ? ' disabled' : ''} aria-label="${esc(r.nazev)}: ${k.startsWith('sv') ? 'svůj deník' : 'deníky ostatních'} – ${l.toLowerCase()}"></td>`).join('')}
            ${Object.keys(PRAVA_KRATCE).map(k => ch(r, i, k, z)).join('')}
            <td>${A && !ROLE_DEF.some(d => d.id === r.id) ? `<button type="button" class="cxs-b del" data-rdel="${i}">Odebrat</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div>
          ${A ? '<div class="cxs-foot"><span class="hint">Management = smí do počítačové aplikace vedení. Deník – svůj = deník vlastní firmy, Deník – ostatních = deníky ostatních firem (Nahlíží = čte, Zapisuje = píše). Po uložení dostanou kolegové s danou rolí tato oprávnění (u jednotlivce je jde změnit v Upravit).</span><button type="button" class="cxs-b pri" id="cxs-rsave">Uložit role</button></div>' : ''}</section>
        <div id="cxs-kol"></div>
        <section class="cxs-card"><div class="cxs-h"><b>Lidé z firem a objednatele</b><span>pracovníci firem, Investor, TDS, BOZP, Architekt… – u každého vyberte roli</span><span class="sp"></span>${A && window.CXDochazka && CXDochazka.pozvatDoStavby ? '<button type="button" class="cxs-b" id="cxs-poz">Pozvat do stavby</button>' : ''}${A ? '<button type="button" class="cxs-b add" id="cxs-ladd">+ Přidat osobu</button>' : ''}</div>
          ${SK.map(([k, nm]) => { const xs = L.map((x, i) => [x, i]).filter(([x]) => x.skup === k); return xs.length || k !== 'ruc' ? `<div class="cxs-sub">${nm} <span class="hint" style="display:inline;font-weight:400">(${xs.length})</span></div>${xs.length ? xs.map(([x, i]) => radek(x, i)).join('') : '<div class="cxs-empty">Nikdo.</div>'}` : ''; }).join('')}
        </section>
        <p class="hint">Kontakty pracovníků firem a objednatele se upravují ve Firmy / osoby na projektu – sem se propíšou samy.</p>`;
      kolegove(box.querySelector('#cxs-kol'), roleSel, L);
      // tlačítko „Pozvat do stavby“ dodává Docházka (CXDochazka.pozvatDoStavby) – stejné jako ve Firmy / osoby na projektu
      { const pz = box.querySelector('#cxs-poz'); if (pz) pz.onclick = () => CXDochazka.pozvatDoStavby({lide: L, projekt: P(), po: render}); }
      // role člověka: uloží se hned po změně (kolega dostane i oprávnění role)
      box.querySelectorAll('select[data-ri]').forEach(s => s.onchange = async () => {
        const x = L[+s.dataset.ri], stara = x.role; x.role = s.value;
        const ja = host.ja ? host.ja() : '';
        if (x.skup === 'kolegove' && x.jmeno === ja && stara === 'spravce' && x.role !== 'spravce') { toast('Sami sobě roli Správce stavby odebrat nemůžete.'); x.role = stara; s.value = stara; return; }
        if (!L.some(y => y.skup === 'kolegove' && y.role === 'spravce')) { toast('Aspoň jeden kolega musí mít roli Správce stavby.'); x.role = stara; s.value = stara; return; }
        try { await uloz(p0 => { zapisClenove(p0, L); if (x.skup === 'kolegove') pravaRoleKolegum(p0, L.filter(y => y === x), roles); }); toast('Role uložena: ' + (x.jmeno || x.firma) + ' – ' + (roles.find(r => r.id === x.role) || {}).nazev); render(); }
        catch (e) { toast('Nepodařilo se uložit: ' + (e.message || e)); }
      });
      box.querySelectorAll('[data-kde]').forEach(b => b.onclick = () => { if (host.prepni) host.prepni('firmy'); else { zal = 'firmy'; render(); } });
      const rs = box.querySelector('#cxs-rsave');
      const sberRole = () => { box.querySelectorAll('tr[data-r]').forEach(tr => { const r = roles[+tr.dataset.r]; r.nazev = tr.querySelector('[data-k=nazev]').value.trim() || 'Role'; if (r.id !== 'spravce') { r.mgmt = tr.querySelector('[data-k=mgmt]').checked; r.denikPr = Object.fromEntries(DEN_SL.map(([k]) => [k, tr.querySelector(`[data-d=${k}]`).checked])); if (r.denikPr.svZ) r.denikPr.svC = true; if (r.denikPr.ostZ) r.denikPr.ostC = true; r.denik = denKod(r.denikPr); Object.keys(PRAVA_KRATCE).forEach(k => { r.prava[k] = tr.querySelector(`[data-k=${k}]`).checked; }); if (r.prava.fakU) r.prava.fakt = true; if (r.prava.fakt) r.prava.rozp = true; } }); };
      if (rs) rs.onclick = async () => { sberRole(); try { await uloz(p0 => { p0.roleStavby = roles; pravaRoleKolegum(p0, L, roles); }); toast('Role uloženy a propsány lidem'); render(); } catch (e) { toast('Nepodařilo se uložit: ' + (e.message || e)); } };
      const rt = box.querySelector('.cxs-tab-r');
      if (rt) rt.onchange = e => { const dk = e.target.dataset.d, tr = e.target.closest('tr');
        if (dk && tr) { const c = x => tr.querySelector(`[data-d=${x}]`), p = dk.replace(/[CZ]$/, ''); if (e.target.checked && dk.endsWith('Z')) c(p + 'C').checked = true; if (!e.target.checked && dk.endsWith('C')) c(p + 'Z').checked = false; return; }
        const k = e.target.dataset.k; if (!tr || !(k in PRAVA_KRATCE)) return; const c = x => tr.querySelector(`[data-k=${x}]`);
        if (e.target.checked && k === 'fakU') { c('fakt').checked = true; c('rozp').checked = true; } if (e.target.checked && k === 'fakt') c('rozp').checked = true;
        if (!e.target.checked && k === 'rozp') { c('fakt').checked = false; c('fakU').checked = false; } if (!e.target.checked && k === 'fakt') c('fakU').checked = false; };
      const ra = box.querySelector('#cxs-radd');
      if (ra) ra.onclick = async () => { sberRole(); roles.push({id: 'r' + uid(), nazev: 'Nová role', mgmt: false, denik: 'cteni', denikPr: {svC: true, svZ: false, ostC: false, ostZ: false}, prava: Object.assign({}, NIC)}); try { await uloz(p0 => { p0.roleStavby = roles; }); render(); const i = el.querySelector('tr[data-r]:last-child input'); if (i) { i.focus(); i.select(); } } catch (e) { toast(e.message || e); } };
      box.querySelectorAll('[data-rdel]').forEach(b => b.onclick = async () => {
        if (!b.classList.contains('arm')) { b.classList.add('arm'); b.textContent = 'Opravdu odebrat?'; return; }
        sberRole(); const r = roles[+b.dataset.rdel]; roles.splice(+b.dataset.rdel, 1);
        L.forEach(x => { if (x.role === r.id) x.role = x.skup === 'kolegove' ? 'vedeni' : x.skup === 'obj' ? 'dozor' : 'subdodavatel'; });
        try { await uloz(p0 => { p0.roleStavby = roles; zapisClenove(p0, L); }); toast('Role odebrána'); render(); } catch (e) { toast(e.message || e); }
      });
      const osobaDlg = i => {
        const x = i == null ? {skup: 'ruc', zdroj: 'ruc', jmeno: '', firma: '', email: '', tel: '', pozice: '', role: 'subdodavatel'} : L[i];
        okno(i == null ? 'Přidat osobu na stavbu' : 'Upravit osobu', `<p class="hint">Pro lidi, kteří nejsou mezi Kolegy ani ve Firmách (např. projektant, geodet). Pracovníky firem přidávejte ve Firmy / osoby na projektu.</p>
          <div class="cxs-grid" style="grid-template-columns:1fr 1fr">
          <div><label class="l" for="cxs-oj">Jméno a příjmení</label><input id="cxs-oj" value="${esc(x.jmeno)}"></div>
          <div><label class="l" for="cxs-of">Firma</label><input id="cxs-of" value="${esc(x.firma)}"></div>
          <div><label class="l" for="cxs-oe">E-mail</label><input id="cxs-oe" type="email" value="${esc(x.email)}"></div>
          <div><label class="l" for="cxs-ot">Telefon</label><input id="cxs-ot" type="tel" value="${esc(x.tel)}"></div>
          <div><label class="l" for="cxs-op">Pozice</label><input id="cxs-op" value="${esc(x.pozice)}" placeholder="např. Projektant"></div>
          <div><label class="l" for="cxs-or">Role</label><select id="cxs-or">${roles.map(r => `<option value="${esc(r.id)}"${r.id === x.role ? ' selected' : ''}>${esc(r.nazev)}</option>`).join('')}</select></div></div>`, i == null ? 'Přidat' : 'Uložit', async ov => {
          const g = id => ov.querySelector('#' + id).value.trim();
          const y = Object.assign({}, x, {jmeno: g('cxs-oj'), firma: g('cxs-of'), email: g('cxs-oe'), tel: g('cxs-ot'), pozice: g('cxs-op'), role: ov.querySelector('#cxs-or').value});
          if (!y.jmeno && !y.firma) { toast('Napište jméno nebo firmu.'); return 'keep'; }
          if (y.email && !EMAIL_RE.test(y.email)) { toast('E-mail nevypadá správně.'); return 'keep'; }
          const L2 = i == null ? L.concat(Object.assign(y, {id: 'c' + uid()})) : L.map((z, j) => j === i ? y : z);
          await uloz(p0 => zapisClenove(p0, L2)); toast('Uloženo'); render();
        }, toast);
      };
      const la = box.querySelector('#cxs-ladd'); if (la) la.onclick = () => osobaDlg(null);
      box.querySelectorAll('[data-red]').forEach(b => b.onclick = () => osobaDlg(+b.dataset.red));
      box.querySelectorAll('[data-rod]').forEach(b => b.onclick = async () => {
        if (!b.classList.contains('arm')) { b.classList.add('arm'); b.textContent = 'Opravdu odebrat?'; return; }
        const L2 = L.filter((z, j) => j !== +b.dataset.rod);
        try { await uloz(p0 => zapisClenove(p0, L2)); toast('Odebráno'); render(); } catch (e) { toast(e.message || e); }
      });
    }

    render();
    return {render, prepni: z => { zal = z; render(); }, upravKolegu};
  }

  return {panel, ZALOZKY, ALIAS, IKONY, PRAVA_KRATCE, POZICE, PRAVA, PRAVA_VYCH, PRAVA_POZICE, ACCESS, ROLE_DEF, DENIK_PR, DEN_SL, DEN_VYCH, STAV, lideNaStavbe, rolesOf, pravaOf, emaily};
})();
if (typeof window !== 'undefined') window.CXSprava = CXSprava;
