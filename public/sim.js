// Pure second-round scenario math (no DOM). Shares are fractions in [0, 1]; votes are counts.
// Nothing here forecasts anything: it only recombines official 1st-round numbers under user premises.

export const clamp01 = x => Math.min(1, Math.max(0, Number(x) || 0));

// Finalists come from TSE data only: official "2º turno" situação, else the TSE flag md='s' + top 2 by votes.
export function finalists(national) {
  const c = national?.candidates || [];
  const rr = c.filter(x => x.secondRound);
  if (rr.length === 2) return [...rr].sort((a, b) => b.votes - a.votes);
  if (national?.defined === 's' && c.length >= 2) return [...c].sort((a, b) => b.votes - a.votes).slice(0, 2);
  return null;
}

// Eliminated candidates: the `n` most voted individually, everyone else in "demais".
export function groupsFrom(national, fin, n = 4) {
  const fn = new Set(fin.map(c => c.number));
  const rest = (national?.candidates || []).filter(c => !fn.has(c.number)).sort((a, b) => b.votes - a.votes);
  const groups = rest.slice(0, n).map(c => ({ key: c.number, label: c.name, party: c.party, numbers: [c.number] }));
  if (rest.length > n) groups.push({ key: 'demais', label: 'Demais candidatos', party: '', numbers: rest.slice(n).map(c => c.number) });
  return groups;
}

// Base for one area (Brasil or a UF) from its own real 1st-round numbers.
export function baseFromArea(area, finNumbers, groups) {
  const by = {};
  for (const c of area?.candidates || []) by[c.number] = c.votes;
  const v = area?.votes || {};
  return {
    A: by[finNumbers[0]] || 0,
    B: by[finNumbers[1]] || 0,
    groups: groups.map(g => ({ key: g.key, votes: g.numbers.reduce((s, n) => s + (by[n] || 0), 0) })),
    nonValid: (v.abstention || 0) + (v.blank || 0) + (v.null || 0),
  };
}

// Share of the others' valid votes O each finalist needs to pass 50% of valid votes, if both finalists keep
// exactly their votes and all of O votes validly for one of them. a + b = 1. a <= 0: already above 50%;
// a > 1: unreachable with these votes alone. O = 0: 0 if already above half, Infinity otherwise.
export function needShare(A, B, O) {
  const V = A + B + O, half = V / 2;
  const one = X => (O > 0 ? (half - X) / O : X > half ? 0 : Infinity);
  return { a: one(A), b: one(B), V };
}

// Inputs clamped so no distribution exceeds 100%: switch + none <= 1 for each finalist's voters.
export function normalizePremises(p = {}) {
  const aToB = clamp01(p.aToB), bToA = clamp01(p.bToA);
  const groups = {};
  for (const [k, g] of Object.entries(p.groups || {})) groups[k] = { valid: clamp01(g.valid), splitA: clamp01(g.splitA ?? 0.5) };
  return {
    groups, aToB, bToA,
    aNone: Math.min(clamp01(p.aNone), 1 - aToB),
    bNone: Math.min(clamp01(p.bNone), 1 - bToA),
    newValid: clamp01(p.newValid),
    newSplitA: clamp01(p.newSplitA ?? 0.5),
  };
}

// Simulated second round. Groups missing from premises are treated as not voting validly.
export function simulate(base, premises) {
  const p = normalizePremises(premises);
  let a = base.A * (1 - p.aToB - p.aNone) + base.B * p.bToA;
  let b = base.B * (1 - p.bToA - p.bNone) + base.A * p.aToB;
  let toNone = base.A * p.aNone + base.B * p.bNone;
  for (const g of base.groups) {
    const q = p.groups[g.key] || { valid: 0, splitA: 0.5 };
    const valid = g.votes * q.valid;
    a += valid * q.splitA;
    b += valid * (1 - q.splitA);
    toNone += g.votes - valid;
  }
  const nv = base.nonValid * p.newValid;
  a += nv * p.newSplitA;
  b += nv * (1 - p.newSplitA);
  const valid = a + b;
  return { a, b, valid, pctA: valid ? (a / valid) * 100 : 0, pctB: valid ? (b / valid) * 100 : 0, toNone };
}

// Neutral, purely mathematical presets. 'neutra': eliminated votes split equally; 'repetir': only the two
// finalists' current votes count (A/(A+B)).
export function preset(name, groupKeys) {
  const valid = name === 'neutra' ? 1 : 0;
  return {
    groups: Object.fromEntries(groupKeys.map(k => [k, { valid, splitA: 0.5 }])),
    aToB: 0, bToA: 0, aNone: 0, bNone: 0, newValid: 0, newSplitA: 0.5,
  };
}
