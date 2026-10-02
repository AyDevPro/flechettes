import test from 'node:test';
import assert from 'node:assert/strict';

import { targetByCode } from '../src/engine/board.ts';
import {
  CRICKET_TARGETS, closedCount, emptyMarks, hasClosedAll, hasWon, isClosed, isDead,
  marksOf, recommendCricket, resolveCricketDart,
} from '../src/engine/cricket.ts';
import { Game } from '../src/game.ts';

const t = (code: string) => {
  const target = targetByCode(code);
  assert.ok(target, `cible inconnue ${code}`);
  return target!;
};

const player = (over: Partial<{ id: string; score: number; marks: Record<number, number> }> = {}) =>
  ({ id: 'p', score: 0, marks: emptyMarks(), ...over });

// ── Marques ────────────────────────────────────────────────────────────────

test('les secteurs en jeu sont 20 à 15 et le bull', () => {
  assert.deepEqual(CRICKET_TARGETS, [20, 19, 18, 17, 16, 15, 25]);
});

test('une fléchette vaut autant de marques que son multiplicateur', () => {
  assert.equal(marksOf(t('S20')), 1);
  assert.equal(marksOf(t('D20')), 2);
  assert.equal(marksOf(t('T20')), 3);
  assert.equal(marksOf(t('S25')), 1, 'anneau extérieur du bull');
  assert.equal(marksOf(t('D25')), 2, 'bull 50');
  assert.equal(marksOf(t('T14')), 0, 'hors jeu');
  assert.equal(marksOf(t('MISS')), 0);
});

test('trois marques ferment un secteur', () => {
  const me = player();
  const other = player({ id: 'o' });
  const first = resolveCricketDart(t('S20'), me, [other]);
  assert.deepEqual(first, { sector: 20, marksAdded: 1, pointsAdded: 0, pointsTo: [], closed: false });
  me.marks[20] = 2;
  const second = resolveCricketDart(t('S20'), me, [other]);
  assert.equal(second.closed, true);
  me.marks[20] = 3;
  assert.equal(isClosed(me.marks, 20), true);
});

test('les marques en trop rapportent des points', () => {
  const me = player({ marks: { ...emptyMarks(), 20: 2 } });
  const other = player({ id: 'o' });
  // Un triple pose la marque manquante, les deux autres valent 40 points.
  const res = resolveCricketDart(t('T20'), me, [other]);
  assert.equal(res.marksAdded, 1);
  assert.equal(res.pointsAdded, 40);
  assert.equal(res.closed, true);
});

test('un secteur fermé par tout le monde ne rapporte plus rien', () => {
  const me = player({ marks: { ...emptyMarks(), 20: 3 } });
  const other = player({ id: 'o', marks: { ...emptyMarks(), 20: 3 } });
  assert.equal(isDead([me, other], 20), true);
  assert.equal(resolveCricketDart(t('T20'), me, [other]).pointsAdded, 0);

  // Avec un adversaire encore ouvert, les trois marques rapportent 60.
  const open = player({ id: 'x' });
  assert.equal(resolveCricketDart(t('T20'), me, [other, open]).pointsAdded, 60);
});

test('le bull rapporte 25 par marque', () => {
  const me = player({ marks: { ...emptyMarks(), 25: 3 } });
  const other = player({ id: 'o' });
  assert.equal(resolveCricketDart(t('S25'), me, [other]).pointsAdded, 25);
  assert.equal(resolveCricketDart(t('D25'), me, [other]).pointsAdded, 50);
});

// ── Victoire ───────────────────────────────────────────────────────────────

test('il faut tout fermer et mener aux points', () => {
  const closedAll = Object.fromEntries(CRICKET_TARGETS.map((s) => [s, 3]));
  const me = player({ marks: closedAll, score: 60 });
  assert.equal(hasClosedAll(me.marks), true);
  assert.equal(closedCount(me.marks), 7);

  assert.equal(hasWon(me, [player({ id: 'o', score: 40 })]), true);
  assert.equal(hasWon(me, [player({ id: 'o', score: 60 })]), true, 'à égalité, on gagne');
  assert.equal(hasWon(me, [player({ id: 'o', score: 80 })]), false, 'derrière aux points');

  const partial = player({ marks: { ...closedAll, 15: 2 }, score: 200 });
  assert.equal(hasWon(partial, [player({ id: 'o', score: 0 })]), false, 'un secteur reste ouvert');
});

// ── Conseils ───────────────────────────────────────────────────────────────

test('le conseil vise le plus gros secteur à fermer', () => {
  const me = player();
  const rival = player({ id: 'o' });
  const r = recommendCricket(me, [rival], 'standard');
  assert.equal(r.kind, 'aim');
  assert.equal(r.text, 'T20');
  assert.match(r.note ?? '', /fermer le 20/);

  // Un débutant se voit proposer le simple, pas le triple.
  assert.equal(recommendCricket(me, [rival], 'beginner').text, '20');
});

test('le conseil privilégie ce qui rapporte, puis les points', () => {
  const closedAll = Object.fromEntries(CRICKET_TARGETS.map((s) => [s, 3]));
  // 20 et 19 sont fermés chez l'adversaire : les y fermer ne rapporterait aucun
  // point. Le moteur envoie d'abord sur un secteur qui ferme *et* rapporte.
  const me = player({ marks: { ...emptyMarks(), 18: 3 } });
  const rival = player({ id: 'o', marks: { ...emptyMarks(), 20: 3, 19: 3 } });
  const r1 = recommendCricket(me, [rival], 'standard');
  assert.equal(r1.text, 'T17');
  assert.match(r1.note ?? '', /fermer le 17/);

  // Tout fermé mais derrière aux points : on marque sur ce qui reste ouvert.
  const ahead = player({ id: 'o', score: 100, marks: { ...emptyMarks(), 20: 3 } });
  const behind = player({ marks: closedAll, score: 40 });
  const r = recommendCricket(behind, [ahead], 'standard');
  assert.equal(r.kind, 'aim');
  assert.equal(r.text, 'T19', 'le 20 est fermé chez l\'adversaire');
  assert.match(r.note ?? '', /61 points à reprendre/);
});

// ── Partie complète ────────────────────────────────────────────────────────

const newGame = (players = ['Alice', 'Bob']) =>
  Game.create({ mode: 'cricket', startScore: 501, inRule: 'straight', outRule: 'double', level: 'standard', players });

test('une partie de cricket démarre à zéro point', () => {
  const g = newGame();
  assert.equal(g.state.mode, 'cricket');
  for (const p of g.state.players) {
    assert.equal(p.score, 0);
    assert.equal(closedCount(p.marks), 0);
    assert.equal(p.entered, true, 'aucune règle d\'entrée au cricket');
  }
  assert.equal(g.view().cricket?.targets.length, 7);
});

test('les fléchettes posent des marques puis marquent des points', () => {
  const g = newGame();
  const alice = g.current!;
  g.applyDart('T20');                       // ferme le 20
  assert.equal(g.player(alice.id)!.marks[20], 3);
  assert.equal(g.player(alice.id)!.score, 0);
  g.applyDart('T20');                       // 60 points
  assert.equal(g.player(alice.id)!.score, 60);
  g.applyDart('S7');                        // hors jeu
  assert.equal(g.state.history[0]!.labels.length, 3);
  assert.equal(g.state.history[0]!.total, 60);
  assert.equal(g.state.history[0]!.marks, 3);
  assert.equal(g.current!.name, 'Bob');
});

test('une fléchette hors jeu ne compte pas', () => {
  const g = newGame();
  g.applyDart('T14');
  const dart = g.state.turn!.darts[0]!;
  assert.equal(dart.kind, 'no-count');
  assert.equal(dart.marks, 0);
  assert.equal(g.current!.score, 0);
});

test('aucun Bust au cricket', () => {
  const g = newGame();
  for (const code of ['T20', 'T20', 'T20']) g.applyDart(code);
  assert.equal(g.state.history[0]!.busted, false);
  assert.equal(g.state.players[0]!.score, 120, 'six marques en trop à 20 points');
});

test('la victoire exige tous les secteurs fermés et l\'avantage aux points', () => {
  const g = newGame();
  const [alice, bob] = g.state.players;
  // Alice ferme tout sauf le bull, Bob reste à zéro.
  for (const sector of [20, 19, 18, 17, 16, 15]) alice!.marks[sector] = 3;
  g.state.turn!.startScore = 0;
  g.applyDart('S25');
  g.applyDart('S25');
  assert.equal(alice!.finished, false, 'il manque une marque au bull');
  g.applyDart('S25');
  assert.equal(alice!.finished, true);
  assert.equal(alice!.rank, 1);
  assert.equal(g.state.status, 'finished', 'à deux joueurs, la partie s\'arrête');
  assert.equal(bob!.rank, 2);
});

test('fermer tout en étant derrière ne suffit pas', () => {
  const g = newGame();
  const [alice, bob] = g.state.players;
  bob!.score = 100;
  for (const sector of [20, 19, 18, 17, 16, 15]) alice!.marks[sector] = 3;
  alice!.marks[25] = 2;
  g.applyDart('S25');                      // tout fermé, mais 0 contre 100
  assert.equal(alice!.finished, false);
  assert.equal(g.view().current.recommendation.kind, 'aim');
});

test('Undo rembobine aussi les marques', () => {
  const g = newGame();
  g.applyDart('T20');
  assert.equal(g.current!.marks[20], 3);
  g.undo();
  assert.equal(g.current!.marks[20], 0);
  assert.equal(g.current!.score, 0);
});

test('la vue signale les secteurs morts', () => {
  const g = newGame();
  const [alice, bob] = g.state.players;
  alice!.marks[20] = 3;
  bob!.marks[20] = 3;
  assert.deepEqual(g.view().cricket?.dead, [20]);
});


// ── Cut-throat ─────────────────────────────────────────────────────────────

test('cut-throat : les points vont aux adversaires encore ouverts', () => {
  const me = player({ marks: { ...emptyMarks(), 20: 3 } });
  const open1 = player({ id: 'a' });
  const open2 = player({ id: 'b' });
  const closed = player({ id: 'c', marks: { ...emptyMarks(), 20: 3 } });

  const res = resolveCricketDart(t('T20'), me, [open1, open2, closed], 'cutthroat');
  assert.equal(res.pointsAdded, 0, 'le lanceur ne marque rien');
  assert.deepEqual(res.pointsTo, [{ id: 'a', points: 60 }, { id: 'b', points: 60 }]);

  // Tout le monde a fermé : plus rien à distribuer.
  assert.deepEqual(resolveCricketDart(t('T20'), me, [closed], 'cutthroat').pointsTo, []);
});

test('cut-throat : le plus bas score gagne', () => {
  const closedAll = Object.fromEntries(CRICKET_TARGETS.map((s) => [s, 3]));
  const me = player({ marks: closedAll, score: 40 });
  assert.equal(hasWon(me, [player({ id: 'o', score: 80 })], 'cutthroat'), true);
  assert.equal(hasWon(me, [player({ id: 'o', score: 40 })], 'cutthroat'), true, 'à égalité, on gagne');
  assert.equal(hasWon(me, [player({ id: 'o', score: 20 })], 'cutthroat'), false, 'devant aux points');
  // La variante standard juge dans l'autre sens.
  assert.equal(hasWon(me, [player({ id: 'o', score: 20 })], 'standard'), true);
});

test('cut-throat : le conseil parle de points à donner', () => {
  const closedAll = Object.fromEntries(CRICKET_TARGETS.map((s) => [s, 3]));
  const me = player({ marks: closedAll, score: 90 });
  const rival = player({ id: 'o', score: 40, marks: { ...emptyMarks(), 20: 3 } });
  const r = recommendCricket(me, [rival], 'standard', 'cutthroat');
  assert.equal(r.text, 'T19', 'le 20 est fermé chez l\'adversaire');
  assert.match(r.note ?? '', /51 points à donner/);
});

test('cut-throat : une partie complète distribue bien les points', () => {
  const g = Game.create({
    mode: 'cricket', variant: 'cutthroat', startScore: 501,
    inRule: 'straight', outRule: 'double', level: 'standard',
    players: ['Alice', 'Bob', 'Chloé'],
  });
  assert.equal(g.state.variant, 'cutthroat');
  const [alice, bob, chloe] = g.state.players;

  g.applyDart('T20');                       // Alice ferme le 20
  g.applyDart('T20');                       // 60 points pour Bob et Chloé
  assert.equal(alice!.score, 0);
  assert.equal(bob!.score, 60);
  assert.equal(chloe!.score, 60);
  assert.equal(g.state.turn!.darts[1]!.points, 120, 'points distribués au total');

  // Alice ferme tout : elle gagne car elle est la plus basse.
  for (const sector of [19, 18, 17, 16, 15]) alice!.marks[sector] = 3;
  alice!.marks[25] = 2;
  g.applyDart('S25');
  assert.equal(alice!.finished, true);
  assert.equal(alice!.rank, 1);
});
