/* Tableau d'affichage TV : lisible à plusieurs mètres, mis à jour en direct. */

import { $, RULE_LABELS, connect, el, loadQr } from './common.js';

let lastEventId = 0;
let view = null;

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
}

function renderStage() {
  const stage = $('#stage');
  if (!stage.querySelector('#who')) stage.replaceChildren(...stageNodes());
  const current = view.current;

  $('#turnLabel').textContent = view.status === 'paused' ? 'Partie en pause' : 'Au tour de';
  $('#who').textContent = current.name ?? '—';
  $('#score').textContent = current.score;
  $('#sub').textContent = `${current.dartsLeft} fléchette${current.dartsLeft > 1 ? 's' : ''} restante${current.dartsLeft > 1 ? 's' : ''} · tour à ${current.turnTotal}`;

  const darts = $('#darts');
  darts.replaceChildren();
  const thrown = view.turn?.darts ?? [];
  for (let i = 0; i < 3; i++) {
    const record = thrown[i];
    const chip = el('div', 'd', record ? record.label : '·');
    if (record) chip.classList.add(record.kind === 'bust' ? 'bust' : record.kind === 'no-count' ? 'void' : 'filled');
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

    row.append(el('div', 'val', player.finished ? 'Terminé' : String(player.score)));
    roster.append(row);
  }
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
  if (event.type === 'bust') return flash('BUST', event.playerName ?? '', 'bad');
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
