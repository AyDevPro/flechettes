/**
 * Règles du moteur : entrée (Straight / Double In), sortie (Straight / Double /
 * Master / Triple Out), gestion des Busts.
 *
 * Ce module est **pur** : aucune dépendance à l'état de la partie ni au réseau.
 */

import type { Target } from './board.ts';

export type InRule = 'straight' | 'double';
export type OutRule = 'straight' | 'double' | 'master' | 'triple';

export const IN_RULES: InRule[] = ['straight', 'double'];
export const OUT_RULES: OutRule[] = ['straight', 'double', 'master', 'triple'];

export const IN_LABELS: Record<InRule, string> = {
  straight: 'Straight In',
  double: 'Double In',
};

export const OUT_LABELS: Record<OutRule, string> = {
  straight: 'Straight Out',
  double: 'Double Out',
  master: 'Master Out',
  triple: 'Triple Out',
};

/** Une fléchette permet-elle d'entrer dans la partie ? (le bull 50 est un double 25) */
export function isValidEntry(t: Target, rule: InRule): boolean {
  if (rule === 'straight') return t.value > 0;
  return t.mult === 2;
}

/** Une fléchette permet-elle de terminer exactement à zéro ? */
export function isValidFinish(t: Target, rule: OutRule): boolean {
  switch (rule) {
    case 'straight':
      return t.value > 0;
    case 'double':
      return t.mult === 2; // D1..D20 et BULL (double 25)
    case 'master':
      return t.mult === 2 || t.mult === 3;
    case 'triple':
      return t.mult === 3; // le bull n'est pas un triple
  }
}

/**
 * Plus petit score restant encore terminable selon la règle de sortie.
 * En dessous (hors zéro), la situation est un Bust immédiat.
 *   Straight Out → 1 (S1)   Double Out → 2 (D1)   Master Out → 2 (D1)   Triple Out → 3 (T1)
 */
export function minRemaining(rule: OutRule): number {
  return rule === 'straight' ? 1 : rule === 'triple' ? 3 : 2;
}

/** Plus haut score terminable avec `darts` fléchettes selon la règle de sortie. */
export function maxCheckout(rule: OutRule, darts: number): number {
  const bestFinish = rule === 'double' ? 50 : 60; // Bull 50 ; T20 = 60
  return Math.max(0, (darts - 1) * 60 + bestFinish);
}

export type ThrowKind = 'score' | 'no-count' | 'bust' | 'win';

export interface ThrowOutcome {
  kind: ThrowKind;
  /** Score du joueur après la fléchette (avant toute restauration liée au Bust). */
  scoreAfter: number;
  /** Le joueur est-il (désormais) entré dans la partie ? */
  entered: boolean;
  /** Motif du Bust, à afficher. */
  reason?: 'depassement' | 'reste-impossible' | 'sortie-invalide';
}

/**
 * Résout une fléchette isolée. Le caller reste responsable de restaurer le
 * score de début de tour lorsque `kind === 'bust'`.
 */
export function resolveDart(opts: {
  target: Target;
  scoreBefore: number;
  entered: boolean;
  inRule: InRule;
  outRule: OutRule;
}): ThrowOutcome {
  const { target, scoreBefore, entered, inRule, outRule } = opts;

  // Double In : tant que le joueur n'est pas entré, la fléchette ne compte pas.
  if (!entered) {
    if (!isValidEntry(target, inRule)) {
      return { kind: 'no-count', scoreAfter: scoreBefore, entered: false };
    }
  }

  const scoreAfter = scoreBefore - target.value;

  if (scoreAfter === 0) {
    if (isValidFinish(target, outRule)) {
      return { kind: 'win', scoreAfter: 0, entered: true };
    }
    return { kind: 'bust', scoreAfter, entered, reason: 'sortie-invalide' };
  }

  if (scoreAfter < 0) {
    return { kind: 'bust', scoreAfter, entered, reason: 'depassement' };
  }

  if (scoreAfter < minRemaining(outRule)) {
    // ex. laisser 1 point en Double Out : plus aucune sortie possible.
    return { kind: 'bust', scoreAfter, entered, reason: 'reste-impossible' };
  }

  return { kind: 'score', scoreAfter, entered: true };
}

export const BUST_LABELS: Record<NonNullable<ThrowOutcome['reason']>, string> = {
  depassement: 'Score dépassé',
  'reste-impossible': 'Reste impossible à terminer',
  'sortie-invalide': 'Sortie non conforme',
};
