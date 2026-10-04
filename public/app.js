// Election dashboard: Presidente (national result + live map of who leads in each UF) and the
// Santa Catarina races (Governador, Senado, Deputados Federais/Estaduais).
// Data comes only from our backend (/api/president snapshot + /api/stream SSE updates).

const UFS = [
  ['AC', 'Acre'], ['AL', 'Alagoas'], ['AP', 'Amapá'], ['AM', 'Amazonas'], ['BA', 'Bahia'], ['CE', 'Ceará'],
  ['DF', 'Distrito Federal'], ['ES', 'Espírito Santo'], ['GO', 'Goiás'], ['MA', 'Maranhão'], ['MT', 'Mato Grosso'],
  ['MS', 'Mato Grosso do Sul'], ['MG', 'Minas Gerais'], ['PA', 'Pará'], ['PB', 'Paraíba'], ['PR', 'Paraná'],
  ['PE', 'Pernambuco'], ['PI', 'Piauí'], ['RJ', 'Rio de Janeiro'], ['RN', 'Rio Grande do Norte'],
  ['RS', 'Rio Grande do Sul'], ['RO', 'Rondônia'], ['RR', 'Roraima'], ['SC', 'Santa Catarina'], ['SP', 'São Paulo'],
  ['SE', 'Sergipe'], ['TO', 'Tocantins'],
];
const NAME = Object.fromEntries(UFS);

// Small states get a tappable chip in the Atlantic, linked by a leader line: [anchorX, anchorY, chipY].
const CHIP_X = 990;
const CALLOUTS = { RN: [935, 285, 262], PB: [940, 316, 318], PE: [930, 345, 374], AL: [920, 380, 430], SE: [897, 400, 486], ES: [830, 618, 600], RJ: [792, 700, 690] };
const DF_LABEL = [676, 512];

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const int = n => (n || 0).toLocaleString('pt-BR');
const pct = n => (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
const ufs = n => `${n} ${n === 1 ? 'UF' : 'UFs'}`;
const SMALL = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);
const nice = s => String(s || '').toLowerCase().replace(/\S+/g, (w, i) => (i && SMALL.has(w) ? w : w[0].toUpperCase() + w.slice(1)));
const partyCls = p => (p === 'PT' ? 'pt' : p === 'PL' ? 'pl' : 'other');
const areaCls = a => (!a || a.status === 'waiting' ? 'waiting' : a.status === 'tie' ? 'tie' : partyCls(a.leader));
const CLS_TEXT = { pt: 'PT lidera', pl: 'PL lidera', other: 'Outro partido lidera', tie: 'Empate momentâneo', waiting: 'Aguardando primeira totalização' };
const clock = iso => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '');
const coarse = matchMedia('(pointer: coarse)');
// Per-state % apurado inside the map only where there is room (desktop with a mouse); elsewhere only for the selected state.
const wide = matchMedia('(min-width: 980px)');
const roomy = () => wide.matches && !coarse.matches;
const pct1 = n => (n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
const fold = s => String(s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
// Party colours for badges and seat bars (approximate traditional colours). PT/PL keep the dashboard red/green,
// and any list that includes them takes that colour. The map itself stays PT/PL/Outros by design.
const PARTY_COLORS = {
  MDB: '#facc15', NOVO: '#fb923c', PSD: '#818cf8', PP: '#38bdf8', 'UNIÃO': '#38bdf8', REPUBLICANOS: '#2dd4bf',
  PODE: '#f472b6', PSOL: '#c084fc', REDE: '#c084fc', PSDB: '#3b82f6', CIDADANIA: '#3b82f6', PSB: '#fbbf24',
  PDT: '#fda4af', AVANTE: '#67e8f9', SOLIDARIEDADE: '#fdba74', PRD: '#a8a29e', 'MISSÃO': '#e879f9', DC: '#d6d3d1',
  PCDOB: '#fca5a5', PV: '#86efac', AGIR: '#fcd34d', MOBILIZA: '#a5b4fc', PMB: '#f9a8d4', UP: '#fda4af', PCB: '#fca5a5',
  PSTU: '#fca5a5', PCO: '#fca5a5', DEMOCRATA: '#93c5fd', PRTB: '#bef264',
};
const FALLBACK_HUES = [30, 45, 190, 210, 230, 260, 280, 300, 320]; // stable hue for unknown parties, never PT red / PL green
function partyColor(name) {
  const t = String(name || '').toUpperCase().split('/').map(x => x.trim());
  if (t.includes('PT')) return 'var(--pt)';
  if (t.includes('PL')) return 'var(--pl)';
  const known = t.map(x => PARTY_COLORS[x]).find(Boolean);
  if (known) return known;
  let h = 0;
  for (const ch of t.join('')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${FALLBACK_HUES[h % FALLBACK_HUES.length]} 75% 70%)`;
}
const pstyle = name => { const c = partyColor(name); return `style="background:${c};color:${c.startsWith('var') ? '#fff' : '#0d1424'}"`; };
const partyBadge = (label, colourBy = label) => `<span class="party" ${pstyle(colourBy)}>${esc(label)}</span>`;

const RACES = {
  governador: { title: 'GOVERNADOR — SANTA CATARINA', lead: 'Liderando', note: 'O destaque indica apenas quem lidera neste momento. A situação oficial (eleito ou 2º turno) só aparece quando definida pelo TSE.' },
  senado: { title: 'SENADO — SANTA CATARINA', lead: 'Nas 2 vagas (parcial)', note: 'Duas vagas em disputa. Destaque não significa eleição — situação oficial só após definição do TSE.' },
  federal: { title: 'DEPUTADOS FEDERAIS — SANTA CATARINA' },
  estadual: { title: 'DEPUTADOS ESTADUAIS — SANTA CATARINA' },
};
const TABS = ['presidente', ...Object.keys(RACES)];

const S = { snap: null, sel: null, keys: {}, natKey: '', selKey: '', els: {}, tab: 'presidente', raceKey: '', listKey: '', filter: {}, query: '' };

// ---------- Map ----------
async function loadMap() {
  const host = $('map');
  host.innerHTML = await (await fetch('brasil.svg')).text();
  const svg = host.querySelector('svg');
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return parent ? parent.appendChild(e) : e;
  };
  svg.setAttribute('role', 'group');
  svg.setAttribute('aria-label', 'Mapa do Brasil: candidato mais votado em cada estado');
  svg.insertAdjacentHTML('afterbegin', `<defs>
    <pattern id="pat-waiting" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="10" height="10" fill="#1a2335"/><rect width="4" height="10" fill="#33456a"/></pattern>
    <pattern id="pat-tie" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="12" height="12" fill="#5b6478"/><circle cx="6" cy="6" r="2.4" fill="#e2e8f0"/></pattern>
  </defs>`);

  const labels = el('g', { class: 'labels', 'aria-hidden': 'true' }, svg);
  const chips = el('g', { class: 'chips', 'aria-hidden': 'true' }, svg);
  const outlines = el('g', {}, svg);
  S.els.hov = el('path', { class: 'outline hov', d: '' }, outlines);
  S.els.sel = el('path', { class: 'outline sel', d: '' }, outlines);

  for (const path of svg.querySelectorAll('path[data-uf]')) {
    const uf = path.dataset.uf;
    const x = +path.dataset.lx, y = +path.dataset.ly;
    path.setAttribute('class', 'uf waiting');
    path.setAttribute('tabindex', '0');
    path.setAttribute('role', 'button');
    path.setAttribute('aria-label', `${NAME[uf]}: aguardando dados`);
    const item = { path, chip: null };
    if (CALLOUTS[uf]) {
      const [ax, ay, cy] = CALLOUTS[uf];
      el('line', { class: 'lead', x1: ax, y1: ay, x2: CHIP_X - 28, y2: cy }, chips);
      el('circle', { class: 'dot', cx: ax, cy: ay, r: 2.6 }, chips);
      const g = el('g', { class: 'chip', 'data-uf': uf }, chips);
      el('rect', { class: 'hit', x: CHIP_X - 34, y: cy - 27, width: 68, height: 54 }, g);
      item.chip = el('rect', { class: 'face waiting', x: CHIP_X - 28, y: cy - 18, width: 56, height: 36, rx: 9 }, g);
      el('text', { class: 'lbl', x: CHIP_X, y: cy + 1 }, g).textContent = uf;
    } else if (uf === 'DF') {
      el('line', { class: 'lead', x1: x, y1: y, x2: DF_LABEL[0] - 12, y2: DF_LABEL[1] + 6 }, labels);
      el('text', { class: 'lbl', x: DF_LABEL[0], y: DF_LABEL[1] }, labels).textContent = uf;
      el('circle', { class: 'hitdf', cx: x, cy: y, r: 30, 'data-uf': uf }, chips);
    } else {
      item.sig = el('text', { class: 'lbl', x, y }, labels);
      item.sig.textContent = uf;
      item.pc = el('text', { class: 'lbl pc', x, y: y + 15, visibility: 'hidden' }, labels);
      item.fits = +path.dataset.lr >= 26;
    }
    S.els[uf] = item;
  }

  svg.addEventListener('click', e => {
    const t = e.target.closest('[data-uf]');
    if (t) select(t.dataset.uf, true);
  });
  svg.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.dataset?.uf) { e.preventDefault(); select(e.target.dataset.uf, true); }
  });
  svg.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    const t = e.target.closest('[data-uf]');
    hover(t ? t.dataset.uf : null, e);
  });
  svg.addEventListener('pointerleave', () => hover(null));
  wide.addEventListener('change', renderPctLabels);
  coarse.addEventListener('change', renderPctLabels);
}

// Two-line label (sigla + % apurado) for states with room on desktop, and always for the selected state.
function renderPctLabels() {
  for (const [uf] of UFS) {
    const it = S.els[uf];
    if (!it?.pc) continue;
    const a = S.snap?.states?.[uf];
    const show = !!a && a.status !== 'waiting' && ((roomy() && it.fits) || uf === S.sel);
    const y = +it.path.dataset.ly;
    it.pc.textContent = show ? pct1(a.sections.pct) : '';
    it.pc.setAttribute('visibility', show ? 'visible' : 'hidden');
    it.sig.setAttribute('y', show ? y - 11 : y);
    it.pc.setAttribute('y', y + 15);
  }
}

function hover(uf, e) {
  const tip = $('tip');
  if (!uf || coarse.matches) { tip.hidden = true; S.els.hov.setAttribute('d', ''); S.hov = null; return; }
  if (S.hov !== uf) { S.hov = uf; S.els.hov.setAttribute('d', S.els[uf].path.getAttribute('d')); tip.innerHTML = tipHtml(uf); }
  tip.hidden = false;
  const box = tip.parentElement.getBoundingClientRect();
  let x = e.clientX - box.left + 14, y = e.clientY - box.top + 14;
  if (x + tip.offsetWidth > box.width) x = e.clientX - box.left - tip.offsetWidth - 14;
  if (y + tip.offsetHeight > box.height) y = e.clientY - box.top - tip.offsetHeight - 14;
  tip.style.transform = `translate(${Math.max(0, x)}px, ${Math.max(0, y)}px)`;
  tip.style.left = tip.style.top = '0';
}

function tipHtml(uf) {
  const a = S.snap?.states?.[uf];
  const head = `<b>${esc(NAME[uf])}</b><div class="mut">${a ? `Apuração: <b>${pct(a.sections.pct)}</b>` : 'sem dados'}</div>`;
  if (!a || a.status === 'waiting') return head + `<div class="r">Aguardando primeira totalização</div>`;
  const rows = a.candidates.slice(0, 2).map((c, i) => `<div class="r"><span>${i + 1}º ${esc(nice(c.name))} <span class="mut">${esc(c.party)}</span></span><b>${pct(c.pct)}</b></div>`).join('');
  return head + (a.status === 'tie' ? '<div class="r"><b>Empate momentâneo</b></div>' : '') + rows;
}

// ---------- Selection ----------
function select(uf, fromMap) {
  S.sel = uf && NAME[uf] ? uf : null;
  $('uf-select').value = S.sel || '';
  $('map').classList.toggle('has-sel', !!S.sel);
  for (const [k, item] of Object.entries(S.els)) {
    if (!item.path) continue;
    item.path.classList.toggle('sel', k === S.sel);
    item.chip?.parentNode.classList.toggle('sel', k === S.sel);
  }
  S.els.sel.setAttribute('d', S.sel ? S.els[S.sel].path.getAttribute('d') : '');
  history.replaceState(null, '', S.sel ? `#${S.sel}` : '#presidente');
  S.selKey = '';
  renderState();
  renderPctLabels();
  if (fromMap && coarse.matches) {
    const card = $('state');
    if (card.getBoundingClientRect().top > innerHeight - 120) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// ---------- Rendering ----------
function candRow(c, i, small) {
  const cls = partyCls(c.party);
  return `<div class="cand${small ? ' sm' : ''}">
    <span class="pos">${i + 1}º</span>
    <span class="nm">${esc(nice(c.name))}${partyBadge(c.party)}</span>
    <span class="pc">${pct(c.pct)}</span>
    <span class="vt"><b>${int(c.votes)}</b> votos</span>
    <span class="meter"><i class="bg-${cls}" style="width:${Math.min(100, c.pct || 0)}%"></i></span>
  </div>`;
}

function renderHeader() {
  const race = S.tab !== 'presidente';
  const n = race ? S.snap.races?.[S.tab] : S.snap.national;
  $('apur-scope').textContent = race ? 'Santa Catarina' : 'Brasil';
  if (!n) { $('nat-pct').textContent = '–'; $('nat-bar').style.width = '0'; $('meta').textContent = 'Aguardando dados deste cargo…'; return; }
  $('nat-pct').textContent = pct(n.sections.pct);
  $('nat-bar').style.width = `${Math.min(100, n.sections.pct || 0)}%`;
  const tse = n.ht ? `Última totalização do TSE: ${esc(n.ht)}${n.dt ? ` (${esc(n.dt)})` : ''}` : 'Aguardando primeira totalização do TSE';
  const check = S.snap.checkedAt ? ` · verificado às ${clock(S.snap.checkedAt)}` : '';
  $('meta').innerHTML = `${n.final ? '<b>Totalização final</b> · ' : ''}${tse}${check}`;
}

function renderNational() {
  const n = S.snap.national;
  const key = JSON.stringify(n);
  if (key === S.natKey) return;
  S.natKey = key;
  const c = n.candidates || [];
  $('nat-top').innerHTML = c.slice(0, 2).map((x, i) => candRow(x, i)).join('');
  $('nat-margin').innerHTML = n.status === 'waiting' ? 'Aguardando primeira totalização'
    : n.status === 'tie' ? '<b>Empate momentâneo</b> entre 1º e 2º'
    : `Diferença entre 1º e 2º: <b>${int(n.margin)}</b> votos`;
  $('nat-rest').innerHTML = c.slice(2).map((x, i) => `<li><span>${i + 3}º ${esc(nice(x.name))}${partyBadge(x.party)}<br><span class="v">${int(x.votes)} votos</span></span><span class="p">${pct(x.pct)}</span></li>`).join('');
  $('nat-rest-wrap').hidden = c.length <= 2;
}

function renderUF(uf, first) {
  const a = S.snap.states[uf];
  const key = JSON.stringify(a);
  if (S.keys[uf] === key) return;
  const prev = S.keys[uf] && areaCls(JSON.parse(S.keys[uf]));
  S.keys[uf] = key;
  const cls = areaCls(a);
  const { path, chip } = S.els[uf];
  for (const node of [path, chip]) {
    if (!node) continue;
    node.classList.remove('pt', 'pl', 'other', 'tie', 'waiting');
    node.classList.add(cls);
  }
  if (!first && prev && prev !== cls) {
    path.classList.remove('flash'); void path.getBBox(); path.classList.add('flash');
    setTimeout(() => path.classList.remove('flash'), 1500);
  }
  const lead = a?.status === 'leading' ? `${a.candidates[0]?.party} lidera com ${pct(a.candidates[0]?.pct)}` : CLS_TEXT[cls];
  path.setAttribute('aria-label', `${NAME[uf]}: ${lead}, ${pct(a?.sections?.pct)} apurado`);
  if (S.hov === uf) $('tip').innerHTML = tipHtml(uf);
}

function renderCounts() {
  const n = { pt: 0, pl: 0, other: 0, tie: 0, waiting: 0 };
  for (const [uf] of UFS) n[areaCls(S.snap.states[uf])]++;
  const total = Object.values(n).reduce((a, b) => a + b, 0);
  const items = [['pt', 'PT liderando'], ['pl', 'PL liderando'], ['other', 'Outros liderando'], ['tie', 'Empate momentâneo'], ['waiting', 'Aguardando dados']];
  $('legend').innerHTML = items.map(([k, t]) => `<li><span class="sw ${k}"></span>${t}<b>${ufs(n[k])}</b></li>`).join('')
    + `<li class="total">Total<b>${ufs(total)}</b></li>`;
  const order = ['pt', 'other', 'tie', 'waiting', 'pl'];
  $('ufbar').innerHTML = order.filter(k => n[k]).map(k => `<i class="sw ${k}" style="flex-grow:${n[k]};border-radius:0;box-shadow:none" title="${ufs(n[k])}"></i>`).join('');
}

function renderState() {
  const card = $('state');
  if (!S.sel) {
    if (S.selKey === 'none') return;
    S.selKey = 'none';
    card.innerHTML = `<h2 id="state-title">📍 Estado selecionado</h2><p class="empty">Toque em um estado no mapa ou use “Ver estado” para ver a apuração detalhada.</p>`;
    return;
  }
  const a = S.snap?.states?.[S.sel];
  const key = S.sel + JSON.stringify(a);
  if (key === S.selKey) return;
  S.selKey = key;
  const cls = areaCls(a);
  const sec = a?.sections || { pct: 0, counted: 0, total: 0 };
  const head = `<h2 id="state-title">📍 ${esc(NAME[S.sel].toUpperCase())} <span class="badge ${cls}">${CLS_TEXT[cls]}</span></h2>
    <div class="apur">
      <span class="k">Apuração em ${esc(NAME[S.sel])}</span>
      <b>${pct(sec.pct)}</b>
      <div class="bar"><i style="width:${Math.min(100, sec.pct || 0)}%"></i></div>
      <span class="s">${sec.total ? `${int(sec.counted)} / ${int(sec.total)} seções totalizadas` : 'Seções: sem dados'}</span>
    </div>`;
  if (!a || a.status === 'waiting') {
    card.innerHTML = head + `<p class="waitmsg">Aguardando primeira totalização</p>` + facts(a);
    return;
  }
  const c = a.candidates || [];
  card.innerHTML = head
    + `<div class="list">${c.slice(0, 3).map((x, i) => candRow(x, i, true)).join('')}</div>`
    + (c.length > 3 ? `<details class="others"><summary>Todos os candidatos (${c.length})</summary><ol class="rest">${c.slice(3).map((x, i) => `<li><span>${i + 4}º ${esc(nice(x.name))}${partyBadge(x.party)}<br><span class="v">${int(x.votes)} votos</span></span><span class="p">${pct(x.pct)}</span></li>`).join('')}</ol></details>` : '')
    + facts(a);
}

function facts(a) {
  if (!a) return '';
  const diff = a.status === 'tie' ? 'Empate momentâneo' : a.margin == null ? '—' : `${int(a.margin)} votos`;
  return `<dl class="facts">
    <dt>Diferença entre 1º e 2º</dt><dd>${diff}</dd>
    <dt>Última atualização</dt><dd>${a.ht ? esc(a.ht) : '—'}</dd>
  </dl>`;
}

function render(first) {
  if (!S.snap || !S.els.AC) return;
  renderHeader();
  renderNational();
  for (const [uf] of UFS) renderUF(uf, first);
  renderCounts();
  renderState();
  renderPctLabels();
  if (S.tab !== 'presidente') renderRace();
}

// ---------- Santa Catarina races ----------
function badges(c, r, view) {
  let b = '';
  if (c.official) b += `<span class="st ${c.elected ? 'st-el' : /suplente/i.test(c.official) ? 'st-sup' : /turno/i.test(c.official) ? 'st-2t' : 'st-out'}">${esc(c.official)}</span>`;
  else if (c.entering) b += '<span class="st st-in">Entrando</span>';
  else if (c.inSeats && c.valid) b += `<span class="st st-lead">${esc(RACES[r.key]?.lead || 'Nas vagas (parcial)')}</span>`;
  else if (view === 'top' && r.proportional && !r.officialAvailable && c.rank <= r.seats && r.status !== 'waiting') b += '<span class="st st-off">Fora das vagas</span>';
  if (!c.valid) b += '<span class="st st-sj">sub judice</span>';
  return b;
}

function renderRace() {
  const r = S.snap?.races?.[S.tab];
  const meta = RACES[S.tab];
  const key = S.tab + JSON.stringify(r);
  if (key !== S.raceKey) {
    S.raceKey = key;
    renderRaceHead(r, meta);
  }
  renderRaceList(r);
}

function renderRaceHead(r, meta) {
  const head = $('race-head');
  $('race-parties').hidden = $('race-filters').hidden = $('race-search').hidden = !r?.proportional;
  if (!r) {
    head.innerHTML = `<h2>${meta.title}</h2><p class="waitmsg">Aguardando dados deste cargo no servidor…</p>`;
    return;
  }
  const c = r.candidates || [];
  const kpi = (v, k) => `<div class="kpi"><b>${v}</b><span>${k}</span></div>`;
  let kpis = kpi(pct(r.sections.pct), 'apurado em SC')
    + kpi(`${int(r.sections.counted)} / ${int(r.sections.total)}`, 'seções totalizadas')
    + kpi(r.seats === 1 ? '1 vaga' : `${r.seats} vagas`, 'em disputa');
  if (r.proportional) kpis += kpi(r.qe ? int(r.qe) : '—', 'quociente eleitoral (parcial)');
  else if (r.status !== 'waiting' && r.margin != null) kpis += kpi(int(r.margin), 'votos entre 1º e 2º');
  if (r.key === 'senado' && r.status !== 'waiting' && c.length > 2) kpis += kpi(int(c[1].votes - c[2].votes), 'votos entre 2º e 3º (linha das 2 vagas)');
  const status = r.final ? '<b>Totalização final</b>' : r.status === 'waiting' ? 'Aguardando primeira totalização' : 'Apuração em andamento';
  head.innerHTML = `<h2>${meta.title}</h2>
    <div class="bar"><i style="width:${Math.min(100, r.sections.pct || 0)}%"></i></div>
    <div class="kpis">${kpis}</div>
    <p class="meta">${status}${r.ht ? ` · última totalização do TSE: ${esc(r.ht)}${r.dt ? ` (${esc(r.dt)})` : ''}` : ''}</p>
    ${r.proportional ? '' : `<p class="note">${meta.note}</p>`}`;
  if (r.proportional) {
    const total = (r.parties || []).reduce((n, p) => n + p.seats, 0);
    $('race-parties').innerHTML = total
      ? `<h3>Vagas por agremiação <span>(distribuição parcial do TSE · ${total}/${r.seats})</span></h3>
         <div class="seatbar">${r.parties.map(p => `<i style="flex-grow:${p.seats};background:${partyColor(p.name)}" title="${esc(p.name)}: ${p.seats}"></i>`).join('')}</div>
         <div class="seats">${r.parties.map(p => `<span class="seat"><i class="sw" style="background:${partyColor(p.name)}"></i>${esc(p.name)}<b>${p.seats}</b></span>`).join('')}</div>`
      : '<h3>Vagas por agremiação</h3><p class="race-note">Nenhuma vaga distribuída ainda.</p>';
    const n = c.filter(x => x.elected || x.entering).length;
    const [fin, ftop, fall] = $('race-filters').querySelectorAll('span');
    fin.textContent = n; ftop.textContent = Math.min(50, c.length); fall.textContent = c.length;
  }
}

function renderRaceList(r) {
  const view = r?.proportional ? (S.filter[S.tab] || 'in') : 'all';
  const key = S.raceKey + view + S.query;
  if (key === S.listKey) return;
  S.listKey = key;
  for (const b of $('race-filters').querySelectorAll('button')) b.setAttribute('aria-pressed', b.dataset.f === view);
  const list = $('race-list'), note = $('race-note');
  if (!r) { list.innerHTML = ''; note.textContent = ''; return; }
  let c = r.candidates || [];
  if (!r.proportional) {
    list.className = 'race-list maj';
    note.textContent = '';
    list.innerHTML = c.map(x => `<li class="cand rc${x.inSeats && x.valid ? ' in' : ''}${x.elected ? ' el' : ''}">
      <span class="pos">${x.rank}º</span>
      <span class="nm">${esc(nice(x.name))}${partyBadge(x.party)}</span>
      <span class="pc">${pct(x.pct)}</span>
      <span class="vt"><b>${int(x.votes)}</b> votos ${badges(x, r)}</span>
      <span class="meter"><i style="width:${Math.min(100, x.pct || 0)}%;background:${partyColor(x.party)}"></i></span>
    </li>`).join('');
    return;
  }
  if (view === 'in') c = c.filter(x => x.elected || x.entering);
  else if (view === 'top') c = c.slice(0, 50);
  const q = fold(S.query.trim());
  if (q) c = c.filter(x => fold(`${x.name} ${x.number} ${x.party} ${x.coalition}`).includes(q));
  note.innerHTML = view === 'in'
    ? (r.officialAvailable ? '<b>Situação oficial do TSE.</b>' : '<b>Entrando pela distribuição parcial de vagas do TSE</b> (quociente partidário e médias) — não é resultado oficial. Muda a cada nova totalização.')
    : view === 'top'
      ? '<b>Mais votados ≠ quem entra.</b> No sistema proporcional as cadeiras vão primeiro para as agremiações (quociente partidário e médias) e depois para os mais votados de cada lista: um candidato muito votado pode ficar de fora e outro com menos votos pode entrar.'
      : `Todos os ${int(r.candidates.length)} candidatos, por ordem de votos.`;
  list.className = 'race-list prop';
  list.innerHTML = c.length ? c.map(x => `<li class="row${x.elected ? ' el' : x.entering ? ' in' : ''}">
      <span class="rk">${x.rank}º</span>
      <span class="who"><b>${esc(nice(x.name))}</b> <span class="num">${esc(x.number)}</span><br>${partyBadge(x.party, x.coalition)}${x.coalition && x.coalition !== x.party ? `<span class="co">${esc(x.coalition)}</span>` : ''}${badges(x, r, view)}</span>
      <span class="nums"><b>${int(x.votes)}</b><span>${pct(x.pct)}</span></span>
    </li>`).join('') : `<li class="none">${q ? 'Nenhum candidato encontrado.' : r.status === 'waiting' ? 'Aguardando primeira totalização.' : 'Nenhuma vaga distribuída ainda.'}</li>`;
}

// ---------- Tabs / routing ----------
function route() {
  const h = decodeURIComponent(location.hash.slice(1));
  const tab = TABS.includes(h.toLowerCase()) ? h.toLowerCase() : 'presidente';
  setTab(tab);
  if (tab === 'presidente' && NAME[h.toUpperCase()]) select(h.toUpperCase());
}
function setTab(tab) {
  const changed = S.tab !== tab;
  S.tab = tab;
  for (const a of $('tabs').querySelectorAll('a')) {
    const on = a.dataset.tab === tab;
    a.setAttribute('aria-selected', on);
    if (on && changed) a.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  $('panel-presidente').hidden = tab !== 'presidente';
  $('panel-race').hidden = tab === 'presidente';
  if (changed) {
    S.raceKey = S.listKey = '';
    $('race-search').value = S.query = '';
    const top = $('tabs').offsetTop;
    if (scrollY > top) scrollTo({ top });
  }
  if (S.snap) { renderHeader(); if (tab !== 'presidente') renderRace(); }
}

// ---------- Data ----------
function applySnapshot(s) {
  const first = !S.snap;
  S.snap = s;
  render(first);
}
function applyUpdate(u) {
  if (!S.snap) return;
  if (u.national) S.snap.national = u.national;
  if (u.states) Object.assign(S.snap.states, u.states);
  if (u.updatedAt) S.snap.updatedAt = u.updatedAt;
  if (u.checkedAt) S.snap.checkedAt = u.checkedAt;
  if (u.races) S.snap.races = { ...S.snap.races, ...u.races };
  render(false);
}
async function fetchSnapshot() {
  try { applySnapshot(await (await fetch('/api/president', { cache: 'no-store' })).json()); } catch {}
}
function setLive(on) {
  const live = $('live');
  live.className = `live ${on ? 'on' : 'off'}`;
  live.textContent = on ? '● AO VIVO' : '● RECONECTANDO…';
}
let es;
function connect() {
  es = new EventSource('/api/stream');
  es.addEventListener('snapshot', e => applySnapshot(JSON.parse(e.data)));
  es.addEventListener('update', e => applyUpdate(JSON.parse(e.data)));
  es.onopen = () => setLive(true);
  es.onerror = () => {
    setLive(false);
    if (es.readyState === EventSource.CLOSED) setTimeout(connect, 5000);
  };
}

// ---------- Boot ----------
$('uf-select').insertAdjacentHTML('beforeend', UFS.map(([uf, nm]) => `<option value="${uf}">${nm}</option>`).join(''));
$('uf-select').addEventListener('change', e => select(e.target.value));
$('race-filters').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b) { S.filter[S.tab] = b.dataset.f; renderRaceList(S.snap?.races?.[S.tab]); }
});
$('race-search').addEventListener('input', e => { S.query = e.target.value; renderRaceList(S.snap?.races?.[S.tab]); });
addEventListener('hashchange', route);
renderState();
await loadMap();
route();
fetchSnapshot().then(route);
connect();
// Safety net if the stream is down (e.g. proxy buffering): poll the cached snapshot.
setInterval(() => { if (es.readyState !== EventSource.OPEN) fetchSnapshot(); }, 30000);
