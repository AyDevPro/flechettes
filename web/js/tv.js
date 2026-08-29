/*
 * Tableau d'affichage TV : lisible à plusieurs mètres, mis à jour en direct.
 *
 * Les animations reprennent la maquette « Animations Score TV » :
 *   01 impact fléchette (anneau + points retirés qui s'envolent)
 *   02 volée validée (balayage doré sur le panneau)
 *   03 TON 80 / gros score (annonce plein écran + rayons)
 *   04 Bust (voile rouge + secousse)
 *   05 checkout (annonce verte, rayons, ligne du joueur illuminée)
 *   06 changement de tour (classement qui se réordonne)
 */

import { $, RULE_LABELS, connect, el, loadQr } from './common.js';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

let view = null;
let lastEventId = 0;

/** Mémoire du dernier rendu : sert à n'animer que ce qui vient de changer. */
const previous = { playerId: null, score: null, darts: 0, turnNo: null, historyTurn: null };
let previousRank = new Map();
/** Lignes de la colonne des joueurs, réutilisées pour que le classement glisse. */
const rows = new Map();

$('#url').textContent = location.host;
loadQr($('#qr'), `${location.origin}/`);

connect({
  role: 'tv',
  onState: render,
  onOpen: () => document.querySelector('.offline')?.remove(),
  onClose: showOffline,
});

addEventListener('resize', () => { if (view) layoutRoster(); });

function showOffline() {
  if (document.querySelector('.offline')) return;
  document.body.append(el('div', 'offline', 'Connexion au serveur perdue — reconnexion…'));
}

// ── Rendu ──────────────────────────────────────────────────────────────────

function render(next) {
  const first = !view;
  view = next;
  $('#main').classList.toggle('idle', !view);

  if (!view) return renderIdle();

  $('#title').textContent = `Partie en ${view.startScore}`;
  $('#rules').replaceChildren(
    el('span', 'tag', RULE_LABELS.in[view.inRule]),
    el('span', 'tag', RULE_LABELS.out[view.outRule]),
    el('span', 'tag', `Conseils ${RULE_LABELS.level[view.level]}`),
  );

  if (view.status === 'finished') renderFinal();
  else renderStage(first);

  renderRoster(first);
  renderFoot(!first && view.history[0] && view.history[0].turnNo !== previous.historyTurn);
  renderStatus();

  const events = view.events ?? [];
  if (first) lastEventId = events.at(-1)?.id ?? 0;
  else playEvents(events);

  // 02 · Une volée vient d'être validée : balayage sur le panneau.
  const last = view.history[0];
  if (last && last.turnNo !== previous.historyTurn) {
    if (!first && !last.busted) sweep();
    previous.historyTurn = last.turnNo;
  }

  previous.playerId = view.current.playerId;
  previous.score = view.current.score;
  previous.darts = view.turn?.darts.length ?? 0;
  previous.turnNo = view.turnNo;
}

/** Aucune partie en cours : on explique quoi faire. */
function renderIdle() {
  $('#title').textContent = 'Fléchettes';
  $('#rules').replaceChildren();
  const box = el('div', 'final');
  box.append(
    el('h2', '', 'Aucune partie en cours'),
    el('div', 'sub', 'Créez la partie depuis un téléphone — scannez le QR code en haut à droite.'),
  );
  $('#stage').replaceChildren(box);
  $('#roster').replaceChildren();
  $('#foot').replaceChildren();
  $('#status').textContent = '';
  rows.clear();
  previousRank = new Map();
  Object.assign(previous, { playerId: null, score: null, darts: 0, turnNo: null, historyTurn: null });
  lastEventId = 0;
}

function renderStage(first) {
  const stage = $('#stage');
  const rebuilt = !stage.querySelector('#score');
  if (rebuilt) stage.replaceChildren(...stageNodes());

  const current = view.current;
  const thrown = view.turn?.darts ?? [];
  const sameTurn = !rebuilt && !first
    && previous.playerId === current.playerId && previous.turnNo === view.turnNo;

  $('#turnLabel').textContent = view.status === 'paused' ? 'Partie en pause' : 'Au tour de';
  $('#who').textContent = current.name ?? '—';
  $('#sub').textContent = `${current.dartsLeft} fléchette${current.dartsLeft > 1 ? 's' : ''} restante${current.dartsLeft > 1 ? 's' : ''} · tour à ${current.turnTotal}`;

  // Le score défile jusqu'à sa nouvelle valeur — seulement s'il s'agit du même
  // joueur, sinon on décompterait entre deux joueurs sans rapport.
  rollTo($('#score'), sameTurn ? previous.score : null, current.score);

  // 06 · Changement de joueur : la scène se remet en place.
  if (!rebuilt && previous.playerId && previous.playerId !== current.playerId) replay(stage, 'turn-in');

  // 01 · Impact de la fléchette qui vient d'être saisie.
  const fresh = sameTurn && thrown.length > previous.darts ? thrown[thrown.length - 1] : null;
  if (fresh) {
    ring();
    if (fresh.value > 0 && (fresh.kind === 'score' || fresh.kind === 'win')) showDelta(`−${fresh.value}`);
  }

  const darts = $('#darts');
  darts.replaceChildren();
  for (let i = 0; i < 3; i++) {
    const record = thrown[i];
    const chip = el('div', 'd', record ? record.label : '·');
    if (record) chip.classList.add(record.kind === 'bust' ? 'bust' : record.kind === 'no-count' ? 'void' : 'filled');
    if (record && fresh && i === thrown.length - 1 && !reduceMotion) chip.classList.add('enter');
    darts.append(chip);
  }

  const reco = current.recommendation;
  const show = view.status === 'playing' && reco && reco.kind !== 'none';
  $('#reco').hidden = !show;
  if (show) {
    $('#recoCap').textContent = reco.kind === 'entry' ? 'Entrée'
      : reco.kind === 'setup' ? `À viser · ${reco.note ?? ''}`
        : 'Checkout conseillé';
    $('#recoRoute').textContent = reco.text;
  }
}

/** (Re)construit la scène — elle est remplacée par le classement en fin de partie. */
function stageNodes() {
  const mk = (tag, cls, id) => { const n = el(tag, cls); if (id) n.id = id; return n; };
  const scoreRow = mk('div', 'score-row');
  const box = mk('div', 'score-box');
  box.append(mk('div', 'rings', 'rings'), mk('div', 'big', 'score'));
  scoreRow.append(box, mk('div', 'delta-slot', 'deltaSlot'));
  const reco = mk('div', 'tv-reco', 'reco');
  reco.append(mk('div', 'cap', 'recoCap'), mk('div', 'route', 'recoRoute'));
  return [
    mk('div', 'turn-label', 'turnLabel'),
    mk('div', 'who', 'who'),
    scoreRow,
    mk('div', 'sub', 'sub'),
    mk('div', 'tv-darts', 'darts'),
    reco,
  ];
}

function renderFinal() {
  const box = el('div', 'final');
  box.append(el('h2', '', 'Classement final'));
  const list = el('ol');
  [...view.players].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)).forEach((player, i) => {
    const li = el('li');
    li.style.animationDelay = `${i * 90}ms`;
    li.append(el('span', 'm', player.rank ? `${player.rank}.` : '—'), document.createTextNode(player.name));
    if (player.stats.checkout) li.append(el('span', 'm', ` (checkout ${player.stats.checkout})`));
    list.append(li);
  });
  box.append(list);
  $('#stage').replaceChildren(box);
}

// ── Classement (colonne de droite) ─────────────────────────────────────────

/** Ordre d'affichage : terminés d'abord, puis le plus proche de zéro. */
function ranked() {
  return [...view.players].sort((a, b) => {
    const bucket = (p) => (p.removed ? 2 : p.finished ? 0 : 1);
    if (bucket(a) !== bucket(b)) return bucket(a) - bucket(b);
    if (a.finished && b.finished) return (a.rank ?? 99) - (b.rank ?? 99);
    if (a.score !== b.score) return a.score - b.score;
    return view.order.indexOf(a.id) - view.order.indexOf(b.id);
  });
}

function renderRoster(first) {
  const roster = $('#roster');
  const order = ranked();
  const seen = new Set();

  order.forEach((player, rank) => {
    seen.add(player.id);
    let row = rows.get(player.id);
    if (!row) {
      row = el('div', 'pl');
      row.append(el('div', 'pos'), el('div', 'block'), el('div', 'val'));
      row.querySelector('.block').append(el('div', 'name'), el('div', 'co'));
      rows.set(player.id, row);
      roster.append(row);
    }

    row.classList.toggle('active', player.id === view.currentPlayerId && view.status !== 'finished');
    row.classList.toggle('done', player.finished);
    row.classList.toggle('out', player.removed);
    row.style.setProperty('--rank', rank);

    row.querySelector('.pos').textContent = player.rank ? `${player.rank}${player.rank === 1 ? 're' : 'e'}` : '·';
    row.querySelector('.name').textContent = player.name;
    const hint = view.hints?.[player.id];
    row.querySelector('.co').textContent = player.finished ? ''
      : hint || (player.entered ? '' : 'doit entrer par un double');

    const value = row.querySelector('.val');
    const label = player.finished ? 'Terminé' : String(player.score);
    if (value.textContent !== label) {
      value.textContent = label;
      if (!first) replay(value, 'pop');
    }

    // 06 · La ligne qui change de place s'illumine.
    if (!first && previousRank.has(player.id) && previousRank.get(player.id) !== rank) replay(row, 'glow');
  });

  for (const [id, row] of rows) {
    if (seen.has(id)) continue;
    row.remove();
    rows.delete(id);
  }

  previousRank = new Map(order.map((p, rank) => [p.id, rank]));
  layoutRoster();
}

/** Répartit les lignes dans la hauteur disponible (elles sont positionnées). */
function layoutRoster() {
  const roster = $('#roster');
  const count = rows.size;
  if (!count) return;
  const height = roster.clientHeight || 420;
  const gap = Math.round(Math.min(14, Math.max(6, height * 0.02)));
  const rowHeight = Math.max(34, Math.min(110, (height - gap * (count - 1)) / count));
  const total = rowHeight * count + gap * (count - 1);
  roster.style.setProperty('--pl-h', `${rowHeight}px`);
  roster.style.setProperty('--pl-gap', `${gap}px`);
  roster.style.setProperty('--pl-top', `${Math.max(0, (height - total) / 2)}px`);
}

function renderStatus() {
  const player = view.players.find((p) => p.id === view.current.playerId);
  const stats = player?.stats;
  const average = stats && stats.darts > 0 ? ((stats.points / stats.darts) * 3).toFixed(1) : null;
  $('#status').textContent = view.status === 'finished'
    ? `${view.players.length} joueurs · ${view.turnNo} tours`
    : `Tour ${view.turnNo}${average ? ` · moyenne ${average}` : ''}`;
}

function renderFoot(fresh) {
  const foot = $('#foot');
  foot.replaceChildren();
  view.history.slice(0, 4).forEach((turn, index) => {
    const item = el('div', 'h');
    if (fresh && index === 0) item.classList.add('in');
    if (turn.busted) item.classList.add('bust');
    if (turn.finished) item.classList.add('win');
    item.append(el('b', '', turn.playerName), document.createTextNode(turn.labels.join(' · ') || 'tour passé'));
    item.append(el('span', 't', turn.busted ? 'BUST' : turn.finished ? '✓' : String(turn.total)));
    foot.append(item);
  });
}

// ── Briques d'animation ────────────────────────────────────────────────────

/** Fait défiler un nombre d'une valeur à l'autre, puis le fait pulser. */
let rollFrame = null;
let rollGuard = null;
function rollTo(node, from, to) {
  cancelAnimationFrame(rollFrame);
  clearTimeout(rollGuard);
  // Onglet en arrière-plan : requestAnimationFrame est gelé, on affiche
  // directement la valeur finale plutôt que de laisser un score figé.
  if (reduceMotion || document.hidden || from === null || from === to) {
    node.textContent = to;
    return;
  }
  replay(node, 'pop');
  const duration = Math.min(620, 200 + Math.abs(to - from) * 3.2);
  const start = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - start) / duration);
    node.textContent = Math.round(from + (to - from) * (1 - (1 - k) ** 3));
    if (k < 1) rollFrame = requestAnimationFrame(step);
    else node.textContent = to;
  };
  rollFrame = requestAnimationFrame(step);
  rollGuard = setTimeout(() => { cancelAnimationFrame(rollFrame); node.textContent = to; }, duration + 400);
}

/** Rejoue une animation CSS même si la classe est déjà posée. */
function replay(node, className) {
  if (reduceMotion) return;
  node.classList.remove(className);
  void node.offsetWidth; // force le navigateur à repartir de zéro
  node.classList.add(className);
  node.addEventListener('animationend', () => node.classList.remove(className), { once: true });
}

/** Élément éphémère : il se retire tout seul, animation terminée ou non. */
function ephemeral(parent, node, ms) {
  if (!parent) return;
  parent.append(node);
  node.addEventListener('animationend', () => node.remove(), { once: true });
  setTimeout(() => node.remove(), ms);
}

function ring() {
  if (reduceMotion || document.hidden) return;
  ephemeral($('#rings'), el('div', 'ring'), 1400);
}

function showDelta(text) {
  if (reduceMotion || document.hidden) return;
  const slot = $('#deltaSlot');
  slot?.replaceChildren();
  ephemeral(slot, el('div', 'delta', text), 1600);
}

function sweep() {
  if (reduceMotion || document.hidden) return;
  ephemeral($('#stage'), el('div', 'sweep'), 1600);
}

function shake() {
  if (reduceMotion) return;
  replay($('#main'), 'shake');
  replay($('#redflash'), 'show');
}

// ── Grandes annonces ───────────────────────────────────────────────────────

/** Rejoue les évènements non encore vus ; seul le plus récent est annoncé. */
function playEvents(events) {
  const fresh = events.filter((e) => e.id > lastEventId);
  if (fresh.length === 0) return;
  lastEventId = fresh.at(-1).id;
  for (const event of fresh.reverse()) if (playEvent(event)) return;
}

function playEvent(event) {
  const player = view.players.find((p) => p.id === event.playerId);
  const name = (event.playerName ?? '').toUpperCase();

  if (event.type === 'bust') {
    shake();
    return announce({
      big: 'BUST',
      sub: (event.text ?? 'Dépassé').toUpperCase(),
      foot: `${name} · SCORE RENDU ${player ? player.score : ''}`.trim(),
      tone: 'bad',
      hold: 2000,
    });
  }

  if (event.type === 'checkout') {
    const rank = player?.rank ?? view.ranking.length;
    const darts = view.history[0]?.labels.length ?? 3;
    return announce({
      big: 'CHECKOUT',
      sub: rank === 1 ? 'MANCHE GAGNÉE' : `${rank}ᵉ PLACE`,
      foot: `${name} · ${event.value} EN ${darts} FLÉCHETTE${darts > 1 ? 'S' : ''}`,
      tone: 'win',
      hold: 2800,
      rays: 18,
    });
  }

  if (event.type === 'bigscore' && event.value >= 100) {
    return announce({
      big: String(event.value),
      sub: event.value === 180 ? 'MAXIMUM' : 'BELLE VOLÉE',
      foot: event.value === 180 ? `${name} · TON 80` : name,
      tone: 'good',
      hold: 2300,
      rays: event.value === 180 ? 16 : 0,
    });
  }

  return false;
}

let announceTimers = [];
function announce({ big, sub, foot, tone, hold, rays = 0 }) {
  const node = $('#flash');
  announceTimers.forEach(clearTimeout);
  announceTimers = [];

  $('#flashBig').textContent = big;
  $('#flashSub').textContent = sub;
  $('#flashFoot').textContent = foot;

  const raysBox = $('#flashRays');
  raysBox.replaceChildren();
  if (rays && !reduceMotion) {
    for (let i = 0; i < rays; i++) {
      const ray = el('div', 'ray');
      ray.style.setProperty('--deg', `${(360 / rays) * i}deg`);
      raysBox.append(ray);
    }
  }

  node.className = `flash ${tone}`;
  void node.offsetWidth; // relance les animations d'entrée
  node.classList.add('show');

  announceTimers.push(setTimeout(() => node.classList.add('out'), hold - 400));
  announceTimers.push(setTimeout(() => {
    node.className = 'flash';
    raysBox.replaceChildren();
  }, hold));
  return true;
}
