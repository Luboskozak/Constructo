/* Constructo – převod DWG/DXF na SVG v samostatném vlákně (aby se okno nezaseklo). Knihovna: dokumentace/dwg/ (LibreDWG, GPL-3.0). */
let lib = null, mod = null;
self.onmessage = async e => {
  const {data, druh, zaklad} = e.data || {};
  try {
    if (!mod) mod = await import(zaklad + 'dist/libredwg-web.js');
    if (!lib) lib = await mod.LibreDwg.create(zaklad + 'wasm');
    const d = lib.dwg_read_data(data, druh === 'dxf' ? mod.Dwg_File_Type.DXF : mod.Dwg_File_Type.DWG);
    if (!d) throw new Error('Soubor se nepodařilo přečíst (možná je poškozený nebo z novější verze AutoCADu).');
    let db;
    try { db = lib.convert(d); } finally { try { lib.dwg_free(d); } catch (x) {} }
    let svg = lib.dwg_to_svg(db);
    const vb = /viewBox="([-\d.eE+]+) ([-\d.eE+]+) ([-\d.eE+]+) ([-\d.eE+]+)"/.exec(svg);
    const w = vb ? Number(vb[3]) : 0, h = vb ? Number(vb[4]) : 0;
    if (!(w > 0 && h > 0)) throw new Error('V modelovém prostoru výkresu nic není (výkres může být jen v rozvržení / layoutu).');
    const k = 3000 / Math.max(w, h), W = Math.round(w * k), H = Math.round(h * k);
    svg = svg.replace('width="100%" height="100%"', `width="${W}" height="${H}"`).replace('preserveAspectRatio="xMinYMin meet"', 'preserveAspectRatio="none"');
    // jako tisk z AutoCADu: bílé pozadí, bílé čáry černě, světlé barvy (žlutá, azurová) tmavší; čáry stejně tenké při každém zvětšení
    svg = svg.replace(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/g, (m, r, g, b) => {
      r = +r; g = +g; b = +b;
      if (r > 235 && g > 235 && b > 235) return '#000000';
      const jas = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      if (jas > 0.55) { const k = 0.55 / jas; r = Math.round(r * k); g = Math.round(g * k); b = Math.round(b * k); }
      return `rgb(${r},${g},${b})`;
    }).replace('stroke-width="0.1%"', 'stroke-width="1.2"').replace('<defs>', '<style>line,path,polyline,polygon,circle,ellipse,rect{vector-effect:non-scaling-stroke}</style><defs>');
    self.postMessage({svg, w: W, h: H});
  } catch (x) {
    self.postMessage({chyba: String((x && x.message) || x)});
  }
};
