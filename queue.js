/* Constructo mobil – fronta odesílání (hlášení s fotkami a změny úkolů).
   Používá ji stránka i service worker, proto tu není nic, co sahá na obrazovku.
   Každý krok je opakovatelný: fotky mají pevné jméno, úkoly pevné id a e-mail pevné číslo hlášení,
   takže opakované odeslání po výpadku signálu nic nezdvojí. */
const CXQ = (() => {
  const DB = 'constructo-mobil';
  const rq = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  let dbP = null;
  const open = () => dbP || (dbP = new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('q', {keyPath: 'cid'}); d.createObjectStore('kv'); };
    r.onsuccess = () => res(r.result); r.onerror = () => { dbP = null; rej(r.error); };
  }));
  const st = async (name, mode) => (await open()).transaction(name, mode).objectStore(name);
  const kvGet = async k => rq((await st('kv', 'readonly')).get(k));
  const kvSet = async (k, v) => rq((await st('kv', 'readwrite')).put(v, k));
  const all = async () => rq((await st('q', 'readonly')).getAll());
  // 1.32: více staveb – každý záznam ve frontě patří stavbě, ve které vznikl (stará data = Hybernská)
  const HYB = 'hybernska';
  let CUR = HYB;
  const sidOf = it => (it && it.sid) || HYB;
  const dk = sid => !sid || sid === HYB ? 'data' : 'data:' + sid;
  const put = async r => { if (r && !r.sid) r.sid = CUR; return rq((await st('q', 'readwrite')).put(r)); };
  const del = async cid => rq((await st('q', 'readwrite')).delete(cid));

  async function post(conn, body, ms) {
    const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), ms || 60000);
    let txt;
    try {
      const r = await fetch(conn.url, {method: 'POST', headers: {'Content-Type': 'text/plain;charset=utf-8'}, body: JSON.stringify(body), redirect: 'follow', signal: ctl.signal});
      txt = await r.text();
    } catch (e) { throw new Error('OFFLINE'); }
    finally { clearTimeout(tm); }
    try { return JSON.parse(txt); } catch (e) { throw new Error('Google místo dat vrátil stránku. Skript musí být nasazený s přístupem „Kdokoli“.'); }
  }
  async function get(conn) {
    const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 30000);
    let txt;
    try {
      // 1.21: známé číslo verze → když se nic nezměnilo, Google vrátí jen {same: true} (pár bajtů místo celých dat; rychlé i při slabém signálu)
      const c0 = await kvGet('data').catch(() => null), rev0 = c0 && c0.data && Number(c0.rev) > 0 ? Number(c0.rev) : -1;
      const r = await fetch(conn.url + (conn.url.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(conn.key) + '&rev=' + rev0 + '&t=' + Date.now(), {redirect: 'follow', signal: ctl.signal});
      txt = await r.text();
    } catch (e) { throw new Error('OFFLINE'); }
    finally { clearTimeout(tm); }
    let res; try { res = JSON.parse(txt); } catch (e) { throw new Error('Google místo dat vrátil stránku. Skript musí být nasazený s přístupem „Kdokoli“.'); }
    if (res.error) throw new Error(res.error === 'heslo' ? 'Kód připojení nesedí se skriptem na Googlu.' : String(res.error));
    if (res.same) { const c = await kvGet('data').catch(() => null); if (c && c.data) { c.at = Date.now(); await kvSet('data', c); return {rev: res.rev, data: c.data, same: true}; } }
    if (res.data) await kvSet('data', {rev: res.rev, data: res.data, at: Date.now()});
    return res;
  }
  const errTxt = e => e === 'heslo' ? 'Kód připojení nesedí se skriptem na Googlu.' : String(e);
  // data jiné stavby než Hybernské jdou přes CXStavby (pc/stavby.js – jen ve stránce; service worker je nechá stránce)
  const SX = () => (typeof self !== 'undefined' && self.CXStavby) || null;
  async function getS(conn, sid) {
    if (!sid || sid === HYB) return get(conn);
    const X = SX(); if (!X) throw new Error('STRANKA');
    const c0 = await kvGet(dk(sid)).catch(() => null);
    let r;
    try { r = await X.stahni(sid, c0 && c0.data ? c0.rev : ''); }
    catch (e) { throw new Error(navigator.onLine === false || /Failed to fetch|NetworkError|neodpověděl|Load failed/i.test(e.message || '') ? 'OFFLINE' : e.message); }
    if (r.same && c0 && c0.data) { c0.at = Date.now(); await kvSet(dk(sid), c0); return {rev: c0.rev, data: c0.data, same: true}; }
    const data = r.data || (c0 && c0.data) || {};
    await kvSet(dk(sid), {rev: r.rev, data, at: Date.now()});
    return {rev: r.rev, data};
  }
  async function postS(conn, sid, data) {
    if (!sid || sid === HYB) {
      const r = await post(conn, {key: conn.key, rev: 0, data});
      if (r.error) throw new Error(errTxt(r.error));
      if (r.data) await kvSet('data', {rev: r.rev, data: r.data, at: Date.now()});
      return r;
    }
    const X = SX(); if (!X) throw new Error('STRANKA');
    let r;
    try { r = await X.posli(sid, data); }
    catch (e) { throw new Error(navigator.onLine === false || /Failed to fetch|NetworkError|neodpověděl|Load failed/i.test(e.message || '') ? 'OFFLINE' : e.message); }
    if (r && r.data) await kvSet(dk(sid), {rev: r.rev, data: r.data, at: Date.now()});
    return r || {};
  }

  // z hlášení udělá záznamy pro program: úkol pro každého vybraného, nebo jedno „Na vědomí“ pro všechny vybrané
  function build(it) {
    const at = it.at, day = it.day || at.slice(0, 10), ts = Date.now(), by = it.by || '';
    const title = (it.text || '').trim() || 'Foto ze stavby bez popisu';
    const att = (it.att || []).filter(Boolean);
    const tasks = [], log = [];
    const base = {kind: 'simple', title, start: day, note: '', obj: it.obj || '', supplier: it.supplier || ((/^Závada poslaná firmě\s+(.+?):\s/.exec(title) || [])[1] || '').trim(), hmg: [], createdAt: at, createdBy: by, updatedAt: at, updatedBy: by, from: 'mobil', grp: it.cid, att, _ts: ts};
    const lg = (id, i, comment, status, done) => log.push({id: 'l' + it.cid + '-' + i, taskId: id, at, by, done, status, comment, title, _ts: ts});
    const foto = att.length ? ` (${att.length} ${att.length === 1 ? 'fotka' : att.length < 5 ? 'fotky' : 'fotek'})` : '';
    if (it.info) {
      const id = 'm' + it.cid + '-0', to = it.to.length ? it.to : [''];
      tasks.push(Object.assign({}, base, {id, owner: to[0], team: to.slice(1), end: '', done: 100, status: 'done', info: true, doneAt: at, doneBy: ''}));
      lg(id, 0, 'Na vědomí z telefonu' + foto, 'done', 100);
    } else {
      (it.to.length ? it.to : ['']).forEach((n, i) => {
        const id = 'm' + it.cid + '-' + i;
        tasks.push(Object.assign({}, base, {id, owner: n, team: [], end: it.end || '', done: 0, status: 'todo'}));
        lg(id, i, 'Zadán úkol z telefonu' + (it.end ? ' do ' + it.end.split('-').reverse().map(Number).join('. ') : '') + foto, 'todo', 0);
      });
    }
    return {tasks, log};
  }

  // zpráva v kolektivu (úkol nebo Na vědomí z telefonu): pokaždé PDF na Disku a e-mail s PDF v příloze všem vybraným
  const fmtDen = d => String(d || '').split('-').reverse().map(Number).join('. ');
  // 4.38: e-mail a PDF zprávy v kolektivu – hlavička „Constructo · název projektu“, tabulky (Outlook), fotky jako odkazy (Outlook cizí obrázky blokuje)
  function cxZpravaHtml(o) {
    const e = x => String(x == null ? '' : x).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);
    const F = 'font-family:Arial,Helvetica,sans-serif;', pdf = !!o.fotky, att = (o.att || []).filter(Boolean);
    const radky = [['Komu', (o.komu || []).join(', ') || '—'], ['Zapsal', o.by || '—'], ['Datum a čas', o.kdy]].concat(o.obj ? [['Objekt', o.obj]] : []).concat(o.end ? [['Splnit do', o.end]] : []);
    const fotkyPdf = pdf ? o.fotky.filter(s => /^data:image\//.test(s || '')) : [];
    const foto = pdf
      ? (fotkyPdf.length ? fotkyPdf.map(s => `<tr><td style="padding:0 30px 12px"><img src="${s}" style="max-width:100%;max-height:560px;display:block"></td></tr>`).join('')
        : att.length ? `<tr><td style="padding:0 30px 14px;${F}font-size:13px;color:#4a5157">Fotky ze stavby (${att.length}): ${att.map((a, i) => `<a href="${e(a.url)}" style="color:#16191c">Foto ${i + 1}</a>`).join(' · ')}</td></tr>` : '')
      : att.length ? `<tr><td style="padding:4px 30px 6px;${F}"><div style="font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#6b7279;margin:0 0 8px">Fotky ze stavby (${att.length})</div>${att.map((a, i) => `<a href="${e(a.url)}" style="display:inline-block;border:1px solid #d9d9d3;background:#fafaf8;color:#16191c;text-decoration:none;font-size:13px;font-weight:bold;padding:7px 12px;margin:0 6px 6px 0">Foto ${i + 1}</a>`).join('')}</td></tr>` : '';
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f4f4f1" style="background:#f4f4f1"><tr><td align="center" style="padding:${pdf ? 0 : 24}px 10px">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:640px;max-width:100%;background:#ffffff;border:1px solid #e2e2dc">
<tr><td bgcolor="#131518" style="background:#131518;padding:20px 30px;${F}"><span style="color:#F4D23C;font-size:24px;font-weight:bold;letter-spacing:-0.5px">Constructo</span><span style="color:#ffffff;font-size:15px">&nbsp;&nbsp;·&nbsp;&nbsp;${e(o.stavba)}</span></td></tr>
<tr><td style="padding:26px 30px 4px;${F}"><span style="display:inline-block;background:#F4D23C;color:#131518;font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;padding:5px 10px">${e(o.typ)} · zpráva v kolektivu</span>
<div style="font-size:23px;font-weight:bold;color:#16191c;margin:14px 0 4px;line-height:1.25">${e(o.typ)} od ${e(o.by || 'kolegy')}</div>
<div style="font-size:13px;color:#6b7279">${e(o.kdy)}${o.obj ? ' · objekt ' + e(o.obj) : ''}${o.end ? ' · splnit do ' + e(o.end) : ''}</div></td></tr>
<tr><td style="padding:18px 30px 10px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#f4f4f1" style="background:#f4f4f1;border-left:4px solid #F4D23C;padding:16px 18px;${F}font-size:15px;line-height:1.6;color:#16191c">${e(o.text).replace(/\n/g, '<br>')}</td></tr></table></td></tr>
<tr><td style="padding:8px 30px 14px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${radky.map(([k, v]) => `<tr><td width="120" style="padding:8px 12px 8px 0;border-bottom:1px solid #ececE6;${F}font-size:13px;color:#6b7279;vertical-align:top">${e(k)}</td><td style="padding:8px 0;border-bottom:1px solid #ececE6;${F}font-size:14px;color:#16191c;font-weight:bold;vertical-align:top">${e(v)}</td></tr>`).join('')}</table></td></tr>
${foto}
${pdf ? '' : `<tr><td style="padding:12px 30px 26px;${F}"><a href="${e(o.web)}" style="display:inline-block;background:#131518;color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;padding:13px 22px">Otevřít v Constructu &rarr;</a>
<div style="font-size:13px;color:#6b7279;margin:14px 0 0">${o.info ? 'Zprávu najdete v Constructu v záložce Zprávy (a v Úkolech).' : 'Úkol najdete v Constructu v záložce Úkoly. Až bude hotový, klikněte Splněno.'} Celá zpráva i s fotkami je v příloze jako PDF.</div></td></tr>`}
<tr><td bgcolor="#131518" style="background:#131518;padding:14px 30px;${F}font-size:12px;color:#9aa1a8">Odesláno z aplikace Constructo · ${e(o.stavba)}<br><span style="color:#F4D23C">Developed by Luboš Kozák</span></td></tr>
</table></td></tr></table>`;
  }
  const WEB = (typeof location !== 'undefined' && /^https?:$/.test(location.protocol) && !/localhost|127\.0\.0\.1/.test(location.host)) ? location.origin : 'https://lovely-gumption-be0f29.netlify.app';
  function zpravaHtml(it, stavba, proPdf) {
    const d = new Date(it.at);
    const kdy = isNaN(d) ? fmtDen(it.day) : d.toLocaleString('cs-CZ', {day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Prague'});
    return cxZpravaHtml({stavba, typ: it.info ? 'Na vědomí' : 'Nový úkol', info: !!it.info, by: it.by, kdy, obj: it.obj, end: !it.info && it.end ? fmtDen(it.end) : '', komu: it.to,
      text: (it.text || '').trim() || 'Foto ze stavby bez popisu', att: it.att, web: WEB + '/pc/',
      fotky: proPdf ? (it.photos || []).slice(0, 12).map(p => p && p.b64 ? 'data:image/jpeg;base64,' + p.b64 : '') : null});
  }
  async function zpravaMail(conn, it) {
    const c = await kvGet(dk(sidOf(it))).catch(() => null), X = SX(), inf = X && sidOf(it) !== HYB ? X.info(sidOf(it)) : null;
    const stavba = (c && c.data && c.data.project && c.data.project.name) || (inf && inf.name) || 'Stavba';
    if (it.form && it.form.pdf) {
      // formulář PDF a e-mail připravil telefon (stejný vzhled jako zprávy pro firmy): PDF na Disk, e-mail s fotkami a PDF v příloze
      const lide = (c && c.data && c.data.project && c.data.project.people) || {};
      const em = n => String((lide[n] || {}).email || '').split(/[,;\s]+/).filter(Boolean)[0] || '';
      const komu = (it.to || []).filter(n => em(n)), missing = (it.to || []).filter(n => !em(n));
      if (!it.form.pdfFile) {
        const r = await post(conn, {key: conn.key, akce: 'foto', name: it.form.cislo + '.pdf', mime: 'application/pdf', den: it.day || it.at.slice(0, 10), data: it.form.pdf});
        if (r && r.id) { it.form.pdfFile = {id: r.id, url: r.url}; await put(it); }
      }
      const pdf = it.form.pdfFile || null;
      if (!komu.length) return {at: new Date().toISOString(), sent: 0, missing, error: '', pdf};
      // 1.21: jeden e-mail všem najednou (jedno nahrání PDF – při slabém signálu mnohem rychlejší), odesílatel „Constructo“, bez kopie
      const obr = {logo: it.form.logo}; (it.form.fotky || []).forEach((b, i) => { if (b) obr['f' + i] = b; });
      const adr = [...new Set([...komu.map(em), em(it.by)].filter(Boolean))];   // mobil 1.42: kopie vždy i autorovi (Luboš 23. 11.)
      const r = await post(conn, {key: conn.key, akce: 'zavada', cid: 'zpr-' + it.cid, komu: adr.join(','), predmet: it.form.predmet, html: it.form.html, text: it.text || '',
        pdf: it.form.pdf, pdfJmeno: it.form.cislo + '.pdf', obr, od: 'Constructo'});
      const ok = !!(r && (r.ok || r.opakovane));
      return {at: new Date().toISOString(), sent: ok ? komu.length : 0, poslano: ok ? komu : [], missing, error: ok ? '' : String((r && r.error) || 'neznámá chyba'), pdf};
    }
    const text = (it.text || '').trim() || 'Foto ze stavby';
    let pdf = null;
    try {
      const r = await post(conn, {key: conn.key, akce: 'zapis_pdf', jmeno: `Zprava-${it.day || it.at.slice(0, 10)}-${String(it.by || '').replace(/\s+/g, '-')}-${it.cid}.pdf`, html: zpravaHtml(it, stavba, true)});
      if (r && r.id) pdf = {id: r.id, url: r.url};
    } catch (e) { if (e.message === 'OFFLINE') throw e; }
    const predmet = 'Constructo · ' + stavba + ' – ' + (it.info ? 'Na vědomí od ' : 'Nový úkol od ') + (it.by || 'kolegy') + ': ' + text.split('\n')[0].slice(0, 70);
    let r = await post(conn, {key: conn.key, akce: 'zapis', cid: 'zpr-' + it.cid, to: it.to, predmet, html: zpravaHtml(it, stavba, false), pdfId: pdf ? pdf.id : ''});
    if (!r || (r.ok === undefined && !r.error))   // starší skript na Googlu umí jen text bez PDF
      r = await post(conn, {key: conn.key, akce: 'mail', cid: it.cid, by: it.by, to: it.to, info: !!it.info, text: it.text, end: it.end, obj: it.obj, fotky: (it.att || []).map(a => a.id)});
    return {at: new Date().toISOString(), sent: Number(r && r.sent) || (r && r.opakovane ? (it.to || []).length : 0), missing: (r && r.missing) || [], error: (r && r.error) || '', pdf};
  }
  async function zapisVysledek(conn, it) {
    const m = it.mail || {}, g = await getS(conn, sidOf(it)), cur = (g && g.data) || null; if (!cur) return;
    const ts = Date.now(), komu = it.to || [];
    const tk = (cur.tasks || []).filter(t => t.grp === it.cid).map(t => Object.assign({}, t, {_ts: ts, zprava: {at: m.at || new Date().toISOString(), komu, sent: m.sent || 0, missing: m.missing || [], error: m.error || '', pdf: m.pdf || null}}));
    if (!tk.length) return;
    await postS(conn, sidOf(it), {tasks: tk});
  }

  let running = null;
  function process() { return running || (running = run().finally(() => { running = null; })); }
  async function run() {
    const conn = await kvGet('conn'); if (!conn) return {sent: 0};
    // hlášení, kterému telefon ještě kreslí formulář PDF, počká (nejvýš 3 minuty, pak odejde i bez něj)
    // 1.24: 'zai' = hlášení pro firmu, kterému telefon ještě připravuje text a formulář (dělá to stránka, ne fronta)
    const items = (await all()).filter(x => x.state !== 'sent' && x.kind !== 'zai' && !(x.formWait && Date.now() - Date.parse(x.at) < 180000))
      .filter(x => sidOf(x) === HYB || SX()).sort((a, b) => a.at.localeCompare(b.at));   // jiné stavby odešle stránka (service worker nemá CXStavby)
    let sent = 0;
    for (const it of items) {
      try {
        if (it.kind === 'zavada') {
          // hlášení závady: soubory na Disk (PDF a jedna fotka), pak záznam do dat stavby
          const rec = it.rec;
          for (const f of it.files || []) {
            if (f.done) continue;
            const r = await post(conn, {key: conn.key, akce: 'foto', name: f.name, mime: f.mime, den: it.day || it.at.slice(0, 10), data: f.b64});
            if (r.error) throw new Error(errTxt(r.error));
            if (!r.id) throw new Error('Skript na Googlu je potřeba aktualizovat.');
            const x = {id: r.id, url: r.url, thumb: f.k === 'pdf' ? '' : r.thumb || ''};
            if (f.k === 'pdf') rec.pdf = x;
            else { if (f.k === 'foto') rec.foto = x; rec.fotky = rec.fotky || []; rec.fotky[f.k === 'foto' ? 0 : Number(f.k.slice(1))] = x; }
            f.done = true; f.b64 = ''; await put(it);
          }
          if (rec.fotky) { rec.fotky = rec.fotky.filter(Boolean); if (rec.fotky.length < 2) delete rec.fotky; }
          await postS(conn, sidOf(it), {zavady: [Object.assign({}, rec, {_ts: Date.now()})]});
          await del(it.cid); sent++; continue;
        }
        if (it.kind === 'zmail') {
          // 1.24: e-mail pro firmu připravený v telefonu. Pevné číslo (cid) → skript na Googlu ho pošle jen jednou, i když se pokus opakuje.
          const r = await post(conn, it.body, 170000);
          if (r && (r.ok || r.opakovane)) { await del(it.cid); sent++; continue; }
          // chyba od skriptu (např. špatná adresa) nesmí zdržet ostatní záznamy ve frontě
          it.err = r && r.error === 'heslo' ? errTxt('heslo') : String((r && r.error) || 'E-mail se nepodařilo odeslat.'); it.tries = (it.tries || 0) + 1; await put(it);
          continue;
        }
        if (it.kind === 'upd') {
          // změna úkolu z telefonu (Splněno): nejdřív aktuální stav ze stavby. Úkol smazaný na počítači se zpátky NEPOŠLE
          // (jinak by se smazaný úkol vrátil) a ostatní úpravy z počítače zůstanou – z telefonu se mění jen splnění.
          let data = it.data;
          const g = await getS(conn, sidOf(it)), cur = (g && g.data) || null;
          if (cur) {
            const byId = new Map((cur.tasks || []).map(t => [t.id, t])), ts = Date.now();
            const KS = ['status', 'done', 'doneAt', 'doneBy', 'updatedAt', 'updatedBy'];
            const tk = (it.data.tasks || []).filter(t => byId.has(t.id)).map(t => { const o = Object.assign({}, byId.get(t.id), {_ts: ts}); KS.forEach(k => { if (k in t) o[k] = t[k]; }); return o; });
            if (!tk.length) { await del(it.cid); sent++; continue; }
            data = {tasks: tk, log: (it.data.log || []).filter(l => byId.has(l.taskId)).map(l => Object.assign({}, l, {_ts: ts}))};
          }
          await postS(conn, sidOf(it), data);
          await del(it.cid); sent++; continue;
        }
        it.att = it.att || [];
        for (let i = 0; i < (it.photos || []).length; i++) {
          if (it.att[i]) continue;
          const name = it.cid + '-' + (i + 1) + '.jpg';
          const r = await post(conn, {key: conn.key, akce: 'foto', name, mime: 'image/jpeg', den: it.day || it.at.slice(0, 10), data: it.photos[i].b64});
          if (r.error) throw new Error(errTxt(r.error));
          if (!r.id) throw new Error('Skript na Googlu je potřeba aktualizovat, aby uměl ukládat fotky (v programu na počítači: Data → Automatická synchronizace → Aktualizovat skript).');
          it.att[i] = {id: r.id, url: r.url, thumb: r.thumb, name};
          await put(it);
        }
        if (!it.saved) {
          await postS(conn, sidOf(it), build(it));
          it.saved = true; await put(it);
        }
        if (!it.mailed) {
          let r;
          try { r = await zpravaMail(conn, it); }
          catch (e) { if (e.message === 'OFFLINE') throw e; r = {error: e.message}; }
          it.mailed = true; it.mail = r; await put(it);
        }
        if (!it.noted) {
          // výsledek e-mailu (komu odešel, komu chybí adresa, PDF) se zapíše k úkolům – v programu ho ukáže záložka Zprávy
          try { await zapisVysledek(conn, it); } catch (e) { if (e.message === 'OFFLINE') throw e; }
          it.noted = true; await put(it);
        }
        it.state = 'sent'; it.sentAt = new Date().toISOString(); it.err = '';
        it.photos = (it.photos || []).map(p => ({thumb: p.thumb}));   // velká data pryč, náhled zůstane
        if (it.form) it.form = {cislo: it.form.cislo, pdfFile: it.form.pdfFile || null};
        await put(it); sent++;
      } catch (e) {
        it.err = e.message === 'OFFLINE' ? '' : e.message; it.tries = (it.tries || 0) + 1; await put(it);
        return {sent, err: e.message};
      }
    }
    return {sent};
  }
  return {kvGet, kvSet, all, put, del, get, post, process, build, getS, postS, dk, HYB, sidOf, stavba: sid => { CUR = sid || HYB; }};
})();
if (typeof self !== 'undefined') self.CXQ = CXQ;
