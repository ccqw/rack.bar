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
// Caitlin's station rule (ADR-0015 as amended 2026-10-17, RBAR-65 slice 4b). Brute
// force, for SMALL Inventories only: every legal Side is enumerated by plain recursion
// (never via sideloads.ts or the planner), and every Ramp through them is costed by an
// exact DP whose state is the whole (Side, station so far) pair -- no pruning, no
// dominance.

/** The rule's parameters, passed in so the oracle states them rather than importing logic. */
export interface StationRule {
  /** A Warm-up set's band, as a share of the Working Total (floored at one grid step). */
  readonly band: number;
  /** Plates of each size per Side, before any raise the Working Total needs. */
  readonly cap: number;
  /** A Plate at least this diameter (mm) is big. */
  readonly bigDiameterMm: number;
  readonly missPerKg: number;
  readonly overFactor: number;
  readonly perPlate: number;
  readonly bigOff: number;
  readonly perMove: number;
  readonly perStationPlate: number;
}

/** A Ramp's cost, compared lexicographically: [band excess, repeated Totals, weighted cost]. */
export type StationCost = readonly [number, number, number];

/** How many of each Plate a Side may carry. */
export type Caps = (p: Plate) => number;

/**
 * Every legal Side of `inventory` within `sleeveMm`, inside -> outside: big Plates
 * (diameter >= rule.bigDiameterMm) in any order, then small Plates heaviest-first, at
 * most `caps(p)` of each Plate. Built from the Inventory's own Plate objects.
 */
export function legalSides(
  inventory: readonly Plate[],
  rule: StationRule,
  caps: Caps,
  sleeveMm: number = SLEEVE_MM,
): (readonly Plate[])[] {
  const bigs = inventory.filter((p) => p.diameterMm >= rule.bigDiameterMm);
  const smalls = inventory
    .filter((p) => p.diameterMm < rule.bigDiameterMm)
    .sort((a, b) => b.kg - a.kg || a.widthMm - b.widthMm);
  const out: (readonly Plate[])[] = [];
  const stack: Plate[] = [];
  const count = (p: Plate) => stack.filter((q) => q === p).length;
  const fits = (p: Plate, mm: number) => mm + p.widthMm <= sleeveMm + 1e-9 && count(p) < caps(p);
  const smallWalk = (from: number, mm: number) => {
    out.push([...stack]);
    for (let j = from; j < smalls.length; j++) {
      if (!fits(smalls[j], mm)) continue;
      stack.push(smalls[j]);
      smallWalk(j, mm + smalls[j].widthMm);
      stack.pop();
    }
  };
  const bigWalk = (mm: number) => {
    smallWalk(0, mm);
    for (const p of bigs) {
      if (!fits(p, mm)) continue;
      stack.push(p);
      bigWalk(mm + p.widthMm);
      stack.pop();
    }
  };
  bigWalk(0);
  return out;
}

const sumKg = (side: readonly Plate[]) => side.reduce((s, p) => s + p.kg, 0);

/** What going from Side `a` to Side `b` costs under `rule` (stack moves, big Plates off). */
export function oracleMoveCost(a: readonly Plate[], b: readonly Plate[], rule: StationRule): number {
  let k = 0;
  while (k < a.length && k < b.length && a[k] === b[k]) k++;
  const off = a.slice(k);
  const bigsOff = off.filter((p) => p.diameterMm >= rule.bigDiameterMm).length;
  return rule.bigOff * bigsOff + rule.perMove * (off.length + b.length - k);
}

/**
 * The cost of a given Ramp under `rule`: `raws[i]` is row i's raw target (null for
 * bare-Bar and Working rows), `kinds[i]` its kind. Band excess over the Warm-up sets;
 * a repeat for every non-bare-Bar row whose Total equals the row before; then the
 * weighted miss, Plates on each Warm-up set, moves from the bare Bar on, and the
 * station (per Plate, the most on one Side, summed).
 */
export function oracleStationCost(
  sides: readonly (readonly Plate[])[],
  totals: readonly number[],
  raws: readonly (number | null)[],
  kinds: readonly string[],
  tol: number,
  rule: StationRule,
): StationCost {
  let excess = 0, repeats = 0, cost = 0;
  let prev: readonly Plate[] = [];
  const most = new Map<Plate, number>();
  sides.forEach((side, i) => {
    const raw = raws[i];
    if (raw !== null) {
      const d = totals[i] - raw;
      excess += Math.max(0, Math.abs(d) - tol);
      cost += rule.missPerKg * Math.abs(d) * (d > 1e-9 ? rule.overFactor : 1) + rule.perPlate * side.length;
    }
    if (i > 0 && kinds[i] !== 'bar' && Math.abs(totals[i] - totals[i - 1]) <= 1e-9) repeats++;
    cost += oracleMoveCost(prev, side, rule);
    for (const p of new Set(side)) most.set(p, Math.max(most.get(p) ?? 0, side.filter((q) => q === p).length));
    prev = side;
  });
  for (const n of most.values()) cost += rule.perStationPlate * n;
  return [excess, repeats, cost];
}

function lessStation(a: StationCost, b: StationCost): boolean {
  for (let i = 0; i < 3; i++) {
    if (a[i] < b[i] - 1e-9) return true;
    if (a[i] > b[i] + 1e-9) return false;
  }
  return false;
}

/**
 * The caps the station rule loads with: rule.cap of each Plate when that loads
 * `total`; otherwise each Plate's cap rises to its count in the ADR-0003 stack for
 * `total` (fewest Plates, then heaviest-first), found here by brute force.
 */
export function oracleCaps(rig: Rig, total: number, rule: StationRule): Caps {
  const flat: Caps = () => rule.cap;
  const reaches = (s: readonly Plate[]) => Math.abs(rig.baselineKg + 2 * sumKg(s) - total) < 1e-6;
  if (legalSides(rig.inventory, rule, flat).some(reaches)) return flat;
  let best: readonly Plate[] | null = null;
  for (const s of allSides(rig.inventory)) {
    if (!reaches(s)) continue;
    if (best === null || s.length < best.length) { best = s; continue; }
    if (s.length > best.length) continue;
    const i = s.findIndex((p, k) => p.kg !== best![k].kg);
    if (i >= 0 && s[i].kg > best[i].kg) best = s;
  }
  if (best === null) throw new Error('oracleCaps: Working Total unreachable');
  const stack = best;
  return (p) => Math.max(rule.cap, stack.filter((q) => q === p).length);
}

/** Every Side of `inventory` within `sleeveMm` with no cap, heaviest-first. */
function allSides(inventory: readonly Plate[], sleeveMm: number = SLEEVE_MM): (readonly Plate[])[] {
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

/**
 * The least [excess, repeats, cost] any Ramp can reach on `rig` (ADR-0015 as amended
 * 2026-10-17, the station rule):
 *   - bare-Bar rows are the empty Side at the Bar;
 *   - the Working row is any legal Side reaching exactly the Working Total (the
 *     at-or-under Total as read, from rampTotalsOracle);
 *   - a percentage row is any legal Side whose Total is at or above the bare rig and at
 *     or under the Working Total (the band is a cost key, not a filter);
 *   - Totals never decrease down the Ramp.
 * Returns the minimum and the band half-width used.
 */
export function stationRampOracle(
  rig: Rig,
  workingTarget: number,
  ceiling: number,
  steps: readonly OracleStep[],
  rule: StationRule,
): { readonly best: StationCost; readonly tol: number; readonly caps: Caps } {
  const nearest = rampTotalsOracle(rig, workingTarget, ceiling, steps);
  const working = nearest[nearest.length - 1];
  const grid = Math.min(...rig.inventory.map((p) => p.kg));
  const tol = Math.max(rule.band * working, grid);
  const caps = oracleCaps(rig, working, rule);
  const sides = legalSides(rig.inventory, rule, caps).map((side) => ({ side, total: rig.baselineKg + 2 * sumKg(side) }));
  const raws: (number | null)[] = steps.map((s) => (s.kind === 'pct' ? (working * s.pct) / 100 : null));
  raws.push(null);
  const kinds = [...steps.map((s) => (s.kind === 'bar' ? 'bar' : 'warmup')), 'working'];
  const rows = kinds.map((kind) => {
    if (kind === 'bar') return [{ side: [] as readonly Plate[], total: rig.barKg }];
    if (kind === 'working') return sides.filter((c) => Math.abs(c.total - working) < 1e-6);
    return sides.filter((c) => c.total <= working + 1e-6);
  });

  // Exact DP: a state is a full path's last Side plus its station so far; every state
  // key keeps its least partial cost (all three keys add up row by row).
  type Node = { side: readonly Plate[]; total: number; most: Map<Plate, number>; cost: StationCost };
  let layer: Node[] = [{ side: [], total: -Infinity, most: new Map(), cost: [0, 0, 0] }];
  kinds.forEach((kind, i) => {
    const next = new Map<string, Node>();
    for (const c of rows[i]) {
      for (const v of layer) {
        if (c.total < v.total - 1e-9) continue;
        const raw = raws[i];
        let [excess, repeats, cost] = v.cost;
        if (raw !== null) {
          const d = c.total - raw;
          excess += Math.max(0, Math.abs(d) - tol);
          cost += rule.missPerKg * Math.abs(d) * (d > 1e-9 ? rule.overFactor : 1) + rule.perPlate * c.side.length;
        }
        if (i > 0 && kind !== 'bar' && Math.abs(c.total - v.total) <= 1e-9) repeats++;
        cost += oracleMoveCost(v.side, c.side, rule);
        const most = new Map(v.most);
        for (const p of new Set(c.side)) {
          const n = c.side.filter((q) => q === p).length;
          if (n > (most.get(p) ?? 0)) {
            cost += rule.perStationPlate * (n - (most.get(p) ?? 0));
            most.set(p, n);
          }
        }
        const key = `${c.total}|${c.side.map((p) => rig.inventory.indexOf(p)).join(',')}|` +
          rig.inventory.map((p) => most.get(p) ?? 0).join(',');
        const node: Node = { side: c.side, total: c.total, most, cost: [excess, repeats, cost] };
        const old = next.get(key);
        if (!old || lessStation(node.cost, old.cost)) next.set(key, node);
      }
    }
    layer = [...next.values()];
  });
  let best: StationCost = [Infinity, Infinity, Infinity];
  for (const v of layer) if (lessStation(v.cost, best)) best = v.cost;
  return { best, tol, caps };
}

/**
 * The cap a stored `rackbar.platesOnHand` value puts on one size, read straight from
 * ADR-0016 as amended for RBAR-72 slice 2 and ADR-0007, independently of
 * lib/platesonhand.ts: the stored value is a JSON object keyed by Plate set, each a
 * JSON object of a size's face to its pairs on hand. The cap is that count when it is
 * a whole number from 0 to 4; anything else -- unparseable text, a non-object, a missing
 * set or face, a fraction, a negative, a count past 4, a string -- is All (Infinity).
 */
export function storedPairsOracle(raw: string | null, set: PlateSetKey, face: string): number {
  if (raw === null) return Infinity;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return Infinity;
  }
  const obj = (x: unknown): x is Record<string, unknown> =>
    typeof x === 'object' && x !== null && !Array.isArray(x);
  if (!obj(v) || !Object.prototype.hasOwnProperty.call(v, set)) return Infinity;
  const limits = v[set];
  if (!obj(limits) || !Object.prototype.hasOwnProperty.call(limits, face)) return Infinity;
  const n = limits[face];
  return typeof n === 'number' && [0, 1, 2, 3, 4].includes(n) ? n : Infinity;
}
