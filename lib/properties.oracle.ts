// TEST-ONLY independent oracle for the property suites (RBAR-62). Never imported by
// app code (nothing under elements/ or index.html reaches it), so it never ships.
//
// It answers "what Totals can this rig physically build?" from the ADRs alone, with
// no call into the loader under test: a dynamic programme over Side sums on the
// Inventory's own grid, tracking the narrowest stack for each (sum, Plate count).
//   - ADR-0002: Bar and Inventory are inputs; the Total is Bar + 2 x Side Load.
//   - ADR-0008: a Collar folds into the baseline (Bar + 2 x Collar) the solver loads from.
//   - ADR-0012: "achievable" means buildable AND within the Sleeve -- a Side sum is
//     achievable iff some stack reaching it fits SLEEVE_MM.
//   - ADR-0003: among stacks reaching the same Total the pick is the fewest Plates.
// The property tests compare the real solver to THESE answers, so a loader change that
// still passes the example tests but breaks a rule somewhere in the space fails here.
import { SLEEVE_MM } from './plates.ts';
import type { Plate } from './plates.ts';
import { PLATE_SETS, PLATE_SET_KEYS } from './platesets.ts';
import type { PlateSetKey } from './platesets.ts';

/** One physical rig: the set's Inventory on a given baseline (Bar + 2 x Collar). */
export interface Rig {
  readonly set: PlateSetKey;
  readonly barKg: number;
  readonly collarKg: number;
  readonly inventory: readonly Plate[];
  /** Bar + 2 x Collar (ADR-0008) -- the empty-rig Total. */
  readonly baselineKg: number;
  /** A readable name for failure messages. */
  readonly name: string;
}

/** The two Collar options v1 offers (None / Standard 2.5 kg, ADR-0008). */
export const COLLARS_KG: readonly number[] = [0, 2.5];

/** Every rig v1 can be set to: each set x each Bar it offers x each Collar. */
export const RIGS: readonly Rig[] = PLATE_SET_KEYS.flatMap((set) =>
  PLATE_SETS[set].bars.flatMap((bar) =>
    COLLARS_KG.map((collarKg) => ({
      set,
      barKg: bar.kg,
      collarKg,
      inventory: PLATE_SETS[set].inventory,
      baselineKg: bar.kg + 2 * collarKg,
      name: `${set} bar ${Number(bar.kg.toFixed(3))} kg collar ${collarKg}`,
    })),
  ),
);

/** What the oracle knows about one achievable Side sum. */
export interface Reachable {
  /** The Side Load in kg (sum of one Side's Plates). */
  readonly sideKg: number;
  /** The fewest Plates that reach it within the Sleeve (ADR-0003 + ADR-0012). */
  readonly fewestPlates: number;
}

interface Table {
  /** Achievable Side sums, ascending. */
  readonly sides: readonly Reachable[];
}

const cache = new Map<string, Table>();

/**
 * Every achievable Side sum for `inventory` under `sleeveMm`, ascending. The grid unit
 * is the smallest Plate (0.5 kg Eleiko, 2.5 lb iron); every Plate must be an integer
 * multiple of it, which holds for both v1 sets (asserted, so a future set that breaks
 * the assumption fails loudly here instead of producing a wrong oracle).
 */
export function reachableSides(
  inventory: readonly Plate[],
  sleeveMm: number = SLEEVE_MM,
): readonly Reachable[] {
  const key = `${inventory.map((p) => `${p.kg}/${p.widthMm}`).join(',')}@${sleeveMm}`;
  const hit = cache.get(key);
  if (hit) return hit.sides;

  const unit = Math.min(...inventory.map((p) => p.kg));
  const units = inventory.map((p) => {
    const u = Math.round(p.kg / unit);
    if (Math.abs(u * unit - p.kg) > 1e-9) {
      throw new Error(`oracle: Plate ${p.kg} kg is off the ${unit} kg grid`);
    }
    return u;
  });
  const widths = inventory.map((p) => p.widthMm);
  const maxCount = Math.floor(sleeveMm / Math.min(...widths));
  const maxUnits = maxCount * Math.max(...units);
  // w[c][s] = the narrowest stack of exactly c Plates summing to s grid units.
  const w: Float64Array[] = [];
  w[0] = new Float64Array(maxUnits + 1).fill(Infinity);
  w[0][0] = 0;
  for (let c = 1; c <= maxCount; c++) {
    const prev = w[c - 1];
    const row = new Float64Array(maxUnits + 1).fill(Infinity);
    for (let s = 0; s <= maxUnits; s++) {
      for (let i = 0; i < units.length; i++) {
        if (units[i] > s) continue;
        const cand = prev[s - units[i]] + widths[i];
        if (cand < row[s]) row[s] = cand;
      }
    }
    w[c] = row;
  }
  const sides: Reachable[] = [];
  for (let s = 0; s <= maxUnits; s++) {
    for (let c = 0; c <= maxCount; c++) {
      if (w[c][s] <= sleeveMm + 1e-9) {
        sides.push({ sideKg: s * unit, fewestPlates: c });
        break;
      }
    }
  }
  cache.set(key, { sides });
  return sides;
}

/** Every achievable Total on `rig`, ascending (baseline + 2 x each achievable Side). */
export function achievableTotals(rig: Rig): readonly number[] {
  return reachableSides(rig.inventory).map((r) => rig.baselineKg + 2 * r.sideKg);
}

// Grid points are >= 1 kg apart on every rig, so a 1e-9 tolerance only absorbs float
// drift in the summed Plate masses (the iron kg are lbToKg products), never a real step.
const TOL = 1e-9;

/** The greatest achievable Total at or under `ceiling`, or the baseline floor (ADR-0003). */
export function greatestAtOrUnder(rig: Rig, ceiling: number): number {
  let best = rig.baselineKg;
  for (const t of achievableTotals(rig)) {
    if (t <= ceiling + TOL) best = t;
    else break;
  }
  return best;
}

/** The least achievable Total strictly above `ceiling`, or null when none fits. */
export function leastAbove(rig: Rig, ceiling: number): number | null {
  for (const t of achievableTotals(rig)) if (t > ceiling + TOL) return t;
  return null;
}

/** The fewest Plates (one Side) that reach `total` on `rig` within the Sleeve, or null. */
export function fewestPlatesFor(rig: Rig, total: number): number | null {
  const sideKg = (total - rig.baselineKg) / 2;
  const r = reachableSides(rig.inventory).find((x) => Math.abs(x.sideKg - sideKg) < 1e-6);
  return r ? r.fewestPlates : null;
}

/** The heaviest achievable Total on `rig` (the Sleeve full of the densest stack). */
export function maxTotal(rig: Rig): number {
  const all = achievableTotals(rig);
  return all[all.length - 1];
}

/** A Ramp step as the oracle reads it (ADR-0015): the bare Bar, or a percentage. */
export type OracleStep = { readonly kind: 'bar' } | { readonly kind: 'pct'; readonly pct: number };

/**
 * The Totals a warm-up Ramp must reach on `rig` (ADR-0015), one per step then the
 * Working set, by brute force over every achievable Total -- no call into the planner:
 *   - the Working set is the greatest achievable Total at or under its solve ceiling
 *     (max(ceiling, Target)), floored at the bare rig (ADR-0003 as read, RBAR-60);
 *     a non-finite Target is the bare rig;
 *   - a bare-Bar step is the Bar alone, no Collars;
 *   - a percentage step is the achievable Total (Collars included, ADR-0008) nearest
 *     pct / 100 x the Working Total among those at or above both the previous row and
 *     the bare rig and at or under the Working Total; ties go to the lighter one.
 */
export function rampTotalsOracle(
  rig: Rig,
  workingTarget: number,
  ceiling: number,
  steps: readonly OracleStep[],
): number[] {
  const solveTo = Number.isFinite(ceiling) ? Math.max(ceiling, workingTarget) : workingTarget;
  const working = Number.isFinite(workingTarget) ? greatestAtOrUnder(rig, solveTo) : rig.baselineKg;
  const out: number[] = [];
  let prev = -Infinity;
  for (const step of steps) {
    if (step.kind === 'bar') {
      prev = rig.barKg;
    } else {
      const raw = (working * step.pct) / 100;
      const lo = Math.max(prev, rig.baselineKg);
      let best = NaN;
      for (const t of achievableTotals(rig)) {
        if (t < lo - TOL || t > working + TOL) continue;
        // Ascending walk: replace only when strictly closer, so a tie keeps the lighter.
        if (Number.isNaN(best) || Math.abs(t - raw) < Math.abs(best - raw) - TOL) best = t;
      }
      prev = best;
    }
    out.push(prev);
  }
  out.push(working);
  return out;
}

// ---------------------------------------------------------------------------------
// Fewest Plate moves (ADR-0015 as amended 2026-10-17, RBAR-65 slice 4). Brute force,
// for SMALL Inventories only: every Side is enumerated by plain recursion (never via
// sideloads.ts), and every combination of row choices is tried.

/** The rule's parameters, passed in so the oracle states them rather than importing logic. */
export interface MovesRule {
  /** Tolerance as a share of the Working Total (floored at one Plate-grid step). */
  readonly toleranceShare: number;
  /** A candidate Side may carry this many Plates past the fewest for its Total. */
  readonly extraPlates: number;
  /** Plates at or under this kg are change Plates... */
  readonly changeMaxKg: number;
  /** ...and each of their moves costs this (others cost 1). */
  readonly changeCost: number;
}

/** A Ramp's cost, compared lexicographically: [excess, moves, miss, Plates]. */
export type MovesCost = readonly [number, number, number, number];

/**
 * Every Side of `inventory` within `sleeveMm`, inside -> outside: heaviest inside,
 * equal masses narrower-first (the physical stack order the rule assumes), built from
 * the Inventory's own Plate objects.
 */
export function allSides(inventory: readonly Plate[], sleeveMm: number = SLEEVE_MM): (readonly Plate[])[] {
  const plates = [...inventory].sort((a, b) => b.kg - a.kg || a.widthMm - b.widthMm);
  const out: (readonly Plate[])[] = [];
  const stack: Plate[] = [];
  const walk = (from: number, mm: number) => {
    out.push([...stack]);
    for (let j = from; j < plates.length; j++) {
      if (mm + plates[j].widthMm > sleeveMm + 1e-9) continue;
      stack.push(plates[j]);
      walk(j, mm + plates[j].widthMm);
      stack.pop();
    }
  };
  walk(0, 0);
  return out;
}

const sumKg = (side: readonly Plate[]) => side.reduce((s, p) => s + p.kg, 0);

/** The weighted Plate moves from Side `a` to Side `b` under `rule`. */
export function oracleMoves(a: readonly Plate[], b: readonly Plate[], rule: MovesRule): number {
  let k = 0;
  while (k < a.length && k < b.length && a[k] === b[k]) k++;
  const w = (p: Plate) => (p.kg <= rule.changeMaxKg + 1e-9 ? rule.changeCost : 1);
  return [...a.slice(k), ...b.slice(k)].reduce((c, p) => c + w(p), 0);
}

/**
 * The cost of a given Ramp (one Side per row, bare-Bar rows empty) under `rule`: excess
 * and miss over the percentage rows, moves from the bare Bar through every row, and
 * the Plates loaded. `raws[i]` is row i's raw target (null for bare-Bar and Working).
 */
export function oracleRampCost(
  sides: readonly (readonly Plate[])[],
  totals: readonly number[],
  raws: readonly (number | null)[],
  tol: number,
  rule: MovesRule,
): MovesCost {
  let excess = 0, moves = 0, miss = 0, plates = 0;
  let prev: readonly Plate[] = [];
  sides.forEach((side, i) => {
    const raw = raws[i];
    if (raw !== null) {
      const d = Math.abs(totals[i] - raw);
      miss += d;
      excess += Math.max(0, d - tol);
    }
    moves += oracleMoves(prev, side, rule);
    plates += side.length;
    prev = side;
  });
  return [excess, moves, miss, plates];
}

function lessCost(a: MovesCost, b: MovesCost): boolean {
  for (let i = 0; i < 4; i++) {
    if (a[i] < b[i] - 1e-9) return true;
    if (a[i] > b[i] + 1e-9) return false;
  }
  return false;
}

/**
 * The least cost any Ramp can reach on `rig` for these steps (ADR-0015 as amended):
 *   - bare-Bar rows are the empty Side at the Bar;
 *   - the Working row is any Side reaching exactly the Working Total (the at-or-under
 *     Total as read, from rampTotalsOracle) with at most `extraPlates` past the fewest;
 *   - a percentage row is any such Side whose Total is within the tolerance of its raw
 *     target (pct x Working Total), at or above the bare rig and at or under the
 *     Working Total -- or reaches its nearest Total from rampTotalsOracle;
 *   - Totals never decrease down the Ramp.
 * Returns the least [excess, moves, miss, Plates] over every such Ramp, and the
 * tolerance used.
 */
export function easyRampOracle(
  rig: Rig,
  workingTarget: number,
  ceiling: number,
  steps: readonly OracleStep[],
  rule: MovesRule,
): { readonly best: MovesCost; readonly tol: number } {
  const nearest = rampTotalsOracle(rig, workingTarget, ceiling, steps);
  const working = nearest[nearest.length - 1];
  const grid = Math.min(...rig.inventory.map((p) => p.kg));
  const tol = Math.max(rule.toleranceShare * working, grid);
  const sides = allSides(rig.inventory);
  // Candidates for a Total: every Side reaching it, at most extraPlates past the fewest.
  const sidesAt = (total: number): (readonly Plate[])[] => {
    const hits = sides.filter((s) => Math.abs(rig.baselineKg + 2 * sumKg(s) - total) < 1e-6);
    if (hits.length === 0) return [];
    const fewest = Math.min(...hits.map((s) => s.length));
    return hits.filter((s) => s.length <= fewest + rule.extraPlates);
  };
  const totals = achievableTotals(rig);
  const raws: (number | null)[] = steps.map((s) => (s.kind === 'pct' ? (working * s.pct) / 100 : null));
  raws.push(null);
  const rows: { side: readonly Plate[]; total: number }[][] = raws.map((raw, i) => {
    if (i < steps.length && steps[i].kind === 'bar') return [{ side: [], total: rig.barKg }];
    const want = new Set<number>([nearest[i]]);
    if (raw !== null) {
      for (const t of totals) {
        if (t >= rig.baselineKg - TOL && t <= working + TOL && Math.abs(t - raw) <= tol + TOL) want.add(t);
      }
    }
    return [...want].flatMap((t) => sidesAt(t).map((side) => ({ side, total: t })));
  });

  let best: MovesCost = [Infinity, Infinity, Infinity, Infinity];
  const pickSides: (readonly Plate[])[] = [];
  const pickTotals: number[] = [];
  const walk = (i: number) => {
    if (i === rows.length) {
      const c = oracleRampCost(pickSides, pickTotals, raws, tol, rule);
      if (lessCost(c, best)) best = c;
      return;
    }
    for (const cand of rows[i]) {
      if (i > 0 && cand.total < pickTotals[i - 1] - TOL) continue;
      pickSides[i] = cand.side;
      pickTotals[i] = cand.total;
      walk(i + 1);
    }
  };
  walk(0);
  return { best, tol };
}
