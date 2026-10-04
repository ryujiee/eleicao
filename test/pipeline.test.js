// End-to-end: fake TSE -> poller (change detection) -> SSE clients.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { startFakeTse } from './fake-tse.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function openSse(url) {
  const res = await fetch(url);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const queue = [];
  let buf = '';
  (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = /^event: (.*)$/m.exec(frame)?.[1];
        if (ev) queue.push({ ev, data: JSON.parse(/^data: (.*)$/m.exec(frame)[1]) });
      }
    }
  })().catch(() => {});
  return {
    async next(type, ms = 4000) {
      for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(20)) {
        const i = queue.findIndex(q => q.ev === type);
        if (i >= 0) return queue.splice(i, 1)[0].data;
      }
      throw new Error(`timeout waiting for ${type}`);
    },
  };
}

function counts(states) {
  const c = { PT: 0, PL: 0, OTHER: 0, tie: 0, waiting: 0 };
  for (const s of Object.values(states)) c[s.status === 'leading' ? s.leader : s.status]++;
  return c;
}

test('live pipeline: detection, per-UF updates, leader changes, independence from national', async t => {
  const tse = await startFakeTse();
  const app = createApp({ base: tse.base, pollMs: 40, heartbeatMs: 60_000, log: () => {} });
  const port = await app.listen(0, '127.0.0.1');
  t.after(() => { app.stop(); tse.close(); });
  const url = `http://127.0.0.1:${port}`;

  for (let i = 0; i < 100 && app.stats.requests < 29; i++) await sleep(20);
  const sse = await openSse(`${url}/api/stream`);
  const snap = await sse.next('snapshot');
  assert.equal(Object.keys(snap.states).length, 27);
  assert.deepEqual(counts(snap.states), { PT: 0, PL: 0, OTHER: 0, tie: 0, waiting: 27 });
  assert.equal(snap.national.status, 'waiting');

  // Idle: only the ab status file and the national result are revalidated, never the 27 UF files.
  let mark = tse.log.length;
  await sleep(250);
  const idle = tse.log.slice(mark);
  assert.ok(idle.length >= 2);
  const cheap = u => u.endsWith('-ab.json') || u.endsWith('/br/br-c0001-e006257-u.json');
  assert.ok(idle.every(cheap), idle.join('\n'));

  mark = tse.log.length;
  tse.publish('sc', { 22: 1000, 13: 500 }, 10, '17:30:00');
  let up = await sse.next('update');
  assert.deepEqual(Object.keys(up.states), ['SC']);
  assert.equal(up.national, undefined);
  assert.equal(up.states.SC.leader, 'PL');
  assert.equal(up.states.SC.margin, 500);
  assert.equal(up.states.SC.ht, '17:30:00');
  assert.deepEqual([...new Set(tse.log.slice(mark).filter(u => !cheap(u)))], ['/oficial/ele2026/6257/dados/sc/sc-c0001-e006257-u.json']);

  tse.publish('sc', { 22: 1000, 13: 1600 }, 20, '17:31:00');
  up = await sse.next('update');
  assert.equal(up.states.SC.leader, 'PT');

  // CDN still serving the old RS file for 3 requests: must keep retrying until it shows up.
  tse.publish('rs', { 22: 300, 13: 300 }, 5, '17:32:00', { lagRequests: 3 });
  up = await sse.next('update');
  assert.equal(up.states.RS.status, 'tie');
  assert.equal(up.states.RS.leader, null);

  tse.publish('mg', { 30: 900, 13: 100 }, 5, '17:33:00');
  up = await sse.next('update');
  assert.equal(up.states.MG.leader, 'OTHER');

  // Acre publishes in local time (UTC-5): shown in Brasília time, and the ab/result keys still match.
  mark = tse.log.length;
  tse.publish('ac', { 22: 70, 13: 30 }, 3, '15:35:00');
  up = await sse.next('update');
  assert.equal(up.states.AC.ht, '17:35:00');
  await sleep(200);
  assert.equal(tse.log.slice(mark).filter(u => u.includes('/ac/')).length, 1, 'no pointless retries for AC');

  tse.publish('br', { 22: 5000, 13: 4000 }, 50, '17:34:00');
  up = await sse.next('update');
  assert.equal(up.national.leader, 'PL');
  assert.equal(up.states, undefined);

  const final = await (await fetch(`${url}/api/president`)).json();
  assert.deepEqual(counts(final.states), { PT: 1, PL: 1, OTHER: 1, tie: 1, waiting: 23 });
  assert.equal(final.states.SC.leader, 'PT', 'national result does not leak into states');
  assert.equal(final.national.leader, 'PL');

  const health = await (await fetch(`${url}/healthz`)).json();
  assert.equal(health.ok, true);
});

test('honours the TSE CDN max-age instead of re-polling a cached file', async t => {
  const tse = await startFakeTse({ maxAge: 30 });
  const app = createApp({ base: tse.base, pollMs: 40, heartbeatMs: 60_000, log: () => {} });
  await app.listen(0, '127.0.0.1');
  t.after(() => { app.stop(); tse.close(); });
  await sleep(600);
  assert.equal(tse.log.filter(u => u.endsWith('-ab.json')).length, 1);
  assert.equal(tse.log.length, 29, 'ab + 28 result files, each fetched once');
});
