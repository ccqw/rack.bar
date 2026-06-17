// Decode: a Target maps to the Side Load that builds it (CONTEXT.md) -- rack.bar's
// primary direction. ADR-0002: the core is parameterized; Bar and Inventory are
// inputs with v1 defaults. ADR-0003: the canonical pick is the fewest Plates,
// loaded biggest-first.
//
// WALKING SKELETON (RBAR-2): exact Targets only -- a naive greedy heaviest-first
// pass returning the exact Side Load when the Target lands on the achievable grid,
// or null when it does not. Greedy is both exact and canonical for the Eleiko set
// (every Plate is a multiple of 0.5 kg). RBAR-6 deepens this into nearest-at-or-
// under with delta and edge handling; the signature is meant to hold.
import { ELEIKO_KG, DEFAULT_BAR_KG } from './plates.ts';
import type { Plate } from './plates.ts';

// Our denominations are exact binary fractions, but keep a hair of tolerance so a
// future fractional Plate can't be defeated by floating-point drift.
const EPS = 1e-9;

/**
 * The Side Load that exactly reaches `target` on `bar`, drawn from `inventory`
 * (heaviest-first), as the fewest Plates biggest-first. Null when the Target is
 * below the bare Bar or not exactly buildable from the Inventory.
 */
export function decode(
  target: number,
  bar: number = DEFAULT_BAR_KG,
  inventory: readonly Plate[] = ELEIKO_KG,
): Plate[] | null {
  // A Target is Bar + 2 x Side Load, so each Side carries half the Plate weight.
  let remaining = (target - bar) / 2;
  if (remaining < -EPS) return null;

  const sideLoad: Plate[] = [];
  for (const plate of inventory) {
    while (remaining >= plate.kg - EPS) {
      sideLoad.push(plate);
      remaining -= plate.kg;
    }
  }
  // Any leftover means the grid cannot hit this Target exactly.
  return Math.abs(remaining) <= EPS ? sideLoad : null;
}
