// The kilogram plate model for rack.bar — the functional core's reference data
// (CONTEXT.md, ADR-0001). Bar weight and Inventory are first-class values here
// even though v1 fixes them (ADR-0002); the solver that consumes this lands next.

/** Eleiko/IWF plate color. Lifters name a Plate by its color (CONTEXT.md). */
export type PlateColor = 'red' | 'blue' | 'yellow' | 'green' | 'white';

export interface Plate {
  /** Weight of a single Plate, in kilograms. */
  readonly kg: number;
  /** Its color in the Eleiko scheme. */
  readonly color: PlateColor;
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
