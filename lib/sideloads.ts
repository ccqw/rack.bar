// The exact Side Loads for an Inventory under a Sleeve (RBAR-69; ADR-0003 as amended
// 2026-10-16, ADR-0012): which Plates go on one Side. Decode's primary and round-up use
// it today; RBAR-66's alternate loadouts ("Another way") and RBAR-65's ramps are meant
// to call the same functions, so every loadout the app shows is ranked by one rule:
//
//   1. a stack must fit the Sleeve (ADR-0012) -- a hard filter, never a ranking key;
//   2. the Side sum comes first: the greatest one at or under the budget (ADR-0003);
//   3. then the fewest Plates reaching that sum;
//   4. then, among equally few, heaviest-first: compare the heaviest Plate, then the
//      next (lexicographic over the heaviest-first stack).
//
// Heaviest-first greedy is not exact for this on every set: on the iron
// {45,35,25,10,5,2.5} lb ladder a 60 lb Side is 35 + 25 where greedy loads 45 + 10 + 5,
// and removing one size from either set breaks it further (Eleiko without its 0.5s:
// greedy fills a 3 kg Side with 2.5 and misses 2 + 1 entirely). This search is exact
// for any Inventory whose Plates share a grid. Where greedy WAS fewest-Plate its stack
// is also the heaviest-first one, so those loads come out identical, order included.
//
// Pure and stateless (ADR-0001): no memo, nothing cached between calls. Bar and Collar
// arithmetic stays with the callers -- a Side sum is (Total - Bar baseline) / 2.
//
// `inventory` here is the v1 unlimited Inventory (ADR-0002): a list of Plate SIZES,
// each available in any count; the Sleeve is the only limit. A finite Inventory (pair
// counts, RBAR-6) is not supported -- it would need a per-size cap in the walk. Two
// sizes with the same mass but different widths are distinct denominations (a
// different physical stack); they rank narrower-first so the order never depends on
// the Inventory's own order. No shipped set has such a pair.
import { SLEEVE_MM, plateFitsMm } from './plates.ts';
import type { Plate } from './plates.ts';

// Plate masses are exact binary fractions (Eleiko) or products of the exact lb factor
// (iron), so sums drift by ~1e-14 at most; this absorbs that and nothing larger.
const EPS = 1e-9;

// The finest grid plateGridKg will try: the smallest Plate / MAX_GRID_DIVISOR.
const MAX_GRID_DIVISOR = 1000;

/**
 * Reject inputs the search cannot reason about: a Sleeve or a Plate mass or width that
 * is not a positive finite number (a zero width or an infinite Sleeve would make the
 * Sleeve bound infinite and the grid walk endless; a NaN or non-positive Sleeve would
 * silently load nothing).
 */
function assertInputs(inventory: readonly Plate[], sleeveMm: number): void {
  if (!(sleeveMm > 0) || !Number.isFinite(sleeveMm)) {
    throw new RangeError(`sideloads: Sleeve ${sleeveMm} mm is not a positive number`);
  }
  assertPlates(inventory);
}

function assertPlates(inventory: readonly Plate[]): void {
  for (const p of inventory) {
    if (!(p.kg > 0) || !Number.isFinite(p.kg)) {
      throw new RangeError(`sideloads: Plate mass ${p.kg} kg is not a positive number`);
    }
    if (!(p.widthMm > 0) || !Number.isFinite(p.widthMm)) {
      throw new RangeError(`sideloads: Plate width ${p.widthMm} mm is not a positive number`);
    }
  }
}

// Heaviest first; equal masses narrower-first, so the rank order is total.
function heaviestFirst(inventory: readonly Plate[]): Plate[] {
  return [...inventory].sort((a, b) => b.kg - a.kg || a.widthMm - b.widthMm);
}

/**
 * The step every Side sum on `inventory` lies on: the largest g with every Plate an
 * integer multiple of it. The smallest Plate when it divides the rest (0.5 kg Eleiko,
 * 2.5 lb iron); finer when it does not (Eleiko without its 0.5s still makes half-kg
 * sums from 2.5 and 1.5). Throws a RangeError for an empty Inventory, a non-positive
 * or non-finite Plate mass or width, or Plates with no common grid (each within EPS)
 * down to 1/1000 of the smallest: no shipped set does any of these (test-locked), and
 * the exact search cannot run without a grid -- a silent fallback would hide the
 * broken Inventory.
 */
export function plateGridKg(inventory: readonly Plate[]): number {
  if (inventory.length === 0) throw new RangeError('plateGridKg: empty Inventory');
  assertPlates(inventory);
  const smallest = Math.min(...inventory.map((p) => p.kg));
  for (let d = 1; d <= MAX_GRID_DIVISOR; d++) {
    const g = smallest / d;
    // Every Plate must sit on the grid to within EPS kg -- the same tolerance the search
    // matches sums with, so a Plate the walk would treat as off-grid is never accepted.
    if (inventory.every((p) => Math.abs(p.kg - Math.round(p.kg / g) * g) <= EPS)) return g;
  }
  throw new RangeError('plateGridKg: the Plates share no common grid');
}

/**
 * Every distinct Side Load that reaches exactly `sideKg` and fits `sleeveMm`, lazily,
 * in rank order (fewest Plates, then heaviest-first). The first is the canonical Side
 * Load; RBAR-66 takes the first few. Each stack is heaviest-first, a fresh array, and
 * holds the Inventory's own Plate objects. A zero sum yields one empty stack (the bare
 * Bar); nothing is yielded when no stack reaches the sum (off-grid, negative, heavier
 * than the Sleeve can carry, or an empty Inventory). Throws a RangeError, at the call,
 * for a Plate with a bad mass or width or a Sleeve that is not a positive finite
 * length -- as do sideAtOrUnder and sideAbove, which also need a common grid
 * (plateGridKg).
 *
 * Method: iterative deepening on the Plate count (1, 2, 3, ...), and at each count a
 * depth-first walk over non-increasing stacks, heaviest denomination first -- so stacks
 * arrive already in rank order and no duplicate can arise. Prunes: the rest of the sum
 * must be buildable in the remaining slots (between the lightest Plate and the current
 * one per slot), and the rest must fit the Sleeve at its narrowest and be carriable at
 * the densest remaining kg-per-mm.
 */
export function sideLoads(
  sideKg: number,
  inventory: readonly Plate[],
  sleeveMm: number = SLEEVE_MM,
): IterableIterator<readonly Plate[]> {
  assertInputs(inventory, sleeveMm); // eagerly, at the call, not on the first next()
  return walkSides(sideKg, inventory, sleeveMm);
}

function* walkSides(
  sideKg: number,
  inventory: readonly Plate[],
  sleeveMm: number,
): Generator<readonly Plate[], void, undefined> {
  if (!Number.isFinite(sideKg) || sideKg < -EPS) return;
  if (Math.abs(sideKg) <= EPS) {
    yield [];
    return;
  }
  if (inventory.length === 0) return;

  const plates = heaviestFirst(inventory);
  const n = plates.length;
  const lightestKg = plates[n - 1].kg;
  // Suffix bounds over plates[j..]: the narrowest width and the densest kg-per-mm.
  const narrowestFrom: number[] = new Array(n + 1).fill(Infinity);
  const densestFrom: number[] = new Array(n + 1).fill(0);
  for (let j = n - 1; j >= 0; j--) {
    narrowestFrom[j] = Math.min(narrowestFrom[j + 1], plates[j].widthMm);
    densestFrom[j] = Math.max(densestFrom[j + 1], plates[j].kg / plates[j].widthMm);
  }
  if (sideKg > densestFrom[0] * sleeveMm + EPS) return; // heavier than the Sleeve holds
  // No stack needs more Plates than fit the Sleeve, or than the lightest Plate allows.
  const maxCount = Math.min(
    Math.floor((sleeveMm + EPS) / narrowestFrom[0]),
    Math.floor((sideKg + EPS) / lightestKg),
  );

  const stack: Plate[] = [];
  // Place `slots` more Plates from plates[from..], summing to `kgLeft`, after `usedMm`.
  function* walk(
    from: number,
    slots: number,
    kgLeft: number,
    usedMm: number,
  ): Generator<readonly Plate[], void, undefined> {
    if (slots === 0) {
      if (Math.abs(kgLeft) <= EPS) yield [...stack];
      return;
    }
    for (let j = from; j < n; j++) {
      const p = plates[j];
      if (p.kg > kgLeft + EPS) continue; // too heavy; a lighter one may still do
      if (p.kg * slots < kgLeft - EPS) break; // even all-p falls short; lighter is worse
      const rest = kgLeft - p.kg;
      if (rest < (slots - 1) * lightestKg - EPS) continue; // too little left for the rest
      // This Plate plus the narrowest possible rest must fit the Sleeve...
      if (!plateFitsMm(usedMm + (slots - 1) * narrowestFrom[j], p, sleeveMm)) continue;
      // ...and the rest must be carriable in the room left, at the best density.
      if (rest > densestFrom[j] * (sleeveMm - usedMm - p.widthMm) + EPS) continue;
      stack.push(p);
      yield* walk(j, slots - 1, rest, usedMm + p.widthMm);
      stack.pop();
    }
  }
  for (let count = 1; count <= maxCount; count++) yield* walk(0, count, sideKg, 0);
}

/** The canonical Side Load for exactly `sideKg` (sideLoads' first), or null. */
export function canonicalSide(
  sideKg: number,
  inventory: readonly Plate[],
  sleeveMm: number = SLEEVE_MM,
): readonly Plate[] | null {
  for (const side of sideLoads(sideKg, inventory, sleeveMm)) return side;
  return null;
}

// The heaviest Side the Sleeve could ever carry: every mm at the densest kg-per-mm.
function sleeveBoundKg(inventory: readonly Plate[], sleeveMm: number): number {
  return Math.max(...inventory.map((p) => p.kg / p.widthMm)) * sleeveMm;
}

/**
 * Decode's fill (ADR-0003, ADR-0012): the canonical Side Load of the greatest Side sum
 * at or under `budgetKg` that some stack loads within the Sleeve. Walks the grid down
 * from the budget (capped at what the Sleeve could carry) to the first loadable sum;
 * the empty Side when nothing at or under the budget loads (a budget under the lightest
 * Plate, a non-positive or NaN budget, or an empty Inventory).
 */
export function sideAtOrUnder(
  budgetKg: number,
  inventory: readonly Plate[],
  sleeveMm: number = SLEEVE_MM,
): readonly Plate[] {
  assertInputs(inventory, sleeveMm);
  if (inventory.length === 0 || !(budgetKg > 0)) return [];
  const grid = plateGridKg(inventory);
  const cap = Math.min(budgetKg, sleeveBoundKg(inventory, sleeveMm));
  for (let units = Math.floor((cap + EPS) / grid); units >= 1; units--) {
    const side = canonicalSide(units * grid, inventory, sleeveMm);
    if (side) return side;
  }
  return [];
}

/**
 * The round-up (ADR-0003 RBAR-11; ADR-0012 as amended by RBAR-62): the canonical Side
 * Load of the least Side sum strictly above `budgetKg` that some stack loads within the
 * Sleeve, or null when the Sleeve holds nothing heavier (or the Inventory is empty).
 * Walks the grid up from the first grid sum above the budget, so in the sleeve-bound
 * band it may skip unloadable sums.
 */
export function sideAbove(
  budgetKg: number,
  inventory: readonly Plate[],
  sleeveMm: number = SLEEVE_MM,
): readonly Plate[] | null {
  assertInputs(inventory, sleeveMm);
  if (inventory.length === 0 || Number.isNaN(budgetKg)) return null;
  const grid = plateGridKg(inventory);
  const top = Math.floor((sleeveBoundKg(inventory, sleeveMm) + EPS) / grid);
  // At least one grid step: the empty Side is never a round-up, even for a budget
  // below zero.
  const from = Math.max(1, Math.floor((budgetKg + EPS) / grid) + 1);
  for (let units = from; units <= top; units++) {
    const side = canonicalSide(units * grid, inventory, sleeveMm);
    if (side) return side;
  }
  return null;
}
