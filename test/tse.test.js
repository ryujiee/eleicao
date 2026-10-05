import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { UFS, abKeys, closure, leaderGroup, normalizeArea, normalizeRace, toBrasilia } from '../lib/tse.js';
import { makeU } from './fake-tse.js';

const ab = JSON.parse(readFileSync(new URL('./fixtures/ab.json', import.meta.url)));
const fx = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)));
const zeroed = JSON.parse(readFileSync(new URL('./fixtures/u-sc.json', import.meta.url)));

test('real zeroed TSE file = waiting, no leader', () => {
  const a = normalizeArea('SC', zeroed);
  assert.equal(a.status, 'waiting');
  assert.equal(a.leader, null);
  assert.equal(a.margin, null);
  assert.equal(a.name, 'Santa Catarina');
  assert.equal(a.candidates.length, 12);
  assert.ok(a.candidates.some(c => c.party === 'PT' && c.number === '13'), 'PT comes from par.sg even inside a federation');
  assert.ok(a.candidates.some(c => c.party === 'PL' && c.number === '22'));
});

test('leader colour group comes from party, not name', () => {
  assert.equal(leaderGroup('PT'), 'PT');
  assert.equal(leaderGroup(' pl '), 'PL');
  assert.equal(leaderGroup('NOVO'), 'OTHER');
  assert.equal(leaderGroup('PSD'), 'OTHER');
});

test('PL leads / PT leads / other leads / tie', () => {
  let a = normalizeArea('SC', makeU('sc', { 22: 1532821, 13: 823212, 30: 83211 }, { st: 100 }));
  assert.equal(a.status, 'leading');
  assert.equal(a.leader, 'PL');
  assert.equal(a.margin, 709609);
  assert.deepEqual(a.candidates.slice(0, 3).map(c => c.party), ['PL', 'PT', 'NOVO']);

  a = normalizeArea('BA', makeU('ba', { 22: 10, 13: 20 }, { st: 1 }));
  assert.equal(a.leader, 'PT');

  a = normalizeArea('MG', makeU('mg', { 30: 900, 13: 100, 22: 50 }, { st: 1 }));
  assert.equal(a.leader, 'OTHER');

  a = normalizeArea('RS', makeU('rs', { 22: 300, 13: 300, 30: 1 }, { st: 1 }));
  assert.equal(a.status, 'tie');
  assert.equal(a.leader, null);
  assert.equal(a.margin, 0);
});

test('sections totalized but zero votes is still waiting', () => {
  const a = normalizeArea('AC', makeU('ac', {}, { st: 5 }));
  assert.equal(a.status, 'waiting');
});

test('UF local time is converted to Brasília time', () => {
  assert.deepEqual(toBrasilia('AC', '04/10/2026', '15:25:43'), ['04/10/2026', '17:25:43']);
  assert.deepEqual(toBrasilia('MT', '04/10/2026', '23:30:00'), ['05/10/2026', '00:30:00']);
  assert.deepEqual(toBrasilia('SC', '04/10/2026', '17:24:55'), ['04/10/2026', '17:24:55']);
  assert.deepEqual(toBrasilia('AC', '', ''), ['', '']);
});

test('ab status file covers 27 UFs + BR, ignores exterior', () => {
  const keys = abKeys(ab);
  assert.deepEqual(Object.keys(keys).sort(), ['BR', ...Object.keys(UFS)].sort());
  assert.equal(keys.ZZ, undefined);
});

test('map has exactly the 27 UF paths with matching ids', () => {
  const svg = readFileSync(new URL('../public/brasil.svg', import.meta.url), 'utf8');
  const paths = [...svg.matchAll(/<path id="uf-([A-Z]{2})" data-uf="([A-Z]{2})"[^>]* d="M[^"]+"/g)];
  assert.equal(paths.length, 27);
  for (const [, id, uf] of paths) assert.equal(id, uf);
  assert.deepEqual(paths.map(p => p[1]).sort(), Object.keys(UFS).sort());
});

test('Deputado Federal SC (real partial file): entering follows the TSE seat distribution, not the top 16', () => {
  const r = normalizeRace('federal', 'SC', fx('sc-federal'));
  assert.equal(r.seats, 16);
  assert.equal(r.proportional, true);
  assert.equal(r.officialAvailable, false);
  assert.ok(r.qe > 0);
  const entering = r.candidates.filter(c => c.entering);
  assert.equal(entering.length, 16);
  assert.equal(r.parties.reduce((a, p) => a + p.seats, 0), 16);
  // Each agremiação gets exactly its TSE seats, filled by its own most voted candidates.
  for (const p of r.parties) {
    const list = r.candidates.filter(c => c.coalition === p.name && c.valid);
    assert.equal(list.filter(c => c.entering).length, p.seats, p.name);
    assert.ok(list.slice(0, p.seats).every(c => c.entering), p.name);
  }
  const top16 = r.candidates.slice(0, 16);
  assert.ok(top16.some(c => !c.entering), 'someone in the overall top 16 is outside');
  assert.ok(entering.some(c => c.rank > 16), 'someone below the top 16 is in via the list');
  assert.ok(r.candidates.every(c => !c.elected && !c.inSeats));
  assert.ok(r.candidates.some(c => !c.valid), 'sub judice candidates flagged');
  assert.ok(r.candidates.filter(c => !c.valid).every(c => !c.entering));
});

test('Governador / Senado SC: highlight seats, never elected without TSE', () => {
  const g = normalizeRace('governador', 'SC', fx('sc-governador'));
  assert.equal(g.seats, 1);
  assert.deepEqual(g.candidates.filter(c => c.inSeats).map(c => c.name), ['JORGINHO MELLO']);
  assert.equal(g.margin, g.candidates[0].votes - g.candidates[1].votes);
  assert.ok(g.candidates.every(c => !c.elected && !c.entering));
  assert.ok(g.sections.pct > 0 && g.status === 'counting');

  const s = normalizeRace('senado', 'SC', fx('sc-senado'));
  assert.equal(s.seats, 2);
  assert.deepEqual(s.candidates.filter(c => c.inSeats).map(c => c.rank), [1, 2]);
  assert.ok(s.candidates.every(c => !c.elected));
});

test('official TSE situação replaces the projection', () => {
  const u = fx('sc-federal');
  const cands = u.carg[0].agr.flatMap(a => a.par).flatMap(p => p.cand);
  cands.forEach(c => { c.st = 'Não eleito'; c.e = 'n'; });
  Object.assign(cands.at(-1), { st: 'Eleito por média', e: 's' });
  const r = normalizeRace('federal', 'SC', u);
  assert.equal(r.officialAvailable, true);
  assert.ok(r.candidates.every(c => !c.entering));
  assert.equal(r.candidates.filter(c => c.elected).length, 1);
  assert.equal(r.candidates.find(c => c.elected).official, 'Eleito por média');
});

test('race with no totalization: nobody entering or in seats', () => {
  const u = fx('sc-federal');
  u.s.st = '0';
  u.carg[0].agr.forEach(a => { a.vag = '0'; a.par.forEach(p => p.cand.forEach(c => (c.vap = '0'))); });
  const r = normalizeRace('federal', 'SC', u);
  assert.equal(r.status, 'waiting');
  assert.ok(r.candidates.every(c => !c.entering && !c.inSeats));
  const empty = normalizeRace('governador', 'SC', {});
  assert.equal(empty.status, 'waiting');
  assert.equal(empty.candidates.length, 0);
});

test('runoff candidates (e=s, st=2º turno) are not "eleito"; md is passed through', () => {
  const u = fx('sc-governador');
  const cands = u.carg[0].agr.flatMap(a => a.par).flatMap(p => p.cand);
  cands.forEach(c => { c.st = 'Não eleito'; c.e = 'n'; });
  for (const n of ['22', '40']) Object.assign(cands.find(c => c.n === n), { st: '2º turno', e: 's' });
  u.md = 's';
  const r = normalizeRace('governador', 'SC', u);
  assert.equal(r.defined, 's');
  assert.deepEqual(r.candidates.filter(c => c.secondRound).map(c => c.number).sort(), ['22', '40']);
  assert.ok(r.candidates.every(c => !c.elected));

  const br = makeU('br', { 22: 600, 13: 400 }, { st: 10 });
  br.md = 'e';
  br.carg[0].agr.flatMap(a => a.par).flatMap(p => p.cand).find(c => c.n === '22').st = 'Eleito';
  const n = normalizeArea('BR', br);
  assert.equal(n.defined, 'e');
  assert.equal(n.candidates[0].elected, true);
  assert.equal(n.candidates[1].official, undefined, 'no situação fields while the TSE leaves st empty');
});

test('apuração encerrada only from TSE flags; raw percentage untouched', () => {
  assert.equal(closure({ tf: 's' }), 'final');
  assert.equal(closure({ tf: 'n', md: 's' }), 'defined');
  assert.equal(closure({ tf: 'n', md: 'e' }), 'defined');
  assert.equal(closure({ tf: 'n', md: 'n' }), null);
  assert.equal(closure({ tf: 'n' }), null, '99,9% without a TSE flag is still counting');
  const u = makeU('br', { 22: 56098518, 13: 53846638 }, { st: 499077 });
  u.s.ts = '499248'; u.s.pstn = '99,965748486'; u.md = 's'; u.tf = 'n';
  u.e = { a: '33458767', te: '158745502' };
  const n = normalizeArea('BR', u);
  assert.equal(n.closure, 'defined');
  assert.equal(n.sections.pct, 99.965748486);
  assert.deepEqual([n.sections.counted, n.sections.total], [499077, 499248]);
  assert.equal(n.votes.abstention, 33458767);
  assert.equal(n.votes.electorate, 158745502);
  assert.equal(normalizeRace('governador', 'SC', { ...fx('sc-governador'), tf: 's' }).closure, 'final');
});
