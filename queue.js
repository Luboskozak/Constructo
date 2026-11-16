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
  const put = async r => rq((await st('q', 'readwrite')).put(r));
  const del = async cid => rq((await st('q', 'readwrite')).delete(cid));

  async function post(conn, body) {
    const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 60000);
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
      const r = await fetch(conn.url + (conn.url.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(conn.key) + '&rev=-1&t=' + Date.now(), {redirect: 'follow', signal: ctl.signal});
      txt = await r.text();
    } catch (e) { throw new Error('OFFLINE'); }
    finally { clearTimeout(tm); }
    let res; try { res = JSON.parse(txt); } catch (e) { throw new Error('Google místo dat vrátil stránku. Skript musí být nasazený s přístupem „Kdokoli“.'); }
    if (res.error) throw new Error(res.error === 'heslo' ? 'Kód připojení nesedí se skriptem na Googlu.' : String(res.error));
    if (res.data) await kvSet('data', {rev: res.rev, data: res.data, at: Date.now()});
    return res;
  }
  const errTxt = e => e === 'heslo' ? 'Kód připojení nesedí se skriptem na Googlu.' : String(e);

  // z hlášení udělá záznamy pro program: úkol pro každého vybraného, nebo jedno „Na vědomí“ pro všechny vybrané
  function build(it) {
    const at = it.at, day = it.day || at.slice(0, 10), ts = Date.now(), by = it.by || '';
    const title = (it.text || '').trim() || 'Foto ze stavby bez popisu';
    const att = (it.att || []).filter(Boolean);
    const tasks = [], log = [];
    const base = {kind: 'simple', title, start: day, note: '', obj: it.obj || '', supplier: '', hmg: [], createdAt: at, createdBy: by, updatedAt: at, updatedBy: by, from: 'mobil', grp: it.cid, att, _ts: ts};
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
  const escH = x => String(x == null ? '' : x).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);
  const fmtDen = d => String(d || '').split('-').reverse().map(Number).join('. ');
  function zpravaHtml(it, stavba, proPdf) {
    const text = (it.text || '').trim() || 'Foto ze stavby bez popisu', d = new Date(it.at);
    const kdy = isNaN(d) ? fmtDen(it.day) : d.toLocaleString('cs-CZ', {day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Prague'});
    const typ = it.info ? 'Na vědomí' : 'Nový úkol';
    const radky = [['Stavba', stavba], ['Druh zprávy', typ + ' · zpráva v kolektivu'], ['Komu', (it.to || []).join(', ') || '—'], ['Zapsal', it.by || '—'], ['Datum a čas', kdy]]
      .concat(it.obj ? [['Objekt', it.obj]] : []).concat(!it.info && it.end ? [['Splnit do', fmtDen(it.end)]] : []);
    const att = (it.att || []).filter(Boolean);
    const foto = proPdf
      ? (it.photos || []).slice(0, 12).map(p => p && p.b64 ? `<div style="margin:0 0 10px"><img src="data:image/jpeg;base64,${p.b64}" style="max-width:100%;max-height:520px"></div>` : '').join('')
      : att.slice(0, 12).map(a => `<a href="${escH(a.url)}"><img src="${escH(a.thumb)}" alt="Fotka" style="width:180px;height:135px;object-fit:cover;border-radius:8px;margin:0 6px 6px 0"></a>`).join('');
    return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#16191c;max-width:720px">
<div style="background:#131518;color:#fff;padding:14px 18px;border-radius:${proPdf ? 0 : 10}px"><b style="color:#F4D23C;font-size:18px">Constructo</b><span style="color:#9aa1a8"> · ${escH(typ)}</span></div>
<h2 style="font-size:19px;margin:16px 0 10px">${escH(typ)} od ${escH(it.by || 'kolegy')}</h2>
<table style="border-collapse:collapse;width:100%;margin:0 0 12px">${radky.map(([k, v]) => `<tr><td style="padding:5px 10px 5px 0;color:#6b7279;width:130px;vertical-align:top">${escH(k)}</td><td style="padding:5px 0;vertical-align:top"><b>${escH(v)}</b></td></tr>`).join('')}</table>
<div style="background:#f4f4f1;border-radius:8px;padding:12px 14px;white-space:pre-wrap;line-height:1.5;margin:0 0 14px">${escH(text)}</div>
${foto ? `<div>${foto}</div>` : ''}
${proPdf ? '' : `<p style="color:#555">${it.info ? 'Zprávu najdete v programu Constructo v záložce Zprávy (a v Úkolech).' : 'Úkol najdete v programu Constructo v záložce Úkoly. Až bude hotový, klikněte Splněno.'} Celá zpráva je v příloze jako PDF.</p>`}
</div>`;
  }
  async function zpravaMail(conn, it) {
    const c = await kvGet('data').catch(() => null), stavba = (c && c.data && c.data.project && c.data.project.name) || 'Stavba';
    const text = (it.text || '').trim() || 'Foto ze stavby';
    let pdf = null;
    try {
      const r = await post(conn, {key: conn.key, akce: 'zapis_pdf', jmeno: `Zprava-${it.day || it.at.slice(0, 10)}-${String(it.by || '').replace(/\s+/g, '-')}-${it.cid}.pdf`, html: zpravaHtml(it, stavba, true)});
      if (r && r.id) pdf = {id: r.id, url: r.url};
    } catch (e) { if (e.message === 'OFFLINE') throw e; }
    const predmet = (it.info ? 'Na vědomí od ' : 'Nový úkol od ') + (it.by || 'kolegy') + ': ' + text.split('\n')[0].slice(0, 70);
    let r = await post(conn, {key: conn.key, akce: 'zapis', cid: 'zpr-' + it.cid, to: it.to, predmet, html: zpravaHtml(it, stavba, false), pdfId: pdf ? pdf.id : ''});
    if (!r || (r.ok === undefined && !r.error))   // starší skript na Googlu umí jen text bez PDF
      r = await post(conn, {key: conn.key, akce: 'mail', cid: it.cid, by: it.by, to: it.to, info: !!it.info, text: it.text, end: it.end, obj: it.obj, fotky: (it.att || []).map(a => a.id)});
    return {at: new Date().toISOString(), sent: Number(r && r.sent) || (r && r.opakovane ? (it.to || []).length : 0), missing: (r && r.missing) || [], error: (r && r.error) || '', pdf};
  }
  async function zapisVysledek(conn, it) {
    const m = it.mail || {}, g = await get(conn), cur = (g && g.data) || null; if (!cur) return;
    const ts = Date.now(), komu = it.to || [];
    const tk = (cur.tasks || []).filter(t => t.grp === it.cid).map(t => Object.assign({}, t, {_ts: ts, zprava: {at: m.at || new Date().toISOString(), komu, sent: m.sent || 0, missing: m.missing || [], error: m.error || '', pdf: m.pdf || null}}));
    if (!tk.length) return;
    const r = await post(conn, {key: conn.key, rev: 0, data: {tasks: tk}});
    if (r && r.data) await kvSet('data', {rev: r.rev, data: r.data, at: Date.now()});
  }

  let running = null;
  function process() { return running || (running = run().finally(() => { running = null; })); }
  async function run() {
    const conn = await kvGet('conn'); if (!conn) return {sent: 0};
    const items = (await all()).filter(x => x.state !== 'sent').sort((a, b) => a.at.localeCompare(b.at));
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
            rec[f.k] = {id: r.id, url: r.url, thumb: f.k === 'foto' ? r.thumb : ''};
            f.done = true; f.b64 = ''; await put(it);
          }
          const r = await post(conn, {key: conn.key, rev: 0, data: {zavady: [Object.assign({}, rec, {_ts: Date.now()})]}});
          if (r.error) throw new Error(errTxt(r.error));
          if (r.data) await kvSet('data', {rev: r.rev, data: r.data, at: Date.now()});
          await del(it.cid); sent++; continue;
        }
        if (it.kind === 'upd') {
          // změna úkolu z telefonu (Splněno): nejdřív aktuální stav ze stavby. Úkol smazaný na počítači se zpátky NEPOŠLE
          // (jinak by se smazaný úkol vrátil) a ostatní úpravy z počítače zůstanou – z telefonu se mění jen splnění.
          let data = it.data;
          const g = await get(conn), cur = (g && g.data) || null;
          if (cur) {
            const byId = new Map((cur.tasks || []).map(t => [t.id, t])), ts = Date.now();
            const KS = ['status', 'done', 'doneAt', 'doneBy', 'updatedAt', 'updatedBy'];
            const tk = (it.data.tasks || []).filter(t => byId.has(t.id)).map(t => { const o = Object.assign({}, byId.get(t.id), {_ts: ts}); KS.forEach(k => { if (k in t) o[k] = t[k]; }); return o; });
            if (!tk.length) { await del(it.cid); sent++; continue; }
            data = {tasks: tk, log: (it.data.log || []).filter(l => byId.has(l.taskId)).map(l => Object.assign({}, l, {_ts: ts}))};
          }
          const r = await post(conn, {key: conn.key, rev: 0, data});
          if (r.error) throw new Error(errTxt(r.error));
          if (r.data) await kvSet('data', {rev: r.rev, data: r.data, at: Date.now()});
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
          const r = await post(conn, {key: conn.key, rev: 0, data: build(it)});
          if (r.error) throw new Error(errTxt(r.error));
          if (r.data) await kvSet('data', {rev: r.rev, data: r.data, at: Date.now()});
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
        await put(it); sent++;
      } catch (e) {
        it.err = e.message === 'OFFLINE' ? '' : e.message; it.tries = (it.tries || 0) + 1; await put(it);
        return {sent, err: e.message};
      }
    }
    return {sent};
  }
  return {kvGet, kvSet, all, put, del, get, post, process, build};
})();
if (typeof self !== 'undefined') self.CXQ = CXQ;
