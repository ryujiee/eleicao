// Pure helpers to turn official TSE "divulgação" files into the dashboard model.
// File layout (2026, discovered from https://resultados.tse.jus.br/oficial/comum/config/ele-c.json):
//   <base>/<ciclo>/<eleicao>/dados/br/br-e<eleicao>-ab.json      one file with every UF's totalization status
//   <base>/<ciclo>/<eleicao>/dados/<uf>/<uf>-c0001-e<eleicao>-u.json  presidential result for one area (uf or br)

export const UFS = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará',
  DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso',
  MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná',
  PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte',
  RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo',
  SE: 'Sergipe', TO: 'Tocantins',
};

// TSE numbers are strings; decimals use a comma ("73,42").
export const num = s => Number(String(s ?? '0').replace(',', '.')) || 0;

export function leaderGroup(party) {
  const p = String(party || '').trim().toUpperCase();
  return p === 'PT' ? 'PT' : p === 'PL' ? 'PL' : 'OTHER';
}

export function emptyArea(uf) {
  return {
    uf, name: uf === 'BR' ? 'Brasil' : UFS[uf], status: 'waiting', leader: null, final: false, dt: '', ht: '',
    sections: { total: 0, counted: 0, pct: 0 }, votes: { valid: 0, blank: 0, null: 0, total: 0 },
    candidates: [], margin: null,
  };
}

// TSE writes dt/ht in the UF's local time (AC = UTC-5; AM, RR, RO, MT, MS = UTC-4). Show everything in Brasília time.
const OFFSET = { AC: 2, AM: 1, RR: 1, RO: 1, MT: 1, MS: 1 };
export function toBrasilia(uf, dt, ht) {
  const h = OFFSET[uf];
  if (!h || !dt || !ht) return [dt || '', ht || ''];
  const [d, m, y] = dt.split('/').map(Number), [H, M, S] = ht.split(':').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, H + h, M, S));
  const p = n => String(n).padStart(2, '0');
  return [`${p(t.getUTCDate())}/${p(t.getUTCMonth() + 1)}/${t.getUTCFullYear()}`, `${p(t.getUTCHours())}:${p(t.getUTCMinutes())}:${p(t.getUTCSeconds())}`];
}

// u = parsed "<uf>-c0001-e<eleicao>-u.json". Candidate photo: <ciclo>/<eleicao>/fotos/<uf|br>/<sq>.jpeg
export function normalizeArea(uf, u) {
  const cargo = u.carg?.[0] ?? { agr: [] };
  const candidates = [];
  for (const agr of cargo.agr ?? [])
    for (const par of agr.par ?? [])
      for (const c of par.cand ?? [])
        candidates.push({ number: c.n, sq: c.sqcand, name: c.nmu || c.nm, party: par.sg, votes: num(c.vap), pct: num(c.pvapn ?? c.pvap) });
  // Stable order: votes desc, then ballot number, so equal votes never shuffle between polls.
  candidates.sort((a, b) => b.votes - a.votes || Number(a.number) - Number(b.number));

  const s = u.s ?? {}, v = u.v ?? {};
  const counted = num(s.st);
  const top = candidates[0]?.votes ?? 0, second = candidates[1]?.votes ?? 0;
  const [dt, ht] = toBrasilia(uf, u.dt, u.ht);
  // No totalized section or no votes yet: nobody leads (never attribute a waiting UF to a party).
  const status = counted === 0 || top === 0 ? 'waiting' : top === second ? 'tie' : 'leading';

  return {
    ...emptyArea(uf),
    status,
    leader: status === 'leading' ? leaderGroup(candidates[0].party) : null,
    final: u.tf === 's',
    dt, ht,
    sections: { total: num(s.ts), counted, pct: num(s.pstn ?? s.pst) },
    votes: { valid: num(v.vv), blank: num(v.vb), null: num(v.tvn), total: num(v.tv) },
    candidates,
    margin: status === 'waiting' ? null : top - second,
  };
}

// State-level races (eleição estadual, e.g. 6259): <uf>-<cargo>-e<eleicao>-u.json, same layout as Presidente.
export const RACES = {
  governador: { cargo: 'c0003', name: 'Governador', seats: 1, proportional: false },
  senado: { cargo: 'c0005', name: 'Senador', seats: 2, proportional: false },
  federal: { cargo: 'c0006', name: 'Deputado Federal', seats: 16, proportional: true },
  estadual: { cargo: 'c0007', name: 'Deputado Estadual', seats: 40, proportional: true },
};

export function normalizeRace(key, uf, u) {
  const meta = RACES[key];
  const cargo = u.carg?.[0] ?? { agr: [] };
  const seats = num(cargo.nv) || meta.seats;
  const candidates = [], parties = [];
  for (const agr of cargo.agr ?? []) {
    const list = [];
    for (const par of agr.par ?? [])
      for (const c of par.cand ?? []) {
        const official = String(c.st || '').trim();
        list.push({
          rank: num(c.seq), number: c.n, sq: c.sqcand, name: c.nmu || c.nm, party: par.sg, coalition: agr.com || par.sg,
          votes: num(c.vap), pct: num(c.pvapn ?? c.pvap), valid: !c.dvt || c.dvt === 'Válido',
          official, elected: c.e === 's' || /^eleit[oa]/i.test(official), entering: false, inSeats: false,
        });
      }
    if (meta.proportional) {
      // agr.vag = seats the TSE currently assigns to this agremiação (quociente partidário + médias, partial count).
      // Open list: those seats go to the list's most voted candidates. The 10%/20% QE individual thresholds are
      // already reflected in the TSE's vag (it never gives a list a seat it cannot fill).
      const vag = num(agr.vag);
      if (vag) parties.push({ name: agr.com || agr.nm, type: agr.tp, seats: vag });
      list.filter(c => c.valid && c.votes > 0).sort((a, b) => b.votes - a.votes || a.rank - b.rank).slice(0, vag).forEach(c => (c.entering = true));
    }
    candidates.push(...list);
  }
  candidates.sort((a, b) => b.votes - a.votes || a.rank - b.rank);
  candidates.forEach((c, i) => (c.rank = i + 1)); // TSE seq is exactly this order (votes desc); keep it contiguous

  const officialAvailable = candidates.some(c => c.official || c.elected);
  if (officialAvailable) candidates.forEach(c => (c.entering = false)); // official situação replaces the projection
  if (!meta.proportional) candidates.filter(c => c.valid && c.votes > 0).slice(0, seats).forEach(c => (c.inSeats = true));
  parties.sort((a, b) => b.seats - a.seats || a.name.localeCompare(b.name));

  const s = u.s ?? {}, v = u.v ?? {};
  const counted = num(s.st);
  const [dt, ht] = toBrasilia(uf, u.dt, u.ht);
  const valid = candidates.filter(c => c.valid);
  return {
    key, cargo: meta.name, election: u.ele || '', uf, ufName: UFS[uf], seats, proportional: meta.proportional, final: u.tf === 's',
    status: counted === 0 ? 'waiting' : u.tf === 's' ? 'final' : 'counting',
    dt, ht,
    sections: { total: num(s.ts), counted, pct: num(s.pstn ?? s.pst) },
    votes: { valid: num(v.vv), blank: num(v.vb), null: num(v.tvn), total: num(v.tv) },
    qe: meta.proportional ? num(cargo.qe) || null : null,
    officialAvailable,
    margin: !meta.proportional && counted > 0 && valid.length > 1 ? valid[0].votes - valid[1].votes : null,
    parties,
    candidates,
  };
}

// ab = parsed "br-e<eleicao>-ab.json"; returns { BR: 'dt ht st', SC: ..., ... } (exterior "zz" ignored)
export function abKeys(ab) {
  const keys = {};
  for (const a of ab.abr ?? []) {
    const uf = a.cdabr.toUpperCase();
    if (uf === 'BR' || UFS[uf]) keys[uf] = `${toBrasilia(uf, a.dt, a.ht).join(' ')} ${a.s?.st}`;
  }
  return keys;
}
