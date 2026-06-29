// The kilogram plate model for rack.bar — the functional core's reference data
// (CONTEXT.md, ADR-0001). Bar weight and Inventory are first-class values here
// even though v1 fixes them (ADR-0002); the solver that consumes this lands next.
//
// kg is the canonical mass for BOTH plate sets: the iron training set (ADR-0010) is
// stamped in pounds but its masses derive from those labels via the exact factor
// (lbToKg), so it stays kg-canonical like Eleiko and the solver core is untouched.
import { lbToKg } from './units.ts';

/**
 * Plate color. Lifters name a Competition Plate by its Eleiko color (CONTEXT.md);
 * the iron training Plates (RBAR-17, ADR-0010) are a single plain-`iron` finish,
 * distinguished by their stamped lb `label` instead of color.
 */
export type PlateColor = 'red' | 'blue' | 'yellow' | 'green' | 'white' | 'iron';

export interface Plate {
  /** Weight of a single Plate, in kilograms -- always canonical, both sets. */
  readonly kg: number;
  /** Its color in the Eleiko scheme (or `iron` for the training set). */
  readonly color: PlateColor;
  /**
   * The face value stamped on the Plate, when it differs from its kg weight: the
   * iron Plates are stamped in pounds ("45", "2.5"), so the readouts and the disc
   * show this rather than the kg mass. Absent on the kg Eleiko set, whose face IS
   * its kg (derived via plateLabel). (RBAR-17, ADR-0010.)
   */
  readonly label?: string;
  /**
   * Real plate diameter, in millimetres -- drives the disc's rendered HEIGHT when
   * drawn side-on (ADR-0004). The four competition bumpers (25-10) share one 450 mm
   * diameter; only the 5 kg and the change plates step down.
   */
  readonly diameterMm: number;
  /**
   * Real plate thickness, in millimetres -- drives the disc's rendered WIDTH. Within
   * the bumper tier this (not diameter) is the size cue: a 25 is as tall as a 10,
   * just fatter (ADR-0004).
   */
  readonly widthMm: number;
}

/**
 * The v1 default Inventory: the unlimited standard Eleiko set down to 0.5 kg,
 * heaviest first (the order you actually load a Bar). The change plates mirror
 * their 10x bumper's color. The mm dimensions are the Eleiko reference table fixed
 * in ADR-0004; the precise millimetres are not load-bearing (the sleeve scales them
 * all under one fit-to-width factor) but the ladder is -- four identical 450 mm
 * bumpers, then a real step down through the smaller plates.
 */
export const ELEIKO_KG: readonly Plate[] = [
  { kg: 25, color: 'red', diameterMm: 450, widthMm: 58 },
  { kg: 20, color: 'blue', diameterMm: 450, widthMm: 50 },
  { kg: 15, color: 'yellow', diameterMm: 450, widthMm: 39 },
  { kg: 10, color: 'green', diameterMm: 450, widthMm: 35 },
  { kg: 5, color: 'white', diameterMm: 228, widthMm: 20 },
  { kg: 2.5, color: 'red', diameterMm: 207, widthMm: 15 },
  { kg: 2, color: 'blue', diameterMm: 193, widthMm: 22 },
  { kg: 1.5, color: 'yellow', diameterMm: 170, widthMm: 20 },
  { kg: 1, color: 'green', diameterMm: 148, widthMm: 19 },
  { kg: 0.5, color: 'white', diameterMm: 127, widthMm: 16 },
];

/**
 * The plain-iron training Inventory (RBAR-17, ADR-0010): the standard US gym set,
 * stamped in pounds, heaviest-first. Each Plate's true `kg` mass is DERIVED from its
 * lb `label` through the exact factor (`lbToKg`), so a whole-lb Target decodes onto
 * the grid with no float drift and the lb readout reads back exact. The mm dimensions
 * (ADR-0004) are the handoff `IRON` table; the precise values are not load-bearing
 * (the sleeve scales them under one fit factor) but the descending ladder is.
 */
export const IRON_LB: readonly Plate[] = (
  [
    ['45', 450, 50],
    ['35', 400, 44],
    ['25', 330, 34],
    ['10', 230, 24],
    ['5', 195, 20],
    ['2.5', 160, 17],
  ] as const
).map(([label, diameterMm, widthMm]) => ({
  kg: lbToKg(Number(label)),
  color: 'iron' as const,
  label,
  diameterMm,
  widthMm,
}));

/** Default Bar weight (men's, kg). Swappable later (ADR-0002, ROADMAP). */
export const DEFAULT_BAR_KG = 20;

/** Total weight of a Side Load — the Plates on one Side — in kilograms. */
export function sideLoadKg(plates: readonly Plate[]): number {
  return plates.reduce((sum, p) => sum + p.kg, 0);
}

/** The Total actually on the Bar = Bar weight + 2 x Side Load (CONTEXT.md). */
export function totalKg(
  sideLoad: readonly Plate[],
  barKg: number = DEFAULT_BAR_KG,
): number {
  return barKg + 2 * sideLoadKg(sideLoad);
}

/**
 * The effective Bar baseline the solver loads from when a Collar is fitted
 * (ADR-0008): `Bar + 2 x Collar`. A Collar is weight on the Bar before any Plate
 * -- one per Side, like the Bar itself -- so it folds into the parameterized Bar
 * input ADR-0002 already provides rather than a separate solver argument. Feeding
 * this to `decode`/`encode`/`totalKg` yields the full `Bar + 2 x Collar + 2 x Side
 * Load` Total with the greedy loader unchanged. `collarKg` of 0 (None) is the bare
 * Bar.
 */
export function barWithCollars(barKg: number, collarKg: number): number {
  return barKg + 2 * collarKg;
}
