// TEST-ONLY independent fewest-Plates oracle (RBAR-69). Never imported by app code.
//
// It answers "which Side Load should Decode pick for this Side sum?" straight from the
// ADRs, with no call into the solver under test and no shared search code:
//   - ADR-0012: a stack is loadable iff its Plates fit the Sleeve;
//   - ADR-0003: the pick is the greatest loadable Side sum at or under the budget, then
//     the fewest Plates reaching it, then -- among equally few -- the heaviest-first
//     tie-break: compare the heaviest Plate first, then the next (lexicographic).
//
// Method: a dynamic programme over Plate COUNT, not a search. On the set's integer grid
// (explicit per set -- 0.5 kg Eleiko, 2.5 lb iron -- never inferred from the Plates),
// W[i][c][s] is the narrowest stack of exactly c Plates, drawn only from the
// denominations i..n-1 (heaviest first), that sums to s grid units. The fewest Plates
// for s is the least c with W[0][c][s] within the Sleeve; the heaviest-first stack is
// then read off greedily against the table: at each position take the heaviest
// denomination that still leaves a completable, fitting rest. The solver is a pruned
// depth-first search; the two share nothing but the Plate data.
import { SLEEVE_MM } from './plates.ts';
import type { InventoryEntry, Plate } from './plates.ts';
import { lbToKg } from './units.ts';
import type { PlateSetKey } from './platesets.ts';

/** The integer grid each shipped set's Side sums lie on, stated, not derived. */
export const GRID_KG: Record<PlateSetKey, number> = {
  comp: 0.5,
  training: lbToKg(2.5),
};

export interface FewestOracle {
  /** The Plates, heaviest first, that the oracle indexes into. */
  readonly plates: readonly Plate[];
  readonly gridKg: number;
  /** Every loadable Side sum, in grid units (NOT kg), ascending (0 included). */
  readonly sums: readonly number[];
  /** The fewest Plates reaching `units` grid units within the Sleeve, or null. */
  fewest(units: number): number | null;
  /** The heaviest-first fewest-Plate stack for `units` grid units, or null if unloadable. */
  pick(units: number): Plate[] | null;
  /** The fewest Plates for `units` with NO Sleeve limit (to see where the Sleeve binds). */
  fewestUncapped(units: number): number | null;
}

const cache = new WeakMap<readonly Plate[], Map<string, FewestOracle>>();

export function fewestOracle(
  inventory: readonly Plate[],
  gridKg: number,
  sleeveMm: number = SLEEVE_MM,
): FewestOracle {
  // Cached per Inventory ARRAY (and grid, Sleeve): pick() hands back that array's own
  // Plate objects, so two Inventories must never share an entry.
  const byInventory = cache.get(inventory) ?? new Map<string, FewestOracle>();
  cache.set(inventory, byInventory);
  const key = `${gridKg}@${sleeveMm}`;
  const hit = byInventory.get(key);
  if (hit) return hit;

  const plates = [...inventory].sort((a, b) => b.kg - a.kg);
  const n = plates.length;
  const units = plates.map((p) => {
    const u = Math.round(p.kg / gridKg);
    if (u < 1 || Math.abs(u * gridKg - p.kg) > 1e-9) {
      throw new Error(`fewest oracle: Plate ${p.kg} kg is off the ${gridKg} kg grid`);
    }
    return u;
  });
  const widths = plates.map((p) => p.widthMm);
  const maxCount = Math.floor(sleeveMm / Math.min(...widths));
  const maxUnits = maxCount * Math.max(...units);
  const size = (maxCount + 1) * (maxUnits + 1);
  const at = (c: number, s: number) => c * (maxUnits + 1) + s;

  // W[i] for i = n is the empty denomination list: only (0 Plates, sum 0) at width 0.
  const W: Float64Array[] = new Array(n + 1);
  W[n] = new Float64Array(size).fill(Infinity);
  W[n][at(0, 0)] = 0;
  for (let i = n - 1; i >= 0; i--) {
    const next = W[i + 1];
    const row = new Float64Array(size).fill(Infinity);
    for (let c = 0; c <= maxCount; c++) {
      for (let s = 0; s <= maxUnits; s++) {
        let best = next[at(c, s)]; // use no more of denomination i
        if (c > 0 && s >= units[i]) {
          const withOne = row[at(c - 1, s - units[i])] + widths[i]; // one more of i
          if (withOne < best) best = withOne;
        }
        row[at(c, s)] = best;
      }
    }
    W[i] = row;
  }

  const fits = (mm: number) => mm <= sleeveMm + 1e-9;
  const fewestIn = (s: number, limitMm: number): number | null => {
    if (s < 0 || s > maxUnits) return null;
    for (let c = 0; c <= maxCount; c++) if (W[0][at(c, s)] <= limitMm + 1e-9) return c;
    return null;
  };
  const sums: number[] = [];
  for (let s = 0; s <= maxUnits; s++) if (fewestIn(s, sleeveMm) !== null) sums.push(s);

  const oracle: FewestOracle = {
    plates,
    gridKg,
    sums,
    fewest: (units) => fewestIn(units, sleeveMm),
    fewestUncapped: (units) => fewestIn(units, Infinity),
    pick(target) {
      const count = fewestIn(target, sleeveMm);
      if (count === null) return null;
      const out: Plate[] = [];
      let left = target;
      let mmLeft = sleeveMm;
      let from = 0;
      for (let c = count; c > 0; c--) {
        let took = false;
        for (let i = from; i < n; i++) {
          if (units[i] > left) continue;
          const rest = W[i][at(c - 1, left - units[i])];
          if (fits(rest + widths[i] + (sleeveMm - mmLeft))) {
            out.push(plates[i]);
            left -= units[i];
            mmLeft -= widths[i];
            from = i;
            took = true;
            break;
          }
        }
        if (!took) throw new Error('fewest oracle: table and read-off disagree');
      }
      return out;
    },
  };
  byInventory.set(key, oracle);
  return oracle;
}

/** The greatest loadable Side sum (grid units) at or under `budgetUnits`. */
export function greatestSumAtOrUnder(o: FewestOracle, budgetUnits: number): number {
  let best = 0;
  for (const s of o.sums) {
    if (s <= budgetUnits) best = s;
    else break;
  }
  return best;
}

/** A readable stack, e.g. "35+25", for failure messages. */
export function show(side: readonly Plate[] | null): string {
  if (side === null) return 'none';
  return side.length === 0 ? '(bare)' : side.map((p) => p.label ?? String(p.kg)).join('+');
}

const cappedCache = new WeakMap<readonly InventoryEntry[], Map<string, FewestOracle>>();

/**
 * The same oracle for a CAPPED Inventory (RBAR-72, ADR-0016): each entry's
 * `maxPerSide` bounds how many of that size one Side may take (undefined = unlimited,
 * 0 = none). A bounded-knapsack DP, independent of the solver and of `fewestOracle`'s
 * one-at-a-time recurrence:
 *
 *   B[i][c][s] = min over k = 0..min(cap_i, c) of B[i+1][c-k][s-k*u_i] + k*w_i,
 *
 * the narrowest stack of exactly c Plates from sizes i..n-1 (heaviest first), at most
 * cap_i of size i, summing to s grid units. The heaviest-first stack is read off size
 * by size: of each size in turn take the MOST that still leaves a completable, fitting
 * rest -- which is the lexicographically heaviest stack among the fewest (any stack
 * with fewer of the heaviest size it could have taken diverges there with a lighter
 * Plate). Cached like `fewestOracle`, per Inventory array.
 */
export function cappedFewestOracle(
  inventory: readonly InventoryEntry[],
  gridKg: number,
  sleeveMm: number = SLEEVE_MM,
): FewestOracle {
  const byInventory = cappedCache.get(inventory) ?? new Map<string, FewestOracle>();
  cappedCache.set(inventory, byInventory);
  const key = `${gridKg}@${sleeveMm}`;
  const hit = byInventory.get(key);
  if (hit) return hit;

  const plates = inventory
    .filter((p) => p.maxPerSide !== 0)
    .sort((a, b) => b.kg - a.kg || a.widthMm - b.widthMm);
  const n = plates.length;
  const units = plates.map((p) => {
    const u = Math.round(p.kg / gridKg);
    if (u < 1 || Math.abs(u * gridKg - p.kg) > 1e-9) {
      throw new Error(`capped oracle: Plate ${p.kg} kg is off the ${gridKg} kg grid`);
    }
    return u;
  });
  const widths = plates.map((p) => p.widthMm);
  const caps = plates.map((p) => p.maxPerSide ?? Infinity);
  const byWidth = n === 0 ? 0 : Math.floor(sleeveMm / Math.min(...widths));
  const maxCount = Math.min(byWidth, caps.reduce((a, b) => a + b, 0));
  const maxUnits = n === 0 ? 0 : maxCount * Math.max(...units);
  const size = (maxCount + 1) * (maxUnits + 1);
  const at = (c: number, s: number) => c * (maxUnits + 1) + s;

  const B: Float64Array[] = new Array(n + 1);
  B[n] = new Float64Array(size).fill(Infinity);
  B[n][at(0, 0)] = 0;
  for (let i = n - 1; i >= 0; i--) {
    const next = B[i + 1];
    const row = new Float64Array(size).fill(Infinity);
    for (let c = 0; c <= maxCount; c++) {
      for (let s = 0; s <= maxUnits; s++) {
        let best = Infinity;
        for (let k = 0; k <= Math.min(caps[i], c) && k * units[i] <= s; k++) {
          const w = next[at(c - k, s - k * units[i])] + k * widths[i];
          if (w < best) best = w;
        }
        row[at(c, s)] = best;
      }
    }
    B[i] = row;
  }

  const fewestIn = (s: number, limitMm: number): number | null => {
    if (s < 0 || s > maxUnits) return null;
    for (let c = 0; c <= maxCount; c++) if (B[0][at(c, s)] <= limitMm + 1e-9) return c;
    return null;
  };
  const sums: number[] = [];
  for (let s = 0; s <= maxUnits; s++) if (fewestIn(s, sleeveMm) !== null) sums.push(s);

  const oracle: FewestOracle = {
    plates,
    gridKg,
    sums,
    fewest: (s) => fewestIn(s, sleeveMm),
    fewestUncapped: (s) => fewestIn(s, Infinity),
    pick(target) {
      const count = fewestIn(target, sleeveMm);
      if (count === null) return null;
      const out: InventoryEntry[] = [];
      let c = count;
      let left = target;
      let usedMm = 0;
      for (let i = 0; i < n; i++) {
        for (let k = Math.min(caps[i], c, Math.floor(left / units[i])); k >= 0; k--) {
          const rest = B[i + 1][at(c - k, left - k * units[i])];
          if (usedMm + k * widths[i] + rest <= sleeveMm + 1e-9) {
            for (let m = 0; m < k; m++) out.push(plates[i]);
            c -= k;
            left -= k * units[i];
            usedMm += k * widths[i];
            break;
          }
        }
      }
      if (c !== 0 || left !== 0) throw new Error('capped oracle: table and read-off disagree');
      return out;
    },
  };
  byInventory.set(key, oracle);
  return oracle;
}
