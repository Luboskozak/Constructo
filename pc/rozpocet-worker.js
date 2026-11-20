/* Constructo – Rozpočet: čtení a zápis Excelu na pozadí (aby se okno při 40 000 řádcích nezaseklo).
   Používá knihovnu SheetJS (xlsx.full.min.js, licence Apache 2.0). Umí .xlsx, .xlsm, .xls, .ods i .csv.
   Vrací všechny řádky všech listů včetně řádků skrytých v Excelu (příznak skryto + úroveň seskupení). */
importScripts('xlsx.full.min.js');
self.onmessage = e => {
  const m = e.data || {};
  try {
    if (m.akce === 'cti') {
      const u8 = new Uint8Array(m.buf), opt = {cellStyles: true, cellFormula: false, cellHTML: false, cellNF: true, cellText: false, sheetStubs: true};
      // CSV/text (ne ZIP ani starý Excel): UTF-8, jinak české Windows-1250 – diakritika zůstane správně
      const bin = (u8[0] === 0x50 && u8[1] === 0x4B) || (u8[0] === 0xD0 && u8[1] === 0xCF);
      let wb;
      if (!bin && u8.length) { let str; try { str = new TextDecoder('utf-8', {fatal: true}).decode(u8); } catch (er) { str = new TextDecoder('windows-1250').decode(u8); } if (str.charCodeAt(0) === 0xFEFF) str = str.slice(1); wb = XLSX.read(str, Object.assign({type: 'string', raw: true}, opt)); }
      else wb = XLSX.read(u8, Object.assign({type: 'array'}, opt));
      const listy = wb.SheetNames.map(n => {
        const ws = wb.Sheets[n];
        if (!ws || !ws['!ref']) return {n, rows: [], skryto: [], urov: [], barvy: [], cols: [], dec: [], colFill: [], od: 0, odSl: 0, skrytyList: false};
        const rg = XLSX.utils.decode_range(ws['!ref']);
        const rows = XLSX.utils.sheet_to_json(ws, {header: 1, raw: true, defval: '', blankrows: true});
        const ri = ws['!rows'] || [], skryto = [], urov = [];
        for (let i = 0; i < rows.length; i++) { const r = ri[rg.s.r + i]; skryto.push(r && r.hidden ? 1 : 0); urov.push(r && r.level ? r.level : 0); }
        // sloupce v řádku začínají prvním sloupcem oblasti listu – kvůli písmenům sloupců si pamatujeme posun
        const st = (wb.Workbook && wb.Workbook.Sheets || []).find(s => s.name === n);
        // vzhled jako v Excelu: šířky a skryté sloupce, desetinná místa podle formátu, barvy výplně buněk
        const nc = rg.e.c - rg.s.c + 1, ci = ws['!cols'] || [];
        const cols = [], dec = [], decN = [], barvy = [], colCnt = [];
        for (let c = 0; c < nc; c++) { const x = ci[rg.s.c + c] || {}; cols.push({w: x.wpx || (x.wch ? Math.round(x.wch * 7) : 64), h: x.hidden ? 1 : 0}); decN.push({}); colCnt.push({}); }
        for (let i = 0; i < rows.length; i++) {
          let f = null;
          for (let c = 0; c < nc; c++) {
            const cell = ws[XLSX.utils.encode_cell({r: rg.s.r + i, c: rg.s.c + c})];
            if (!cell) continue;
            if (cell.t === 'n' && cell.z && i < 4000) { const m = /\.(0+)/.exec(String(cell.z)); const d = m ? m[1].length : /^(General|0)$/i.test(cell.z) ? -1 : 0; decN[c][d] = (decN[c][d] || 0) + 1; }
            const s = cell.s, rgb = s && s.patternType && s.patternType !== 'none' && s.fgColor && s.fgColor.rgb;
            if (rgb && !/^(FFFFFF|000000)$/i.test(String(rgb).slice(-6))) { const col = String(rgb).slice(-6).toUpperCase(); (f ||= []).push([c, col]); colCnt[c][col] = (colCnt[c][col] || 0) + 1; }
          }
          barvy.push(f);
        }
        decN.forEach(o => { let best = -1, bn = 0; Object.keys(o).forEach(k => { if (o[k] > bn) { bn = o[k]; best = +k; } }); dec.push(best); });
        // barva, kterou má skoro celý sloupec (např. žlutý sloupec cen), se uloží jen jednou pro sloupec
        const colFill = colCnt.map(o => { let best = '', bn = 0; Object.keys(o).forEach(k => { if (o[k] > bn) { bn = o[k]; best = k; } }); return bn > rows.length * 0.5 ? best : ''; });
        for (let i = 0; i < barvy.length; i++) if (barvy[i]) { barvy[i] = barvy[i].filter(([c, col]) => colFill[c] !== col); if (!barvy[i].length) barvy[i] = null; }
        return {n, rows, skryto, urov, barvy, cols, dec, colFill, od: rg.s.r, odSl: rg.s.c, skrytyList: !!(st && st.Hidden)};
      });
      self.postMessage({ok: true, listy});
    } else if (m.akce === 'zapis') {
      const wb = XLSX.utils.book_new();
      (m.listy || []).forEach(l => {
        const ws = XLSX.utils.aoa_to_sheet(l.rows || []);
        if (l.sirky) ws['!cols'] = l.sirky.map(w => ({wch: w}));
        if (l.urov) ws['!rows'] = l.urov.map(u => u ? {level: u} : {});
        XLSX.utils.book_append_sheet(wb, ws, String(l.n || 'List').replace(/[\\\/?*\[\]:]/g, ' ').slice(0, 31));
      });
      const out = XLSX.write(wb, {type: 'array', bookType: 'xlsx', compression: true});
      self.postMessage({ok: true, buf: out}, [out.buffer || out]);
    }
  } catch (x) { self.postMessage({ok: false, chyba: String(x && x.message || x)}); }
};
