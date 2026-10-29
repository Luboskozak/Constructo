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

  let running = null;
  function process() { return running || (running = run().finally(() => { running = null; })); }
  async function run() {
    const conn = await kvGet('conn'); if (!conn) return {sent: 0};
    const items = (await all()).filter(x => x.state !== 'sent').sort((a, b) => a.at.localeCompare(b.at));
    let sent = 0;
    for (const it of items) {
      try {
        if (it.kind === 'upd') {
          const r = await post(conn, {key: conn.key, rev: 0, data: it.data});
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
          try { r = await post(conn, {key: conn.key, akce: 'mail', cid: it.cid, by: it.by, to: it.to, info: !!it.info, text: it.text, end: it.end, obj: it.obj, fotky: it.att.map(a => a.id)}); }
          catch (e) { if (e.message === 'OFFLINE') throw e; r = {error: e.message}; }
          it.mailed = true; it.mail = r; await put(it);
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
