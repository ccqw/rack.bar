// Decode: a Target maps to the Side Load that builds it (CONTEXT.md) -- rack.bar's
// primary direction. ADR-0002: the core is parameterized; Bar and Inventory are
// inputs with v1 defaults. ADR-0003: Decode never overshoots by default -- the
// primary suggestion is the greatest achievable Total at or under the Target, as
// the fewest Plates loaded biggest-first. ADR-0012: "achievable" includes fitting
// the Bar's sleeve -- the fill never proposes a Side Load wider than `sleeveMm`.
//
// Which Plates make up a Side is the exact search in sideloads.ts (RBAR-69, the
// ADR-0003 amendment of 2026-10-16): fewest Plates, ties broken heaviest-first, within
// the Sleeve, for any Inventory. Until RBAR-69 this was a heaviest-first greedy pass,
// which is fewest-Plate on the Eleiko set but not on the iron one (a 60 lb Side is
// 35 + 25, not greedy's 45 + 10 + 5); the search returns greedy's exact answer
// wherever greedy was already fewest-Plate.
import { ELEIKO_KG, DEFAULT_BAR_KG, SLEEVE_MM, totalKg } from './plates.ts';
import type { InventoryEntry, Plate } from './plates.ts';
import { hasUsablePlates, sideAtOrUnder, sideAbove } from './sideloads.ts';

// Our denominations are exact binary fractions, but keep a hair of tolerance so a
// future fractional Plate can't be defeated by floating-point drift.
const EPS = 1e-9;

/** One way to load the Bar: the Side Load, the Total it reaches, and the miss. */
export interface Loadout {
  /**
   * The Plates on one Side, heaviest-first: the fewest that reach `total` within the
   * Sleeve, and among equally few the heaviest-first stack (sideloads.ts sideLoads).
   */
  readonly side: readonly Plate[];
  /** The Total actually on the Bar = Bar + 2 x Side Load (CONTEXT.md). */
  readonly total: number;
  /**
   * `total - target`, always against the real Target: 0 when exact, negative when the
   * achievable grid lands short, positive when the Target is below the bare Bar (the
   * Bar is the floor). From `decodeWithin` it can also be a hair positive -- a load
   * inside the Target's displayed reading (RBAR-60) -- so the shell judges
   * exact/short/over from the DISPLAYED numbers, never from this sign (ADR-0010).
   */
  readonly delta: number;
}

/** The result of decoding a Target. */
export interface Decoded {
  /**
   * The at-or-under suggestion (ADR-0003): the greatest Total at or under the solve
   * ceiling, fewest Plates. For `decode` the ceiling is the Target; for `decodeWithin`
   * it is the top of the Target's displayed reading (RBAR-60).
   */
  readonly primary: Loadout;
  /**
   * The opt-in over-target alternative (ADR-0003): the least achievable Total
   * *strictly above* the solve ceiling, fewest Plates, with a positive `delta`.
   * Present only when `primary` lands strictly under the ceiling and a PHYSICAL
   * round-up exists -- the least Side sum above the budget that some stack loads
   * within the Sleeve (sideloads.ts sideAbove; in the sleeve-bound band that can be
   * several grid steps up, RBAR-62), so a sleeve-full shortfall carries no over.
   * Absent for a primary exactly on the ceiling (an exact `decode`), a sub-Bar
   * Target, an empty Inventory, and -- via the early return below -- a non-finite
   * Target. Note a `decodeWithin` primary sits just under its ceiling, so it usually
   * carries an over even when it DISPLAYS exact; the shell hides the offer then.
   * Never auto-selected -- the shell offers it as a choice.
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
 *
 * `inventory` entries may carry Plate limits (ADR-0016, `withLimits`): no Loadout ever
 * holds more of a size than its `maxPerSide`, and the primary and round-up are the same
 * exact picks made among the stacks the limits allow. A Target the limits cannot reach
 * falls back at or under it (ADR-0003); past every pair on hand there is no `over`.
 *
 * Throws a RangeError (from sideloads.ts) only for malformed rig data: a Plate with a
 * non-positive or non-finite mass or width, a Plate limit that is not a whole count,
 * Plates with no common grid, or a Sleeve that is not a positive finite length. No
 * shipped set, single-size reduction of one, or the default Sleeve can (test-locked),
 * so the shell never sees it.
 */
export function decode(
  target: number,
  bar: number = DEFAULT_BAR_KG,
  inventory: readonly InventoryEntry[] = ELEIKO_KG,
  sleeveMm: number = SLEEVE_MM,
): Decoded {
  // A non-finite Target (NaN, or Infinity from a "1e999"-style entry) has no
  // achievable Total -- and an Infinity budget would walk the fill's grid forever.
  // Degrade to the bare Bar with a zero delta (we make no claim about how far off an
  // unusable Target is).
  if (!Number.isFinite(target)) {
    return { primary: { side: [], total: bar, delta: 0 } };
  }

  // A Target is Bar + 2 x Side Load, so each Side carries half the Plate weight.
  // The bare Bar is the floor: a Target lighter than it leaves the Side empty.
  const sidePerHalf = Math.max(0, (target - bar) / 2);
  const side = sideAtOrUnder(sidePerHalf, inventory, sleeveMm);
  const total = totalKg(side, bar);
  const primary: Loadout = { side, total, delta: total - target };

  // The opt-in over-target alternative (ADR-0003, RBAR-11): only when `primary`
  // lands strictly under the Target (the solve ceiling, when called from
  // decodeWithin -- RBAR-60) -- an exact (delta 0) or sub-Bar (delta > 0) Target has
  // nothing to round up to, and an empty Inventory (or one of all-none sizes,
  // ADR-0016) has nothing to round up with. The
  // least achievable Total above the Target is the least loadable Side sum above the
  // Side budget, found by the same search and Sleeve cap, so it is the fewest Plates
  // heaviest-first too. In the sleeve-bound band that may be several grid steps up
  // (RBAR-62, ADR-0012); when the Sleeve holds nothing heavier there is no physical
  // round-up and no `over` at all.
  if (primary.delta < -EPS && hasUsablePlates(inventory)) {
    const overSide = sideAbove(sidePerHalf, inventory, sleeveMm);
    if (overSide) {
      const overTotal = totalKg(overSide, bar);
      // A Side sum above the budget always clears the Target by a grid step; failing
      // that is a solver bug, so say so rather than silently dropping the round-up.
      if (!(overTotal > target + EPS)) {
        throw new Error(`decode: round-up ${overTotal} kg is not above the Target ${target} kg`);
      }
      return {
        primary,
        over: { side: overSide, total: overTotal, delta: overTotal - target },
      };
    }
  }

  return { primary };
}

/**
 * Decode at or under a `ceiling` at or above the Target, reporting every `delta`
 * against the real `target` (RBAR-60). The shell passes the top of the Target's
 * displayed reading (units.ts displayCeilingKg): a Target typed as "55 lb" is
 * 24.95 kg, yet the 25 kg load also reads 55 lb, so "at or under what the lifter
 * typed" means at or under everything that reading covers. Solving to the raw kg
 * would land a whole Plate step low on any reading that rounds down -- the
 * ADR-0010 displayed-unit exactness rule carried from the status pill into the
 * solve itself. The overshoot is below one displayed unit, so it never reads as over.
 *
 * The core stays unit-free (ADR-0010): it sees only the two kg numbers. Deltas stay
 * Target-relative so `total - delta` still recovers the Target the lifter typed;
 * a primary may carry a tiny positive delta (inside the reading), and `over`, when
 * present, is strictly above the ceiling.
 *
 * `ceiling` must not exceed the top of the Target's displayed reading -- use
 * displayCeilingKg. A wider ceiling would overshoot VISIBLY, breaking ADR-0003. A
 * ceiling below the Target clamps up to it; a non-finite one means no widening.
 */
export function decodeWithin(
  target: number,
  ceiling: number,
  bar: number = DEFAULT_BAR_KG,
  inventory: readonly InventoryEntry[] = ELEIKO_KG,
  sleeveMm: number = SLEEVE_MM,
): Decoded {
  if (!Number.isFinite(target)) return decode(target, bar, inventory, sleeveMm);
  const solveTo = Number.isFinite(ceiling) ? Math.max(ceiling, target) : target;
  const solved = decode(solveTo, bar, inventory, sleeveMm);
  const rebase = (l: Loadout): Loadout => ({ ...l, delta: l.total - target });
  return solved.over
    ? { primary: rebase(solved.primary), over: rebase(solved.over) }
    : { primary: rebase(solved.primary) };
}
