import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { UFS, abKeys, leaderGroup, normalizeArea } from '../lib/tse.js';
import { makeU } from './fake-tse.js';

const ab = JSON.parse(readFileSync(new URL('./fixtures/ab.json', import.meta.url)));
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
