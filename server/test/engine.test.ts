import test from 'node:test';
import assert from 'node:assert/strict';

import { targetByCode, TARGETS } from '../src/engine/board.ts';
import { isValidFinish, maxCheckout, resolveDart } from '../src/engine/rules.ts';
import { CLASSIC_DOUBLE_OUT } from '../src/engine/classic.ts';
import { bestRoutes, findRoutes, finishOptions, isCheckable, recommend } from '../src/engine/checkout.ts';
import { Game } from '../src/game.ts';

const t = (code: string) => {
  const target = targetByCode(code);
  assert.ok(target, `cible inconnue ${code}`);
  return target!;
};

// ── Cible ───────────────────────────────────────────────────────────────────

test('la cible expose 62 zones marquables', () => {
  assert.equal(TARGETS.length, 62);
  assert.equal(t('T20').value, 60);
  assert.equal(t('D17').value, 34);
  assert.equal(t('S14').value, 14);
  assert.equal(t('S25').value, 25);
  assert.equal(t('D25').value, 50);
  assert.equal(targetByCode('X9'), null);
});

// ── Règles de sortie ────────────────────────────────────────────────────────

test('les règles de sortie acceptent les bonnes fléchettes', () => {
  assert.equal(isValidFinish(t('S20'), 'straight'), true);
  assert.equal(isValidFinish(t('S20'), 'double'), false);
  assert.equal(isValidFinish(t('D20'), 'double'), true);
  assert.equal(isValidFinish(t('D25'), 'double'), true, 'le bull 50 est un double 25');
  assert.equal(isValidFinish(t('T20'), 'master'), true);
  assert.equal(isValidFinish(t('D20'), 'master'), true);
  assert.equal(isValidFinish(t('S20'), 'master'), false);
  assert.equal(isValidFinish(t('T20'), 'triple'), true);
  assert.equal(isValidFinish(t('D20'), 'triple'), false);
  assert.equal(isValidFinish(t('D25'), 'triple'), false);
});

test('maxCheckout reflète la meilleure dernière fléchette', () => {
  assert.equal(maxCheckout('double', 3), 170);
  assert.equal(maxCheckout('straight', 3), 180);
  assert.equal(maxCheckout('double', 2), 110);
  assert.equal(maxCheckout('double', 1), 50);
});

// ── Résolution d'une fléchette ──────────────────────────────────────────────

test('Straight In : la première fléchette compte', () => {
  const r = resolveDart({ target: t('T20'), scoreBefore: 501, entered: true, inRule: 'straight', outRule: 'double' });
  assert.equal(r.kind, 'score');
  assert.equal(r.scoreAfter, 441);
});

test('Double In : rien ne compte avant le premier double', () => {
  const miss = resolveDart({ target: t('S20'), scoreBefore: 301, entered: false, inRule: 'double', outRule: 'double' });
  assert.equal(miss.kind, 'no-count');
  assert.equal(miss.scoreAfter, 301);
  assert.equal(miss.entered, false);

  const entry = resolveDart({ target: t('D20'), scoreBefore: 301, entered: false, inRule: 'double', outRule: 'double' });
  assert.equal(entry.kind, 'score');
  assert.equal(entry.scoreAfter, 261, 'la fléchette du Double In compte normalement');
  assert.equal(entry.entered, true);
});

test('Bust : dépassement, reste impossible et sortie non conforme', () => {
  const over = resolveDart({ target: t('S20'), scoreBefore: 12, entered: true, inRule: 'straight', outRule: 'double' });
  assert.equal(over.kind, 'bust');
  assert.equal(over.reason, 'depassement');

  const one = resolveDart({ target: t('S20'), scoreBefore: 21, entered: true, inRule: 'straight', outRule: 'double' });
  assert.equal(one.kind, 'bust');
  assert.equal(one.reason, 'reste-impossible', 'laisser 1 en Double Out est un Bust');

  const wrongOut = resolveDart({ target: t('S20'), scoreBefore: 20, entered: true, inRule: 'straight', outRule: 'double' });
  assert.equal(wrongOut.kind, 'bust');
  assert.equal(wrongOut.reason, 'sortie-invalide');

  const ok = resolveDart({ target: t('S20'), scoreBefore: 20, entered: true, inRule: 'straight', outRule: 'straight' });
  assert.equal(ok.kind, 'win');
});

test('Triple Out : seul un triple termine', () => {
  assert.equal(resolveDart({ target: t('T20'), scoreBefore: 60, entered: true, inRule: 'straight', outRule: 'triple' }).kind, 'win');
  assert.equal(resolveDart({ target: t('D20'), scoreBefore: 40, entered: true, inRule: 'straight', outRule: 'triple' }).kind, 'bust');
  // Reste 2 : plus terminable puisqu'il faut un triple (min. T1 = 3).
  assert.equal(resolveDart({ target: t('S18'), scoreBefore: 20, entered: true, inRule: 'straight', outRule: 'triple' }).reason, 'reste-impossible');
});

// ── Table classique ─────────────────────────────────────────────────────────

test('chaque route classique tombe à zéro sur un double', () => {
  for (const [score, route] of CLASSIC_DOUBLE_OUT) {
    const targets = route.map(t);
    const total = targets.reduce((s, x) => s + x.value, 0);
    assert.equal(total, score, `${score} : ${route.join(' ')} = ${total}`);
    assert.ok(route.length <= 3, `${score} : plus de trois fléchettes`);
    const last = targets[targets.length - 1]!;
    assert.equal(isValidFinish(last, 'double'), true, `${score} ne finit pas sur un double`);
    // Aucun reste intermédiaire ne doit être injouable.
    let rest = score;
    for (const target of targets.slice(0, -1)) {
      rest -= target.value;
      assert.ok(rest >= 2, `${score} : reste ${rest} injouable`);
    }
  }
  assert.equal(CLASSIC_DOUBLE_OUT.has(169), false, '169 n\'a pas de sortie');
  assert.equal(CLASSIC_DOUBLE_OUT.size, 162, '2 → 170 moins les sept scores injouables');
});

// ── Recherche de combinaisons ───────────────────────────────────────────────

test('les scores injouables sont détectés', () => {
  for (const bogey of [169, 168, 166, 165, 163, 162, 159]) {
    assert.equal(isCheckable(bogey, 3, 'double'), false, `${bogey} devrait être injouable`);
  }
  assert.equal(isCheckable(170, 3, 'double'), true);
  assert.equal(isCheckable(1, 3, 'double'), false);
  assert.equal(isCheckable(1, 3, 'straight'), true);
  assert.equal(isCheckable(110, 2, 'double'), true, 'T20 + Bull');
  assert.equal(isCheckable(111, 2, 'double'), false);
});

test('toutes les routes trouvées sont valides', () => {
  const routes = findRoutes(100, 3, 'double');
  assert.ok(routes.length > 10);
  for (const route of routes) {
    assert.equal(route.reduce((s, x) => s + x.value, 0), 100);
    assert.equal(isValidFinish(route[route.length - 1]!, 'double'), true);
  }
});

// ── Recommandations ─────────────────────────────────────────────────────────

const reco = (remaining: number, dartsLeft: number, outRule: 'straight' | 'double' | 'master' | 'triple', level: 'beginner' | 'standard' | 'expert') =>
  recommend({ remaining, dartsLeft, outRule, inRule: 'straight', entered: true, level });

test('routes classiques en mode Standard', () => {
  assert.equal(reco(100, 3, 'double', 'standard').text, 'T20 → D20');
  assert.equal(reco(170, 3, 'double', 'standard').text, 'T20 → T20 → BULL');
  assert.equal(reco(40, 3, 'double', 'standard').text, 'D20');
  assert.equal(reco(80, 2, 'double', 'standard').text, 'T20 → D10');
  assert.equal(reco(32, 1, 'double', 'standard').text, 'D16');
});

test('la recommandation se recalcule après chaque fléchette (§18)', () => {
  assert.equal(reco(100, 3, 'double', 'standard').text, 'T20 → D20');
  assert.equal(reco(80, 2, 'double', 'standard').kind, 'checkout');
  assert.equal(reco(32, 1, 'double', 'standard').text, 'D16');
});

test('le mode Débutant évite les triples quand un chemin simple existe', () => {
  const easy = reco(52, 3, 'double', 'beginner');
  assert.equal(easy.kind, 'checkout');
  assert.ok(!easy.labels.some((l) => l.startsWith('T')), `route trop technique : ${easy.text}`);
  const hundred = reco(100, 3, 'beginner' === 'beginner' ? 'double' : 'double', 'beginner');
  assert.equal(hundred.kind, 'checkout');
});

test('une seule fléchette : seule une sortie directe est proposée', () => {
  assert.equal(reco(40, 1, 'double', 'standard').text, 'D20');
  assert.equal(reco(50, 1, 'double', 'standard').text, 'BULL');
  assert.equal(reco(60, 1, 'double', 'standard').kind, 'setup', '60 ne se sort pas en une fléchette au double');
  assert.equal(reco(60, 1, 'triple', 'standard').text, 'T20');
});

test('score trop élevé : aucun conseil au-dessus de 180', () => {
  // Au-dessus d'une volée maximale, le conseil serait toujours « vise le 20 ».
  for (const remaining of [501, 301, 240, 200, 181]) {
    assert.equal(reco(remaining, 3, 'double', 'standard').kind, 'none', `${remaining} ne devrait rien proposer`);
  }
});

test('à partir de 180, le moteur prépare le tour suivant', () => {
  // 180 ne se sort pas en Double Out : on vise 140 pour laisser 40 (D20).
  const setup = reco(180, 3, 'double', 'standard');
  assert.equal(setup.kind, 'setup');
  assert.deepEqual(setup.labels, ['T20', 'T20', '20']);
  assert.equal(setup.note, 'Laisse 40, sortable au prochain tour');

  // Une préparation ne doit jamais conduire à un Bust ni à un reste injouable.
  for (const remaining of [180, 171, 169, 100, 62]) {
    for (const darts of [3, 2, 1]) {
      const plan = reco(remaining, darts, 'double', 'standard');
      if (plan.kind !== 'setup') continue;
      const rest = remaining - plan.codes.map(t).reduce((s, x) => s + x.value, 0);
      assert.ok(rest >= 2, `${remaining} en ${darts} fléchettes laisse ${rest}`);
      assert.ok(plan.codes.length <= darts);
    }
  }
});

test('le mode Débutant vise des cibles plus simples pour préparer', () => {
  // Avec une seule fléchette sur 62, un débutant vise un grand simple ; les
  // autres niveaux acceptent un triple pour laisser un meilleur reste.
  const beginner = reco(62, 1, 'double', 'beginner');
  const standard = reco(62, 1, 'double', 'standard');
  assert.equal(beginner.kind, 'setup');
  assert.ok(beginner.labels.every((l) => !l.startsWith('T')), `route trop technique : ${beginner.text}`);
  assert.ok(standard.labels.some((l) => l.startsWith('T')), `route trop timide : ${standard.text}`);
});

test('un reste sans option est jugé fragile', () => {
  // 2 ne se termine que par D1 ; 48 offre de nombreux chemins.
  assert.equal(finishOptions(2, 'double'), 1);
  assert.ok(finishOptions(48, 'double') > 10);
  assert.equal(finishOptions(1, 'double'), 0);
});

test('Double In : le moteur demande d\'abord un double', () => {
  const r = recommend({ remaining: 301, dartsLeft: 3, outRule: 'double', inRule: 'double', entered: false, level: 'standard' });
  assert.equal(r.kind, 'entry');
  assert.equal(r.text, 'D20');
});

test('les routes proposées respectent la règle de sortie choisie', () => {
  for (const rule of ['straight', 'double', 'master', 'triple'] as const) {
    for (const level of ['beginner', 'standard', 'expert'] as const) {
      for (const remaining of [2, 3, 7, 20, 40, 60, 99, 141]) {
        const r = recommend({ remaining, dartsLeft: 3, outRule: rule, inRule: 'straight', entered: true, level });
        if (r.kind !== 'checkout') continue;
        const targets = r.codes.map(t);
        assert.equal(targets.reduce((s, x) => s + x.value, 0), remaining, `${rule}/${level}/${remaining} : ${r.text}`);
        assert.equal(isValidFinish(targets[targets.length - 1]!, rule), true, `${rule}/${level}/${remaining} : ${r.text}`);
      }
    }
  }
});

test('toute route classée est jouable pour tous les scores sortables', () => {
  for (const remaining of Array.from({ length: 170 }, (_, i) => i + 1)) {
    if (!isCheckable(remaining, 3, 'double')) continue;
    const best = bestRoutes(remaining, 3, 'double', 'standard', 1)[0]!;
    assert.equal(best.codes.map(t).reduce((s, x) => s + x.value, 0), remaining);
  }
});

// ── Partie complète ─────────────────────────────────────────────────────────

const newGame = (over: Partial<Parameters<typeof Game.create>[0]> = {}) =>
  Game.create({ startScore: 501, inRule: 'straight', outRule: 'double', level: 'standard', players: ['Lucas', 'Thomas'], ...over });

test('un tour de trois fléchettes passe la main', () => {
  const g = newGame();
  const lucas = g.current!;
  assert.equal(lucas.name, 'Lucas');
  g.applyDart('T20');
  g.applyDart('T20');
  assert.equal(g.current!.score, 381);
  assert.equal(g.view().current.turnTotal, 120);
  g.applyDart('T20');
  assert.equal(g.current!.name, 'Thomas', 'la main passe après trois fléchettes');
  assert.equal(g.player(lucas.id)!.score, 321);
  assert.equal(g.player(lucas.id)!.stats.count180, 1);
});

test('un Bust rend le score de début de tour et termine le tour', () => {
  const g = newGame();
  const lucas = g.current!;
  lucas.score = 32;
  g.state.turn!.startScore = 32;
  g.applyDart('S20'); // 12
  assert.equal(g.current!.score, 12);
  g.applyDart('S20'); // −8 → Bust
  assert.equal(g.player(lucas.id)!.score, 32, 'retour au score de début de tour');
  assert.equal(g.current!.name, 'Thomas');
  assert.equal(g.state.history[0]!.busted, true);
});

test('victoire : classement, sortie de la rotation et fin de partie', () => {
  const g = Game.create({ startScore: 501, inRule: 'straight', outRule: 'double', level: 'standard', players: ['Lucas', 'Thomas', 'Alex'] });
  const lucas = g.current!;
  lucas.score = 40;
  g.state.turn!.startScore = 40;
  g.applyDart('D20');
  assert.equal(g.player(lucas.id)!.finished, true);
  assert.equal(g.player(lucas.id)!.rank, 1);
  assert.equal(g.player(lucas.id)!.stats.checkout, 40);
  assert.equal(g.current!.name, 'Thomas');

  // Thomas termine à son tour : il ne reste qu'Alex, la partie s'arrête.
  const thomas = g.current!;
  thomas.score = 40;
  g.state.turn!.startScore = 40;
  g.applyDart('D20');
  assert.equal(g.state.status, 'finished');
  assert.equal(g.state.ranking.length, 3);
  assert.equal(g.player(g.state.ranking[2]!)!.name, 'Alex');
});

test('Undo restitue exactement l\'état précédent', () => {
  const g = newGame();
  const before = JSON.stringify(g.state);
  g.applyDart('T20');
  assert.notEqual(JSON.stringify(g.state), before);
  assert.equal(g.undo(), true);
  const after = JSON.parse(JSON.stringify(g.state));
  const expected = JSON.parse(before);
  expected.updatedAt = after.updatedAt;
  assert.deepEqual(after, expected);
});

test('Undo répare une fin de tour et une victoire', () => {
  const g = Game.create({ startScore: 501, inRule: 'straight', outRule: 'double', level: 'standard', players: ['Lucas', 'Thomas', 'Alex'] });
  const lucas = g.current!;
  lucas.score = 40;
  g.state.turn!.startScore = 40;
  g.applyDart('D20');
  assert.equal(g.state.ranking.length, 1);
  g.undo();
  assert.equal(g.state.ranking.length, 0);
  assert.equal(g.current!.name, 'Lucas');
  assert.equal(g.current!.score, 40);
  assert.equal(g.current!.finished, false);
});

test('Double In : le tour se déroule sans marquer avant le double', () => {
  const g = newGame({ startScore: 301, inRule: 'double' });
  const lucas = g.current!;
  g.applyDart('S20');
  assert.equal(g.current!.score, 301);
  assert.equal(g.current!.entered, false);
  g.applyDart('D20');
  assert.equal(g.current!.score, 261);
  assert.equal(g.current!.entered, true);
  g.applyDart('T20');
  assert.equal(g.player(lucas.id)!.score, 201);
});

test('l\'organisateur peut passer un tour et retirer un joueur', () => {
  const g = Game.create({ startScore: 301, inRule: 'straight', outRule: 'double', level: 'standard', players: ['Lucas', 'Thomas', 'Alex'] });
  assert.equal(g.skipTurn(), true);
  assert.equal(g.current!.name, 'Thomas');
  assert.equal(g.removePlayer(g.current!.id), true);
  assert.equal(g.current!.name, 'Alex');
  assert.equal(g.state.players.find((p) => p.name === 'Thomas')!.removed, true);
});

test('chaque fléchette est journalisée pour les statistiques futures', () => {
  const g = newGame();
  g.applyDart('T20');
  g.applyDart('MISS');
  assert.equal(g.state.log.length, 2);
  assert.deepEqual(
    g.state.log.map((e) => [e.code, e.kind, e.scoreBefore, e.scoreAfter]),
    [['T20', 'score', 501, 441], ['MISS', 'score', 441, 441]],
  );
  g.undo();
  assert.equal(g.state.log.length, 1, 'l\'Undo rembobine aussi le journal');
});

test('la vue expose le joueur actif, ses fléchettes et la recommandation', () => {
  const g = newGame();
  g.current!.score = 100;
  g.state.turn!.startScore = 100;
  const view = g.view();
  assert.equal(view.current.name, 'Lucas');
  assert.equal(view.current.dartsLeft, 3);
  assert.equal(view.current.recommendation.text, 'T20 → D20');
  assert.equal(view.hints[view.current.playerId!], 'T20 → D20');
  assert.equal(view.canUndo, false);
});
