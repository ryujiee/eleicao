// Converts the official IBGE UF mesh (malhas API v3, SVG) into public/brasil.svg:
// clean viewBox, ids by UF sigla and a label anchor per state (pole of inaccessibility).
// Usage: node scripts/build-map.mjs [qualidade]   (minima | intermediaria, default intermediaria)
import { writeFileSync } from 'node:fs';

const IBGE = {
  11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO', 21: 'MA', 22: 'PI',
  23: 'CE', 24: 'RN', 25: 'PB', 26: 'PE', 27: 'AL', 28: 'SE', 29: 'BA', 31: 'MG', 32: 'ES',
  33: 'RJ', 35: 'SP', 41: 'PR', 42: 'SC', 43: 'RS', 50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF',
};
const quality = process.argv[2] || 'intermediaria';
const url = `https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?formato=image/svg+xml&intrarregiao=UF&qualidade=${quality}`;
const src = await (await fetch(url)).text();

// Source coords are lon/lat * 1e4, commands are M (absolute), l/h/v (relative) and Z.
const states = [];
for (const [, id, d] of src.matchAll(/<path id="(\d+)" d="([^"]*)"/g)) {
  const rings = [];
  let ring, x = 0, y = 0;
  for (const [, cmd, args] of d.matchAll(/([MlhvZz])([^MlhvZz]*)/g)) {
    const nums = args.trim() ? args.trim().split(/[\s,]+/).map(Number) : [];
    if (cmd === 'M') { x = nums[0]; y = nums[1]; ring = [[x, y]]; rings.push(ring); }
    else if (cmd === 'l') for (let i = 0; i < nums.length; i += 2) { x += nums[i]; y += nums[i + 1]; ring.push([x, y]); }
    else if (cmd === 'h') for (const n of nums) { x += n; ring.push([x, y]); }
    else if (cmd === 'v') for (const n of nums) { y += n; ring.push([x, y]); }
  }
  states.push({ uf: IBGE[id], rings: rings.map(r => r.map(([a, b]) => [a / 1e4, b / 1e4])) });
}
if (states.length !== 27 || states.some(s => !s.uf)) throw new Error(`expected 27 UFs, got ${states.length}`);

// Equirectangular with cos(lat0) correction: good enough for Brazil's extent, keeps shared borders identical.
const all = states.flatMap(s => s.rings.flat());
const lonMin = Math.min(...all.map(p => p[0])), lonMax = Math.max(...all.map(p => p[0]));
const latMin = Math.min(...all.map(p => p[1])), latMax = Math.max(...all.map(p => p[1]));
const K = 25, COS = Math.cos((((latMin + latMax) / 2) * Math.PI) / 180), PAD = 8;
const proj = ([lon, lat]) => [Math.round(((lon - lonMin) * COS * K + PAD) * 10) / 10, Math.round(((latMax - lat) * K + PAD) * 10) / 10];
const W = Math.ceil((lonMax - lonMin) * COS * K + 2 * PAD), H = Math.ceil((latMax - latMin) * K + 2 * PAD);

const fmt = n => String(Math.round(n * 10) / 10);
function pathD(rings) {
  return rings.map(r => {
    const pts = r.map(proj).filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]);
    let out = `M${fmt(pts[0][0])} ${fmt(pts[0][1])}`;
    for (let i = 1; i < pts.length; i++) out += `l${fmt(pts[i][0] - pts[i - 1][0])} ${fmt(pts[i][1] - pts[i - 1][1])}`;
    return out + 'z';
  }).join('');
}

// Pole of inaccessibility on the largest ring (coarse grid + refinement): label anchor inside the shape.
function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function inside(p, r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++)
    if ((r[i][1] > p[1]) !== (r[j][1] > p[1]) && p[0] < ((r[j][0] - r[i][0]) * (p[1] - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
  return c;
}
function area(r) { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return Math.abs(s / 2); }
function pole(r) {
  const xs = r.map(p => p[0]), ys = r.map(p => p[1]);
  let [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  let best = [(x0 + x1) / 2, (y0 + y1) / 2], bestD = -1;
  for (let iter = 0; iter < 4; iter++) {
    const step = Math.max(x1 - x0, y1 - y0) / 30;
    for (let x = x0; x <= x1; x += step) for (let y = y0; y <= y1; y += step) {
      if (!inside([x, y], r)) continue;
      let d = Infinity;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) d = Math.min(d, segDist([x, y], r[j], r[i]));
      if (d > bestD) { bestD = d; best = [x, y]; }
    }
    [x0, x1, y0, y1] = [best[0] - step * 2, best[0] + step * 2, best[1] - step * 2, best[1] + step * 2];
  }
  return { p: best, r: bestD };
}

const out = states.sort((a, b) => a.uf.localeCompare(b.uf)).map(s => {
  const projRings = s.rings.map(r => r.map(proj));
  const main = projRings.reduce((a, b) => (area(b) > area(a) ? b : a));
  const { p, r } = pole(main);
  return `<path id="uf-${s.uf}" data-uf="${s.uf}" data-lx="${fmt(p[0])}" data-ly="${fmt(p[1])}" data-lr="${fmt(r)}" d="${pathD(s.rings)}"/>`;
});

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" data-source="IBGE malhas v3 (${quality})">\n<g class="ufs">\n${out.join('\n')}\n</g>\n</svg>\n`;
writeFileSync(new URL('../public/brasil.svg', import.meta.url), svg);
console.log(`public/brasil.svg ${W}x${H} ${(svg.length / 1024).toFixed(1)} KB`);
