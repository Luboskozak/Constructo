/* Constructo – zpráva v kolektivu (úkol / Na vědomí): formulář PDF a e-mail ve stejném vzhledu jako zprávy pro firmy.
   Používá mobilní aplikace (/) i Management (/pc/). */
const CXZprava = (() => {
  const LOGO_D = 'M498.35 265.33A154.8 154.8 0 1 0 498.35 304.67L430.02 304.67A87.46 87.46 0 1 1 430.02 265.33ZM445.2 172.19A151.02 151.02 0 0 1 484.72 228.17A87.46 87.46 0 1 1 484.72 341.83A151.02 151.02 0 0 1 445.2 397.81A154.8 154.8 0 1 0 445.2 172.19Z';
  function logoCanvas(col, h) {
    const s = h / 310, c = document.createElement('canvas'); c.width = Math.ceil(516 * s); c.height = Math.ceil(h);
    const g = c.getContext('2d'); g.scale(s, s); g.translate(-190, -130); g.fillStyle = col === '#F4D23C' ? '#FAD805' : col;
    g.fill(new Path2D(LOGO_D));
    return c;
  }
  const loadImg = src => new Promise((res, rej) => { const i = new Image(); if (/^https?:/.test(src)) i.crossOrigin = 'anonymous'; const t = setTimeout(rej, 20000); i.onload = () => { clearTimeout(t); res(i); }; i.onerror = e => { clearTimeout(t); rej(e); }; i.src = src; });
  function rrect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function wrapT(g, text, maxW) {
    const out = [];
    String(text).split('\n').forEach(par => {
      if (!par.trim()) { out.push(''); return; }
      let line = '';
      par.split(/\s+/).filter(Boolean).forEach(w => { const t = line ? line + ' ' + w : w; if (line && g.measureText(t).width > maxW) { out.push(line); line = w; } else line = t; });
      out.push(line);
    });
    return out;
  }
  function jpegPdf(pages) {
    const enc = new TextEncoder(), parts = [], offs = []; let len = 0;
    const push = x => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
    const obj = (n, fill) => { offs[n] = len; push(n + ' 0 obj\n'); fill(); push('\nendobj\n'); };
    const W = 595.28, H = 841.89, n = pages.length;
    push(new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52, 10, 37, 226, 227, 207, 211, 10]));
    obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
    obj(2, () => push(`<< /Type /Pages /Count ${n} /Kids [${pages.map((p, i) => (3 + i * 3) + ' 0 R').join(' ')}] >>`));
    pages.forEach((p, i) => {
      const pg = 3 + i * 3, c = `q ${W} 0 0 ${H} 0 0 cm /I${i} Do Q`;
      obj(pg, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /I${i} ${pg + 1} 0 R >> >> /Contents ${pg + 2} 0 R >>`));
      obj(pg + 1, () => { push(`<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpg.length} >>\nstream\n`); push(p.jpg); push('\nendstream'); });
      obj(pg + 2, () => push(`<< /Length ${c.length} >>\nstream\n${c}\nendstream`));
    });
    const xref = len, total = 3 + n * 3;
    push(`xref\n0 ${total}\n0000000000 65535 f \n` + offs.slice(1).map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(parts, {type: 'application/pdf'});
  }
  const esc = x => String(x == null ? '' : x).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);
  const b64 = b => new Promise(res => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => res(''); r.readAsDataURL(b); });
  const STITEK = o => o.zapis ? {l: 'DENNÍ ZÁPIS', bg: '#0f9d74', fg: '#ffffff', h: 'DENNÍ ZÁPIS'} : o.firma ? {l: String(o.typL || 'Zpráva').toUpperCase(), bg: '#16191c', fg: '#F4D23C', h: 'ZPRÁVA PRO FIRMU'} : o.info ? {l: 'NA VĚDOMÍ', bg: '#2b6cb0', fg: '#ffffff', h: 'NA VĚDOMÍ'} : {l: 'ÚKOL', bg: '#16191c', fg: '#F4D23C', h: 'ÚKOL PRO KOLEGY'};
  // Drive: fotka přes lh3 (posílá CORS), aby šla nakreslit do PDF
  const fotoSrc = a => typeof a === 'string' ? a : a && a.id ? `https://lh3.googleusercontent.com/d/${a.id}=w1600` : (a && (a.thumb || a.url)) || '';
  async function formular(o) {
    const W = 1240, H = 1754, M = 86, CW = W - 2 * M, FOOT = 120, FN = '"Hanken Grotesk", Arial, sans-serif', st = STITEK(o);
    try { await Promise.all([300, 400, 600, 700, 800].map(w => document.fonts.load(`${w} 24px "Hanken Grotesk"`))); } catch (e) {}
    const logo = logoCanvas('#F4D23C', 96), pages = []; let g, y;
    const font = (w, px) => { g.font = `${w} ${px}px ${FN}`; };
    function strana() {
      const c = document.createElement('canvas'); c.width = W; c.height = H; g = c.getContext('2d'); pages.push(c);
      g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
      const prvni = pages.length === 1, hh = prvni ? 190 : 120, lh = prvni ? 60 : 42, lw = logo.width * lh / logo.height;
      g.fillStyle = '#131518'; g.fillRect(0, 0, W, hh); g.fillStyle = '#F4D23C'; g.fillRect(0, hh, W, 10);
      g.drawImage(logo, M, (hh - lh) / 2, lw, lh);
      g.textBaseline = 'middle'; g.textAlign = 'left'; font(300, prvni ? 58 : 40); g.fillStyle = '#fff'; g.fillText('Constructo', M + lw + 18, hh / 2 + 2);
      g.textAlign = 'right'; font(800, prvni ? 40 : 28); g.fillStyle = '#F4D23C'; g.fillText(st.h, W - M, hh / 2 - (prvni ? 18 : 12));
      font(400, prvni ? 24 : 20); g.fillStyle = '#c9ced3'; g.fillText(`${o.cislo} · ${o.datum}`, W - M, hh / 2 + (prvni ? 26 : 18));
      g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      y = hh + 10 + (prvni ? 70 : 56);
    }
    const misto = h => { if (y + h > H - FOOT) strana(); };
    function nadpis(s) { misto(120); y += 10; g.fillStyle = '#F4D23C'; g.fillRect(M, y - 30, 10, 38); font(800, 32); g.fillStyle = '#16191c'; g.fillText(s, M + 26, y); y += 44; }
    strana();
    font(800, 22); const bw = g.measureText(st.l).width + 40;
    g.fillStyle = st.bg; rrect(g, M, y - 31, bw, 44, 22); g.fill(); g.fillStyle = st.fg; g.fillText(st.l, M + 20, y);
    if (!o.firma) { font(600, 22); g.fillStyle = '#6b7279'; g.fillText('zpráva v kolektivu', M + bw + 18, y); }
    y += 68; font(800, 44); g.fillStyle = '#16191c';
    wrapT(g, o.predmet, CW).slice(0, 3).forEach(l => { g.fillText(l, M, y); y += 54; });
    y += 14;
    const pol = o.polozky, colW = (CW - 80) / 2, rows = [];
    font(600, 27);
    for (let i = 0; i < pol.length; i += 2) { const a = wrapT(g, pol[i][1], colW), b = pol[i + 1] ? wrapT(g, pol[i + 1][1], colW) : []; rows.push({pa: pol[i], a, pb: pol[i + 1], b, h: 64 + Math.max(a.length, b.length) * 36}); }
    const boxH = rows.reduce((s, r) => s + r.h, 0) + 30;
    g.fillStyle = '#f4f4f1'; rrect(g, M, y, CW, boxH, 18); g.fill();
    let ry = y + 22;
    rows.forEach((r, ri) => {
      [[r.pa, r.a, M + 28], [r.pb, r.b, M + 52 + colW]].forEach(([p, lines, x]) => {
        if (!p) return;
        font(700, 19); g.fillStyle = '#6b7279'; g.fillText(p[0].toUpperCase(), x, ry + 26);
        font(600, 27); g.fillStyle = '#16191c'; lines.forEach((l, i) => g.fillText(l, x, ry + 64 + i * 36));
      });
      ry += r.h;
      if (ri < rows.length - 1) { g.fillStyle = '#e4e4df'; g.fillRect(M + 28, ry - 2, CW - 56, 2); }
    });
    y += boxH + 56;
    nadpis(o.firma ? 'Zpráva pro firmu' : 'Zpráva');
    font(400, 26);
    wrapT(g, o.text, CW).forEach(l => { misto(40); font(400, 26); g.fillStyle = '#16191c'; if (l) g.fillText(l, M, y); y += l ? 38 : 20; });
    y += 40;
    const fotky = [];   // JPEG fotek pro e-mail (cid:f0…)
    const src = (o.fotky || []).map(fotoSrc).filter(Boolean);
    if (src.length) {
      const fw = (CW - 30) / 2, fh = Math.round(fw * .78);
      const ims = await Promise.all(src.map(s => loadImg(s).catch(() => null)));
      misto(fh + 150); nadpis('Fotodokumentace');
      for (let i = 0; i < src.length; i += 2) {
        misto(fh + 50);
        for (let k = 0; k < 2 && i + k < src.length; k++) {
          const x = M + k * (fw + 30), im = ims[i + k];
          g.fillStyle = '#f4f4f1'; g.fillRect(x, y - 10, fw, fh);
          if (im) { const sc = Math.min(fw / im.width, fh / im.height), w = im.width * sc, h = im.height * sc; g.drawImage(im, x + (fw - w) / 2, y - 10 + (fh - h) / 2, w, h); }
          else { font(600, 22); g.fillStyle = '#6b7279'; g.textAlign = 'center'; g.fillText('Fotka je na Disku Google', x + fw / 2, y - 10 + fh / 2); g.textAlign = 'left'; }
          font(600, 19); g.fillStyle = '#6b7279'; g.fillText('Foto ' + (i + k + 1), x, y + fh + 18);
        }
        y += fh + 56;
      }
      for (const im of ims.slice(0, 6)) {
        if (!im) { fotky.push(''); continue; }
        // do e-mailu všechny fotky stejně velké (4 : 3, výřez ze středu), aby mřížka vypadala úhledně
        try { const c = document.createElement('canvas'); c.width = 800; c.height = 600; const r = Math.max(800 / im.width, 600 / im.height), w = 800 / r, h = 600 / r;
          c.getContext('2d').drawImage(im, (im.width - w) / 2, (im.height - h) / 2, w, h, 0, 0, 800, 600); fotky.push(c.toDataURL('image/jpeg', .82).split(',')[1]); } catch (e) { fotky.push(''); }
      }
    }
    pages.forEach((c, i) => {
      const q = c.getContext('2d');
      q.fillStyle = '#16191c'; q.fillRect(M, H - 94, CW, 2);
      q.font = `700 19px ${FN}`; q.textAlign = 'left'; q.fillText(`Constructo · ${o.cislo}`, M, H - 58);
      q.font = `400 19px ${FN}`; q.fillStyle = '#6b7279'; q.textAlign = 'center'; q.fillText('Developed by Luboš Kozák', W / 2, H - 58);
      q.textAlign = 'right'; q.fillText(`strana ${i + 1} / ${pages.length}`, W - M, H - 58); q.textAlign = 'left';
    });
    const jpgs = [];
    for (const c of pages) { const b = await new Promise(res => c.toBlob(res, 'image/jpeg', .85)); jpgs.push({jpg: new Uint8Array(await b.arrayBuffer()), w: W, h: H}); }
    return {pdf: jpegPdf(jpgs), pages, fotky, logo: logoCanvas('#F4D23C', 52).toDataURL('image/png').split(',')[1]};
  }
  // e-mail: stejný vzhled jako zpráva pro firmu (obrázky cid:logo, cid:f0…)
  function html(o, fotky) {
    // 4.49: velké žluté tlačítko nahoře i dole – firma odpoví na stránce /odpoved/, kolega na /reakce/ (bez přihlášení a bez kódu)
    const odk = o.firma ? o.odkaz : (o.reakce || o.web);
    const pop = o.firma ? 'Potvrďte přijetí, nahlaste opravu (i s fotkou) nebo napište, proč nesouhlasíte. Nic nemusíte instalovat ani zadávat žádný kód.'
      : o.reakce ? (o.info ? 'Jedním klepnutím odpovězte: Beru na vědomí, Potvrzuji, Nesouhlasím, nebo napište vlastní odpověď. Bez přihlašování a bez kódu.' : 'Jedním klepnutím potvrďte „Splněno“ nebo „Beru na vědomí“, nebo napište odpověď. Bez přihlašování a bez kódu.') : '';
    const nap = o.firma ? 'Odpovědět na tuto zprávu' : o.reakce ? (o.info ? 'Beru na vědomí / Potvrzuji / Nesouhlasím / Odpovědět' : 'Splněno / Beru na vědomí / Odpovědět') : 'Otevřít v Constructu';
    const tlac = horni => !odk ? '' : `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:${horni ? '0 0 18px' : '22px 0 4px'}"><tr><td style="background:#F4D23C;border-radius:12px"><a href="${e(odk)}" style="display:inline-block;padding:${horni ? '16px 26px' : '14px 24px'};color:#131518;font-size:${horni ? 18 : 16}px;font-weight:800;text-decoration:none">${nap} &rarr;</a></td></tr></table>${horni && pop ? `<p style="font-size:13px;color:#6b7279;margin:-10px 0 18px">${pop}</p>` : ''}`;
    const e = esc, st = STITEK(o), pol = o.polozky, radky = [];
    for (let i = 0; i < pol.length; i += 2) radky.push('<tr>' + pol.slice(i, i + 2).map(p => `<td style="padding:10px 14px;vertical-align:top;width:50%"><div style="font-size:11px;font-weight:700;color:#6b7279;text-transform:uppercase;letter-spacing:.05em">${e(p[0])}</div><div style="font-size:14px;font-weight:600;color:#16191c;margin-top:3px">${e(p[1]).replace(/\n/g, '<br>')}</div></td>`).join('') + '</tr>');
    const sek = s => `<div style="margin:24px 0 10px;font-size:17px;font-weight:800;color:#16191c;border-left:5px solid #F4D23C;padding-left:10px">${s}</div>`;
    const n = (o.fotky || []).length, ff = (fotky || []).map((b, i) => b ? `<img src="cid:f${i}" alt="Foto ${i + 1}" width="300" height="225" style="width:48%;max-width:300px;height:auto;margin:0 1% 10px 0;border-radius:6px;vertical-align:top">` : '').join('');
    return `<!doctype html><html><body style="margin:0;background:#f4f4f1"><div style="background:#f4f4f1;padding:20px 8px;font-family:Arial,Helvetica,sans-serif;color:#16191c">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:#131518;padding:20px 26px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td style="vertical-align:middle;white-space:nowrap"><img src="cid:logo" height="26" alt="" style="vertical-align:middle;height:26px"><span style="color:#ffffff;font-size:24px;font-weight:300;vertical-align:middle;margin-left:10px">Constructo</span><div style="color:#c9ced3;font-size:13px;margin-top:6px">${e(o.stavba)}</div></td>
<td align="right" style="vertical-align:middle;color:#F4D23C;font-size:15px;font-weight:800;letter-spacing:.08em">${st.h}<div style="color:#c9ced3;font-size:12px;font-weight:400;letter-spacing:0;margin-top:3px">${e(o.cislo)} · ${e(o.datum)}</div></td></tr></table></td></tr>
<tr><td style="height:5px;background:#F4D23C;font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:22px 26px 26px">
<span style="display:inline-block;background:${st.bg};color:${st.fg};font-size:12px;font-weight:800;letter-spacing:.06em;padding:5px 12px;border-radius:20px">${e(st.l)}</span>${o.firma ? '' : ' <span style="font-size:12px;color:#6b7279;font-weight:600">zpráva v kolektivu</span>'}
<div style="font-size:21px;font-weight:800;margin:10px 0 16px;line-height:1.3">${e(o.predmet)}</div>
${tlac(true)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f1;border-radius:10px">${radky.join('')}</table>
${sek('Zpráva')}<div style="font-size:15px;line-height:1.6">${e(o.text).replace(/\n/g, '<br>')}</div>
${ff ? sek('Fotodokumentace') + '<div>' + ff + '</div>' + (n > 6 ? `<p style="font-size:13px;color:#6b7279;margin:4px 0 0">Všech ${n} fotek je v PDF v příloze.</p>` : '') : ''}
${tlac(false)}
<p style="font-size:13px;color:#6b7279;margin:18px 0 0">${o.firma ? '' : o.reakce ? (o.info ? 'Zprávu najdete i v Constructu v záložce Zprávy. ' : 'Úkol najdete i v Constructu v záložce Úkoly. ') : (o.info ? 'Zprávu najdete v Constructu v záložce Zprávy. ' : 'Úkol najdete v Constructu v záložce Úkoly. Až bude hotový, klikněte Splněno. ')}Celý formulář je v příloze jako PDF.</p>
</td></tr>
<tr><td style="background:#131518;padding:16px 26px;font-size:12px;color:#9aa1a8">Odesláno z aplikace Constructo · ${e(o.stavba)}<br><span style="color:#F4D23C">Developed by Luboš Kozák</span></td></tr>
</table></div></body></html>`;
  }
  // společné údaje zprávy z hlášení (it z mobilu nebo složené v Managementu)
  function udaje(it, stavba, web) {
    const d = new Date(it.at), dd = s => String(s || '').split('-').reverse().map(Number).join('. ');
    const kdy = isNaN(d) ? dd(it.day) : d.toLocaleString('cs-CZ', {day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Prague'});
    const text = (it.text || '').trim() || 'Foto ze stavby bez popisu', prvni = text.split('\n')[0];
    const den = isNaN(d) ? String(it.day || '').replace(/-/g, '') : d.toLocaleDateString('sv-SE', {timeZone: 'Europe/Prague'}).replace(/-/g, '');
    return {stavba, info: !!it.info, web, cislo: 'K-' + den + '-' + String(it.cid || '').slice(-4).toUpperCase(), datum: isNaN(d) ? dd(it.day) : d.toLocaleDateString('cs-CZ', {timeZone: 'Europe/Prague'}),
      predmet: prvni.length > 90 ? prvni.slice(0, 88).replace(/\s+\S*$/, '') + '…' : prvni, text,
      polozky: [['Stavba', stavba], ['Objekt', it.obj || '—'], ...(it.misto ? [['Místo', it.misto]] : []), ['Komu', (it.to || []).join(', ') || '—'], [it.info ? 'Druh' : 'Splnit do', it.info ? 'Na vědomí – jen informace' : (it.end ? dd(it.end) : '—')], ['Zapsal', it.by || '—'], ['Datum a čas', kdy]]};
  }
  // 4.49: kód odkazu /reakce/ pro jednu zprávu v kolektivu = HMAC-SHA256(skupina, heslo skriptu); skript ho spočítá stejně, nic se neukládá
  async function tok(key, grp) {
    if (!key || !grp || !(window.crypto && crypto.subtle)) return '';
    const enc = new TextEncoder(), k = await crypto.subtle.importKey('raw', enc.encode(String(key)), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
    const b = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(String(grp))));
    return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').slice(0, 22);
  }
  const reakceUrl = async (web, key, grp) => { try { const t = await tok(key, grp); return t ? String(web).replace(/\/pc\/?$/, '').replace(/\/$/, '') + '/reakce/#' + grp + '.' + t : ''; } catch (e) { return ''; } };
  return {formular, html, udaje, b64, tok, reakceUrl, jpegPdf};
})();
if (typeof window !== 'undefined') window.CXZprava = CXZprava;
