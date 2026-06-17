// Decode: a Target maps to the Side Load that builds it (CONTEXT.md) -- rack.bar's
// primary direction. ADR-0002: the core is parameterized; Bar and Inventory are
// inputs with v1 defaults. ADR-0003: Decode never overshoots by default -- the
// primary suggestion is the greatest achievable Total at or under the Target, as
// the fewest Plates loaded biggest-first.
//
// A naive greedy heaviest-first pass is both minimal-Plate AND greatest-at-or-under
// for the standard Eleiko set, because it is a canonical coin system
// (25,20,15,10,5 = 5x{5,4,3,2,1}; the change Plates mirror that at 0.5x), so no
// search/backtracking is needed. A future non-canonical Inventory (finite home-gym
// counts) would revisit this -- out of scope here (RBAR-6).
import { ELEIKO_KG, DEFAULT_BAR_KG, totalKg } from './plates.ts';
import type { Plate } from './plates.ts';

// Our denominations are exact binary fractions, but keep a hair of tolerance so a
// future fractional Plate can't be defeated by floating-point drift.
const EPS = 1e-9;

/** One way to load the Bar: the Side Load, the Total it reaches, and the miss. */
export interface Loadout {
  /**
   * The Plates on one Side, heaviest-first. The fewest that reach `total` for a
   * canonical Inventory like the default Eleiko set (see the greedy note on
   * `decode`); a non-canonical custom Inventory may not be minimal.
   */
  readonly side: readonly Plate[];
  /** The Total actually on the Bar = Bar + 2 x Side Load (CONTEXT.md). */
  readonly total: number;
  /**
   * `total - target`: 0 when exact, negative when the achievable grid lands short.
   * Positive only when the Target is below the bare Bar (the Bar is the floor).
   */
  readonly delta: number;
}

/** The result of decoding a Target. RBAR-11 adds an opt-in over-target `alternative`. */
export interface Decoded {
  /** The at-or-under suggestion (ADR-0003): greatest Total <= Target, fewest Plates. */
  readonly primary: Loadout;
}

/**
 * Decode `target` on `bar`, drawing from `inventory`: the greatest achievable Total
 * at or under the Target, as the fewest Plates biggest-first (ADR-0003). Never
 * overshoots for any Target at or above the Bar; a sub-Bar Target floors at the bare
 * Bar (empty Side Load, positive delta). Always returns a Loadout -- never null.
 */
export function decode(
  target: number,
  bar: number = DEFAULT_BAR_KG,
  inventory: readonly Plate[] = ELEIKO_KG,
): Decoded {
  // A non-finite Target (NaN, or Infinity from a "1e999"-style entry) has no
  // achievable Total -- and an Infinity remaining would spin the greedy loop
  // forever. Degrade to the bare Bar with a zero delta (we make no claim about
  // how far off an unusable Target is).
  if (!Number.isFinite(target)) {
    return { primary: { side: [], total: bar, delta: 0 } };
  }

  // A Target is Bar + 2 x Side Load, so each Side carries half the Plate weight.
  // The bare Bar is the floor: a Target lighter than it leaves the Side empty.
  let remaining = Math.max(0, (target - bar) / 2);

  const side: Plate[] = [];
  for (const plate of inventory) {
    while (remaining >= plate.kg - EPS) {
      side.push(plate);
      remaining -= plate.kg;
    }
  }

  const total = totalKg(side, bar);
  return { primary: { side, total, delta: total - target } };
}
