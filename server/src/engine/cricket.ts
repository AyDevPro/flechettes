/**
 * Cricket (règles américaines classiques).
 *
 * Secteurs en jeu : 20, 19, 18, 17, 16, 15 et le bull.
 *
 * • Chaque joueur doit « fermer » un secteur en y plaçant trois marques.
 *   Un simple vaut une marque, un double deux, un triple trois ; l'anneau
 *   extérieur du bull vaut une marque, le bull 50 en vaut deux.
 * • Une fois le secteur fermé, les marques en trop rapportent sa valeur en
 *   points — tant qu'au moins un adversaire ne l'a pas fermé.
 * • Un secteur fermé par tout le monde est « mort » : il ne rapporte plus rien.
 * • On gagne en ayant fermé les sept secteurs **et** au moins autant de points
 *   que chaque adversaire encore en lice.
 *
 * Module pur : aucune dépendance à l'état de la partie ni au réseau.
 */

import { targetByCode, type Target } from './board.ts';
import type { Level, Recommendation } from './checkout.ts';

export const CRICKET_TARGETS = [20, 19, 18, 17, 16, 15, 25];
export const MARKS_TO_CLOSE = 3;

export type Marks = Record<number, number>;

export function emptyMarks(): Marks {
  return Object.fromEntries(CRICKET_TARGETS.map((sector) => [sector, 0]));
}

export function isCricketSector(sector: number): boolean {
  return CRICKET_TARGETS.includes(sector);
}

/** Nombre de marques apportées par une fléchette (0 si la cible n'est pas en jeu). */
export function marksOf(target: Target): number {
  if (!isCricketSector(target.sector)) return 0;
  return target.sector === 25 ? (target.mult === 2 ? 2 : 1) : target.mult;
}

export function isClosed(marks: Marks, sector: number): boolean {
  return (marks[sector] ?? 0) >= MARKS_TO_CLOSE;
}

export function hasClosedAll(marks: Marks): boolean {
  return CRICKET_TARGETS.every((sector) => isClosed(marks, sector));
}

/** Vue minimale d'un joueur dont le moteur a besoin. */
export interface CricketPlayer {
  id: string;
  score: number;
  marks: Marks;
}

/** Secteur fermé par tous : il ne rapporte plus rien à personne. */
export function isDead(players: CricketPlayer[], sector: number): boolean {
  return players.every((p) => isClosed(p.marks, sector));
}

export interface CricketResolution {
  /** Secteur touché, ou `null` si la fléchette n'est pas en jeu. */
  sector: number | null;
  /** Marques réellement posées (une fois le secteur fermé, le reste part en points). */
  marksAdded: number;
  pointsAdded: number;
  /** Le secteur vient-il d'être fermé par cette fléchette ? */
  closed: boolean;
}

const NOTHING: CricketResolution = { sector: null, marksAdded: 0, pointsAdded: 0, closed: false };

/** Résout une fléchette pour un joueur donné, face à ses adversaires. */
export function resolveCricketDart(
  target: Target,
  player: CricketPlayer,
  opponents: CricketPlayer[],
): CricketResolution {
  const marks = marksOf(target);
  if (!marks) return NOTHING;

  const sector = target.sector;
  const before = player.marks[sector] ?? 0;
  const needed = Math.max(0, MARKS_TO_CLOSE - before);
  const marksAdded = Math.min(marks, needed);
  const after = before + marksAdded;
  const spare = marks - marksAdded;

  // Les marques en trop ne rapportent que si un adversaire n'a pas fermé.
  const scoring = after >= MARKS_TO_CLOSE && opponents.some((o) => !isClosed(o.marks, sector));
  return {
    sector,
    marksAdded,
    pointsAdded: scoring ? spare * sector : 0,
    closed: before < MARKS_TO_CLOSE && after >= MARKS_TO_CLOSE,
  };
}

/** Le joueur remplit-il les conditions de victoire ? */
export function hasWon(player: CricketPlayer, opponents: CricketPlayer[]): boolean {
  if (!hasClosedAll(player.marks)) return false;
  return opponents.every((o) => player.score >= o.score);
}

// ── Conseils ───────────────────────────────────────────────────────────────

const NONE: Recommendation = { kind: 'none', codes: [], labels: [], text: '—', alternatives: [] };

/**
 * Que viser maintenant ? On ferme en priorité les gros secteurs qui rapportent
 * aussi des points ; une fois tout fermé, on marque sur ce qui reste ouvert
 * chez les adversaires.
 */
export function recommendCricket(player: CricketPlayer, opponents: CricketPlayer[], level: Level): Recommendation {
  const prefix = level === 'beginner' ? 'S' : 'T';
  const aim = (sector: number, note: string): Recommendation => {
    const code = sector === 25 ? (level === 'beginner' ? 'S25' : 'D25') : `${prefix}${sector}`;
    const target = targetByCode(code);
    if (!target) return NONE;
    return { kind: 'aim', codes: [target.code], labels: [target.label], text: target.label, note, alternatives: [] };
  };

  // 1. Secteurs encore à fermer : le plus gros d'abord, en privilégiant ceux
  //    qui rapporteront des points derrière.
  const toClose = CRICKET_TARGETS
    .filter((sector) => !isClosed(player.marks, sector))
    .map((sector) => ({
      sector,
      payback: opponents.some((o) => !isClosed(o.marks, sector)),
      left: MARKS_TO_CLOSE - (player.marks[sector] ?? 0),
    }))
    // À égalité, on suit l'ordre d'usage : le 20 d'abord, le bull en dernier.
    .sort((a, b) => (Number(b.payback) - Number(a.payback))
      || (CRICKET_TARGETS.indexOf(a.sector) - CRICKET_TARGETS.indexOf(b.sector)));

  const next = toClose[0];
  if (next) {
    const label = next.sector === 25 ? 'le bull' : `le ${next.sector}`;
    const marks = next.left === 1 ? 'une marque' : `${next.left} marques`;
    return aim(next.sector, `Encore ${marks} pour fermer ${label}`);
  }

  // 2. Tout est fermé : il faut des points pour passer devant.
  // CRICKET_TARGETS est déjà dans l'ordre de préférence (20 → bull).
  const open = CRICKET_TARGETS.filter((sector) => opponents.some((o) => !isClosed(o.marks, sector)));
  const best = open[0];
  if (best !== undefined) {
    const behind = Math.max(0, ...opponents.map((o) => o.score - player.score)) + 1;
    return aim(best, `${behind} point${behind > 1 ? 's' : ''} à reprendre`);
  }

  return NONE;
}

/** Résumé lisible d'un joueur : secteurs fermés, points. */
export function closedCount(marks: Marks): number {
  return CRICKET_TARGETS.filter((sector) => isClosed(marks, sector)).length;
}
