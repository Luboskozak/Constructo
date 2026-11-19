/* Constructo – Rozpočet: čtení a zápis Excelu na pozadí (aby se okno při 40 000 řádcích nezaseklo).
   Používá knihovnu SheetJS (xlsx.full.min.js, licence Apache 2.0). Umí .xlsx, .xlsm, .xls, .ods i .csv.
   Vrací všechny řádky všech listů včetně řádků skrytých v Excelu (příznak skryto + úroveň seskupení). */
importScripts('xlsx.full.min.js');
self.onmessage = e => {
  const m = e.data || {};
  try {
    if (m.akce === 'cti') {
      const wb = XLSX.read(new Uint8Array(m.buf), {type: 'array', cellStyles: true, cellFormula: false, cellHTML: false, cellNF: false, cellText: false, sheetStubs: false});
      const listy = wb.SheetNames.map(n => {
        const ws = wb.Sheets[n];
        if (!ws || !ws['!ref']) return {n, rows: [], skryto: [], urov: [], od: 0, skrytyList: false};
        const rg = XLSX.utils.decode_range(ws['!ref']);
        const rows = XLSX.utils.sheet_to_json(ws, {header: 1, raw: true, defval: '', blankrows: true});
        const ri = ws['!rows'] || [], skryto = [], urov = [];
        for (let i = 0; i < rows.length; i++) { const r = ri[rg.s.r + i]; skryto.push(r && r.hidden ? 1 : 0); urov.push(r && r.level ? r.level : 0); }
        // sloupce v řádku začínají prvním sloupcem oblasti listu – kvůli písmenům sloupců si pamatujeme posun
        const st = (wb.Workbook && wb.Workbook.Sheets || []).find(s => s.name === n);
        return {n, rows, skryto, urov, od: rg.s.r, odSl: rg.s.c, skrytyList: !!(st && st.Hidden)};
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
