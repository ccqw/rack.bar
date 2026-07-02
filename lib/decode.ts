// Decode: a Target maps to the Side Load that builds it (CONTEXT.md) -- rack.bar's
// primary direction. ADR-0002: the core is parameterized; Bar and Inventory are
// inputs with v1 defaults. ADR-0003: Decode never overshoots by default -- the
// primary suggestion is the greatest achievable Total at or under the Target, as
// the fewest Plates loaded biggest-first. ADR-0012: "achievable" includes fitting
// the Bar's sleeve -- the fill never proposes a Side Load wider than `sleeveMm`.
//
// A naive greedy heaviest-first pass is both minimal-Plate AND greatest-at-or-under
// for the standard Eleiko set, because it is a canonical coin system
// (25,20,15,10,5 = 5x{5,4,3,2,1}; the change Plates mirror that at 0.5x) -- so no
// search is needed for the UNCAPPED problem. The sleeve cap breaks that optimality
// in a narrow extreme band, where a bounded exact search takes over (see fillSide/
// searchFill and ADR-0012). A future non-canonical Inventory (finite home-gym
// counts) would revisit the loader -- out of scope here (RBAR-6).
import {
  ELEIKO_KG,
  DEFAULT_BAR_KG,
  SLEEVE_MM,
  plateFitsMm,
  totalKg,
  sideLoadKg,
} from './plates.ts';
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
   * only when `primary` lands strictly under the Target (`primary.delta < 0`) and a
   * PHYSICAL round-up exists -- the step is re-filled under the same sleeve cap and
   * kept only if it still exceeds the Target (ADR-0012), so a sleeve-full shortfall
   * carries no over. Absent for an exact (`delta == 0`) or sub-Bar (`delta > 0`)
   * Target, an empty Inventory, and -- via the early return below -- a non-finite
   * Target. Never auto-selected -- the shell offers it as a choice.
   */
  readonly over?: Loadout;
}

/**
 * Decode `target` on `bar`, drawing from `inventory`: the greatest achievable Total
 * at or under the Target, as the fewest Plates biggest-first (ADR-0003), never wider
 * than the sleeve (ADR-0012 -- `sleeveMm` is a parameter like the Bar, one constant
 * for every Bar until real per-Bar data lands). Never overshoots for any Target at
 * or above the Bar; a sub-Bar Target floors at the bare Bar (empty Side Load,
 * positive delta). Always returns a Loadout -- never null.
 */
export function decode(
  target: number,
  bar: number = DEFAULT_BAR_KG,
  inventory: readonly Plate[] = ELEIKO_KG,
  sleeveMm: number = SLEEVE_MM,
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
  const side = fillSide(sidePerHalf, inventory, sleeveMm);
  const total = totalKg(side, bar);
  const primary: Loadout = { side, total, delta: total - target };

  // The opt-in over-target alternative (ADR-0003, RBAR-11): only when `primary`
  // lands strictly under the Target -- an exact (delta 0) or sub-Bar (delta > 0)
  // Target has nothing to round up to. The least achievable Total above the Target
  // is one grid step up: `primary`'s Side Load plus the smallest denomination,
  // re-filled biggest-first so any carry collapses to the fewest Plates. An empty
  // Inventory has no denomination to step by (and `Math.min` of nothing is Infinity,
  // which would spin fillSide's loop forever), so the length guard gates the block.
  // The refill honors the same sleeve cap, so the candidate is kept only when it
  // still lands strictly ABOVE the Target -- a sleeve-full shortfall has no physical
  // round-up and carries no `over` at all (ADR-0012).
  if (primary.delta < -EPS && inventory.length > 0) {
    const step = Math.min(...inventory.map((p) => p.kg));
    const overSide = fillSide(sideLoadKg(side) + step, inventory, sleeveMm);
    const overTotal = totalKg(overSide, bar);
    if (overTotal > target + EPS) {
      return {
        primary,
        over: { side: overSide, total: overTotal, delta: overTotal - target },
      };
    }
  }

  return { primary };
}

/**
 * Fill one Side to the greatest reachable Side Load at or under `perSideKg` that
 * also fits the sleeve (ADR-0012), biggest Plate first.
 *
 * Greedy is the fast path: when the width guard never interferes this is the old
 * canonical coin problem, where heaviest-first is optimal AND fewest-Plate
 * (ADR-0003); and a greedy that lands the budget exactly cannot be beaten. But when
 * the sleeve blocks an add and greedy comes up short, greedy can be SUBOPTIMAL --
 * a heavy Plate can crowd out a denser tail (e.g. Side budget 163.5: greedy's
 * sixth red leaves 163, while 5 x 25 + 20 + 15 + 2.5 + 1 lands 163.5 in 413 mm) --
 * so a bounded exact search takes over for exactly that band (ADR-0012).
 */
function fillSide(
  perSideKg: number,
  inventory: readonly Plate[],
  sleeveMm: number,
): Plate[] {
  let remaining = perSideKg;
  let usedMm = 0;
  let capped = false; // did the sleeve ever refuse a Plate the budget allowed?
  const side: Plate[] = [];
  for (const plate of inventory) {
    while (remaining >= plate.kg - EPS) {
      if (!plateFitsMm(usedMm, plate, sleeveMm)) {
        capped = true;
        break;
      }
      side.push(plate);
      remaining -= plate.kg;
      usedMm += plate.widthMm;
    }
  }
  // Uncapped greedy is canonical-optimal; a capped greedy that still hit the budget
  // exactly is unbeatable. Only the capped-and-short band needs the exact search.
  if (!capped || remaining <= EPS) return side;
  return searchFill(perSideKg, inventory, sleeveMm, side);
}

/**
 * Exact fill for the band where the sleeve binds (ADR-0012): branch-and-bound over
 * denomination counts, heaviest denomination first, counts descending -- so the
 * first optimum found is the biggest-first canonical form, and the greedy incumbent
 * survives ties (equal sums never replace it). The admissible bound prunes any node
 * that cannot beat the incumbent even filling the rest of the sleeve with the
 * densest remaining Plate; an exact-budget hit stops the search outright. The
 * denomination list is ~10 Plates and the band is a sliver of extreme Targets, so
 * the search is small in practice; the DP oracle in decode.test locks optimality.
 */
function searchFill(
  perSideKg: number,
  inventory: readonly Plate[],
  sleeveMm: number,
  incumbent: Plate[],
): Plate[] {
  let bestSide = incumbent;
  let bestKg = sideLoadKg(incumbent);
  const n = inventory.length;
  // The best kg-per-mm density among inventory[i..]: the bound's optimistic rate.
  const densestFrom: number[] = new Array(n + 1).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    densestFrom[i] = Math.max(
      densestFrom[i + 1],
      inventory[i].kg / inventory[i].widthMm,
    );
  }
  const stack: Plate[] = [];
  const visit = (i: number, kgLeft: number, mmLeft: number, sumKg: number): void => {
    if (sumKg > bestKg + EPS) {
      bestKg = sumKg;
      bestSide = [...stack];
    }
    if (i === n || bestKg >= perSideKg - EPS) return;
    if (sumKg + Math.min(kgLeft, densestFrom[i] * mmLeft) <= bestKg + EPS) return;
    const plate = inventory[i];
    const maxCount = Math.min(
      Math.floor((kgLeft + EPS) / plate.kg),
      Math.floor((mmLeft + EPS) / plate.widthMm),
    );
    for (let count = maxCount; count >= 0; count--) {
      for (let k = 0; k < count; k++) stack.push(plate);
      visit(
        i + 1,
        kgLeft - count * plate.kg,
        mmLeft - count * plate.widthMm,
        sumKg + count * plate.kg,
      );
      for (let k = 0; k < count; k++) stack.pop();
      if (bestKg >= perSideKg - EPS) return; // exact hit: unbeatable
    }
  };
  visit(0, perSideKg, sleeveMm, 0);
  return bestSide;
}
