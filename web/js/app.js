/*
 * Téléphone : création de la partie puis saisie des fléchettes.
 * L'application ne gère qu'une partie à la fois — cette page suit son état.
 */

import { $, $$, RULE_LABELS, api, buzz, connect, el, registerSW, store, toast } from './common.js';

registerSW();

const SHARED = 'shared';
const config = { startScore: 501, inRule: 'straight', outRule: 'double', level: 'standard' };
const draft = [];                       // joueurs saisis avant le lancement

let view = null;                        // état de la partie, ou null
let choice = store.get('player');       // 'shared' | id du joueur | null
let mult = 'S';

$('#tvUrl').textContent = `${location.host}/tv`;

const conn = connect({
  role: 'phone',
  playerId: choice && choice !== SHARED ? choice : null,
  onState: render,
  onError: (message) => { toast(message, true); buzz(60); },
  onOpen: () => $('#conn').classList.add('on'),
  onClose: () => $('#conn').classList.remove('on'),
});

// ── Création : réglages ─────────────────────────────────────────────────────

function segment(id, key) {
  const group = $(`#${id}`);
  const paint = () => $$('button', group).forEach((b) => b.setAttribute('aria-pressed', String(b.value === String(config[key]))));
  group.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    config[key] = key === 'startScore' ? Number(button.value) : button.value;
    paint();
  });
  paint();
}

segment('startScore', 'startScore');
segment('inRule', 'inRule');
segment('outRule', 'outRule');
segment('level', 'level');

const nameInput = $('#playerName');

function renderDraft() {
  const list = $('#playerList');
  list.replaceChildren();
  draft.forEach((name, index) => {
    const li = el('li');
    li.append(el('span', 'idx', String(index + 1)), el('span', 'name', name));
    const remove = el('button', 'rm', '×');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Retirer ${name}`);
    remove.addEventListener('click', () => { draft.splice(index, 1); renderDraft(); });
    li.append(remove);
    list.append(li);
  });
  $('#playerHint').textContent = draft.length
    ? `${draft.length} joueur${draft.length > 1 ? 's' : ''} — l'ordre d'ajout est l'ordre de passage.`
    : "L'ordre d'ajout est l'ordre de passage.";
}

function addPlayer() {
  const name = nameInput.value.trim().slice(0, 20);
  if (!name) return nameInput.focus();
  if (draft.length >= 12) return toast('Douze joueurs maximum', true);
  draft.push(name);
  nameInput.value = '';
  nameInput.focus();
  renderDraft();
}

$('#addPlayer').addEventListener('click', addPlayer);
nameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') { event.preventDefault(); addPlayer(); }
});
renderDraft();

$('#setup').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('#error').textContent = '';
  if (draft.length === 0) {
    $('#error').textContent = 'Ajoutez au moins un joueur.';
    return;
  }
  const button = $('#createBtn');
  button.disabled = true;
  button.textContent = 'Lancement…';
  try {
    await api('/api/game', { method: 'POST', body: { ...config, players: draft, shuffle: $('#shuffle').checked } });
    store.del('player');
    choice = null;
  } catch (err) {
    $('#error').textContent = err.message;
  } finally {
    button.disabled = false;
    button.textContent = 'Lancer la partie';
  }
});

// ── Pavé de saisie ─────────────────────────────────────────────────────────

const QUICK = [['T20', 'T20'], ['T19', 'T19'], ['T18', 'T18'], ['D20', 'D20'], ['D16', 'D16'], ['D25', 'BULL']];

for (const [target, label] of QUICK) {
  const button = el('button', '', label);
  button.type = 'button';
  button.dataset.code = target;
  $('#quick').append(button);
}

for (let n = 1; n <= 20; n++) {
  const button = el('button', '', String(n));
  button.type = 'button';
  button.dataset.number = String(n);
  $('#numbers').append(button);
}

function setMult(next) {
  mult = next;
  $$('#mults button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mult === next)));
}

$('#mults').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  setMult(button.dataset.mult === mult ? 'S' : button.dataset.mult);
  buzz(8);
});

function throwDart(target) {
  buzz(14);
  conn.send({ type: 'throw', code: target });
  setMult('S');
}

$('#numbers').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (button) throwDart(`${mult}${button.dataset.number}`);
});

document.querySelector('.specials').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (button) throwDart(button.dataset.code);
});

$('#quick').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (button) throwDart(button.dataset.code);
});

$('#undoBtn').addEventListener('click', () => { buzz(20); conn.send({ type: 'undo' }); });
$('#skipBtn').addEventListener('click', () => {
  if (confirm('Passer le tour du joueur actif ?')) conn.send({ type: 'skip' });
});
$('#pauseBtn').addEventListener('click', () => conn.send({ type: 'pause', paused: view?.status !== 'paused' }));

// ── Terminer / nouvelle partie ─────────────────────────────────────────────

$('#quitBtn').addEventListener('click', async () => {
  if (!view) return;
  if (view.status === 'finished') return newGame();
  if (!confirm('Mettre fin à la partie maintenant ? Le classement sera figé.')) return;
  conn.send({ type: 'end' });
});

$('#newBtn').addEventListener('click', newGame);

async function newGame() {
  try {
    await api('/api/game', { method: 'DELETE' });
    store.del('player');
    choice = null;
  } catch (err) {
    toast(err.message, true);
  }
}

// ── Choix du joueur ────────────────────────────────────────────────────────

$('#whoBtn').addEventListener('click', () => openPicker());

function openPicker() {
  if (!view) return;
  const box = $('#pickerList');
  box.replaceChildren();
  for (const player of view.players.filter((p) => !p.removed)) {
    const button = el('button');
    button.type = 'button';
    button.append(el('strong', '', player.name), el('span', '', player.finished ? 'A terminé' : `${player.score} points`));
    button.addEventListener('click', () => pick(player.id));
    box.append(button);
  }
  const shared = el('button');
  shared.type = 'button';
  shared.append(el('strong', '', 'Téléphone partagé'), el('span', '', 'Je saisis pour tous les joueurs'));
  shared.addEventListener('click', () => pick(SHARED));
  box.append(shared);
  show('picker');
}

function pick(value) {
  choice = value;
  store.set('player', value);
  conn.setPlayer(value === SHARED ? null : value);
  conn.send({ type: 'claim', playerId: value === SHARED ? null : value });
  if (view) render(view);
}

// ── Rendu ──────────────────────────────────────────────────────────────────

/** Affiche un seul des quatre écrans. */
function show(panel) {
  for (const id of ['setup', 'picker', 'game', 'over']) $(`#${id}`).hidden = id !== panel;
}

function render(next) {
  view = next;

  // Aucune partie : on propose d'en créer une.
  if (!view) {
    $('#rules').textContent = '';
    $('#whoBtn').hidden = true;
    $('#quitBtn').hidden = true;
    return show('setup');
  }

  $('#rules').textContent = `${view.startScore} · ${RULE_LABELS.out[view.outRule]}`;
  $('#quitBtn').hidden = false;
  $('#quitBtn').textContent = view.status === 'finished' ? 'Nouvelle' : 'Terminer';

  // Le joueur choisi doit exister dans la partie courante (sinon nouvelle partie).
  const me = view.players.find((p) => p.id === choice) ?? null;
  if (choice && choice !== SHARED && !me) {
    choice = null;
    store.del('player');
  }
  $('#whoBtn').hidden = false;
  $('#whoBtn').textContent = choice === SHARED ? 'Partagé' : me ? me.name : 'Choisir';

  if (view.status === 'finished') {
    renderStandings($('#finalList'), true);
    return show('over');
  }
  if (!choice) return openPicker();

  show('game');

  const current = view.current;
  const myTurn = choice === SHARED || choice === current.playerId;
  const playing = view.status === 'playing';

  $('#playerNameLive').textContent = current.name ?? '—';
  $('#score').textContent = current.score;
  $('#turnBadge').textContent = myTurn && choice !== SHARED ? 'À toi de jouer' : 'Au tour de';
  $('#meta').textContent = `${current.dartsLeft} fléchette${current.dartsLeft > 1 ? 's' : ''} · tour à ${current.turnTotal}`;
  $('#scoreboard').classList.toggle('waiting', !myTurn);

  // Fléchettes du tour
  const darts = $('#darts');
  darts.replaceChildren();
  const thrown = view.turn?.darts ?? [];
  for (let i = 0; i < 3; i++) {
    const record = thrown[i];
    const chip = el('div', 'dart', record ? record.label : '·');
    if (record) chip.classList.add(record.kind === 'bust' ? 'bust' : record.kind === 'no-count' ? 'void' : 'filled');
    darts.append(chip);
  }

  // Recommandation
  const reco = current.recommendation;
  const showReco = playing && reco && reco.kind !== 'none';
  $('#reco').hidden = !showReco;
  if (showReco) {
    $('#recoLabel').textContent = reco.kind === 'entry' ? 'Entrée'
      : reco.kind === 'setup' ? 'À viser pour préparer la sortie'
        : 'Checkout conseillé';
    $('#recoRoute').textContent = reco.text;
    $('#recoNote').textContent = reco.note ?? '';
  }

  // Verrouillage du pavé
  $('#keypad').classList.toggle('locked', !playing || !myTurn);
  const wait = !playing
    ? 'Partie en pause'
    : !myTurn
      ? `Tour de ${current.name} — en attente…`
      : choice !== SHARED
        ? `À toi ${me?.name ?? ''} !`
        : '';
  $('#waitline').hidden = !wait;
  $('#waitline').textContent = wait;

  $('#undoBtn').disabled = !view.canUndo;
  $('#pauseBtn').textContent = view.status === 'paused' ? 'Reprendre' : 'Pause';

  renderStandings($('#standings'), false);
}

function renderStandings(list, final) {
  list.replaceChildren();
  const players = [...view.players];
  if (final) players.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  else players.sort((a, b) => view.order.indexOf(a.id) - view.order.indexOf(b.id));

  for (const player of players) {
    const li = el('li');
    if (player.id === view.currentPlayerId) li.classList.add('active');
    if (player.finished) li.classList.add('done');
    if (player.removed) li.classList.add('out');
    li.append(el('span', 'n', player.name));
    if (player.rank) li.append(el('span', 'rk', `${player.rank}${player.rank === 1 ? 're' : 'e'}`));
    else if (view.hints?.[player.id]) li.append(el('span', 'rk', view.hints[player.id]));
    li.append(el('span', 's', player.finished ? '✓' : String(player.score)));

    const others = view.players.filter((p) => !p.removed).length;
    if (!final && !player.removed && !player.finished && others > 1) {
      const remove = el('button', 'rm', '×');
      remove.type = 'button';
      remove.style.cssText = 'background:none;border:0;color:var(--muted);font-size:1.1rem;cursor:pointer';
      remove.setAttribute('aria-label', `Retirer ${player.name}`);
      remove.addEventListener('click', () => {
        if (confirm(`Retirer ${player.name} de la partie ?`)) conn.send({ type: 'remove', playerId: player.id });
      });
      li.append(remove);
    }
    list.append(li);
  }
}
