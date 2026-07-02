// Encode: a hand-built Side Load maps back to its Total (CONTEXT.md) -- rack.bar's
// secondary direction, the inverse of decode(). The lifter taps Plates onto a Side
// and reads the running Total; tapping a loaded Plate removes it.
//
// ADR-0001 core/shell split: all the plate math lives here as pure functions; the
// shell only wires taps to them. ADR-0005: the Side Load is one value the console
// owns, and these transforms swap it wholesale -- they never mutate their input and
// always return a fresh heaviest-first array (the load order CONTEXT.md fixes for a
// Side Load, the same order the sleeve draws).
import {
  DEFAULT_BAR_KG,
  SLEEVE_MM,
  plateFitsMm,
  sideWidthMm,
  totalKg,
} from './plates.ts';
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
 * A Plate that no longer fits the sleeve (ADR-0012) is REFUSED: the result is an
 * unchanged fresh copy, mirroring removePlate's not-found no-op -- so Encode respects
 * the same physical limit as the Decode fill (the palette additionally disables
 * unfittable keys so the refusal is visible before the tap). Sorts a copy by kg so
 * the result is heaviest-first wherever the Plate slots in (the canonical set has no
 * kg ties), and the input is left untouched (ADR-0005).
 */
export function addPlate(
  side: readonly Plate[],
  plate: Plate,
  sleeveMm: number = SLEEVE_MM,
): readonly Plate[] {
  if (!plateFitsMm(sideWidthMm(side), plate, sleeveMm)) return [...side];
  return [...side, plate].sort((a, b) => b.kg - a.kg);
}

/**
 * Tap a loaded Plate off a Side Load: a new Side Load with the first Plate matching
 * `plate` (by kg and color) removed. A Plate not on the Side leaves the Side Load
 * unchanged. Order-preserving: it assumes a heaviest-first input (the console always
 * supplies one) and removes a single element without reordering, so the result is
 * heaviest-first iff the input was; the input is never mutated (ADR-0005). Removes by
 * value: for the canonical set two Plates of the same kg are identical, so no index.
 */
export function removePlate(
  side: readonly Plate[],
  plate: Plate,
): readonly Plate[] {
  const i = side.findIndex((p) => p.kg === plate.kg && p.color === plate.color);
  return i === -1 ? [...side] : [...side.slice(0, i), ...side.slice(i + 1)];
}
