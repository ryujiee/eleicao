// Zero-dependency backend: polls TSE once, caches, and fans out to browsers via SSE.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UFS, abKeys, emptyArea, normalizeArea } from './lib/tse.js';

const AREAS = ['BR', ...Object.keys(UFS)];
const PUBLIC = fileURLToPath(new URL('./public/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png' };
const UA = 'eleicao.infinitytech.net.br (+https://github.com/ryujiee/eleicao)';

async function mapLimit(items, n, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: n }, async () => { while (queue.length) await fn(queue.shift()); }));
}

export function createApp({
  base = process.env.TSE_BASE || 'https://resultados.tse.jus.br/oficial',
  ciclo = process.env.TSE_CICLO || 'ele2026',
  election = process.env.TSE_ELECTION || '6257', // 1º turno; 2º turno = 6258
  electionName = process.env.ELECTION_NAME || 'Eleição Ordinária Federal - 2026 1º Turno',
  pollMs = Number(process.env.POLL_MS) || 3_000, // TSE CDN serves the ab file with max-age=2; unchanged = 304
  fullRefreshMs = 60_000,
  heartbeatMs = 20_000,
  log = (...a) => console.log(new Date().toISOString(), ...a),
} = {}) {
  const e = election.padStart(6, '0');
  const dados = `${base}/${ciclo}/${election}/dados`;
  const abUrl = `${dados}/br/br-e${e}-ab.json`;
  const uUrl = uf => `${dados}/${uf.toLowerCase()}/${uf.toLowerCase()}-c0001-e${e}-u.json`;

  const national = emptyArea('BR');
  const states = Object.fromEntries(Object.keys(UFS).map(uf => [uf, emptyArea(uf)]));
  const area = uf => (uf === 'BR' ? national : states[uf]);
  const etags = new Map();
  const freshUntil = new Map(); // url -> ms; the TSE CDN cannot return anything newer before its max-age expires
  const seen = {};   // uf -> ab key already reflected in our cached data
  const tries = Object.fromEntries(AREAS.map(uf => [uf, 0]));
  let wanted = {};   // uf -> latest ab key ("dt ht seçõesTotalizadas")
  let lastFull = 0, updatedAt = new Date().toISOString(), checkedAt = null, lastError = null, snapshotJson = null;
  let timer, delay = pollMs;
  const clients = new Set();
  const stats = { requests: 0, notModified: 0, urls: [] };

  async function get(url) {
    if (freshUntil.get(url) > Date.now()) return null;
    const headers = { 'user-agent': UA, accept: 'application/json' };
    if (etags.has(url)) headers['if-none-match'] = etags.get(url);
    stats.requests++; stats.urls.push(url);
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
    const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control'))?.[1] || 0);
    if (maxAge > 1) freshUntil.set(url, Date.now() + Math.min(maxAge, 60) * 1000);
    if (res.status === 304) { stats.notModified++; return null; }
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    const body = await res.json();
    if (res.headers.get('etag')) etags.set(url, res.headers.get('etag'));
    return body;
  }

  function apply(next) {
    const cur = area(next.uf);
    if (next.sections.counted < cur.sections.counted) return false; // stale copy from another CDN edge
    if (JSON.stringify(next) === JSON.stringify(cur)) return false;
    Object.assign(cur, next);
    return true;
  }

  // One cycle = conditional requests for the ab status file and the national result (304 when unchanged)
  // + 1 request per UF whose status line changed.
  async function cycle() {
    const ab = await get(abUrl);
    if (ab) wanted = abKeys(ab);
    const full = Date.now() - lastFull > fullRefreshMs; // safety net in case ab lags; unchanged files answer 304
    if (full) lastFull = Date.now();
    // Files served with a CDN max-age are revalidated as soon as it expires (get() skips them until then):
    // ab and each result file have independent ~60s CDN cycles, so waiting for ab would add up to 2 delays.
    const dirty = AREAS.filter(uf => uf === 'BR' || full || freshUntil.has(uUrl(uf)) || !(uf in seen) || (wanted[uf] !== undefined && wanted[uf] !== seen[uf]));
    const changed = {};
    await mapLimit(dirty, 4, async uf => {
      try {
        const u = await get(uUrl(uf));
        if (u && apply(normalizeArea(uf, u))) changed[uf] = area(uf);
        const a = area(uf), target = wanted[uf];
        // The CDN may still serve an older result file than ab announced: retry each cycle (~90s max).
        if (target === undefined || `${a.dt} ${a.ht} ${a.sections.counted}` === target || ++tries[uf] >= Math.ceil(90_000 / pollMs)) {
          seen[uf] = target ?? '';
          tries[uf] = 0;
        }
      } catch (err) {
        tries[uf] = 0;
        log('area', uf, err.message);
      }
    });
    checkedAt = new Date().toISOString();
    snapshotJson = null;
    const keys = Object.keys(changed);
    if (keys.length) {
      updatedAt = checkedAt;
      const { BR, ...ufs } = changed;
      const msg = { updatedAt, checkedAt };
      if (BR) msg.national = BR;
      if (Object.keys(ufs).length) msg.states = ufs;
      send(`event: update\ndata: ${JSON.stringify(msg)}\n\n`);
      log('changed', keys.join(','));
    }
  }

  async function loop() {
    try { await cycle(); lastError = null; delay = pollMs; }
    catch (err) { lastError = err.message; delay = Math.min(delay * 2, 60_000); log('poll', err.message); }
    timer = setTimeout(loop, delay);
  }

  const snapshot = () => (snapshotJson ??= JSON.stringify({
    election: { code: election, name: electionName, cargo: 'Presidente' }, updatedAt, checkedAt, national, states,
  }));
  const send = frame => { for (const res of clients) res.write(frame); };
  // Heartbeat doubles as keep-alive and "verificado às" refresh for the page.
  const heartbeat = setInterval(() => send(`event: update\ndata: ${JSON.stringify({ checkedAt })}\n\n`), heartbeatMs);

  const server = http.createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }

    if (path === '/api/president') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' });
      res.end(snapshot());
      return;
    }
    if (path === '/api/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      res.write(`retry: 3000\nevent: snapshot\ndata: ${snapshot()}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (path === '/healthz') {
      res.writeHead(lastError ? 503 : 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: !lastError, lastError, checkedAt, updatedAt, clients: clients.size, requests: stats.requests, notModified: stats.notModified }));
      return;
    }

    const file = join(PUBLIC, normalize(path === '/' ? '/index.html' : path));
    if (!file.startsWith(PUBLIC)) { res.writeHead(404).end(); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'public, max-age=60' });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });

  return {
    server, stats, national, states,
    listen(port, host) {
      loop();
      return new Promise(r => server.listen(port, host, () => r(server.address().port)));
    },
    stop() {
      clearTimeout(timer); clearInterval(heartbeat);
      for (const res of clients) res.end();
      server.close();
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3026;
  createApp().listen(port, process.env.HOST || '127.0.0.1').then(p => console.log(`eleicao on :${p}`));
}
