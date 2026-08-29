/**
 * Moteur de recommandation : quelles cibles viser pour finir la manche ?
 *
 * Trois étages :
 *   1. `findRoutes`  — énumère toutes les routes valides (1 à 3 fléchettes) qui
 *                      tombent exactement à zéro en respectant la règle de sortie.
 *   2. `bestRoutes`  — les classe selon un coût dépendant du niveau choisi
 *                      (Débutant / Standard / Expert).
 *   3. `recommend`   — décide quoi afficher : entrée (Double In), checkout, ou
 *                      préparation quand le score est encore trop élevé.
 *
 * Le classement n'essaie pas de retirer un maximum de points : il pondère la
 * difficulté des cibles, la qualité du double final et ce que laisse une
 * fléchette manquée (§17 et §25 du cahier des charges).
 */

import { TARGETS, targetByCode, type Target } from './board.ts';
import { isValidFinish, maxCheckout, minRemaining, type InRule, type OutRule } from './rules.ts';
import { classicRoute } from './classic.ts';

export type Level = 'beginner' | 'standard' | 'expert';
export const LEVELS: Level[] = ['beginner', 'standard', 'expert'];
export const LEVEL_LABELS: Record<Level, string> = {
  beginner: 'Débutant',
  standard: 'Standard',
  expert: 'Expert',
};

// ── Difficulté des cibles ────────────────────────────────────────────────────

const BASE_COST: Record<string, number> = { single: 1, s25: 1.9, double: 2.4, triple: 2.6, bull: 3.2 };

/** Doubles les plus « propres » à viser (0 = facile). */
const DOUBLE_HARDNESS: Record<number, number> = {
  20: 0, 16: 0.05, 8: 0.15, 10: 0.2, 4: 0.25, 12: 0.25, 18: 0.25, 2: 0.35, 6: 0.4,
  14: 0.4, 1: 0.5, 15: 0.6, 19: 0.6, 9: 0.65, 5: 0.7, 7: 0.7, 11: 0.7, 17: 0.7,
  3: 0.8, 13: 0.8, 25: 0.9,
};

/** Triples les plus travaillés par les joueurs (0 = facile). */
const TRIPLE_HARDNESS: Record<number, number> = {
  20: 0, 19: 0.1, 18: 0.15, 17: 0.2, 16: 0.2, 15: 0.3, 14: 0.3, 13: 0.35,
  12: 0.4, 11: 0.4, 10: 0.45,
};

/** Multiplicateurs par niveau : un débutant paie très cher un triple. */
const LEVEL_WEIGHTS: Record<Level, { single: number; double: number; triple: number; bull: number; s25: number }> = {
  beginner: { single: 0.85, double: 1.15, triple: 2.6, bull: 2.2, s25: 1.8 },
  standard: { single: 1, double: 1, triple: 1, bull: 1, s25: 1 },
  expert: { single: 1, double: 0.95, triple: 0.85, bull: 0.9, s25: 1 },
};

/** Chaque fléchette supplémentaire coûte plus que n'importe quel écart de difficulté. */
const DART_COST = 6;

/** Poids des points marqués lors d'un tour de préparation, par niveau. */
const POINT_WEIGHT: Record<Level, number> = { beginner: 0.1, standard: 0.25, expert: 0.28 };

function targetCost(t: Target, level: Level): number {
  const w = LEVEL_WEIGHTS[level];
  if (t.sector === 25) {
    return t.mult === 2 ? BASE_COST.bull! * w.bull + DOUBLE_HARDNESS[25]! : BASE_COST.s25! * w.s25;
  }
  if (t.mult === 3) return (BASE_COST.triple! + (TRIPLE_HARDNESS[t.sector] ?? 0.55)) * w.triple;
  if (t.mult === 2) return (BASE_COST.double! + (DOUBLE_HARDNESS[t.sector] ?? 0.7)) * w.double;
  return BASE_COST.single! * w.single;
}

// ── Recherche des routes ─────────────────────────────────────────────────────

const FINISH_BY_VALUE: Record<OutRule, Map<number, Target[]>> = (() => {
  const rules: OutRule[] = ['straight', 'double', 'master', 'triple'];
  const out = {} as Record<OutRule, Map<number, Target[]>>;
  for (const rule of rules) {
    const map = new Map<number, Target[]>();
    for (const t of TARGETS) {
      if (!isValidFinish(t, rule)) continue;
      const bucket = map.get(t.value);
      if (bucket) bucket.push(t);
      else map.set(t.value, [t]);
    }
    out[rule] = map;
  }
  return out;
})();

const existsCache = new Map<string, boolean>();

/** Existe-t-il au moins une sortie pour ce score avec ce nombre de fléchettes ? */
export function isCheckable(remaining: number, darts: number, out: OutRule): boolean {
  if (remaining <= 0 || darts <= 0) return false;
  if (remaining < minRemaining(out)) return false;
  if (remaining > maxCheckout(out, darts)) return false;
  const key = `${remaining}|${darts}|${out}`;
  const hit = existsCache.get(key);
  if (hit !== undefined) return hit;
  let found = FINISH_BY_VALUE[out].has(remaining);
  if (!found && darts > 1) {
    for (const t of TARGETS) {
      const rest = remaining - t.value;
      if (rest < minRemaining(out) || rest > maxCheckout(out, darts - 1)) continue;
      if (isCheckable(rest, darts - 1, out)) {
        found = true;
        break;
      }
    }
  }
  existsCache.set(key, found);
  return found;
}

/** Toutes les routes (≤ `darts` fléchettes) terminant exactement à zéro. */
export function findRoutes(remaining: number, darts: number, out: OutRule): Target[][] {
  const results: Target[][] = [];
  const walk = (rem: number, left: number, acc: Target[]): void => {
    const finishers = FINISH_BY_VALUE[out].get(rem);
    if (finishers) for (const t of finishers) results.push([...acc, t]);
    if (left <= 1) return;
    for (const t of TARGETS) {
      const rest = rem - t.value;
      if (rest < minRemaining(out) || rest > maxCheckout(out, left - 1)) continue;
      if (!isCheckable(rest, left - 1, out)) continue;
      walk(rest, left - 1, [...acc, t]);
    }
  };
  if (remaining > 0 && darts > 0) walk(remaining, darts, []);
  return results;
}

const optionsCache = new Map<string, number>();

/**
 * Nombre de sorties distinctes en deux fléchettes — mesure la « souplesse » d'un
 * score : laisser 2 (seulement D1) est bien plus fragile que laisser 48.
 */
export function finishOptions(remaining: number, out: OutRule): number {
  if (remaining <= 0) return 0;
  const key = `${remaining}|${out}`;
  const cached = optionsCache.get(key);
  if (cached !== undefined) return cached;
  const count = findRoutes(remaining, 2, out).length;
  optionsCache.set(key, count);
  return count;
}

// ── Classement ───────────────────────────────────────────────────────────────

export interface ScoredRoute {
  codes: string[];
  labels: string[];
  text: string;
  darts: number;
  /** Coût global : sert à choisir la route à proposer maintenant. */
  cost: number;
  /** Coût des cibles seules, sans le prix des fléchettes utilisées : sert à
   *  juger la qualité d'un score laissé (là, le nombre de fléchettes importe peu). */
  quality: number;
}

function routeCost(route: Target[], remaining: number, level: Level, out: OutRule): number {
  let cost = DART_COST * route.length;
  let rem = remaining;
  const sectors = new Set<number>();

  route.forEach((t, i) => {
    const last = i === route.length - 1;
    cost += targetCost(t, level);
    sectors.add(t.sector);

    if (!last) {
      if (t.mult >= 2) {
        // Conséquence d'un lancer imparfait : triple ou double manqué finit en
        // simple. La route reste-t-elle jouable avec les fléchettes restantes ?
        const after = rem - t.sector;
        const dartsAfter = route.length - i - 1;
        if (!isCheckable(after, dartsAfter, out)) cost += level === 'beginner' ? 1.6 : 1;
        // Viser un double pour marquer (et non pour sortir) est un mauvais plan.
        if (t.mult === 2) cost += level === 'beginner' ? 1.8 : 1.2;
      }
    } else if (t.mult === 2 && t.sector !== 25) {
      // Qualité du double final : un D16 manqué laisse 16, puis D8, D4, D2, D1.
      // Plus le secteur se divise par deux, plus l'erreur reste rattrapable (§24).
      let chain = 0;
      for (let n = t.sector; n % 2 === 0; n /= 2) chain += 1;
      cost -= chain * (level === 'beginner' ? 0.22 : 0.14);
      if (t.sector === 20 && level !== 'beginner') cost -= 0.3; // le double le plus travaillé
    }
    rem -= t.value;
  });

  // Simplicité : rester dans le même secteur est plus facile à comprendre.
  const spread = sectors.size - 1;
  cost += (level === 'beginner' ? 0.45 : level === 'standard' ? 0.15 : 0.05) * spread;
  return cost;
}

function toScored(route: Target[], remaining: number, level: Level, out: OutRule): ScoredRoute {
  const labels = route.map((t) => t.label);
  const cost = routeCost(route, remaining, level, out);
  return {
    codes: route.map((t) => t.code),
    labels,
    text: labels.join(' → '),
    darts: route.length,
    cost,
    quality: cost - DART_COST * route.length,
  };
}

const bestCache = new Map<string, ScoredRoute[]>();

/** Les meilleures routes classées, la première étant la recommandation. */
export function bestRoutes(remaining: number, darts: number, out: OutRule, level: Level, limit = 4): ScoredRoute[] {
  const key = `${remaining}|${darts}|${out}|${level}`;
  const cached = bestCache.get(key);
  if (cached) return cached.slice(0, limit);
  const scored = findRoutes(remaining, darts, out)
    .map((r) => toScored(r, remaining, level, out))
    .sort((a, b) => a.cost - b.cost);
  // Une seule route par « première cible + longueur » : évite dix variantes du même plan.
  const seen = new Set<string>();
  const top: ScoredRoute[] = [];
  for (const r of scored) {
    const sig = `${r.codes[0]}|${r.darts}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    top.push(r);
    if (top.length >= 6) break;
  }
  bestCache.set(key, top);
  return top.slice(0, limit);
}

// ── Préparation quand la sortie n'est pas encore possible ────────────────────

/** Scores qu'aucune sortie en trois fléchettes ne permet de terminer (Double Out). */
const BOGEY = new Set([169, 168, 166, 165, 163, 162, 159]);

/** Cibles proposées pour marquer, par niveau. */
const SCORING_CANDIDATES: Record<Level, string[]> = {
  beginner: ['S20', 'S19', 'S18', 'S17', 'S16', 'S25', 'T20', 'S15', 'S14', 'S13', 'S12', 'S11', 'S10', 'S9', 'S8', 'S7', 'S6', 'S5', 'S4', 'S3', 'S2', 'S1'],
  standard: ['T20', 'T19', 'T18', 'T17', 'S20', 'S19', 'T16', 'T15', 'S25', 'D25', 'S18', 'S17', 'S16', 'S15', 'S14', 'S13', 'S12', 'S11', 'S10', 'S9', 'S8', 'S7', 'S6', 'S5', 'S4', 'S3', 'S2', 'S1', 'D20', 'D19', 'D18', 'D16'],
  expert: ['T20', 'T19', 'T18', 'T17', 'T16', 'T15', 'T14', 'T13', 'S20', 'S19', 'D25', 'S25', 'S18', 'S17', 'S16', 'S15', 'S14', 'S13', 'S12', 'S11', 'S10', 'S9', 'S8', 'S7', 'S6', 'S5', 'S4', 'S3', 'S2', 'S1', 'D20', 'D19', 'D18', 'D16'],
};

/**
 * Qualité d'un score laissé : très haute s'il se termine dans le tour, bonne
 * s'il laisse un checkout confortable au tour suivant, mauvaise sur un bogey.
 */
function leaveQuality(rest: number, dartsLeft: number, out: OutRule, level: Level): number {
  if (rest < 0) return -Infinity;
  if (rest === 0) return -Infinity; // un zéro non conforme serait un Bust
  if (rest < minRemaining(out)) return -Infinity;

  if (dartsLeft > 0 && isCheckable(rest, dartsLeft, out)) {
    const best = bestRoutes(rest, dartsLeft, out, level, 1)[0];
    return 1000 - (best ? best.cost * 6 : 0);
  }

  if (isCheckable(rest, 3, out)) {
    // Sortable au tour suivant : on privilégie le reste le plus confortable.
    // On juge la difficulté des cibles, pas le nombre de fléchettes : laisser 2
    // (donc D1) est pire que laisser 42 (10 puis D16) même si c'est plus court.
    const best = bestRoutes(rest, 3, out, level, 1)[0];
    let q = 500 - (best ? best.quality * 8 + best.darts * 2 : 0);
    q += Math.min(finishOptions(rest, out), 12) * 1.5; // plus de chemins = reste plus sûr
    if (out !== 'straight' && rest % 2 === 1) q -= 12; // un impair complique le double
    return q;
  }
  // Encore hors de portée : on descend, en évitant les scores injouables.
  return 200 - Math.min(rest, 500) / 8 - (BOGEY.has(rest) ? 90 : 0);
}

interface SetupPlan {
  targets: Target[];
  rest: number;
  /** La suite du tour permet-elle de sortir ? */
  finishable: boolean;
}

const setupCache = new Map<string, SetupPlan>();

/**
 * Plan de préparation : on explore les combinaisons de cibles « à marquer » pour
 * les fléchettes du tour et on garde celle qui laisse le meilleur score — soit
 * une sortie atteignable dans le tour, soit un reste confortable au tour suivant.
 * À valeur égale, les grosses cibles sont jouées en premier (usage courant).
 */
function planSetup(remaining: number, darts: number, out: OutRule, level: Level): SetupPlan {
  const key = `${remaining}|${darts}|${out}|${level}`;
  const cached = setupCache.get(key);
  if (cached) return cached;

  const candidates = SCORING_CANDIDATES[level]
    .map((code) => targetByCode(code))
    .filter((t): t is Target => t !== null);

  type Scored = SetupPlan & { score: number };
  const found: { best: Scored | null } = { best: null };
  const keep = (plan: Scored) => {
    if (!found.best || plan.score > found.best.score) found.best = plan;
  };

  const walk = (rem: number, left: number, acc: Target[], bonus: number): void => {
    if (left === 0) {
      keep({ targets: acc, rest: rem, finishable: false, score: leaveQuality(rem, 0, out, level) + bonus });
      return;
    }
    for (const t of candidates) {
      const rest = rem - t.value;
      if (rest <= 0 || rest < minRemaining(out)) continue; // Bust : jamais conseillé
      // Marquer reste le but d'un tour de préparation, mais la difficulté de la
      // cible compte (un débutant ne se voit pas conseiller un triple) et viser
      // un double pour marquer est un mauvais plan. À valeur égale, les grosses
      // cibles se jouent en premier.
      const nextBonus = bonus
        + t.value * POINT_WEIGHT[level]
        - targetCost(t, level) * (level === 'beginner' ? 2 : 1.2)
        - (t.mult === 2 ? (level === 'beginner' ? 3.5 : 2.5) : 0)
        + t.value * left * 0.002;
      if (isCheckable(rest, left - 1, out)) {
        // Sortie possible avec les fléchettes qui restent : on s'arrête là.
        const route = bestRoutes(rest, left - 1, out, level, 1)[0];
        keep({ targets: [...acc, t], rest, finishable: true, score: 2000 - (route ? route.quality * 8 : 0) + nextBonus });
        continue;
      }
      walk(rest, left - 1, [...acc, t], nextBonus);
    }
  };

  walk(remaining, Math.min(darts, 3), [], 0);
  const best = found.best;
  const plan: SetupPlan = best
    ? { targets: best.targets, rest: best.rest, finishable: best.finishable }
    : { targets: [], rest: remaining, finishable: false };
  setupCache.set(key, plan);
  return plan;
}

// ── API publique ─────────────────────────────────────────────────────────────

export type RecommendationKind = 'entry' | 'checkout' | 'setup' | 'none';

export interface Recommendation {
  kind: RecommendationKind;
  /** Codes canoniques des cibles conseillées. */
  codes: string[];
  /** Libellés à afficher, ex. `['T20', 'D20']`. */
  labels: string[];
  /** Texte prêt à afficher, ex. `T20 → D20`. */
  text: string;
  /** Explication courte affichée sous la recommandation. */
  note?: string;
  /** Autres routes possibles, classées. */
  alternatives: { labels: string[]; text: string }[];
}

const NONE: Recommendation = { kind: 'none', codes: [], labels: [], text: '—', alternatives: [] };

export function recommend(opts: {
  remaining: number;
  dartsLeft: number;
  inRule: InRule;
  outRule: OutRule;
  entered: boolean;
  level: Level;
}): Recommendation {
  const { remaining, dartsLeft, inRule, outRule, entered, level } = opts;
  if (remaining <= 0 || dartsLeft <= 0) return NONE;

  // Double In : tant que le joueur n'est pas entré, rien d'autre ne compte.
  if (!entered && inRule === 'double') {
    const t = targetByCode('D20')!;
    return {
      kind: 'entry',
      codes: [t.code],
      labels: [t.label],
      text: t.label,
      note: 'Touchez un double pour entrer dans la partie',
      alternatives: [
        { labels: ['D16'], text: 'D16' },
        { labels: ['BULL'], text: 'BULL' },
      ],
    };
  }

  // Route classique (Double Out) pour les niveaux Standard et Expert.
  if (outRule === 'double' && level !== 'beginner') {
    const classic = classicRoute(remaining);
    if (classic && classic.length <= dartsLeft) {
      const targets = classic.map((c) => targetByCode(c)).filter((t): t is Target => t !== null);
      if (targets.length === classic.length) {
        const labels = targets.map((t) => t.label);
        const alts = bestRoutes(remaining, dartsLeft, outRule, level, 3)
          .filter((r) => r.codes.join() !== targets.map((t) => t.code).join())
          .slice(0, 2)
          .map((r) => ({ labels: r.labels, text: r.text }));
        return {
          kind: 'checkout',
          codes: targets.map((t) => t.code),
          labels,
          text: labels.join(' → '),
          note: `Sortie en ${targets.length} fléchette${targets.length > 1 ? 's' : ''}`,
          alternatives: alts,
        };
      }
    }
  }

  if (isCheckable(remaining, dartsLeft, outRule)) {
    const routes = bestRoutes(remaining, dartsLeft, outRule, level, 3);
    const best = routes[0];
    if (best) {
      return {
        kind: 'checkout',
        codes: best.codes,
        labels: best.labels,
        text: best.text,
        note: `Sortie en ${best.darts} fléchette${best.darts > 1 ? 's' : ''}`,
        alternatives: routes.slice(1).map((r) => ({ labels: r.labels, text: r.text })),
      };
    }
  }

  // Pas de sortie possible ce tour-ci : on prépare le tour suivant.
  const plan = planSetup(remaining, dartsLeft, outRule, level);
  if (plan.targets.length === 0) return NONE;
  const labels = plan.targets.map((t) => t.label);
  const note = plan.finishable
    ? `Puis sortie sur ${plan.rest}`
    : isCheckable(plan.rest, 3, outRule)
      ? `Laisse ${plan.rest}, sortable au prochain tour`
      : `Laisse ${plan.rest}`;
  return {
    kind: 'setup',
    codes: plan.targets.map((t) => t.code),
    labels,
    text: labels.join(' → '),
    note,
    alternatives: [],
  };
}

/** Vide les caches internes (utile aux tests). */
export function resetCaches(): void {
  existsCache.clear();
  bestCache.clear();
  setupCache.clear();
  optionsCache.clear();
}
