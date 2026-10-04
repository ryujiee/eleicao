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

// u = parsed "<uf>-c0001-e<eleicao>-u.json"
export function normalizeArea(uf, u) {
  const cargo = u.carg?.[0] ?? { agr: [] };
  const candidates = [];
  for (const agr of cargo.agr ?? [])
    for (const par of agr.par ?? [])
      for (const c of par.cand ?? [])
        candidates.push({ number: c.n, name: c.nmu || c.nm, party: par.sg, votes: num(c.vap), pct: num(c.pvapn ?? c.pvap) });
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

// ab = parsed "br-e<eleicao>-ab.json"; returns { BR: 'dt ht st', SC: ..., ... } (exterior "zz" ignored)
export function abKeys(ab) {
  const keys = {};
  for (const a of ab.abr ?? []) {
    const uf = a.cdabr.toUpperCase();
    if (uf === 'BR' || UFS[uf]) keys[uf] = `${toBrasilia(uf, a.dt, a.ht).join(' ')} ${a.s?.st}`;
  }
  return keys;
}
