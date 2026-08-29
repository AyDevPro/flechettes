/**
 * Machine à états d'une partie : tours, scores, Busts, classement, Undo.
 *
 * Toute mutation empile un instantané complet de l'état (les parties sont
 * légères) : l'Undo se réduit à un `pop`, ce qui rend triviale l'annulation
 * d'un Bust, d'un changement de joueur ou d'une victoire.
 */

import { randomBytes } from 'node:crypto';
import { targetByCode, type Target } from './engine/board.ts';
import { BUST_LABELS, resolveDart } from './engine/rules.ts';
import { isCheckable, recommend } from './engine/checkout.ts';
import type {
  DartLogEntry, DartRecord, GameEvent, GameState, GameView, InRule, Level, OutRule, Player, Turn, TurnSummary,
} from './types.ts';

const MAX_UNDO = 300;
const MAX_HISTORY = 60;
const MAX_EVENTS = 8;
const MAX_LOG = 3000;

export function makeId(size = 5): string {
  return randomBytes(size).toString('hex');
}

export interface CreateOptions {
  startScore: number;
  inRule: InRule;
  outRule: OutRule;
  level: Level;
  players: string[];
  shuffle?: boolean;
}

export interface ApplyResult {
  ok: true;
  record: DartRecord;
  turnEnded: boolean;
}

export type ActionError = { ok: false; error: string };

function newPlayer(name: string, score: number, entered: boolean): Player {
  return {
    id: makeId(),
    name,
    score,
    entered,
    finished: false,
    rank: null,
    removed: false,
    stats: {
      darts: 0, points: 0, bestTurn: 0, turns: 0,
      count100: 0, count140: 0, count180: 0,
      doublesHit: 0, doublesTried: 0, checkout: null,
    },
  };
}

export class Game {
  state: GameState;
  private undoStack: GameState[] = [];

  constructor(state: GameState) {
    this.state = state;
  }

  static create(opts: CreateOptions): Game {
    const names = opts.players.map((n) => n.trim()).filter(Boolean);
    const entered = opts.inRule === 'straight';
    const players = names.map((n) => newPlayer(n, opts.startScore, entered));
    const order = players.map((p) => p.id);
    if (opts.shuffle) {
      for (let i = order.length - 1; i > 0; i--) {
        const j = randomBytes(1)[0]! % (i + 1);
        const a = order[i]!, b = order[j]!;
        order[i] = b;
        order[j] = a;
      }
    }
    const now = new Date().toISOString();
    const state: GameState = {
      createdAt: now,
      updatedAt: now,
      startScore: opts.startScore,
      inRule: opts.inRule,
      outRule: opts.outRule,
      level: opts.level,
      status: 'playing',
      players,
      order,
      currentPlayerId: order[0] ?? null,
      turn: null,
      turnNo: 0,
      ranking: [],
      history: [],
      log: [],
      events: [],
      eventSeq: 0,
    };
    const game = new Game(state);
    if (state.currentPlayerId) game.startTurn(state.currentPlayerId);
    return game;
  }

  // ── Accès ──────────────────────────────────────────────────────────────────

  player(id: string | null): Player | null {
    if (!id) return null;
    return this.state.players.find((p) => p.id === id) ?? null;
  }

  get current(): Player | null {
    return this.player(this.state.currentPlayerId);
  }

  private contenders(): Player[] {
    return this.state.order
      .map((id) => this.player(id))
      .filter((p): p is Player => !!p && !p.finished && !p.removed);
  }

  // ── Cycle de vie d'un tour ─────────────────────────────────────────────────

  private startTurn(playerId: string): void {
    const p = this.player(playerId);
    if (!p) return;
    this.state.turnNo += 1;
    this.state.currentPlayerId = playerId;
    this.state.turn = { playerId, startScore: p.score, darts: [], busted: false, finished: false };
  }

  private pushEvent(event: Omit<GameEvent, 'id'>): void {
    this.state.eventSeq += 1;
    this.state.events.push({ id: this.state.eventSeq, ...event });
    if (this.state.events.length > MAX_EVENTS) this.state.events.shift();
  }

  private snapshot(): void {
    this.undoStack.push(structuredClone(this.state));
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
  }

  private countedTotal(turn: Turn): number {
    if (turn.busted) return 0;
    return turn.darts.reduce((sum, d) => sum + (d.kind === 'score' || d.kind === 'win' ? d.value : 0), 0);
  }

  private endTurn(): void {
    const turn = this.state.turn;
    if (!turn) return;
    const p = this.player(turn.playerId);
    const total = this.countedTotal(turn);

    if (p) {
      p.stats.turns += 1;
      p.stats.points += total;
      if (total > p.stats.bestTurn) p.stats.bestTurn = total;
      if (total >= 180) p.stats.count180 += 1;
      else if (total >= 140) p.stats.count140 += 1;
      else if (total >= 100) p.stats.count100 += 1;
    }

    const summary: TurnSummary = {
      turnNo: this.state.turnNo,
      playerId: turn.playerId,
      playerName: p?.name ?? '—',
      labels: turn.darts.map((d) => d.label),
      total,
      busted: turn.busted,
      finished: turn.finished,
    };
    this.state.history.unshift(summary);
    if (this.state.history.length > MAX_HISTORY) this.state.history.pop();

    if (!turn.busted && !turn.finished && total >= 100) {
      this.pushEvent({ type: 'bigscore', playerId: turn.playerId, playerName: p?.name, value: total });
    }

    this.advance(turn.playerId);
  }

  /** Donne la main au joueur suivant, ou clôture la partie. */
  private advance(afterPlayerId: string): void {
    const left = this.contenders();

    if (left.length === 0) return this.finishGame();
    // Dès qu'il ne reste qu'un joueur et qu'au moins un a terminé, la partie est jouée.
    if (left.length === 1 && this.state.ranking.length > 0) return this.finishGame();

    const order = this.state.order;
    const from = order.indexOf(afterPlayerId);
    for (let step = 1; step <= order.length; step++) {
      const id = order[(from + step + order.length) % order.length];
      const p = this.player(id ?? null);
      if (p && !p.finished && !p.removed) {
        this.startTurn(p.id);
        this.pushEvent({ type: 'turn', playerId: p.id, playerName: p.name });
        return;
      }
    }
    this.finishGame();
  }

  private finishGame(): void {
    // Les joueurs encore en lice sont classés derrière ceux qui ont terminé,
    // par score restant croissant.
    const left = this.contenders().sort((a, b) => a.score - b.score);
    for (const p of left) {
      p.rank = this.state.ranking.length + 1;
      this.state.ranking.push(p.id);
    }
    this.state.status = 'finished';
    this.state.turn = null;
    this.state.currentPlayerId = null;
    this.pushEvent({ type: 'status', text: 'Partie terminée' });
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  /** Enregistre une fléchette pour le joueur actif. */
  applyDart(code: string): ApplyResult | ActionError {
    if (this.state.status !== 'playing') return { ok: false, error: 'La partie n\'est pas en cours' };
    const turn = this.state.turn;
    const p = this.current;
    if (!turn || !p) return { ok: false, error: 'Aucun joueur actif' };
    if (turn.darts.length >= 3) return { ok: false, error: 'Tour déjà complet' };
    const target = targetByCode(code);
    if (!target) return { ok: false, error: `Cible inconnue : ${code}` };

    this.snapshot();

    const scoreBefore = p.score;
    const dartNo = turn.darts.length + 1;

    // Tentative de double comptabilisée pour les statistiques (§32).
    if (this.state.outRule === 'double' && p.entered && isCheckable(scoreBefore, 1, 'double')) {
      p.stats.doublesTried += 1;
    }

    const outcome = resolveDart({
      target,
      scoreBefore,
      entered: p.entered,
      inRule: this.state.inRule,
      outRule: this.state.outRule,
    });

    const record: DartRecord = {
      code: target.code,
      label: target.label,
      value: target.value,
      mult: target.mult,
      sector: target.sector,
      kind: outcome.kind,
      scoreAfter: outcome.kind === 'bust' ? turn.startScore : outcome.scoreAfter,
      ...(outcome.reason ? { reason: BUST_LABELS[outcome.reason] } : {}),
    };
    turn.darts.push(record);
    p.stats.darts += 1;
    p.entered = outcome.entered;

    let turnEnded = false;

    switch (outcome.kind) {
      case 'no-count':
        break;
      case 'score':
        p.score = outcome.scoreAfter;
        break;
      case 'bust':
        p.score = turn.startScore;
        turn.busted = true;
        this.pushEvent({ type: 'bust', playerId: p.id, playerName: p.name, text: record.reason });
        break;
      case 'win':
        p.score = 0;
        p.finished = true;
        p.rank = this.state.ranking.length + 1;
        p.stats.checkout = turn.startScore;
        if (target.mult === 2) p.stats.doublesHit += 1;
        this.state.ranking.push(p.id);
        turn.finished = true;
        this.pushEvent({ type: 'checkout', playerId: p.id, playerName: p.name, value: turn.startScore });
        break;
    }

    const entry: DartLogEntry = {
      turnNo: this.state.turnNo,
      dartNo,
      playerId: p.id,
      playerName: p.name,
      code: target.code,
      sector: target.sector,
      mult: target.mult,
      value: target.value,
      kind: outcome.kind,
      scoreBefore,
      scoreAfter: record.scoreAfter,
    };
    this.state.log.push(entry);
    if (this.state.log.length > MAX_LOG) this.state.log.shift();

    const result: ApplyResult = { ok: true, record, turnEnded: false };

    if (outcome.kind === 'bust' || outcome.kind === 'win' || turn.darts.length >= 3) {
      this.endTurn();
      turnEnded = true;
    }
    result.turnEnded = turnEnded;
    this.touch();
    return result;
  }

  /** Annule la dernière action (fléchette, tour passé, joueur retiré…). */
  undo(): boolean {
    const previous = this.undoStack.pop();
    if (!previous) return false;
    this.state = previous;
    this.touch();
    return true;
  }

  /** Termine le tour du joueur actif sans lancer les fléchettes restantes. */
  skipTurn(): boolean {
    if (this.state.status !== 'playing' || !this.state.turn) return false;
    this.snapshot();
    this.endTurn();
    this.touch();
    return true;
  }

  /** Retire un joueur de la partie (il sort de la rotation). */
  removePlayer(playerId: string): boolean {
    const p = this.player(playerId);
    if (!p || p.removed) return false;
    this.snapshot();
    p.removed = true;
    if (this.state.currentPlayerId === playerId && this.state.turn) {
      this.state.turn.darts = [];
      this.endTurn();
    } else if (this.contenders().length <= 1 && this.state.ranking.length > 0) {
      this.finishGame();
    }
    this.touch();
    return true;
  }

  setPaused(paused: boolean): boolean {
    if (this.state.status === 'finished') return false;
    this.snapshot();
    this.state.status = paused ? 'paused' : 'playing';
    this.pushEvent({ type: 'status', text: paused ? 'Partie en pause' : 'Reprise de la partie' });
    this.touch();
    return true;
  }

  endGame(): void {
    if (this.state.status === 'finished') return;
    this.snapshot();
    this.finishGame();
    this.touch();
  }

  private touch(): void {
    this.state.updatedAt = new Date().toISOString();
  }

  // ── Vue client ─────────────────────────────────────────────────────────────

  view(): GameView {
    const p = this.current;
    const turn = this.state.turn;
    const dartsLeft = turn ? 3 - turn.darts.length : 0;
    const turnTotal = turn ? this.countedTotal(turn) : 0;
    const entered = p ? p.entered : true;
    const recommendation = p && turn && this.state.status === 'playing'
      ? recommend({
          remaining: p.score,
          dartsLeft,
          inRule: this.state.inRule,
          outRule: this.state.outRule,
          entered,
          level: this.state.level,
        })
      : { kind: 'none' as const, codes: [], labels: [], text: '—', alternatives: [] };

    return {
      ...this.state,
      current: {
        playerId: p?.id ?? null,
        name: p?.name ?? null,
        score: p?.score ?? 0,
        dartsLeft,
        turnTotal,
        entered,
        recommendation,
      },
      canUndo: this.undoStack.length > 0,
      hints: Object.fromEntries(this.state.players.map((pl) => [pl.id, this.hintFor(pl)])),
    };
  }

  /** Recommandation propre à un joueur (affichage TV : checkout sous chaque score). */
  hintFor(player: Player): string | null {
    if (player.finished || player.removed || !player.entered) return null;
    if (!isCheckable(player.score, 3, this.state.outRule)) return null;
    const r = recommend({
      remaining: player.score,
      dartsLeft: 3,
      inRule: this.state.inRule,
      outRule: this.state.outRule,
      entered: player.entered,
      level: this.state.level,
    });
    return r.kind === 'checkout' ? r.text : null;
  }
}

export type { Target };
