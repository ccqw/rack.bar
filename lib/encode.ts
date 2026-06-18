// Encode: a hand-built Side Load maps back to its Total (CONTEXT.md) -- rack.bar's
// secondary direction, the inverse of decode(). The lifter taps Plates onto a Side
// and reads the running Total; tapping a loaded Plate removes it.
//
// ADR-0001 core/shell split: all the plate math lives here as pure functions; the
// shell only wires taps to them. ADR-0005: the Side Load is one value the console
// owns, and these transforms swap it wholesale -- they never mutate their input and
// always return a fresh heaviest-first array (the load order CONTEXT.md fixes for a
// Side Load, the same order the sleeve draws).
import { DEFAULT_BAR_KG, totalKg } from './plates.ts';
import type { Plate } from './plates.ts';

/**
 * The Total a hand-built Side Load reaches = Bar + 2 x Side Load (CONTEXT.md). An
 * empty Side Load reads as the bare Bar. This is the Encode direction's reading of
 * `totalKg` -- named to mirror `decode`; the Bar stays a parameter (ADR-0002).
 */
export function encode(
  side: readonly Plate[],
  bar: number = DEFAULT_BAR_KG,
): number {
  return totalKg(side, bar);
}

/**
 * Tap a Plate onto a Side Load: a new heaviest-first Side Load with `plate` added.
 * Sorts a copy so the result is heaviest-first wherever the Plate slots in, and the
 * input is left untouched (ADR-0005).
 */
export function addPlate(side: readonly Plate[], plate: Plate): Plate[] {
  return [...side, plate].sort((a, b) => b.kg - a.kg);
}

/**
 * Tap a loaded Plate off a Side Load: a new Side Load with the first Plate matching
 * `plate` (by kg and color) removed. A Plate not on the Side leaves the Side Load
 * unchanged. The result stays heaviest-first because the input was, and the input is
 * never mutated (ADR-0005). Removes a single match by value: for the canonical set
 * two Plates of the same kg are identical, so "remove a 25" needs no index.
 */
export function removePlate(side: readonly Plate[], plate: Plate): Plate[] {
  const i = side.findIndex((p) => p.kg === plate.kg && p.color === plate.color);
  return i === -1 ? [...side] : [...side.slice(0, i), ...side.slice(i + 1)];
}
