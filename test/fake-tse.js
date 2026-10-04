// Local stand-in for resultados.tse.jus.br built from real (zeroed) 2026 files, with ETag/304 like the CDN.
import http from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const abFixture = JSON.parse(readFileSync(new URL('./fixtures/ab.json', import.meta.url)));
const uFixture = JSON.parse(readFileSync(new URL('./fixtures/u-sc.json', import.meta.url)));
const br = n => String(n).replace('.', ',');

// votes = { candidateNumber: votes }
export function makeU(uf, votes = {}, { st = 0, dt = st ? '04/10/2026' : '', ht = st ? '17:30:00' : '' } = {}) {
  const u = structuredClone(uFixture);
  Object.assign(u, { cdabr: uf, tpabr: uf === 'br' ? 'br' : 'uf', dt, ht });
  const total = Object.values(votes).reduce((a, b) => a + b, 0);
  for (const agr of u.carg[0].agr)
    for (const par of agr.par)
      for (const c of par.cand) {
        const v = votes[c.n] ?? 0;
        c.vap = String(v);
        c.pvapn = br(total ? (v / total) * 100 : 0);
        c.pvap = br(total ? ((v / total) * 100).toFixed(2) : '0.00');
      }
  u.s.st = String(st);
  u.s.pstn = br((st / Number(u.s.ts)) * 100);
  u.v.vv = String(total);
  u.v.tv = String(total);
  return u;
}

export async function startFakeTse({ maxAge = 0 } = {}) {
  const ab = structuredClone(abFixture);
  const files = {};
  const lag = {};
  const log = [];
  for (const a of ab.abr) if (a.cdabr !== 'zz') files[a.cdabr] = makeU(a.cdabr);

  const server = http.createServer((req, res) => {
    log.push(req.url);
    let body, m;
    if (req.url.endsWith('/dados/br/br-e006257-ab.json')) body = JSON.stringify(ab);
    else if ((m = req.url.match(/\/dados\/([a-z]{2})\/\1-c0001-e006257-u\.json$/)) && files[m[1]]) {
      const l = lag[m[1]];
      body = JSON.stringify(l && l.remaining-- > 0 ? l.old : files[m[1]]);
    }
    if (!body) { res.writeHead(404).end(); return; }
    const etag = `"${createHash('md5').update(body).digest('hex')}"`;
    if (req.headers['if-none-match'] === etag) { res.writeHead(304).end(); return; }
    res.writeHead(200, { 'content-type': 'application/json', etag, 'cache-control': `max-age=${maxAge}` }).end(body);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));

  return {
    base: `http://127.0.0.1:${server.address().port}/oficial`,
    log,
    // New totalization for an area: rewrites its result file and its line in the ab status file.
    // lagRequests simulates the CDN serving the previous result file for N more requests.
    publish(uf, votes, st, ht, { lagRequests = 0, touchAb = true } = {}) {
      const old = files[uf];
      files[uf] = makeU(uf, votes, { st, ht });
      if (lagRequests) lag[uf] = { old, remaining: lagRequests };
      if (!touchAb) return;
      const a = ab.abr.find(x => x.cdabr === uf);
      Object.assign(a, { dt: '04/10/2026', ht });
      a.s.st = String(st);
    },
    close: () => server.close(),
  };
}
