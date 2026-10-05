import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseFromArea, finalists, groupsFrom, needShare, normalizePremises, preset, simulate } from '../public/sim.js';

// Official TSE national numbers (1st round 2026, 99,97% totalizado).
const A = 56098518, B = 53846638; // Flávio (22), Lula (13)
const others = [['70', 3447888], ['14', 2675586], ['55', 2604789], ['30', 326469], ['80', 122903], ['16', 43100], ['27', 40041], ['21', 22688], ['35', 16876], ['29', 15022]];
const O = others.reduce((s, [, v]) => s + v, 0);
const national = {
  defined: 's',
  votes: { valid: A + B + O, blank: 2300248, null: 3672695, abstention: 33458767 },
  candidates: [{ number: '22', name: 'FLAVIO BOLSONARO', party: 'PL', votes: A }, { number: '13', name: 'LULA', party: 'PT', votes: B }, ...others.map(([n, v]) => ({ number: n, name: n, party: 'X', votes: v }))],
};
const fin = finalists(national);
const groups = groupsFrom(national, fin);
const base = baseFromArea(national, fin.map(c => c.number), groups);
const keys = groups.map(g => g.key);
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const all = (valid, splitA) => ({ ...preset('repetir', keys), groups: Object.fromEntries(keys.map(k => [k, { valid, splitA }])) });

test('finalists and groups come from data', () => {
  assert.deepEqual(fin.map(c => c.number), ['22', '13']);
  assert.deepEqual(groups.map(g => g.key), ['70', '14', '55', '30', 'demais']);
  assert.equal(groups.at(-1).numbers.length, 6);
  assert.equal(finalists({ defined: 'n', candidates: national.candidates }), null);
  const official = { candidates: national.candidates.map(c => ({ ...c, secondRound: c.number === '13' || c.number === '70' })) };
  assert.deepEqual(finalists(official).map(c => c.number), ['13', '70']);
});

test('base totals equal the area real votes', () => {
  assert.equal(base.A + base.B + base.groups.reduce((s, g) => s + g.votes, 0), national.votes.valid);
  assert.equal(base.nonValid, 2300248 + 3672695 + 33458767);
  const uf = { votes: { abstention: 10, blank: 2, null: 3 }, candidates: [{ number: '22', votes: 100 }, { number: '13', votes: 80 }, { number: '70', votes: 7 }, { number: '29', votes: 1 }] };
  const ub = baseFromArea(uf, ['22', '13'], groups);
  assert.equal(ub.A + ub.B + ub.groups.reduce((s, g) => s + g.votes, 0), 188);
  assert.equal(ub.groups.find(g => g.key === 'demais').votes, 1);
  assert.equal(ub.nonValid, 15);
});

test('needShare with official numbers: ~37,9% / ~62,1%, summing to 1', () => {
  const n = needShare(A, B, O);
  close(n.a + n.b, 1);
  assert.ok(n.a > 0.378 && n.a < 0.380, String(n.a));
  assert.ok(n.b > 0.620 && n.b < 0.622, String(n.b));
  assert.equal(needShare(60, 30, 10).a, -1); // already above 50%
  assert.ok(needShare(10, 80, 10).a > 1); // unreachable
  assert.equal(needShare(60, 40, 0).a, 0);
  assert.equal(needShare(40, 60, 0).a, Infinity);
});

test('repetir = A/(A+B); neutra splits the others equally', () => {
  const r = simulate(base, preset('repetir', keys));
  close(r.pctA, (A / (A + B)) * 100);
  assert.equal(r.pctA.toFixed(2), '51.02');
  assert.equal(r.toNone, O);
  const n = simulate(base, preset('neutra', keys));
  close(n.a, A + O / 2, 1e-6);
  close(n.b, B + O / 2, 1e-6);
  assert.equal(n.toNone, 0);
});

test('0/100, 100/0 and 50/50 transfers', () => {
  let r = simulate(base, all(1, 1));
  close(r.a, A + O, 1e-6);
  close(r.b, B, 1e-6);
  r = simulate(base, all(1, 0));
  close(r.a, A, 1e-6);
  close(r.b, B + O, 1e-6);
  r = simulate(base, all(1, 0.5));
  close(r.a - r.b, A - B, 1e-6);
  close(r.pctA + r.pctB, 100);
});

test('blank/null: valid 0.5 sends half of the others to none', () => {
  const r = simulate(base, all(0.5, 0.5));
  close(r.toNone, O / 2, 1e-6);
  close(r.valid, A + B + O / 2, 1e-6);
  const s = simulate(base, { ...preset('repetir', keys), aNone: 0.1 });
  close(s.a, A * 0.9, 1e-6);
  close(s.toNone, O + A * 0.1, 1e-6);
});

test('swaps between finalists and new valid voters', () => {
  const r = simulate(base, { ...preset('repetir', keys), aToB: 0.02, bToA: 0.01 });
  close(r.a, A * 0.98 + B * 0.01, 1e-6);
  close(r.b, B * 0.99 + A * 0.02, 1e-6);
  close(r.valid, A + B, 1e-6); // swaps keep the valid total
  const n = simulate(base, { ...preset('repetir', keys), newValid: 0.1, newSplitA: 0.25 });
  close(n.a, A + base.nonValid * 0.1 * 0.25, 1e-6);
  close(n.b, B + base.nonValid * 0.1 * 0.75, 1e-6);
});

test('no distribution exceeds 100%: inputs clamped to [0,1] and switch + none <= 1', () => {
  const p = normalizePremises({ aToB: 0.8, aNone: 0.5, bToA: -1, bNone: 7, newValid: 2, groups: { 70: { valid: 1.5, splitA: -0.2 } } });
  assert.equal(p.aToB, 0.8);
  close(p.aNone, 0.2);
  assert.equal(p.bToA, 0);
  assert.equal(p.bNone, 1);
  assert.equal(p.newValid, 1);
  assert.deepEqual(p.groups['70'], { valid: 1, splitA: 0 });
  const r = simulate(base, { ...preset('repetir', keys), aToB: 0.8, aNone: 0.5 });
  assert.ok(r.a >= 0 && r.b >= 0);
  close(r.a + r.b + r.toNone, A + B + O, 1e-6); // nobody created or lost without newValid
});
