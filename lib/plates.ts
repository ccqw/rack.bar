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
}

/**
 * The v1 default Inventory: the unlimited standard Eleiko set down to 0.5 kg,
 * heaviest first (the order you actually load a Bar). The change plates mirror
 * their 10x bumper's color.
 */
export const ELEIKO_KG: readonly Plate[] = [
  { kg: 25, color: 'red' },
  { kg: 20, color: 'blue' },
  { kg: 15, color: 'yellow' },
  { kg: 10, color: 'green' },
  { kg: 5, color: 'white' },
  { kg: 2.5, color: 'red' },
  { kg: 2, color: 'blue' },
  { kg: 1.5, color: 'yellow' },
  { kg: 1, color: 'green' },
  { kg: 0.5, color: 'white' },
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
