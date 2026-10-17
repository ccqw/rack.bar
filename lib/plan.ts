// The warm-up Ramp planner (RBAR-65 slice 1, ADR-0015): from a Working set's Target and
// a template of steps, the ordered Warm-up sets that build to it, each as a loadable
// Side. Pure (ADR-0001), kg-canonical and unit-free like decode (ADR-0010): the shell
// passes the Working set's display ceiling, never a Unit.
//
// The rules, all in ADR-0015:
//   - The Working set is Decode's at-or-under solve, unchanged (ADR-0003): decodeWithin
//     on the effective Bar. Its achieved Total is the Ramp's 100%.
//   - A percentage step is taken of that achieved Total (Q1) and rounds to the NEAREST
//     loadable Total, ties down -- the warm-up carve-out from ADR-0003 (Q2).
//   - Every row is floored at the bare Bar, Totals never decrease down the Ramp, and no
//     warm-up goes above the Working set. Rows are never dropped; one that lands on the
//     previous Total says so (`sameAsPrevious`, Q4).
//   - The bare-Bar row never carries Collars (its Total is the Bar alone); every other
//     row carries them exactly when the rig has them (Q5, ADR-0008).
//
// Which Plates make up each Side is sideloads.ts's canonical stack (fewest Plates, then
// heaviest-first, within the Sleeve -- RBAR-69), the same one Decode shows. Add-only
// loading (RBAR-65 slice 4) will be a later pass that may swap a warm-up's Side for a
// near one; rows carry the Side and Total separately from the nominal step so it can.
import { SLEEVE_MM, barWithCollars, totalKg } from './plates.ts';
import type { Plate } from './plates.ts';
import { decodeWithin } from './decode.ts';
import type { Decoded } from './decode.ts';
import { sideAtOrUnder, sideAbove } from './sideloads.ts';

// Loadable Totals are >= 1 kg apart on every shipped rig; this absorbs only float drift
// in summed Plate masses (the iron kg are lbToKg products), never a real grid step.
const EPS = 1e-9;

/**
 * One step of a Ramp template, lightest first. `bar` is the bare Bar (a first-class
 * step, not "0%"); `pct` is a percentage of the Working set's achieved Total, in
 * (0, 100]. `reps` is an optional positive integer. The Working set is not a step: it
 * is the implicit, fixed last row at 100%.
 */
export type RampStep =
  | { readonly kind: 'bar'; readonly reps?: number }
  | { readonly kind: 'pct'; readonly pct: number; readonly reps?: number };

/** Caitlin's deadlift ramp, the default template: Bar x7, 50% x7, 70%, 90%, then Work. */
export const DEFAULT_RAMP: readonly RampStep[] = [
  { kind: 'bar', reps: 7 },
  { kind: 'pct', pct: 50, reps: 7 },
  { kind: 'pct', pct: 70 },
  { kind: 'pct', pct: 90 },
];

/** The rig a Ramp is loaded on: the Plate set's Inventory and Bar, and the Collar. */
export interface RampRig {
  /** The bare Bar, kg. */
  readonly barKg: number;
  /** One Collar's weight, kg (0 = None). Folds into the baseline, ADR-0008. */
  readonly collarKg: number;
  readonly inventory: readonly Plate[];
  /** The Sleeve, mm (ADR-0012); defaults to SLEEVE_MM. */
  readonly sleeveMm?: number;
}

/** Fields every row shares. */
interface RowBase {
  /**
   * The raw kg the step asked for, before rounding: the Bar for a bare-Bar row,
   * pct / 100 x the Working Total for a warm-up, the typed Target for the Working set.
   */
  readonly targetKg: number;
  /** One Side's Plates, heaviest-first (the canonical stack, sideloads.ts). */
  readonly side: readonly Plate[];
  /** Whether this row's Total includes the rig's Collars (ADR-0015 Q5). */
  readonly collars: boolean;
  /** The Total actually on the Bar: Bar (+ 2 x Collar when `collars`) + 2 x Side Load. */
  readonly total: number;
  /** `total` as a percentage of the Working set's Total (100 on the Working row). */
  readonly realPct: number;
  readonly reps?: number;
  /** True when `total` equals the previous row's (never on the first row). */
  readonly sameAsPrevious: boolean;
}

/** A bare-Bar row: no Plates, no Collars, Total = the Bar. */
export interface BarRow extends RowBase {
  readonly kind: 'bar';
  readonly pct: null;
}

/** A Warm-up set from a percentage step; `pct` is the nominal percentage asked for. */
export interface WarmUpRow extends RowBase {
  readonly kind: 'warmup';
  readonly pct: number;
}

/** The Working set: Decode's at-or-under primary (ADR-0003). */
export interface WorkingRow extends RowBase {
  readonly kind: 'working';
  readonly pct: 100;
}

export type RampRow = BarRow | WarmUpRow | WorkingRow;

/** A planned Ramp: one row per step, then the Working set last. */
export interface Ramp {
  readonly rows: readonly RampRow[];
  /**
   * The Working set's full Decode, so the shell can still offer the ADR-0003 round-up
   * (`over`) on that row. Its `primary` is the Working row's Side and Total.
   */
  readonly working: Decoded;
}

export interface PlanOptions {
  /**
   * The Working set's solve ceiling, as decodeWithin takes it: the top of the Target's
   * displayed reading (units.ts displayCeilingKg). Defaults to the Target itself.
   */
  readonly ceilingKg?: number;
  /** Reps for the Working set (a positive integer), if any. */
  readonly workingReps?: number;
}

function isReps(reps: number | undefined): boolean {
  return reps === undefined || (Number.isInteger(reps) && reps > 0);
}

/**
 * Reject a template or rig the planner cannot reason about. The shell validates a
 * persisted template at its boundary (ADR-0007); reaching here with a bad one is a
 * shell bug, so it throws rather than quietly planning something else.
 */
function assertPlan(steps: readonly RampStep[], rig: RampRig, workingReps?: number): void {
  if (!(rig.barKg > 0) || !Number.isFinite(rig.barKg)) {
    throw new RangeError(`planRamp: Bar ${rig.barKg} kg is not a positive number`);
  }
  if (!(rig.collarKg >= 0) || !Number.isFinite(rig.collarKg)) {
    throw new RangeError(`planRamp: Collar ${rig.collarKg} kg is not a non-negative number`);
  }
  if (!isReps(workingReps)) {
    throw new RangeError(`planRamp: Working-set reps ${workingReps} is not a positive integer`);
  }
  let sawPct = false;
  let lastPct = -Infinity;
  for (const step of steps) {
    if (!isReps(step.reps)) {
      throw new RangeError(`planRamp: reps ${step.reps} is not a positive integer`);
    }
    if (step.kind === 'pct') {
      if (!(step.pct > 0 && step.pct <= 100)) {
        throw new RangeError(`planRamp: ${step.pct}% is not in (0, 100]`);
      }
      // Percentages never fall (ADR-0015): a falling step would force a lower set to
      // repeat a heavier one, which no Ramp means (the editor saves them ascending).
      if (step.pct < lastPct) {
        throw new RangeError(`planRamp: ${step.pct}% comes after ${lastPct}%; percentages must not fall`);
      }
      lastPct = step.pct;
      sawPct = true;
    } else if (sawPct) {
      // A bare-Bar step after a warm-up would break the non-decreasing rule.
      throw new RangeError('planRamp: a bare-Bar step must come before every percentage step');
    }
  }
}

/**
 * The Side whose Total on `baselineKg` is the loadable Total nearest `rawKg` within
 * [loKg, hiKg], ties going to the lighter one (ADR-0015). `loKg` must be at or above
 * the baseline and `hiKg` must itself be loadable on it (the Working Total), so the
 * window always holds a candidate.
 *
 * Clamping `rawKg` into the window and taking its two neighbours (the greatest loadable
 * at or under it, the least above it) finds the answer: any loadable Total nearer
 * `rawKg` inside the window would sit between those two neighbours.
 */
function nearestSide(
  rawKg: number,
  loKg: number,
  hiKg: number,
  baselineKg: number,
  inventory: readonly Plate[],
  sleeveMm: number,
): readonly Plate[] {
  const r = Math.min(Math.max(rawKg, loKg), hiKg);
  const budget = (r - baselineKg) / 2;
  const under = sideAtOrUnder(budget, inventory, sleeveMm);
  const uTotal = totalKg(under, baselineKg);
  const above = sideAbove(budget, inventory, sleeveMm);
  const aTotal = above ? totalKg(above, baselineKg) : Infinity;
  const underOk = uTotal >= loKg - EPS;
  const aboveOk = above !== null && aTotal <= hiKg + EPS;
  if (underOk && aboveOk) {
    // Ties (within float drift) go down.
    return aTotal - rawKg < rawKg - uTotal - EPS ? above : under;
  }
  if (underOk) return under;
  if (aboveOk) return above;
  // Unreachable while hiKg is loadable on the baseline: it would be `under` once r hit it.
  throw new Error(`planRamp: no loadable Total in [${loKg}, ${hiKg}] kg`);
}

/**
 * Plan a warm-up Ramp building to `workingTarget` (kg) on `rig`: one row per step in
 * `steps`, then the Working set. The Working set is Decode's at-or-under solve within
 * `options.ceilingKg` (ADR-0003, unchanged); each percentage step is that achieved
 * Total x pct / 100, rounded to the nearest loadable Total with ties down, floored at
 * the previous row and the bare Bar and capped at the Working set (ADR-0015).
 *
 * Never returns fewer rows than `steps.length + 1`. A non-finite Working Target
 * degrades to the bare rig as Decode does. Throws a RangeError for a malformed
 * template (a percentage outside (0, 100], a percentage below the one before it, reps
 * that are not a positive integer, a bare-Bar step after a percentage step) or rig (a
 * non-positive Bar, a negative Collar), and -- from sideloads.ts -- for malformed
 * Plates or Sleeve.
 */
export function planRamp(
  workingTarget: number,
  steps: readonly RampStep[],
  rig: RampRig,
  options: PlanOptions = {},
): Ramp {
  const { ceilingKg = workingTarget, workingReps } = options;
  assertPlan(steps, rig, workingReps);
  const { barKg, collarKg, inventory } = rig;
  const sleeveMm = rig.sleeveMm ?? SLEEVE_MM;
  const collars = collarKg > 0;
  const baselineKg = barWithCollars(barKg, collarKg);

  const working = decodeWithin(workingTarget, ceilingKg, baselineKg, inventory, sleeveMm);
  const workingTotal = working.primary.total;
  const pctOf = (total: number) => (total / workingTotal) * 100;

  const rows: RampRow[] = [];
  let prev = -Infinity;
  const same = (total: number) => rows.length > 0 && Math.abs(total - prev) <= EPS;

  for (const step of steps) {
    if (step.kind === 'bar') {
      rows.push({
        kind: 'bar',
        pct: null,
        targetKg: barKg,
        side: [],
        collars: false,
        total: barKg,
        realPct: pctOf(barKg),
        reps: step.reps,
        sameAsPrevious: same(barKg),
      });
      prev = barKg;
      continue;
    }
    const rawKg = (workingTotal * step.pct) / 100;
    const loKg = Math.max(prev, baselineKg);
    const side = nearestSide(rawKg, loKg, workingTotal, baselineKg, inventory, sleeveMm);
    const total = totalKg(side, baselineKg);
    rows.push({
      kind: 'warmup',
      pct: step.pct,
      targetKg: rawKg,
      side,
      collars,
      total,
      realPct: pctOf(total),
      reps: step.reps,
      sameAsPrevious: same(total),
    });
    prev = total;
  }

  rows.push({
    kind: 'working',
    pct: 100,
    targetKg: workingTarget,
    side: working.primary.side,
    collars,
    total: workingTotal,
    realPct: 100,
    reps: workingReps,
    sameAsPrevious: same(workingTotal),
  });
  return { rows, working };
}
