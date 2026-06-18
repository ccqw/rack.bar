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
import { ELEIKO_KG, DEFAULT_BAR_KG, totalKg, sideLoadKg } from './plates.ts';
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

/** The result of decoding a Target. */
export interface Decoded {
  /** The at-or-under suggestion (ADR-0003): greatest Total <= Target, fewest Plates. */
  readonly primary: Loadout;
  /**
   * The opt-in over-target alternative (ADR-0003): the least achievable Total
   * *strictly above* the Target, fewest Plates, with a positive `delta`. Present
   * only when `primary` lands strictly under the Target (`primary.delta < 0`) and
   * the Inventory is non-empty -- so for the unlimited v1 set it appears whenever the
   * Target is off-grid. Absent for an exact (`delta == 0`) or sub-Bar (`delta > 0`)
   * Target, an empty Inventory, and -- via the early return below -- a non-finite
   * Target. Never auto-selected -- the shell offers it as a choice.
   */
  readonly over?: Loadout;
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
  const sidePerHalf = Math.max(0, (target - bar) / 2);
  const side = fillSide(sidePerHalf, inventory);
  const total = totalKg(side, bar);
  const primary: Loadout = { side, total, delta: total - target };

  // The opt-in over-target alternative (ADR-0003, RBAR-11): only when `primary`
  // lands strictly under the Target -- an exact (delta 0) or sub-Bar (delta > 0)
  // Target has nothing to round up to. The least achievable Total above the Target
  // is one grid step up: `primary`'s Side Load plus the smallest denomination,
  // re-filled biggest-first so any carry collapses to the fewest Plates. An empty
  // Inventory has no denomination to step by (and `Math.min` of nothing is Infinity,
  // which would spin fillSide's loop forever), so the length guard gates the block.
  if (primary.delta < -EPS && inventory.length > 0) {
    const step = Math.min(...inventory.map((p) => p.kg));
    const overSide = fillSide(sideLoadKg(side) + step, inventory);
    const overTotal = totalKg(overSide, bar);
    return {
      primary,
      over: { side: overSide, total: overTotal, delta: overTotal - target },
    };
  }

  return { primary };
}

/**
 * Greedily fill one Side to the greatest reachable Side Load at or under
 * `perSideKg`, biggest Plate first -- the fewest Plates for a canonical Inventory
 * (see the greedy note on `decode`).
 */
function fillSide(perSideKg: number, inventory: readonly Plate[]): Plate[] {
  let remaining = perSideKg;
  const side: Plate[] = [];
  for (const plate of inventory) {
    while (remaining >= plate.kg - EPS) {
      side.push(plate);
      remaining -= plate.kg;
    }
  }
  return side;
}
