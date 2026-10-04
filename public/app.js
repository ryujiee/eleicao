// Presidential dashboard: national result + live map of who leads in each UF.
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

const S = { snap: null, sel: null, keys: {}, natKey: '', selKey: '', els: {} };

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
      el('text', { class: 'lbl', x, y }, labels).textContent = uf;
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
  const head = `<b>${esc(NAME[uf])}</b><div class="mut">${a ? pct(a.sections.pct) + ' apurado' : 'sem dados'}</div>`;
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
  history.replaceState(null, '', S.sel ? `#${S.sel}` : location.pathname + location.search);
  S.selKey = '';
  renderState();
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
    <span class="nm">${esc(nice(c.name))}<span class="party bg-${cls} ${cls}">${esc(c.party)}</span></span>
    <span class="pc">${pct(c.pct)}</span>
    <span class="vt"><b>${int(c.votes)}</b> votos</span>
    <span class="meter"><i class="bg-${cls}" style="width:${Math.min(100, c.pct || 0)}%"></i></span>
  </div>`;
}

function renderHeader() {
  const n = S.snap.national;
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
  $('nat-rest').innerHTML = c.slice(2).map((x, i) => `<li><span>${i + 3}º ${esc(nice(x.name))}<span class="party bg-${partyCls(x.party)} ${partyCls(x.party)}">${esc(x.party)}</span><br><span class="v">${int(x.votes)} votos</span></span><span class="p">${pct(x.pct)}</span></li>`).join('');
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
  const head = `<h2 id="state-title">📍 ${esc(NAME[S.sel].toUpperCase())} <span class="badge ${cls}">${CLS_TEXT[cls]}</span></h2>
    <div class="sub"><b>${pct(a?.sections?.pct)}</b> apurado</div>`;
  if (!a || a.status === 'waiting') {
    card.innerHTML = head + `<p class="waitmsg">Aguardando primeira totalização</p>` + facts(a);
    return;
  }
  const c = a.candidates || [];
  card.innerHTML = head
    + `<div class="list">${c.slice(0, 3).map((x, i) => candRow(x, i, true)).join('')}</div>`
    + (c.length > 3 ? `<details class="others"><summary>Todos os candidatos (${c.length})</summary><ol class="rest">${c.slice(3).map((x, i) => `<li><span>${i + 4}º ${esc(nice(x.name))}<span class="party bg-${partyCls(x.party)} ${partyCls(x.party)}">${esc(x.party)}</span><br><span class="v">${int(x.votes)} votos</span></span><span class="p">${pct(x.pct)}</span></li>`).join('')}</ol></details>` : '')
    + facts(a);
}

function facts(a) {
  if (!a) return '';
  const diff = a.status === 'tie' ? 'Empate momentâneo' : a.margin == null ? '—' : `${int(a.margin)} votos`;
  return `<dl class="facts">
    <dt>Diferença entre 1º e 2º</dt><dd>${diff}</dd>
    <dt>Seções totalizadas</dt><dd>${int(a.sections.counted)} / ${int(a.sections.total)}</dd>
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
renderState();
await loadMap();
const initial = location.hash.slice(1).toUpperCase();
fetchSnapshot().then(() => NAME[initial] && select(initial));
connect();
// Safety net if the stream is down (e.g. proxy buffering): poll the cached snapshot.
setInterval(() => { if (es.readyState !== EventSource.OPEN) fetchSnapshot(); }, 30000);
