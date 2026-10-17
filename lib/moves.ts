// Fewest Plate moves across a warm-up Ramp (RBAR-65 slice 4, ADR-0015 as amended
// 2026-10-17). planRamp (plan.ts) picks each Warm-up set's nearest loadable Total on
// its own; at the rack the real cost is the Plates you take off and put on between
// sets. This pass re-picks every row's Side -- and, within a tolerance, its Total -- so
// the whole Ramp needs the fewest weighted Plate moves.
//
// The model (Caitlin, 2026-10-17):
//   - A Side is a stack, inside -> outside, heaviest inside (sideloads.ts order). Going
//     from one set's Side to the next takes off every Plate outside the longest common
//     inside run, then puts on the new ones. Strict add-only is the zero-off case.
//   - A change Plate (at most CHANGE_PLATE_MAX_KG: Competition 2.5 / 2 / 1.5 / 1 /
//     0.5 kg, iron 5 / 2.5 lb) is loaded last and swapped bit by bit, so each of its
//     moves costs CHANGE_PLATE_MOVE_COST; any other Plate costs 1.
//   - A Warm-up set may sit anywhere within RAMP_TOLERANCE of the Working Total from
//     its percentage (never closer than one Plate-grid step on that set), and still
//     obeys planRamp's floor, monotone and ceiling rules. Its nearest Total from
//     planRamp is always a candidate, so a row the floor pushes out of tolerance still
//     has one.
//   - The Working set's Total is exactly Decode's at-or-under Total (ADR-0003); its
//     Side may be any equal-Total stack if that saves moves.
//
// The search is exact over its candidates: a dynamic programme over rows, each
// candidate one (Total, Side) pair, minimising lexicographically
//   1. how far rows sit outside the tolerance (only a forced row ever does),
//   2. the weighted Plate moves from the bare Bar through the Working set,
//   3. the summed distance of each Warm-up set from its percentage,
//   4. the Plates loaded, over every row.
// Candidate Sides for a Total are sideloads.ts's ranked stacks with at most
// EXTRA_PLATES more Plates than the fewest: a stack with more is never the easy one.
import { SLEEVE_MM, barWithCollars, totalKg } from './plates.ts';
import type { Plate } from './plates.ts';
import { planRamp } from './plan.ts';
import type { PlanOptions, Ramp, RampRig, RampRow, RampStep } from './plan.ts';
import { plateGridKg, sideLoads } from './sideloads.ts';

const EPS = 1e-9;

/** The heaviest change Plate, kg: Competition 2.5 kg and below, iron 5 lb (2.27 kg)
 * and below. Iron 10 lb (4.54 kg) and Competition 5 kg are not change Plates. */
export const CHANGE_PLATE_MAX_KG = 2.5;

/** What one move of a change Plate costs, against 1 for any other Plate. */
export const CHANGE_PLATE_MOVE_COST = 0.5;

/** How far a Warm-up set may drift from its percentage, as a share of the Working Total. */
export const RAMP_TOLERANCE = 0.025;

/** How many Plates past the fewest a candidate Side may carry. */
export const EXTRA_PLATES = 2;

/** What one Plate move costs: CHANGE_PLATE_MOVE_COST for a change Plate, else 1. */
export function moveCost(plate: Plate): number {
  return plate.kg <= CHANGE_PLATE_MAX_KG + EPS ? CHANGE_PLATE_MOVE_COST : 1;
}

/** The Plates to take off and put on, one Side, to go from `from` to `to`. */
export interface Moves {
  /** Taken off, outermost first (the order you remove them). */
  readonly off: readonly Plate[];
  /** Put on, innermost first (the order you load them). */
  readonly on: readonly Plate[];
  /** The weighted count: moveCost summed over `off` and `on`. */
  readonly cost: number;
}

/**
 * The Plate moves from Side `from` to Side `to` (both inside -> outside): off with
 * everything outside their longest common inside run, then on with the rest of `to`.
 * Plates match by identity -- the Inventory's own Plate objects (sideloads.ts).
 */
export function movesBetween(from: readonly Plate[], to: readonly Plate[]): Moves {
  let k = 0;
  while (k < from.length && k < to.length && from[k] === to[k]) k++;
  const off = from.slice(k).reverse();
  const on = to.slice(k);
  const cost = [...off, ...on].reduce((c, p) => c + moveCost(p), 0);
  return { off, on, cost };
}

/** A Ramp row with the Plate moves that get there from the row before. */
export type EasyRow = RampRow & {
  /** From the previous row's Side (the bare Bar for the first row). */
  readonly moves: Moves;
};

/** A Ramp re-picked for fewest Plate moves. */
export interface EasyRamp {
  readonly rows: readonly EasyRow[];
  /** The Working set's Decode, as planRamp returns it (its round-up included). */
  readonly working: Ramp['working'];
  /** The weighted Plate moves over the whole Ramp (the sum of each row's `moves.cost`). */
  readonly totalMoves: number;
}

interface Candidate {
  readonly side: readonly Plate[];
  readonly total: number;
  /** How far outside the tolerance (0 inside it). */
  readonly excess: number;
  /** |total - the row's raw target| for a Warm-up set, 0 otherwise. */
  readonly miss: number;
}

/** The ranked stacks for exactly `sideKg`, at most EXTRA_PLATES past the fewest. */
function sidesFor(sideKg: number, inventory: readonly Plate[], sleeveMm: number): (readonly Plate[])[] {
  const out: (readonly Plate[])[] = [];
  let fewest = -1;
  for (const side of sideLoads(sideKg, inventory, sleeveMm)) {
    if (fewest < 0) fewest = side.length;
    if (side.length > fewest + EXTRA_PLATES) break;
    out.push(side);
  }
  return out;
}

// A path's cost, compared lexicographically: [excess, moves, miss, Plates].
type Cost = readonly [number, number, number, number];
const add = (a: Cost, b: Cost): Cost => [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]];
function less4(
  a0: number, a1: number, a2: number, a3: number,
  b0: number, b1: number, b2: number, b3: number,
): boolean {
  if (a0 < b0 - EPS) return true;
  if (a0 > b0 + EPS) return false;
  if (a1 < b1 - EPS) return true;
  if (a1 > b1 + EPS) return false;
  if (a2 < b2 - EPS) return true;
  if (a2 > b2 + EPS) return false;
  return a3 < b3 - EPS;
}
const less = (a: Cost, b: Cost): boolean => less4(a[0], a[1], a[2], a[3], b[0], b[1], b[2], b[3]);

/** w[k] = the summed moveCost of side[k..]; w[side.length] = 0. */
function suffixWeights(side: readonly Plate[]): Float64Array {
  const w = new Float64Array(side.length + 1);
  for (let k = side.length - 1; k >= 0; k--) w[k] = w[k + 1] + moveCost(side[k]);
  return w;
}

/** The length of the longest common inside run of two Sides (by Plate identity). */
function commonInside(a: readonly Plate[], b: readonly Plate[]): number {
  let k = 0;
  while (k < a.length && k < b.length && a[k] === b[k]) k++;
  return k;
}

/**
 * Plan a warm-up Ramp like planRamp, then re-pick every Warm-up set's Total and Side,
 * and the Working set's Side, for the fewest weighted Plate moves (ADR-0015 as amended
 * 2026-10-17). Same arguments, same row order and count, same bare-Bar rows, and the
 * same Working Total; each row also carries the `moves` from the row before. Throws
 * whatever planRamp throws.
 */
export function planEasyRamp(
  workingTarget: number,
  steps: readonly RampStep[],
  rig: RampRig,
  options: PlanOptions = {},
): EasyRamp {
  const nearest = planRamp(workingTarget, steps, rig, options);
  const { barKg, collarKg, inventory } = rig;
  const sleeveMm = rig.sleeveMm ?? SLEEVE_MM;
  const baselineKg = barWithCollars(barKg, collarKg);
  const workingTotal = nearest.working.primary.total;
  const grid = inventory.length > 0 ? plateGridKg(inventory) : 0;
  const tol = Math.max(RAMP_TOLERANCE * workingTotal, grid);
  const unitsOf = (total: number) => Math.round((total - baselineKg) / 2 / grid);
  const totalOf = (units: number) => baselineKg + 2 * units * grid;

  // Each row's candidates. A bare-Bar row has one; with no Plates to choose from every
  // other row keeps planRamp's (bare-rig) answer too.
  const cands: Candidate[][] = nearest.rows.map((row) => {
    const keep: Candidate = { side: row.side, total: row.total, excess: 0, miss: 0 };
    if (row.kind === 'bar' || grid === 0) return [keep];
    const units = new Set<number>([unitsOf(row.total)]);
    if (row.kind === 'warmup') {
      const lo = Math.max(baselineKg, row.targetKg - tol);
      const hi = Math.min(workingTotal, row.targetKg + tol);
      for (let u = Math.max(0, Math.ceil((lo - baselineKg) / 2 / grid - EPS)); totalOf(u) <= hi + EPS; u++) {
        units.add(u);
      }
    }
    const out: Candidate[] = [];
    for (const u of [...units].sort((a, b) => a - b)) {
      for (const side of sidesFor(u * grid, inventory, sleeveMm)) {
        const total = totalKg(side, baselineKg);
        const miss = row.kind === 'warmup' ? Math.abs(total - row.targetKg) : 0;
        out.push({ side, total, excess: Math.max(0, miss - tol), miss });
      }
    }
    return out.length > 0 ? out : [keep];
  });

  // DP: best[i][j] = the least Cost of rows 0..i ending on candidate j of row i. The
  // inner loop is the hot path (thousands of candidates per row on a heavy Ramp), so
  // the move cost is computed without allocating: the weighted Plates outside the
  // common inside run are two suffix sums.
  const suffix = cands.map((row) => row.map((c) => suffixWeights(c.side)));
  const nodeCost = (c: Candidate): Cost => [c.excess, 0, c.miss, c.side.length];
  let best: Cost[] = cands[0].map((c, k) => add(nodeCost(c), [0, suffix[0][k][0], 0, 0]));
  const from: number[][] = [cands[0].map(() => -1)];
  for (let i = 1; i < cands.length; i++) {
    const prevCands = cands[i - 1];
    const prevBest = best;
    const nextBest: Cost[] = [];
    const nextFrom: number[] = [];
    cands[i].forEach((c, ci) => {
      const node = nodeCost(c);
      const cSuffix = suffix[i][ci];
      let b0 = Infinity, b1 = Infinity, b2 = Infinity, b3 = Infinity;
      let bestJ = -1;
      for (let j = 0; j < prevCands.length; j++) {
        const p = prevCands[j];
        if (c.total < p.total - EPS) continue; // Totals never decrease (ADR-0015)
        const k = commonInside(p.side, c.side);
        const pb = prevBest[j];
        const c0 = pb[0] + node[0];
        const c1 = pb[1] + suffix[i - 1][j][k] + cSuffix[k];
        const c2 = pb[2] + node[2];
        const c3 = pb[3] + node[3];
        if (bestJ < 0 || less4(c0, c1, c2, c3, b0, b1, b2, b3)) {
          b0 = c0; b1 = c1; b2 = c2; b3 = c3;
          bestJ = j;
        }
      }
      nextBest.push([b0, b1, b2, b3]);
      nextFrom.push(bestJ);
    });
    best = nextBest;
    from.push(nextFrom);
  }

  // Walk back from the cheapest last-row candidate. planRamp's own rows are always a
  // feasible path (each is a candidate, and they never decrease), so one exists.
  let j = 0;
  for (let k = 1; k < best.length; k++) if (less(best[k], best[j])) j = k;
  if (!Number.isFinite(best[j][0])) {
    throw new Error('planEasyRamp: no non-decreasing path through the candidates');
  }
  const picks: Candidate[] = [];
  for (let i = cands.length - 1; i >= 0; i--) {
    picks[i] = cands[i][j];
    j = from[i][j];
  }

  let prevSide: readonly Plate[] = [];
  let prevTotal = -Infinity;
  let totalMoves = 0;
  const rows: EasyRow[] = nearest.rows.map((row, i) => {
    const { side, total } = picks[i];
    const moves = movesBetween(prevSide, side);
    totalMoves += moves.cost;
    const realPct = row.kind === 'working' ? 100 : (total / workingTotal) * 100;
    const sameAsPrevious = Math.abs(total - prevTotal) <= EPS;
    prevSide = side;
    prevTotal = total;
    return { ...row, side, total, realPct, sameAsPrevious, moves } as EasyRow;
  });
  return { rows, working: nearest.working, totalMoves };
}
