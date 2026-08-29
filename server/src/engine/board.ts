/**
 * Représentation de la cible : toutes les zones marquables d'un jeu de fléchettes.
 *
 * Codes canoniques (utilisés partout : API, WebSocket, base de données) :
 *   MISS            → raté, 0 point
 *   S1..S20         → simple 1 à 20
 *   D1..D20         → double 1 à 20
 *   T1..T20         → triple 1 à 20
 *   S25             → anneau extérieur du bull, 25 points
 *   D25             → bull, 50 points, compté comme un double 25
 */

export type Multiplier = 0 | 1 | 2 | 3;

export interface Target {
  /** Code canonique, ex. `T20`. */
  code: string;
  /** Libellé court affiché à l'écran, ex. `T20`, `25`, `BULL`. */
  label: string;
  /** Secteur touché (1-20, ou 25 pour le bull). 0 pour un raté. */
  sector: number;
  /** Multiplicateur : 1 simple, 2 double, 3 triple, 0 raté. */
  mult: Multiplier;
  /** Points marqués. */
  value: number;
}

export const MISS: Target = { code: 'MISS', label: 'RATÉ', sector: 0, mult: 0, value: 0 };

function make(code: string, label: string, sector: number, mult: Multiplier): Target {
  return { code, label, sector, mult, value: sector * mult };
}

/** Toutes les zones marquables, raté exclu. */
export const TARGETS: Target[] = (() => {
  const list: Target[] = [];
  for (let n = 1; n <= 20; n++) list.push(make(`S${n}`, `${n}`, n, 1));
  for (let n = 1; n <= 20; n++) list.push(make(`D${n}`, `D${n}`, n, 2));
  for (let n = 1; n <= 20; n++) list.push(make(`T${n}`, `T${n}`, n, 3));
  list.push(make('S25', '25', 25, 1));
  list.push(make('D25', 'BULL', 25, 2));
  return list;
})();

const BY_CODE = new Map<string, Target>([[MISS.code, MISS], ...TARGETS.map((t) => [t.code, t] as const)]);

/** Résout un code canonique. Renvoie `null` si le code est inconnu. */
export function targetByCode(code: string): Target | null {
  return BY_CODE.get(String(code ?? '').trim().toUpperCase()) ?? null;
}

/** Toutes les valeurs distinctes atteignables avec une fléchette (0 exclu). */
export const VALUES = [...new Set(TARGETS.map((t) => t.value))].sort((a, b) => a - b);

/** Zones ayant exactement cette valeur, ex. 40 → [D20], 60 → [S20*3? non] → [T20]. */
export function targetsWithValue(value: number): Target[] {
  return TARGETS.filter((t) => t.value === value);
}
