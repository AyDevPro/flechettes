/* Tableau d'affichage TV : lisible à plusieurs mètres, mis à jour en direct. */

import { $, RULE_LABELS, connect, el, loadQr } from './common.js';

let lastEventId = 0;
let view = null;

/** Mémoire du dernier rendu : sert à n'animer que ce qui vient de changer. */
const previous = { playerId: null, score: null, darts: 0, turnNo: null, floatedTurn: null };
/** Dernier score connu de chaque joueur, pour n'animer que les lignes qui bougent. */
let previousScores = new Map();
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

$('#url').textContent = location.host;
loadQr($('#qr'), `${location.origin}/`);

connect({
  role: 'tv',
  onState: render,
  onOpen: () => document.querySelector('.offline')?.remove(),
  onClose: showOffline,
});

function showOffline() {
  if (document.querySelector('.offline')) return;
  document.body.append(el('div', 'offline', 'Connexion au serveur perdue — reconnexion…'));
}

// ── Rendu ──────────────────────────────────────────────────────────────────

function render(next) {
  const first = !view;
  view = next;
  document.querySelector('.tv-main').classList.toggle('idle', !view);

  if (!view) return renderIdle();

  $('#title').textContent = `Partie en ${view.startScore}`;
  $('#rules').replaceChildren(
    el('span', 'tag', RULE_LABELS.in[view.inRule]),
    el('span', 'tag', RULE_LABELS.out[view.outRule]),
    el('span', 'tag', `Conseils ${RULE_LABELS.level[view.level]}`),
  );

  if (view.status === 'finished') renderFinal();
  else renderStage();

  renderRoster();
  renderFoot();

  const events = view.events ?? [];
  if (first) lastEventId = events.at(-1)?.id ?? 0;
  else playEvents(events);

  // Total du tour qui vient de s'achever (les gros scores ont déjà leur annonce).
  const last = view.history[0];
  if (last && last.turnNo !== previous.floatedTurn) {
    // Les gros scores et les Busts ont déjà leur annonce plein écran.
    if (!first && !last.busted && last.total > 0 && last.total < 100) floatTotal(last.total);
    previous.floatedTurn = last.turnNo;
  }

  previous.playerId = view.current.playerId;
  previous.score = view.current.score;
  previous.darts = view.turn?.darts.length ?? 0;
  previous.turnNo = view.turnNo;
}

/** Fait défiler un nombre d'une valeur à l'autre, puis le fait pulser. */
let rollFrame = null;
let rollGuard = null;
function rollTo(node, from, to) {
  cancelAnimationFrame(rollFrame);
  clearTimeout(rollGuard);
  // Onglet en arrière-plan : requestAnimationFrame est gelé, on affiche la
  // valeur finale directement plutôt que de laisser un score figé à l'écran.
  if (reduceMotion || document.hidden || from === null || from === to) {
    node.textContent = to;
    return;
  }
  replay(node, 'pop');
  const duration = Math.min(620, 200 + Math.abs(to - from) * 3.2);
  const start = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - start) / duration);
    const eased = 1 - (1 - k) ** 3;
    node.textContent = Math.round(from + (to - from) * eased);
    if (k < 1) rollFrame = requestAnimationFrame(step);
    else node.textContent = to;
  };
  rollFrame = requestAnimationFrame(step);
  // Filet de sécurité : quoi qu'il arrive, le vrai score finit par s'afficher.
  rollGuard = setTimeout(() => {
    cancelAnimationFrame(rollFrame);
    node.textContent = to;
  }, duration + 400);
}

/** Rejoue une animation CSS même si la classe est déjà posée. */
function replay(node, className) {
  if (reduceMotion) return;
  node.classList.remove(className);
  void node.offsetWidth; // force le navigateur à repartir de zéro
  node.classList.add(className);
  node.addEventListener('animationend', () => node.classList.remove(className), { once: true });
}

function floatTotal(total) {
  if (reduceMotion || document.hidden) return;
  const node = el('div', 'float', `+${total}`);
  $('#stage').append(node);
  node.addEventListener('animationend', () => node.remove(), { once: true });
  setTimeout(() => node.remove(), 2000); // au cas où l'animation ne se termine pas
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
  lastEventId = 0;
  previous.playerId = null;
  previous.score = null;
  previous.darts = 0;
  previous.turnNo = null;
  previous.floatedTurn = null;
  previousScores = new Map();
}

function renderStage() {
  const stage = $('#stage');
  const rebuilt = !stage.querySelector('#who');
  if (rebuilt) stage.replaceChildren(...stageNodes());
  const current = view.current;
  const thrown = view.turn?.darts ?? [];
  const sameTurn = !rebuilt && previous.playerId === current.playerId && previous.turnNo === view.turnNo;

  $('#turnLabel').textContent = view.status === 'paused' ? 'Partie en pause' : 'Au tour de';
  $('#who').textContent = current.name ?? '—';
  $('#sub').textContent = `${current.dartsLeft} fléchette${current.dartsLeft > 1 ? 's' : ''} restante${current.dartsLeft > 1 ? 's' : ''} · tour à ${current.turnTotal}`;

  // Le score défile jusqu'à sa nouvelle valeur, seulement s'il s'agit du même
  // joueur (sinon on afficherait un décompte entre deux joueurs sans rapport).
  rollTo($('#score'), sameTurn ? previous.score : null, current.score);

  // Changement de joueur : la scène se remet en place.
  if (!rebuilt && previous.playerId && previous.playerId !== current.playerId) replay(stage, 'turn-in');

  const darts = $('#darts');
  darts.replaceChildren();
  for (let i = 0; i < 3; i++) {
    const record = thrown[i];
    const chip = el('div', 'd', record ? record.label : '·');
    if (record) chip.classList.add(record.kind === 'bust' ? 'bust' : record.kind === 'no-count' ? 'void' : 'filled');
    // Seule la fléchette qui vient d'être saisie s'anime.
    if (record && !reduceMotion && sameTurn && i === thrown.length - 1 && thrown.length > previous.darts) {
      chip.classList.add('enter');
    }
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
  const mk = (tag, cls, id) => { const n = el(tag, cls); n.id = id; return n; };
  const reco = mk('div', 'tv-reco', 'reco');
  reco.append(mk('div', 'cap', 'recoCap'), mk('div', 'route', 'recoRoute'));
  return [
    mk('div', 'turn-label', 'turnLabel'),
    mk('div', 'who', 'who'),
    mk('div', 'big', 'score'),
    mk('div', 'sub', 'sub'),
    mk('div', 'tv-darts', 'darts'),
    reco,
  ];
}

function renderFinal() {
  const box = el('div', 'final');
  box.append(el('h2', '', 'Classement final'));
  const list = el('ol');
  for (const player of [...view.players].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))) {
    const li = el('li');
    li.append(el('span', 'm', player.rank ? `${player.rank}.` : '—'), document.createTextNode(player.name));
    if (player.stats.checkout) li.append(el('span', 'm', ` (checkout ${player.stats.checkout})`));
    list.append(li);
  }
  box.append(list);
  $('#stage').replaceChildren(box);
}

function renderRoster() {
  const roster = $('#roster');
  roster.replaceChildren();
  const players = [...view.players].sort((a, b) => view.order.indexOf(a.id) - view.order.indexOf(b.id));
  for (const player of players) {
    const row = el('div', 'pl');
    if (player.id === view.currentPlayerId && view.status !== 'finished') row.classList.add('active');
    if (player.finished) row.classList.add('done');
    if (player.removed) row.classList.add('out');

    row.append(el('div', 'pos', player.rank ? `${player.rank}${player.rank === 1 ? 're' : 'e'}` : '·'));

    const block = el('div');
    block.append(el('div', 'name', player.name));
    const hint = view.hints?.[player.id];
    if (hint && !player.finished) block.append(el('div', 'co', hint));
    else if (!player.entered) block.append(el('div', 'co', 'doit entrer par un double'));
    row.append(block);

    const value = el('div', 'val', player.finished ? 'Terminé' : String(player.score));
    if (previousScores.has(player.id) && previousScores.get(player.id) !== player.score) replay(value, 'pop');
    row.append(value);
    roster.append(row);
  }
  previousScores = new Map(view.players.map((p) => [p.id, p.score]));
}

function renderFoot() {
  const foot = $('#foot');
  foot.replaceChildren();
  for (const turn of view.history.slice(0, 4)) {
    const item = el('div', 'h');
    if (turn.busted) item.classList.add('bust');
    if (turn.finished) item.classList.add('win');
    item.append(el('b', '', turn.playerName), document.createTextNode(turn.labels.join(' · ') || 'tour passé'));
    item.append(el('span', 't', turn.busted ? 'BUST' : turn.finished ? '✓' : String(turn.total)));
    foot.append(item);
  }
}

// ── Animations ─────────────────────────────────────────────────────────────

/** Rejoue les évènements non encore vus ; seul le plus récent est animé. */
function playEvents(events) {
  const fresh = events.filter((e) => e.id > lastEventId);
  if (fresh.length === 0) return;
  lastEventId = fresh.at(-1).id;
  for (const event of fresh.reverse()) if (playEvent(event)) return;
}

function playEvent(event) {
  if (event.type === 'bust') {
    replay($('#stage'), 'shake');
    return flash('BUST', event.playerName ?? '', 'bad');
  }
  if (event.type === 'checkout') {
    const player = view.players.find((p) => p.id === event.playerId);
    const rank = player?.rank ?? view.ranking.length;
    return flash('CHECKOUT !', `${event.playerName} termine en ${rank}${rank === 1 ? 're' : 'e'} position`, 'win');
  }
  if (event.type === 'bigscore' && event.value >= 100) {
    return flash(String(event.value), event.value === 180 ? 'Maximum !' : event.playerName ?? '', 'good');
  }
  return false;
}

let flashTimer;
function flash(big, small, tone) {
  const node = $('#flash');
  $('#flashBig').textContent = big;
  $('#flashSmall').textContent = small;
  node.className = `flash ${tone}`;
  void node.offsetWidth; // relance l'animation
  node.classList.add('show');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => node.classList.remove('show'), 2300);
  return true;
}
