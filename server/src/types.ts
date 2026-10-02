/** Types partagés entre le moteur, la persistance et les clients. */

import type { InRule, OutRule, ThrowKind } from './engine/rules.ts';
import type { Level, Recommendation } from './engine/checkout.ts';
import type { CricketVariant, Marks } from './engine/cricket.ts';

export type { InRule, OutRule, Level, Recommendation, ThrowKind, Marks, CricketVariant };

export type GameStatus = 'playing' | 'paused' | 'finished';

/** Mode de jeu : x01 (301/501) ou cricket. */
export type GameMode = 'x01' | 'cricket';

export interface Player {
  id: string;
  name: string;
  /** x01 : points restants. Cricket : points marqués. */
  score: number;
  /** Cricket : marques posées par secteur (0 à 3). */
  marks: Marks;
  /** Entré dans la partie (toujours vrai en Straight In). */
  entered: boolean;
  finished: boolean;
  /** Place au classement (1 = vainqueur), `null` tant que le joueur joue. */
  rank: number | null;
  /** Retiré de la partie par l'organisateur. */
  removed: boolean;
  /** Statistiques cumulées (base des stats futures, §32). */
  stats: {
    darts: number;
    points: number;
    bestTurn: number;
    turns: number;
    count100: number;
    count140: number;
    count180: number;
    doublesHit: number;
    doublesTried: number;
    checkout: number | null;
  };
}

export interface DartRecord {
  code: string;
  label: string;
  value: number;
  mult: number;
  sector: number;
  kind: ThrowKind;
  /** Score du joueur après la fléchette (score de début de tour si Bust). */
  scoreAfter: number;
  reason?: string;
  /** Cricket : marques posées et points rapportés par cette fléchette. */
  marks?: number;
  points?: number;
}

export interface Turn {
  playerId: string;
  /** Score du joueur au début du tour — valeur restaurée en cas de Bust. */
  startScore: number;
  darts: DartRecord[];
  busted: boolean;
  finished: boolean;
}

export interface TurnSummary {
  turnNo: number;
  playerId: string;
  playerName: string;
  labels: string[];
  total: number;
  /** Cricket : marques posées pendant le tour. */
  marks?: number;
  busted: boolean;
  finished: boolean;
}

export interface GameEvent {
  id: number;
  type: 'throw' | 'bust' | 'checkout' | 'bigscore' | 'turn' | 'status';
  playerId?: string;
  playerName?: string;
  value?: number;
  text?: string;
}

/** Une fléchette du journal complet de la partie (matière des stats, §32). */
export interface DartLogEntry {
  turnNo: number;
  dartNo: number;
  playerId: string;
  playerName: string;
  code: string;
  sector: number;
  mult: number;
  value: number;
  kind: ThrowKind;
  scoreBefore: number;
  scoreAfter: number;
}

export interface GameState {
  mode: GameMode;
  /** Cricket : variante de comptage (points pour soi, ou pour les adversaires). */
  variant: CricketVariant;
  createdAt: string;
  updatedAt: string;
  startScore: number;
  inRule: InRule;
  outRule: OutRule;
  level: Level;
  status: GameStatus;
  players: Player[];
  /** Ordre de passage (identifiants de joueurs). */
  order: string[];
  currentPlayerId: string | null;
  turn: Turn | null;
  turnNo: number;
  /** Identifiants des joueurs ayant terminé, dans l'ordre d'arrivée. */
  ranking: string[];
  history: TurnSummary[];
  /** Journal de toutes les fléchettes de la partie, dans l'ordre. */
  log: DartLogEntry[];
  /** Derniers évènements (animations TV) : le client joue ceux qu'il n'a pas vus. */
  events: GameEvent[];
  eventSeq: number;
}

/** Vue envoyée aux clients : l'état + ce qui en découle (recommandations). */
export interface GameView extends GameState {
  current: {
    playerId: string | null;
    name: string | null;
    score: number;
    dartsLeft: number;
    turnTotal: number;
    entered: boolean;
    recommendation: Recommendation;
  };
  canUndo: boolean;
  /** Checkout conseillé pour chaque joueur (affichage TV), `null` si hors de portée. */
  hints: Record<string, string | null>;
  /** Cricket : secteurs en jeu et secteurs morts (fermés par tout le monde). */
  cricket?: { targets: number[]; dead: number[] };
}
