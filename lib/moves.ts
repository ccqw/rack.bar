// Caitlin's station rule for a warm-up Ramp (RBAR-65 slice 4b, ADR-0015 as amended
// 2026-10-17, "the station rule"). planRamp (plan.ts) picks each Warm-up set's nearest
// loadable Total on its own; this pass re-picks the whole Ramp the way Caitlin loads
// it by hand, from the Plates she has gathered at her station.
//
// The stack (her words: "I'll be willing to load on a large diameter plate that's
// heavier than the innermost one as I go up in weight, but I wouldn't put a little
// plate on the inside with a big plate outside it"):
//   - A big Plate is full diameter (BIG_PLATE_DIAMETER_MM: Eleiko 25-10 kg, the iron
//     45 lb). Big Plates go on in ANY order.
//   - Every other Plate is small. Small Plates sit only outside every big Plate,
//     heaviest-first.
//   - At most PLATES_PER_SIZE of each size per Side ("I probably don't have more than 4
//     of most things"). When 2 of each cannot load the Working Total, each size's cap
//     rises to the count Decode's own Side uses. Either way a size never goes past the
//     lifter's pairs on hand, and a size on hand as none is no size (ADR-0016).
//
// So a Side is an ordered stack, inside -> outside, and is NOT always heaviest-first.
// Going from one set to the next takes off every Plate outside the longest common
// inside run, then puts on the rest of the new Side (movesBetween).
//
// The Ramp: the Working set is exactly Decode's at-or-under Total (ADR-0003; its Side
// may be any legal stack). Each Warm-up set is within RAMP_BAND of the Working Total
// of pct x Working Total, at or above the bare rig, and at or under the Working Total.
// Totals never decrease, and a repeated Total (sameAsPrevious) is avoided wherever the
// band allows: each repeat counts against the Ramp. A row with no loadable Total in
// its band falls back to the nearest loadable Totals either side. Percentages must not
// fall (planRamp throws). Under Plate limits the rule is the same: the band widens only
// as far as the Plates on hand force it (band excess ranks first), and a row that ends
// up more than RAMP_BAND from its percentage is flagged `drift` so the stairs can say so
// (ADR-0016 as amended, RBAR-72 slice 3). Those keys rank first: [band excess, repeated
// Totals], then the weighted cost (RAMP_COST, summed over the Ramp):
//   - missPerKg per kg of Total from the percentage (x overFactor when over);
//   - perPlate per Plate on each Warm-up set;
//   - bigOff per big Plate taken off, and perMove per Plate taken off or put on;
//   - perStationPlate per Plate needed at the station (for each size, the most of it
//     the Ramp ever needs on one Side, summed).
// Ties go to fewer weighted moves, then closeness, then fewer Plates.
//
// The search is a dynamic programme over rows. A state is (this row's Side, the
// station so far); a state is dropped only when another provably beats it for every
// future (dominance), so the DP is exact over its candidates. On a small Inventory
// (EXHAUSTIVE_LIMIT) the candidates are every legal Side in the row's Totals, in every
// order, so the plan is exact. On a full set they are pruned: per row the
// CANDIDATES_PER_ROW multisets cheapest on their own (miss + Plates), in their
// orderings, plus every Side that keeps the previous row's whole stack (or its big
// Plates) and adds up to MAX_ADDED Plates; and only the BEAM best states go on to the
// next row. That keeps a whole Ramp to a few ms (ADR-0015 has the numbers).
//
// A Side is drawn in the order given here: the sleeve and the share text never
// re-sort it (pinned in elements/sleeve.test.ts and lib/summary.test.ts).
import { SLEEVE_MM, barWithCollars, totalKg } from './plates.ts';
import type { InventoryEntry, Plate } from './plates.ts';
import { RAMP_BAND, drifted, planRamp } from './plan.ts';
import type { PlanOptions, Ramp, RampRig, RampRow, RampStep } from './plan.ts';
import { hasUsablePlates, plateGridKg } from './sideloads.ts';

const EPS = 1e-9;

/** A Plate this wide (mm diameter) or wider is big: it may go on in any order. */
export const BIG_PLATE_DIAMETER_MM = 450;

/** Plates of each size per Side the station rule plans with, within the pairs on hand. */
export const PLATES_PER_SIZE = 2;

// RAMP_BAND (how far a Warm-up set may sit from its percentage) lives in plan.ts, next
// to `drifted`, the rule that flags a row past it; re-exported for the planner's callers.
export { RAMP_BAND };

/** The station rule's weights (fitted to Caitlin's hand loads, ADR-0015). */
export const RAMP_COST = {
  /** Per kg of Total a Warm-up set sits from pct x Working Total... */
  missPerKg: 1,
  /** ...times this when it sits over. */
  overFactor: 1.5,
  /** Per Plate on each Warm-up set (one Side). */
  perPlate: 1,
  /** Per big Plate taken off between sets. */
  bigOff: 2,
  /** Per Plate taken off or put on between sets. */
  perMove: 0.2,
  /** Per Plate needed at the station. */
  perStationPlate: 0.2,
} as const;

/** On a full set: the multisets per row kept by their own cost (miss + Plates). */
export const CANDIDATES_PER_ROW = 30;

/** On a full set: how many Plates a kept Side may add on top of the previous row's. */
export const MAX_ADDED = 2;

/** An Inventory with at most this many ordered legal Sides (every capped multiset in
 * every order of its big Plates) is searched exhaustively. */
export const EXHAUSTIVE_LIMIT = 256;

// On a full set: the best DP states carried to the next row, and how many of them seed
// its candidate Sides; and the states kept per candidate.
const BEAM = 60;
const SEED_STATES = 12;
const STATES_PER_CAND = 2;

// On a full set, a multiset's big Plates are tried in every order when there are at
// most this many orders; past it, heaviest-first plus the orders that keep a previous
// row's inside Plates.
const ORDER_LIMIT = 6;

/** Whether `plate` is full diameter: big Plates may go on in any order. */
export function isBigPlate(plate: Plate): boolean {
  return plate.diameterMm >= BIG_PLATE_DIAMETER_MM - EPS;
}

/**
 * Whether `side` (inside -> outside) is a legal stack: no small Plate inside a big
 * one, small Plates heaviest-first, and at most `cap` of each Plate.
 */
export function isLegalSide(side: readonly Plate[], cap: number = PLATES_PER_SIZE): boolean {
  const counts = new Map<Plate, number>();
  let sawSmall = false;
  for (let i = 0; i < side.length; i++) {
    const p = side[i];
    const n = (counts.get(p) ?? 0) + 1;
    if (n > cap) return false;
    counts.set(p, n);
    if (isBigPlate(p)) {
      if (sawSmall) return false;
    } else {
      if (sawSmall && side[i - 1].kg < p.kg - EPS) return false;
      sawSmall = true;
    }
  }
  return true;
}

/** The Plates to take off and put on, one Side, to go from one set to the next. */
export interface Moves {
  /** Taken off, outermost first (the order you remove them). */
  readonly off: readonly Plate[];
  /** Put on, innermost first (the order you load them). */
  readonly on: readonly Plate[];
  /** RAMP_COST.bigOff per big Plate off plus RAMP_COST.perMove per Plate moved. */
  readonly cost: number;
}

/**
 * The Plate moves from Side `from` to Side `to` (both inside -> outside): off with
 * everything outside their longest common inside run, then on with the rest of `to`.
 * Plates match by identity -- the Inventory's own Plate objects.
 */
export function movesBetween(from: readonly Plate[], to: readonly Plate[]): Moves {
  let k = 0;
  while (k < from.length && k < to.length && from[k] === to[k]) k++;
  const off = from.slice(k).reverse();
  const on = to.slice(k);
  const bigs = off.filter(isBigPlate).length;
  return { off, on, cost: RAMP_COST.bigOff * bigs + RAMP_COST.perMove * (off.length + on.length) };
}

/** The Plates a Ramp needs at the station: per Plate, the most on any one Side, summed. */
export function stationPlates(sides: readonly (readonly Plate[])[]): number {
  const most = new Map<Plate, number>();
  for (const side of sides) {
    const here = new Map<Plate, number>();
    for (const p of side) here.set(p, (here.get(p) ?? 0) + 1);
    for (const [p, n] of here) most.set(p, Math.max(most.get(p) ?? 0, n));
  }
  let sum = 0;
  for (const n of most.values()) sum += n;
  return sum;
}

/** A Ramp row with the Plate moves that get there from the row before. */
export type EasyRow = RampRow & {
  /** From the previous row's Side (the bare Bar for the first row). */
  readonly moves: Moves;
};

/** A Ramp planned by the station rule. */
export interface EasyRamp {
  readonly rows: readonly EasyRow[];
  /** The Working set's Decode, as planRamp returns it (its round-up included). */
  readonly working: Ramp['working'];
  /** The summed move cost (each row's `moves.cost`). */
  readonly totalMoves: number;
  /** The Plates needed at the station (stationPlates over the rows). */
  readonly station: number;
  /** The Ramp's whole weighted cost under RAMP_COST. */
  readonly cost: number;
  /**
   * True when the pruned search found no Ramp through its candidates and the rows are
   * planRamp's own (nearest Totals, Decode's Working Side) instead. Never expected; the
   * property suite asserts it stays false, so a pruning bug fails loudly there.
   */
  readonly degraded: boolean;
}

// --- The search ----------------------------------------------------------------

/** One denomination, in heaviest-first rank (equal masses narrower-first). */
interface Size {
  readonly plate: InventoryEntry;
  readonly big: boolean;
  /** Its mass in grid units. */
  readonly units: number;
}

/** One candidate Side for a row. */
interface Cand {
  /** Size indices, inside -> outside. */
  readonly seq: readonly number[];
  readonly key: string;
  readonly counts: Uint8Array;
  readonly total: number;
  /** Band excess (kg) and the row's own cost (miss + Plates), Warm-up sets only. */
  readonly excess: number;
  readonly own: number;
  /** |total - raw| for a Warm-up set. */
  readonly miss: number;
  /** bigsFrom[k] = big Plates in seq[k..]. */
  readonly bigsFrom: Uint8Array;
}

/** A DP state: a path's end on one candidate, with its station so far. */
interface State {
  readonly excess: number;
  readonly repeats: number;
  readonly cost: number;
  readonly moves: number;
  readonly miss: number;
  readonly plates: number;
  /** most[j] = the most of size j on any one Side so far; station = their sum. */
  readonly most: Uint8Array;
  readonly station: number;
  readonly back: State | null;
  readonly cand: Cand;
}

/** a < b on the leading keys [excess, repeats, cost] alone. */
function lessHead(a: State, b: State): boolean {
  if (a.excess < b.excess - EPS) return true;
  if (a.excess > b.excess + EPS) return false;
  if (a.repeats !== b.repeats) return a.repeats < b.repeats;
  return a.cost < b.cost - EPS;
}

function lessHead2(excess: number, repeats: number, cost: number, b: State): boolean {
  if (excess < b.excess - EPS) return true;
  if (excess > b.excess + EPS) return false;
  if (repeats !== b.repeats) return repeats < b.repeats;
  return cost < b.cost - EPS;
}

const byKey = (x: State, y: State) => (lessKey(x, y) ? -1 : lessKey(y, x) ? 1 : 0);

function lessKey(a: State, b: State): boolean {
  if (a.excess < b.excess - EPS) return true;
  if (a.excess > b.excess + EPS) return false;
  if (a.repeats !== b.repeats) return a.repeats < b.repeats;
  if (a.cost < b.cost - EPS) return true;
  if (a.cost > b.cost + EPS) return false;
  if (a.moves < b.moves - EPS) return true;
  if (a.moves > b.moves + EPS) return false;
  if (a.miss < b.miss - EPS) return true;
  if (a.miss > b.miss + EPS) return false;
  return a.plates < b.plates;
}

/**
 * Whether `a` is at least as good as `b` for every way the Ramp can go on. The excess
 * and repeats keys add up independently of the station; on equal ones, the most `a`
 * can still pay over `b` for the station later is perStationPlate per Plate `b`'s
 * station already holds beyond `a`'s.
 */
function dominates(a: State, b: State): boolean {
  if (a.excess < b.excess - EPS) return true;
  if (a.excess > b.excess + EPS) return false;
  if (a.repeats !== b.repeats) return a.repeats < b.repeats;
  let slack = 0;
  let same = true;
  for (let j = 0; j < a.most.length; j++) {
    if (a.most[j] !== b.most[j]) same = false;
    if (b.most[j] > a.most[j]) slack += b.most[j] - a.most[j];
  }
  if (same) return !lessKey(b, a);
  return a.cost + RAMP_COST.perStationPlate * slack < b.cost - EPS;
}

/**
 * Plan a warm-up Ramp like planRamp, then re-pick every Warm-up set's Total and Side,
 * and the Working set's Side, by the station rule (ADR-0015 as amended 2026-10-17).
 * Same arguments, same row order and count, same bare-Bar rows, and the same Working
 * Total; each row also carries the `moves` from the row before. Throws whatever
 * planRamp throws.
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
  // The Working row is planRamp's: Decode's at-or-under load, or its round-up when that
  // reads short (workingLoad, RBAR-87). Its Total is fixed; only its Side may change.
  const workRow = nearest.rows[nearest.rows.length - 1];
  const workingTotal = workRow.total;

  // No Plates to load (an empty Inventory, one whose every size is none -- ADR-0016's
  // hasUsablePlates -- or a Working Total on the bare rig): every row is planRamp's
  // bare-rig row, so plateGridKg never sees a set with nothing to load.
  if (!hasUsablePlates(inventory) || nearest.rows.every((r) => r.side.length === 0)) {
    return finish(nearest, nearest.rows.map((r) => r.side));
  }

  const grid = plateGridKg(inventory);
  // Only the sizes the lifter has (ADR-0016): a size limited to none is no size here,
  // and a limited one never goes past its pairs on hand (RBAR-72 slice 2).
  const sizes: Size[] = inventory
    .filter((p) => p.maxPerSide !== 0)
    .sort((a, b) => b.kg - a.kg || a.widthMm - b.widthMm)
    .map((plate) => ({ plate, big: isBigPlate(plate), units: Math.round(plate.kg / grid) }));
  const n = sizes.length;
  const indexOf = new Map(sizes.map((s, j) => [s.plate, j]));
  const unitsOf = (total: number) => Math.round((total - baselineKg) / 2 / grid);
  const totalOf = (units: number) => baselineKg + 2 * units * grid;
  const workUnits = unitsOf(workingTotal);
  const tol = Math.max(RAMP_BAND * workingTotal, grid);

  // The cap per size: PLATES_PER_SIZE, unless that cannot load the Working Total; then
  // each size may go up to the count the Working row's Decode Side uses (ADR-0003's
  // stack, or the round-up's).
  // A size's own Plate limit caps both (Decode's Side already respects it).
  const onHand = (s: Size) => s.plate.maxPerSide ?? Infinity;
  let caps = sizes.map((s) => Math.min(PLATES_PER_SIZE, onHand(s)));
  let loadable = loadableUnits(sizes, caps, sleeveMm, workUnits);
  if (!loadable[workUnits]) {
    caps = sizes.map((s) =>
      Math.min(
        onHand(s),
        Math.max(PLATES_PER_SIZE, workRow.side.filter((p) => p === s.plate).length),
      ),
    );
    loadable = loadableUnits(sizes, caps, sleeveMm, workUnits);
  }
  const exhaustive = orderedSides(sizes, caps, EXHAUSTIVE_LIMIT) <= EXHAUSTIVE_LIMIT;

  // Suffix bounds for the multiset walk: the most units sizes[j..] can add.
  const maxFrom = new Array<number>(n + 1).fill(0);
  for (let j = n - 1; j >= 0; j--) maxFrom[j] = maxFrom[j + 1] + caps[j] * sizes[j].units;

  const makeCand = (seq: readonly number[], kind: RampRow['kind'], raw: number): Cand => {
    const counts = new Uint8Array(n);
    let units = 0;
    for (const j of seq) {
      counts[j]++;
      units += sizes[j].units;
    }
    const bigsFrom = new Uint8Array(seq.length + 1);
    for (let k = seq.length - 1; k >= 0; k--) bigsFrom[k] = bigsFrom[k + 1] + (sizes[seq[k]].big ? 1 : 0);
    const total = totalOf(units);
    let excess = 0, own = 0, miss = 0;
    if (kind === 'warmup') {
      miss = Math.abs(total - raw);
      excess = Math.max(0, miss - tol);
      own = RAMP_COST.missPerKg * miss * (total > raw + EPS ? RAMP_COST.overFactor : 1) +
        RAMP_COST.perPlate * seq.length;
    }
    return { seq, key: seq.join(','), counts, total, excess, own, miss, bigsFrom };
  };

  const widthOk = (counts: Uint8Array) => {
    let mm = 0;
    for (let j = 0; j < n; j++) mm += counts[j] * sizes[j].plate.widthMm;
    return mm <= sleeveMm + EPS;
  };

  // Every distinct order of a multiset's big Plates (bigs listed heaviest-first).
  const bigOrders = (bigs: readonly number[], limit: number): number[][] | null => {
    const out: number[][] = [];
    const left = new Map<number, number>();
    for (const j of bigs) left.set(j, (left.get(j) ?? 0) + 1);
    const kinds = [...left.keys()];
    const cur: number[] = [];
    const walk = (): boolean => {
      if (cur.length === bigs.length) {
        out.push([...cur]);
        return out.length <= limit;
      }
      for (const j of kinds) {
        const c = left.get(j)!;
        if (c === 0) continue;
        left.set(j, c - 1);
        cur.push(j);
        const go = walk();
        cur.pop();
        left.set(j, c);
        if (!go) return false;
      }
      return true;
    };
    return walk() ? out : null;
  };

  // The Side for multiset `counts` that keeps the longest legal inside run of `prev`.
  const keepPrefix = (counts: Uint8Array, prev: readonly number[]): number[] => {
    const left = Uint8Array.from(counts);
    const seq: number[] = [];
    let bigsLeft = 0;
    for (let j = 0; j < n; j++) if (sizes[j].big) bigsLeft += left[j];
    for (const j of prev) {
      if (left[j] === 0) break;
      if (!sizes[j].big) {
        if (bigsLeft > 0) break;
        // The next small Plate must be the heaviest small one left.
        let heaviest = -1;
        for (let i = 0; i < n; i++) if (!sizes[i].big && left[i] > 0) { heaviest = i; break; }
        if (heaviest !== j) break;
      } else {
        bigsLeft--;
      }
      left[j]--;
      seq.push(j);
    }
    for (let j = 0; j < n; j++) if (sizes[j].big) for (let c = 0; c < left[j]; c++) seq.push(j);
    for (let j = 0; j < n; j++) if (!sizes[j].big) for (let c = 0; c < left[j]; c++) seq.push(j);
    return seq;
  };

  // Each row's candidate Sides.
  const raws = nearest.rows.map((r) => r.targetKg);
  let prevUnits: number[] = [];
  // The DP layer: the surviving states after the previous row, from a virtual start
  // on the bare Bar.
  const start: State = {
    excess: 0, repeats: 0, cost: 0, moves: 0, miss: 0, plates: 0, station: 0,
    most: new Uint8Array(n), back: null,
    cand: { ...makeCand([], 'bar', 0), total: -Infinity },
  };
  let layer: State[] = [start];
  for (let i = 0; i < nearest.rows.length; i++) {
    const row = nearest.rows[i];
    // Off a full set, only the best states go on, and only their Sides seed this row.
    const beam = exhaustive ? layer : [...layer].sort(byKey).slice(0, BEAM);
    const before = [...new Set(beam.slice(0, exhaustive ? beam.length : SEED_STATES).map((st) => st.cand))]
      .filter((c) => c.total > -Infinity);
    const list = row.kind === 'bar' ? [{ ...makeCand([], 'bar', 0), total: barKg }] : candidates(i, row, before);
    layer = advance(beam, list, row.kind);
    // Beam pruning dropped every state this row could climb from: give the lifter
    // planRamp's own Ramp (valid, non-decreasing, Decode's Working Side), flagged.
    if (layer.length === 0) return finish(nearest, nearest.rows.map((r) => r.side), true);
    if (row.kind === 'bar') prevUnits = [];
  }
  let best = layer[0];
  for (const s of layer) if (lessKey(s, best)) best = s;
  const picks: Cand[] = [];
  for (let s: State | null = best; s && s.back; s = s.back) picks.unshift(s.cand);
  return finish(nearest, picks.map((c) => c.seq.map((j) => sizes[j].plate)));

  // This row's candidate Sides, seeded by the previous row's best Sides `before`.
  function candidates(i: number, row: RampRow, before: readonly Cand[]): Cand[] {
    // The Totals this row may take, in grid units.
    const allowed = new Set<number>();
    if (row.kind === 'working') {
      allowed.add(workUnits);
    } else {
      const raw = raws[i];
      const lo = Math.max(0, Math.ceil((raw - tol - baselineKg) / 2 / grid - EPS));
      const hi = Math.min(workUnits, Math.floor((raw + tol - baselineKg) / 2 / grid + EPS));
      for (let u = lo; u <= hi; u++) if (loadable[u]) allowed.add(u);
      if (allowed.size === 0) {
        // Nothing loads in the band: the nearest loadable Totals either side of it.
        const r = (raw - baselineKg) / 2 / grid;
        for (let u = Math.min(workUnits, Math.floor(r)); u >= 0; u--) if (loadable[u]) { allowed.add(u); break; }
        for (let u = Math.max(0, Math.ceil(r)); u <= workUnits; u++) if (loadable[u]) { allowed.add(u); break; }
      }
      // A row that cannot climb may repeat a Total the row before could take.
      const top = Math.max(...allowed);
      for (const u of prevUnits) if (u > top) allowed.add(u);
    }
    prevUnits = [...allowed];
    const kind = row.kind;
    const raw = raws[i];
    const ownOf = (units: number, plates: number) => {
      if (kind !== 'warmup') return plates;
      const total = totalOf(units);
      return RAMP_COST.missPerKg * Math.abs(total - raw) * (total > raw + EPS ? RAMP_COST.overFactor : 1) +
        RAMP_COST.perPlate * plates;
    };
    const lowU = Math.min(...allowed);
    const highU = Math.max(...allowed);
    const missLB = (from: number, to: number) => {
      // The least own-cost miss over units [from, to] within [lowU, highU].
      const a = Math.max(from, lowU), b = Math.min(to, highU);
      if (a > b) return Infinity;
      if (kind !== 'warmup') return 0;
      const r = (raw - baselineKg) / 2 / grid;
      const u = Math.min(Math.max(r, a), b);
      return ownOf(u, 0);
    };

    // The multisets: all of them (exhaustive), or the CANDIDATES_PER_ROW cheapest.
    const limit = exhaustive ? Infinity : CANDIDATES_PER_ROW;
    const kept: { counts: Uint8Array; own: number }[] = [];
    const counts = new Uint8Array(n);
    const bound = () => (kept.length < limit ? Infinity : kept[kept.length - 1].own);
    const walk = (j: number, units: number, plates: number, mm: number) => {
      // Plates still needed to reach the lowest allowed Total, at the heaviest size left.
      const short = lowU - units;
      const more = short <= 0 ? 0 : j < n ? Math.ceil(short / sizes[j].units) : Infinity;
      if (plates + more + missLB(units, units + maxFrom[j]) > bound() + EPS) return;
      if (j === n) {
        if (!allowed.has(units)) return;
        const own = ownOf(units, plates);
        let at = kept.length;
        while (at > 0 && kept[at - 1].own > own + EPS) at--;
        kept.splice(at, 0, { counts: Uint8Array.from(counts), own });
        if (kept.length > limit) kept.pop();
        return;
      }
      // Most of each size first, so good multisets turn up early and tighten the bound.
      const s = sizes[j];
      for (let c = caps[j]; c >= 0; c--) {
        const w = mm + c * s.plate.widthMm;
        if (w > sleeveMm + EPS) continue;
        if (units + c * s.units > highU) continue;
        counts[j] = c;
        walk(j + 1, units + c * s.units, plates + c, w);
      }
      counts[j] = 0;
    };
    walk(0, 0, 0, 0);

    const out = new Map<string, Cand>();
    const add = (seq: readonly number[]) => {
      const key = seq.join(',');
      if (!out.has(key)) out.set(key, makeCand(seq, kind, raw));
    };
    for (const { counts: c } of kept) {
      const bigs: number[] = [];
      const smalls: number[] = [];
      for (let j = 0; j < n; j++) for (let k = 0; k < c[j]; k++) (sizes[j].big ? bigs : smalls).push(j);
      const orders = bigOrders(bigs, exhaustive ? Infinity : ORDER_LIMIT);
      if (orders) {
        for (const o of orders) add([...o, ...smalls]);
      } else {
        add([...bigs, ...smalls]);
        for (const p of before) add(keepPrefix(c, p.seq));
      }
    }
    if (!exhaustive) {
      // Keep the previous row's whole stack, or its big Plates, and add a few.
      for (const p of before) {
        // A legal stack's big Plates are its inside run, so bigsFrom[0] is that run.
        for (const k of new Set([p.seq.length, p.bigsFrom[0]])) {
          const base = p.seq.slice(0, k);
          const c = new Uint8Array(n);
          let units = 0;
          for (const j of base) { c[j]++; units += sizes[j].units; }
          const extend = (seq: number[], units: number, added: number) => {
            if (added > 0 && allowed.has(units) && widthOk(c)) add([...seq]);
            if (added === MAX_ADDED) return;
            const last = seq.length > 0 ? seq[seq.length - 1] : -1;
            const lastSmall = last >= 0 && !sizes[last].big;
            for (let j = 0; j < n; j++) {
              const s = sizes[j];
              if (s.big && lastSmall) continue;
              if (!s.big && lastSmall && j < last) continue;
              if (c[j] >= caps[j] || units + s.units > highU) continue;
              c[j]++;
              seq.push(j);
              extend(seq, units + s.units, added + 1);
              seq.pop();
              c[j]--;
            }
          };
          extend([...base], units, 0);
        }
      }
    }
    // The Working row always has Decode's own stack (its round-up's, when rounded up)
    // when the caps allow it.
    if (kind === 'working') {
      const seq = workRow.side.map((p) => indexOf.get(p)!);
      if (seq.every((j) => seq.filter((x) => x === j).length <= caps[j])) add(seq);
    }
    const list = [...out.values()].filter((c) => widthOk(c.counts));
    list.sort((a, b) => a.own - b.own || a.seq.length - b.seq.length || cmpSeq(a.seq, b.seq));
    return list;
  }

  // One DP step: every state in `beam` onto every candidate of the row, keeping per
  // candidate only the states no other dominates (at most STATES_PER_CAND off a full set).
  function advance(beam: readonly State[], list: readonly Cand[], kind: RampRow['kind']): State[] {
    const next: State[] = [];
    const ownCost = kind === 'warmup';
    for (const c of list) {
      const kept: State[] = [];
      let lead: State | null = null; // the kept state least by [excess, repeats, cost]
      for (const s of beam) {
        const prev = s.cand;
        if (c.total < prev.total - EPS) continue; // Totals never decrease
        const from = prev.seq;
        let k = 0;
        while (k < from.length && k < c.seq.length && from[k] === c.seq[k]) k++;
        const moves = RAMP_COST.bigOff * prev.bigsFrom[k] + RAMP_COST.perMove * (from.length + c.seq.length - 2 * k);
        let grew = 0;
        for (let j = 0; j < n; j++) if (c.counts[j] > s.most[j]) grew += c.counts[j] - s.most[j];
        const excess = s.excess + c.excess;
        const repeats = s.repeats + (kind !== 'bar' && Math.abs(c.total - prev.total) <= EPS ? 1 : 0);
        const cost = s.cost + (ownCost ? c.own : 0) + moves + RAMP_COST.perStationPlate * grew;
        const station = s.station + grew;
        // Cheap dominance first: `lead` beats this state whatever its station holds.
        if (lead && (lead.excess < excess - EPS ||
          (Math.abs(lead.excess - excess) <= EPS && (lead.repeats < repeats ||
            (lead.repeats === repeats && lead.cost + RAMP_COST.perStationPlate * station < cost - EPS))))) continue;
        // Off a full set the list is bounded: a state no better than the worst kept is out.
        if (!exhaustive && kept.length >= STATES_PER_CAND && !lessHead2(excess, repeats, cost, kept[kept.length - 1])) continue;
        const most = new Uint8Array(n);
        for (let j = 0; j < n; j++) most[j] = c.counts[j] > s.most[j] ? c.counts[j] : s.most[j];
        const st: State = {
          excess, repeats, cost, station,
          moves: s.moves + moves,
          miss: s.miss + c.miss,
          plates: s.plates + c.seq.length,
          most, back: s, cand: c,
        };
        if (insert(kept, st) && (!lead || lessHead(st, lead))) lead = st;
        if (!exhaustive) {
          kept.sort(byKey);
          if (kept.length > STATES_PER_CAND) kept.pop();
        }
      }
      for (const st of kept) next.push(st);
    }
    return next;
  }

  // Add `s` unless a kept state dominates it, dropping those it dominates.
  function insert(list: State[], s: State): boolean {
    for (const o of list) if (dominates(o, s)) return false;
    for (let k = list.length - 1; k >= 0; k--) if (dominates(s, list[k])) list.splice(k, 1);
    list.push(s);
    return true;
  }

  function finish(ramp: Ramp, sides: readonly (readonly Plate[])[], degraded = false): EasyRamp {
    let prevSide: readonly Plate[] = [];
    let prevTotal = -Infinity;
    let totalMoves = 0;
    let cost = 0;
    const rows: EasyRow[] = ramp.rows.map((row, i) => {
      const side = sides[i];
      const base = row.collars ? baselineKg : barKg;
      const total = row.kind === 'bar' ? row.total : totalKg(side, base);
      const moves = movesBetween(prevSide, side);
      totalMoves += moves.cost;
      cost += moves.cost;
      if (row.kind === 'warmup') {
        const d = total - row.targetKg;
        cost += RAMP_COST.missPerKg * Math.abs(d) * (d > EPS ? RAMP_COST.overFactor : 1) +
          RAMP_COST.perPlate * side.length;
      }
      const realPct = row.kind === 'working' ? 100 : (total / workingTotal) * 100;
      const sameAsPrevious = Math.abs(total - prevTotal) <= EPS;
      const drift = row.kind === 'warmup' && drifted(total, row.targetKg, workingTotal, baselineKg);
      prevSide = side;
      prevTotal = total;
      return { ...row, side, total, realPct, sameAsPrevious, drift, moves } as EasyRow;
    });
    const station = stationPlates(sides);
    cost += RAMP_COST.perStationPlate * station;
    return { rows, working: ramp.working, totalMoves, station, cost, degraded };
  }
}

/**
 * How many ordered Sides the caps allow, ignoring the Sleeve: for every capped multiset,
 * the distinct orders of its big Plates (k! / prod(c_j!)). Counting stops once past
 * `stop`, so a full set costs no more than a small one.
 */
function orderedSides(sizes: readonly Size[], caps: readonly number[], stop: number): number {
  if (caps.reduce((x, c) => x * (c + 1), 1) > stop) return stop + 1; // at least one each
  const fact = (k: number): number => (k <= 1 ? 1 : k * fact(k - 1));
  let total = 0;
  const walk = (j: number, bigs: number, denom: number): boolean => {
    if (j === sizes.length) {
      total += fact(bigs) / denom;
      return total <= stop;
    }
    for (let c = 0; c <= caps[j]; c++) {
      const big = sizes[j].big;
      if (!walk(j + 1, bigs + (big ? c : 0), denom * (big ? fact(c) : 1))) return false;
    }
    return true;
  };
  walk(0, 0, 1);
  return total;
}

function cmpSeq(a: readonly number[], b: readonly number[]): number {
  for (let k = 0; k < Math.min(a.length, b.length); k++) if (a[k] !== b[k]) return a[k] - b[k];
  return a.length - b.length;
}

/**
 * loadable[u] for u in 0..maxUnits: whether some multiset with at most caps[j] of size
 * j sums to u grid units within the Sleeve. A DP of the narrowest such stack.
 */
function loadableUnits(sizes: readonly Size[], caps: readonly number[], sleeveMm: number, maxUnits: number): boolean[] {
  let narrowest = new Array<number>(maxUnits + 1).fill(Infinity);
  narrowest[0] = 0;
  sizes.forEach((s, j) => {
    const cap = caps[j];
    const next = [...narrowest];
    for (let u = 0; u <= maxUnits; u++) {
      if (narrowest[u] === Infinity) continue;
      for (let c = 1; c <= cap; c++) {
        const v = u + c * s.units;
        if (v > maxUnits) break;
        const mm = narrowest[u] + c * s.plate.widthMm;
        if (mm < next[v]) next[v] = mm;
      }
    }
    narrowest = next;
  });
  return narrowest.map((mm) => mm <= sleeveMm + EPS);
}
