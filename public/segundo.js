// "2º turno" tab: official 1st-round numbers + a purely mathematical scenario simulator. Never a forecast.
import { baseFromArea, finalists, groupsFrom, needShare, preset, simulate } from './sim.js?v=__V__';

const NS = 'http://www.w3.org/2000/svg';
const RUNOFF_DATE = '25 de outubro'; // último domingo de outubro (Constituição, art. 77)
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const SMALL = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);
const nice = s => String(s || '').toLowerCase().replace(/\S+/g, (w, i) => (i && SMALL.has(w) ? w : w[0].toUpperCase() + w.slice(1)));
const int = n => Math.round(n || 0).toLocaleString('pt-BR');
const pct = (n, d = 2) => (Number.isFinite(n) ? n : 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) + '%';
const approx = n => (n >= 1e6 ? `~${(n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: n < 1e7 ? 2 : 1 })} milhões` : `~${int(n)}`);
const PRESETS = {
  neutra: ['Transferência neutra', 'Votos dos candidatos eliminados divididos igualmente entre os dois finalistas. Nenhuma outra mudança.'],
  repetir: ['Repetir 1º turno', 'Só os votos atuais dos dois finalistas, normalizados para 100% dos votos válidos.'],
  personalizado: ['Personalizado', 'Você define cada premissa nos controles abaixo.'],
};

const st = { host: null, ctx: null, snap: null, visible: false, sig: '', fin: null, groups: [], base: null, premises: null, mode: 'repetir', touched: false, map: 'real', sel: '', polls: null, pollsAsked: false, raf: 0, els: {} };
const q = sel => st.host.querySelector(sel);

export function mountRunoff(host, ctx) {
  st.host = host;
  st.ctx = ctx;
}

export function updateRunoff(snap, visible) {
  if (snap) st.snap = snap;
  st.visible = !!visible;
  if (!st.visible || !st.host || !st.snap) return;
  if (!st.pollsAsked) {
    st.pollsAsked = true;
    fetch('/api/polls', { cache: 'no-store' }).then(r => r.json())
      .catch(() => ({ enabled: false, note: 'Não foi possível carregar as pesquisas agora.', runoff: [], firstRound: [] }))
      .then(p => { st.polls = p; renderPolls(); });
  }
  render();
}

function render() {
  const n = st.snap.national;
  const fin = finalists(n);
  if (!fin) {
    st.sig = '';
    st.host.innerHTML = `<section class="card rt-empty"><span class="rt-badge">2º TURNO</span><h2>2º turno ainda não definido pelo TSE</h2><p>Esta área usa apenas a definição oficial do TSE (situação "2º turno" ou resultado matematicamente definido). Assim que ela existir, os finalistas e o simulador aparecem aqui.</p></section>`;
    return;
  }
  const groups = groupsFrom(n, fin);
  const sig = `${fin.map(c => c.number).join('x')}|${groups.map(g => g.key).join(',')}`;
  st.fin = fin;
  st.groups = groups;
  st.base = baseFromArea(n, fin.map(c => c.number), groups);
  if (sig !== st.sig) {
    st.sig = sig;
    const keys = groups.map(g => g.key);
    if (!st.premises) st.premises = preset(st.mode, keys);
    for (const k of keys) st.premises.groups[k] ??= { valid: 0, splitA: 0.5 };
    build();
  }
  renderDuel();
  renderAvail();
  renderGroups();
  renderResult();
  renderMap();
  renderDetail();
  renderPolls();
}

// ---------- Skeleton (built once per finalist pair; data updates never touch the inputs) ----------
function slider(id, label, attrs, max = 100, step = 1) {
  return `<label class="rt-sl" for="${id}"><span class="lb">${label}</span><output id="${id}-o"></output><input id="${id}" type="range" min="0" max="${max}" step="${step}" ${attrs}></label>`;
}
function build() {
  const [A, B] = st.fin, a = nice(A.name), b = nice(B.name);
  st.host.innerHTML = `
<section class="card rt-duel" aria-labelledby="rt-title">
  <div class="rt-kick"><span class="rt-badge">2º TURNO</span><span>Votação em ${RUNOFF_DATE}</span></div>
  <h2 id="rt-title">${esc(a.toUpperCase())} × ${esc(b.toUpperCase())}</h2>
  <div class="rt-vs">${[A, B].map((c, i) => `<div class="rt-fin" data-i="${i}">${img(st.ctx.photo(c))}<b class="nm">${esc(nice(c.name))}</b>${chip(c.party)}<strong class="pc"></strong><span class="vt"></span></div>`).join('')}</div>
  <div class="rt-gap"><b id="rt-gap"></b><span>de diferença no 1º turno</span></div>
  <dl class="rt-facts">
    <div><dt>Diferença ${esc(a)} → ${esc(b)}</dt><dd id="rt-diff"></dd></div>
    <div><dt>Outros candidatos</dt><dd id="rt-oth"></dd></div>
  </dl>
  <p class="rt-src" id="rt-src"></p>
</section>

<section class="card rt-avail" aria-labelledby="rt-av-t">
  <h3 id="rt-av-t">Votos disponíveis</h3>
  <div class="rt-big"><span>Votos dos outros candidatos</span><b id="rt-o-pct"></b><small id="rt-o-n"></small></div>
  <p class="rt-lead">Dos votos que foram para outros candidatos:</p>
  <div class="rt-need" id="rt-need"></div>
  <p class="rt-assume">para ultrapassar 50% dos votos válidos, mantendo constantes os votos atuais dos dois finalistas e supondo que todos os eleitores dos demais candidatos votem validamente em um dos dois.</p>
  <p class="rt-warn">⚠ Simulação matemática, não previsão eleitoral.</p>
  <button type="button" class="rt-cta" data-go="rt-sim">Simular transferência</button>
</section>

<div class="rt-simwrap">
  <section class="card rt-result" id="rt-result" aria-live="polite" aria-labelledby="rt-res-t"></section>
  <section class="card rt-sim" id="rt-sim" aria-labelledby="rt-sim-t">
    <h3 id="rt-sim-t">Simulador de transferência</h3>
    <div class="rt-seg" role="group" aria-label="Cenários prontos">${Object.entries(PRESETS).map(([k, [t]]) => `<button type="button" data-preset="${k}">${t}</button>`).join('')}</div>
    <p class="rt-pdesc" id="rt-pdesc"></p>
    ${st.groups.map(g => `<fieldset class="rt-g" data-g="${esc(g.key)}">
      <legend><b>Votos de ${esc(nice(g.label))}</b>${g.party ? chip(g.party) : ''}<span class="v" data-gv="${esc(g.key)}"></span></legend>
      ${slider(`rt-v-${g.key}`, 'Votam em um dos finalistas', `data-g="${esc(g.key)}" data-k="valid"`)}
      ${slider(`rt-s-${g.key}`, `Divisão entre os finalistas`, `data-g="${esc(g.key)}" data-k="toB"`)}<div class="rt-ends"><span>← ${esc(a)}</span><span>${esc(b)} →</span></div>
      <div class="rt-dist" data-gd="${esc(g.key)}"></div>
    </fieldset>`).join('')}
    <details class="rt-adv">
      <summary>Premissas avançadas</summary>
      <p class="rt-note">O 2º turno não é só a transferência dos eliminados: eleitores dos finalistas podem mudar de lado ou deixar de votar validamente, e quem não votou validamente no 1º turno pode passar a votar.</p>
      ${slider('rt-p-aToB', `Eleitores de ${esc(a)} que passam a votar em ${esc(b)}`, 'data-p="aToB"', 50, 0.5)}
      ${slider('rt-p-bToA', `Eleitores de ${esc(b)} que passam a votar em ${esc(a)}`, 'data-p="bToA"', 50, 0.5)}
      ${slider('rt-p-aNone', `Eleitores de ${esc(a)} que votam branco/nulo ou se abstêm`, 'data-p="aNone"', 50, 0.5)}
      ${slider('rt-p-bNone', `Eleitores de ${esc(b)} que votam branco/nulo ou se abstêm`, 'data-p="bNone"', 50, 0.5)}
      ${slider('rt-p-newValid', 'Novos votos válidos: eleitores que se abstiveram ou votaram branco/nulo no 1º turno e passam a votar validamente', 'data-p="newValid"', 30, 0.5)}
      ${slider('rt-p-newToB', 'Divisão dos novos votos entre os finalistas', 'data-p="newToB"')}<div class="rt-ends"><span>← ${esc(a)}</span><span>${esc(b)} →</span></div>
    </details>
    <div class="rt-mini" id="rt-mini" aria-hidden="true"></div>
  </section>
</div>

<section class="card rt-mapcard" aria-labelledby="rt-map-t">
  <div class="rt-maphead"><h3 id="rt-map-t">Mapa por estado</h3>
    <div class="rt-seg" role="group" aria-label="Modo do mapa"><button type="button" data-map="real">1º turno</button><button type="button" data-map="sim">Cenário 2º turno</button></div></div>
  <div class="rt-banner" id="rt-banner" hidden><b>MAPA SIMULADO</b> — não é resultado oficial. Aplica as mesmas premissas do simulador em todas as UFs, sobre o resultado real do 1º turno de cada uma.</div>
  <div class="rt-mapgrid">
    <div class="rt-map" id="rt-map"></div>
    <div>
      <p class="rt-legend" id="rt-legend"></p>
      <label class="rt-ufsel">Ver estado: <select id="rt-uf"><option value="">Escolha um estado</option>${Object.entries(st.snap.states).sort((x, y) => x[1].name.localeCompare(y[1].name, 'pt-BR')).map(([uf, s]) => `<option value="${uf}">${esc(s.name)}</option>`).join('')}</select></label>
      <div class="rt-detail" id="rt-detail"></div>
    </div>
  </div>
</section>

<section class="card rt-polls" aria-labelledby="rt-pol-t">
  <h3 id="rt-pol-t">Pesquisas registradas — ${esc(a)} × ${esc(b)}</h3>
  <div id="rt-polls"></div>
</section>
<section class="card rt-polls" aria-labelledby="rt-cmp-t">
  <h3 id="rt-cmp-t">Pesquisas × resultado do 1º turno</h3>
  <div id="rt-cmp"></div>
</section>`;
  buildMap();
  syncInputs();
  if (!st.host.dataset.wired) wire();
}

const img = url => `<img class="ph" ${url ? `src="${url}"` : ''} alt="" loading="lazy" decoding="async" onerror="this.onerror=null;this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E'">`;
function chip(party) {
  const c = st.ctx.partyColor(party);
  return `<span class="party" style="background:${c};color:${c.startsWith('var') ? '#fff' : '#0d1424'}">${esc(party)}</span>`;
}

function wire() {
  st.host.dataset.wired = '1';
  st.host.addEventListener('input', e => {
    const t = e.target;
    if (t.type !== 'range') return;
    const v = +t.value / 100, P = st.premises;
    if (t.dataset.g) {
      const g = P.groups[t.dataset.g];
      if (t.dataset.k === 'valid') g.valid = v; else g.splitA = 1 - v;
    } else if (t.dataset.p === 'newToB') P.newSplitA = 1 - v;
    else P[t.dataset.p] = v;
    st.mode = 'personalizado';
    if (!st.touched) { st.touched = true; st.map = 'sim'; }
    outputs();
    schedule();
  });
  st.host.addEventListener('click', e => {
    const b = e.target.closest('button');
    const uf = e.target.closest('.rt-map [data-uf]');
    if (b?.dataset.preset) {
      if (b.dataset.preset !== 'personalizado') st.premises = preset(b.dataset.preset, st.groups.map(g => g.key));
      st.mode = b.dataset.preset;
      if (!st.touched) { st.touched = true; st.map = 'sim'; }
      syncInputs();
      schedule();
    } else if (b?.dataset.map) {
      st.map = b.dataset.map;
      schedule();
    } else if (b?.dataset.go) {
      q(`#${b.dataset.go}`).scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    } else if (uf) {
      selectUf(uf.dataset.uf);
    }
  });
  st.host.addEventListener('keydown', e => {
    const uf = e.target.closest?.('.rt-map [data-uf]');
    if (uf && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selectUf(uf.dataset.uf); }
  });
  st.host.addEventListener('change', e => { if (e.target.id === 'rt-uf') selectUf(e.target.value); });
}
function schedule() {
  cancelAnimationFrame(st.raf);
  st.raf = requestAnimationFrame(() => { renderResult(); renderMap(); renderDetail(); });
}
function selectUf(uf) {
  st.sel = uf || '';
  q('#rt-uf').value = st.sel;
  renderMap();
  renderDetail();
}

// Inputs <-> premises
function syncInputs() {
  const P = st.premises;
  for (const g of st.groups) {
    const p = P.groups[g.key];
    q(`#rt-v-${CSS.escape(g.key)}`).value = Math.round(p.valid * 100);
    q(`#rt-s-${CSS.escape(g.key)}`).value = Math.round((1 - p.splitA) * 100);
  }
  for (const k of ['aToB', 'bToA', 'aNone', 'bNone', 'newValid']) q(`#rt-p-${k}`).value = +(P[k] * 100).toFixed(1);
  q('#rt-p-newToB').value = Math.round((1 - P.newSplitA) * 100);
  outputs();
}
function outputs() {
  const [A, B] = st.fin, a = nice(A.name), b = nice(B.name), P = st.premises;
  const set = (id, text, vt = text) => { const i = q(`#${id}`); q(`#${id}-o`).textContent = text; i.setAttribute('aria-valuetext', vt); };
  for (const g of st.groups) {
    const p = P.groups[g.key], k = CSS.escape(g.key);
    const pa = p.valid * p.splitA * 100, pb = p.valid * (1 - p.splitA) * 100, pn = 100 - pa - pb;
    set(`rt-v-${k}`, pct(p.valid * 100, 0));
    set(`rt-s-${k}`, `${pct(p.splitA * 100, 0)} · ${pct((1 - p.splitA) * 100, 0)}`, `${a} ${pct(p.splitA * 100, 0)}, ${b} ${pct((1 - p.splitA) * 100, 0)}`);
    q(`[data-gd="${CSS.escape(g.key)}"]`).innerHTML = `<i class="rt-bar"><i style="width:${pa}%;background:${st.ctx.partyColor(A.party)}"></i><i style="width:${pb}%;background:${st.ctx.partyColor(B.party)}"></i></i>
      <span><b>${esc(a)}</b> ${pct(pa, 0)}</span><span><b>${esc(b)}</b> ${pct(pb, 0)}</span><span>Branco/nulo/abstenção ${pct(pn, 0)}</span>`;
  }
  for (const k of ['aToB', 'bToA', 'aNone', 'bNone']) set(`rt-p-${k}`, pct(P[k] * 100, 1));
  set('rt-p-newValid', `${pct(P.newValid * 100, 1)} · ${approx(st.base.nonValid * P.newValid)} votos`);
  set('rt-p-newToB', `${pct(P.newSplitA * 100, 0)} · ${pct((1 - P.newSplitA) * 100, 0)}`, `${a} ${pct(P.newSplitA * 100, 0)}, ${b} ${pct((1 - P.newSplitA) * 100, 0)}`);
  for (const btn of st.host.querySelectorAll('[data-preset]')) btn.setAttribute('aria-pressed', btn.dataset.preset === st.mode);
  q('#rt-pdesc').textContent = PRESETS[st.mode][1];
}

// ---------- Official 1st-round blocks ----------
function renderDuel() {
  const n = st.snap.national, [A, B] = st.fin;
  const others = st.base.groups.reduce((s, g) => s + g.votes, 0);
  for (const [i, c] of [A, B].entries()) {
    const el = q(`.rt-fin[data-i="${i}"]`);
    el.querySelector('.pc').textContent = pct(c.pct);
    el.querySelector('.vt').textContent = `${int(c.votes)} votos`;
  }
  q('#rt-gap').textContent = approx(A.votes - B.votes);
  q('#rt-diff').textContent = `${int(A.votes - B.votes)} votos · ${(A.pct - B.pct).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} p.p.`;
  q('#rt-oth').textContent = `${int(others)} votos · ${pct(n.votes.valid ? (others / n.votes.valid) * 100 : 0)}`;
  const s = n.sections;
  const state = n.final ? 'Totalização final do TSE' : n.defined === 's' ? '2º turno matematicamente definido pelo TSE' : 'Situação oficial do TSE';
  q('#rt-src').textContent = `Resultado do 1º turno (dados oficiais do TSE) · Totalização oficial recebida: ${pct(s.pct)} (${int(s.counted)} de ${int(s.total)} seções) · ${state}${n.ht ? ` · ${n.ht}` : ''}`;
}
function renderAvail() {
  const n = st.snap.national, [A, B] = st.fin;
  const O = st.base.groups.reduce((s, g) => s + g.votes, 0);
  q('#rt-o-pct').textContent = pct(n.votes.valid ? (O / n.votes.valid) * 100 : 0);
  q('#rt-o-n').textContent = `${int(O)} votos válidos`;
  const need = needShare(st.base.A, st.base.B, O);
  const line = (c, x) => {
    const text = x <= 0 ? 'já tem mais de 50% dos válidos' : x > 1 ? 'não alcança 50% só com esses votos' : `precisa de aproximadamente <b>${pct(x * 100, 1)}</b>`;
    const w = Math.max(0, Math.min(1, x)) * 100;
    return `<div class="rt-nrow"><span class="who">${esc(nice(c.name))}</span><span class="txt">${text}</span><i class="rt-bar"><i style="width:${w}%;background:${st.ctx.partyColor(c.party)}"></i></i></div>`;
  };
  q('#rt-need').innerHTML = line(A, need.a) + line(B, need.b);
}
function renderGroups() {
  for (const g of st.base.groups) {
    const el = q(`[data-gv="${CSS.escape(g.key)}"]`);
    if (el) el.textContent = `${int(g.votes)} votos`;
  }
}

// ---------- Scenario ----------
function renderResult() {
  const [A, B] = st.fin, r = simulate(st.base, st.premises);
  const rows = [[A, r.a, r.pctA], [B, r.b, r.pctB]];
  const lead = r.a === r.b ? null : r.a > r.b ? A : B;
  q('#rt-result').innerHTML = `
    <h3 id="rt-res-t">Cenário simulado</h3>
    <p class="rt-preset">Premissas: ${PRESETS[st.mode][0]}</p>
    ${rows.map(([c, v, p]) => `<div class="rt-row"><div class="top"><b>${esc(nice(c.name))}</b>${chip(c.party)}<strong>${pct(p)}</strong></div>
      <i class="rt-bar big"><i style="width:${p}%;background:${st.ctx.partyColor(c.party)}"></i></i><span class="v">${int(v)} votos</span></div>`).join('')}
    <dl class="rt-facts">
      <div><dt>Diferença no cenário</dt><dd>${lead ? `${esc(nice(lead.name))} +${int(Math.abs(r.a - r.b))} votos · ${Math.abs(r.pctA - r.pctB).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} p.p.` : 'Empate'}</dd></div>
      <div><dt>Votos válidos no cenário</dt><dd>${int(r.valid)}</dd></div>
      <div><dt>Votos válidos do 1º turno que não vão para nenhum dos dois</dt><dd>${int(r.toNone)}</dd></div>
    </dl>
    <p class="rt-warn big">⚠ SIMULAÇÃO — NÃO É PREVISÃO</p>`;
  q('#rt-mini').innerHTML = `<span>Cenário simulado</span><b>${esc(nice(A.name))} ${pct(r.pctA)}</b><b>${esc(nice(B.name))} ${pct(r.pctB)}</b>`;
}

// ---------- Map (own copy of the official IBGE mesh; the Presidente map is untouched) ----------
function buildMap() {
  const host = q('#rt-map');
  host.innerHTML = st.ctx.svgText.replace(/ id="uf-[A-Z]{2}"/g, '');
  const svg = host.querySelector('svg');
  svg.setAttribute('role', 'group');
  svg.setAttribute('aria-label', 'Mapa do Brasil por estado');
  svg.insertAdjacentHTML('afterbegin', `<defs>
    <pattern id="rt-pat-wait" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="10" height="10" fill="#1a2335"/><rect width="4" height="10" fill="#33456a"/></pattern>
    <pattern id="rt-pat-tie" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="12" height="12" fill="#5b6478"/><circle cx="6" cy="6" r="2.4" fill="#e2e8f0"/></pattern></defs>`);
  const labels = document.createElementNS(NS, 'g');
  labels.setAttribute('class', 'rt-lbls');
  labels.setAttribute('aria-hidden', 'true');
  st.els = {};
  for (const p of svg.querySelectorAll('path[data-uf]')) {
    p.setAttribute('class', 'rtu');
    p.setAttribute('tabindex', '0');
    p.setAttribute('role', 'button');
    if (+p.dataset.lr >= 26) {
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', p.dataset.lx);
      t.setAttribute('y', p.dataset.ly);
      t.textContent = p.dataset.uf;
      labels.appendChild(t);
    }
    st.els[p.dataset.uf] = p;
  }
  svg.appendChild(labels);
  st.outline = document.createElementNS(NS, 'path');
  st.outline.setAttribute('class', 'rt-outline');
  svg.appendChild(st.outline);
}
function ufSim(uf) {
  return simulate(baseFromArea(st.snap.states[uf], st.fin.map(c => c.number), st.groups), st.premises);
}
function renderMap() {
  const sim = st.map === 'sim', [A, B] = st.fin;
  const count = { A: 0, B: 0, tie: 0, wait: 0, PT: 0, PL: 0, OTHER: 0 };
  for (const [uf, p] of Object.entries(st.els)) {
    const s = st.snap.states[uf];
    let cls = 'rtu', fill = '', label;
    if (!sim) {
      if (!s || s.status === 'waiting') { cls += ' c-wait'; count.wait++; label = 'aguardando dados'; }
      else if (s.status === 'tie') { cls += ' c-tie'; count.tie++; label = 'empate'; }
      else { cls += ` c-${s.leader.toLowerCase()}`; count[s.leader]++; label = `${s.candidates[0].party} mais votado no 1º turno`; }
    } else {
      const r = ufSim(uf);
      if (!r.valid) { cls += ' c-wait'; count.wait++; label = 'sem dados'; }
      else if (Math.abs(r.a - r.b) < 0.5) { cls += ' c-tie'; count.tie++; label = 'empate no cenário'; }
      else { const w = r.a > r.b ? A : B; fill = st.ctx.partyColor(w.party); count[w === A ? 'A' : 'B']++; label = `cenário simulado: ${nice(w.name)} à frente`; }
    }
    if (p.getAttribute('class') !== cls) p.setAttribute('class', cls);
    p.style.fill = fill;
    p.setAttribute('aria-label', `${s?.name || uf}: ${label}`);
  }
  st.outline.setAttribute('d', st.sel ? st.els[st.sel].getAttribute('d') : '');
  for (const btn of st.host.querySelectorAll('[data-map]')) btn.setAttribute('aria-pressed', btn.dataset.map === st.map);
  q('#rt-banner').hidden = !sim;
  q('.rt-mapcard').classList.toggle('sim', sim);
  q('#rt-legend').innerHTML = sim
    ? `<b>Cenário simulado</b> · ${sw(st.ctx.partyColor(A.party))}${esc(nice(A.name))}: ${count.A} UFs · ${sw(st.ctx.partyColor(B.party))}${esc(nice(B.name))}: ${count.B} UFs${count.tie ? ` · Empate: ${count.tie}` : ''}`
    : `<b>1º turno — resultado oficial (TSE)</b>, candidato mais votado em cada UF · ${sw('var(--pt)')}PT: ${count.PT} · ${sw('var(--pl)')}PL: ${count.PL} · ${sw('var(--other)')}Outros: ${count.OTHER}${count.wait ? ` · Aguardando: ${count.wait}` : ''}`;
}
const sw = c => `<i class="rt-sw" style="background:${c}"></i>`;
function renderDetail() {
  const box = q('#rt-detail');
  if (!st.sel) { box.innerHTML = '<p class="rt-muted">Toque em um estado no mapa ou use "Ver estado" para ver o 1º turno real e o cenário daquela UF.</p>'; return; }
  const s = st.snap.states[st.sel], [A, B] = st.fin;
  const by = Object.fromEntries((s.candidates || []).map(c => [c.number, c]));
  const valid = s.votes?.valid || 0;
  const real = [A, B].map(c => by[c.number] || { votes: 0, pct: 0 });
  const oth = valid - real[0].votes - real[1].votes;
  const r = ufSim(st.sel);
  box.innerHTML = `<h4>${esc(s.name)}</h4>
    <p class="rt-k">1º turno — resultado oficial (TSE) · ${pct(s.sections.pct)} apurado</p>
    <ul class="rt-list">${[A, B].map((c, i) => `<li><span>${esc(nice(c.name))}</span><b>${pct(real[i].pct)}</b><small>${int(real[i].votes)} votos</small></li>`).join('')}
      <li><span>Outros candidatos</span><b>${pct(valid ? (oth / valid) * 100 : 0)}</b><small>${int(oth)} votos</small></li></ul>
    <p class="rt-k sim">Cenário simulado nesta UF (mesmas premissas)</p>
    <ul class="rt-list">${[[A, r.a, r.pctA], [B, r.b, r.pctB]].map(([c, v, p]) => `<li><span>${esc(nice(c.name))}</span><b>${pct(p)}</b><small>${int(v)} votos</small></li>`).join('')}</ul>
    <p class="rt-warn">⚠ Simulação — não é resultado oficial nem previsão.</p>`;
}

// ---------- Polls (registered surveys only; integration disabled until a reliable source exists) ----------
const FIELDS = 'instituto, data de campo, data de divulgação, percentuais de cada candidato, branco/nulo, indecisos, margem de erro e número de registro no TSE';
function renderPolls() {
  if (!st.sig || !q('#rt-polls')) return;
  const p = st.polls;
  if (!p) { q('#rt-polls').innerHTML = q('#rt-cmp').innerHTML = '<p class="rt-muted">Carregando…</p>'; return; }
  const [A, B] = st.fin;
  const runoff = p.enabled ? p.runoff || [] : [];
  const first = p.enabled ? p.firstRound || [] : [];
  const empty = extra => `<div class="rt-emptybox"><p><b>Nenhuma pesquisa exibida.</b> ${esc(p.note || '')}</p><p class="rt-muted">${extra} Campos exigidos: ${FIELDS}.</p></div>`;
  q('#rt-polls').innerHTML = runoff.length
    ? `<p class="rt-muted">Cada cartão é uma pesquisa individual registrada. Pesquisa não é previsão; nenhuma média é calculada.</p><div class="rt-pgrid">${runoff.map(x => pollCard(x, [A, B])).join('')}</div>`
    : empty('Pesquisas do 2º turno aparecem aqui individualmente, nunca como média.');
  const nat = Object.fromEntries(st.snap.national.candidates.map(c => [c.number, c]));
  q('#rt-cmp').innerHTML = first.length
    ? `<p class="rt-muted">Diferença absoluta, em pontos percentuais, entre cada pesquisa (convertida para votos válidos quando publicada sobre votos totais) e o resultado oficial do TSE. Sem ranking.</p><div class="rt-pgrid">${first.map(x => cmpCard(x, nat)).join('')}</div>`
    : empty('As últimas pesquisas antes do 1º turno serão comparadas aqui com o resultado oficial, de forma neutra.');
}
function pollHead(x) {
  return `<div class="hd"><b>${x.source ? `<a href="${esc(x.source)}" target="_blank" rel="noopener">${esc(x.institute)}</a>` : esc(x.institute)}</b><span>Registro ${esc(x.registration)}</span></div>
    <p class="rt-muted">Campo: ${esc(x.fieldStart)}${x.fieldEnd ? ` a ${esc(x.fieldEnd)}` : ''} · Divulgação: ${esc(x.published)} · ${int(x.sampleSize)} entrevistas · Margem ±${esc(x.marginOfError)} p.p.${x.confidence ? ` (${esc(x.confidence)}%)` : ''} · ${x.scope === 'validos' ? 'votos válidos' : 'votos totais'}</p>`;
}
function pollCard(x, fin) {
  const rows = [...fin.map(c => [nice(c.name), x.results?.[c.number]]), ['Branco/nulo', x.blankNull], ['Indecisos', x.undecided]];
  return `<article class="rt-poll">${pollHead(x)}<ul class="rt-list">${rows.map(([k, v]) => `<li><span>${esc(k)}</span><b>${v == null ? '—' : pct(+v, 1)}</b></li>`).join('')}</ul></article>`;
}
function cmpCard(x, nat) {
  const entries = Object.entries(x.results || {});
  const total = entries.reduce((s, [, v]) => s + +v, 0);
  return `<article class="rt-poll">${pollHead(x)}<table class="rt-tbl"><thead><tr><th>Candidato</th><th>Pesquisa (válidos)</th><th>Oficial TSE</th><th>Diferença</th></tr></thead><tbody>${entries.map(([n, v]) => {
    const poll = x.scope === 'validos' ? +v : total ? (+v / total) * 100 : 0;
    const off = nat[n]?.pct ?? 0;
    return `<tr><td>${esc(nice(nat[n]?.name || n))}</td><td>${pct(poll, 1)}</td><td>${pct(off, 2)}</td><td>${Math.abs(poll - off).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} p.p.</td></tr>`;
  }).join('')}</tbody></table></article>`;
}
