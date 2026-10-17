// Property-based invariants for the pure core (RBAR-62). Each `it` is named after the
// rule it guards, with the ADR that states it. The oracle (properties.oracle.ts) is
// derived from the ADRs, not from the loader, so these pin the RULES across the whole
// input space rather than one hand-picked Target at a time -- the gap RBAR-60 fell
// through (687 example tests, none checked "typing back a displayed Total" everywhere).
//
// Where the space is small it is enumerated exhaustively (every achievable Total on
// every rig, in both units); elsewhere fast-check generates inputs. The seed is fixed so
// CI is deterministic; a failure prints the shrunk counterexample and its seed/path. To
// explore beyond the fixed cases locally, change SEED (or drop it) and re-run.
//
// Add a property here for every new core rule; the shell-side counterpart lives in
// elements/console.properties.test.ts.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { decode, decodeWithin } from './decode.ts';
import { addPlate, removePlate, encode } from './encode.ts';
import {
  SLEEVE_MM,
  sideLoadKg,
  sideWidthMm,
  totalKg,
  barWithCollars,
  COLLAR_OPTIONS,
  isOfferedCollar,
} from './plates.ts';
import type { Plate } from './plates.ts';
import {
  draftToKg,
  displayCeilingKg,
  kgToLb,
  lbToKg,
  shownIn,
  stepFor,
} from './units.ts';
import type { Unit } from './units.ts';
import {
  pushRecent,
  parseRecents,
  removeRecent,
  restoreRecent,
  MAX_RECENTS,
  isRememberable,
} from './recents.ts';
import { plateSetFor, PLATE_SET_KEYS, isOfferedPlateSet, PLATE_SETS } from './platesets.ts';
import { withLimits } from './plates.ts';
import type { InventoryEntry } from './plates.ts';
import { cappedFewestOracle, greatestSumAtOrUnder } from './fewest.oracle.ts';
import {
  RIGS,
  achievableTotals,
  greatestAtOrUnder,
  leastAbove,
  fewestPlatesFor,
  maxTotal,
  rampTotalsOracle,
  easyRampOracle,
  oracleRampCost,
  oracleMoves,
} from './properties.oracle.ts';
import type { MovesRule } from './properties.oracle.ts';
import {
  planEasyRamp,
  RAMP_TOLERANCE,
  EXTRA_PLATES,
  CHANGE_PLATE_MAX_KG,
  CHANGE_PLATE_MOVE_COST,
} from './moves.ts';
import { planRamp, DEFAULT_RAMP } from './plan.ts';
import type { RampStep } from './plan.ts';
import type { Rig } from './properties.oracle.ts';
import { GRID_KG, fewestOracle } from './fewest.oracle.ts';
import { parseLink, serializeLink, MAX_TARGET_KG } from './link.ts';
import type { LinkState, LinkMode } from './link.ts';

const SEED = 62;
const RUNS = 300;
const opts = { seed: SEED, numRuns: RUNS };
const EPS = 1e-9;
const UNITS: readonly Unit[] = ['kg', 'lb'];

const rigArb = fc.constantFrom(...RIGS);
const unitArb = fc.constantFrom(...UNITS);

// A Target for `rig`: mostly realistic typed values (<= 2 dp, the keypad's precision),
// plus arbitrary doubles across the same range and past the Sleeve's limit -- so the
// grid points, the gaps between them, sub-Bar Targets and the capped band are all hit.
function targetArb(rig: Rig): fc.Arbitrary<number> {
  const hi = maxTotal(rig) + 40;
  return fc.oneof(
    fc.integer({ min: 0, max: Math.round(hi * 100) }).map((c) => c / 100),
    fc.double({ min: 0, max: hi, noNaN: true }),
    fc.constantFrom(...achievableTotals(rig)),
  );
}
const rigTargetArb = rigArb.chain((rig) => targetArb(rig).map((t) => ({ rig, t })));

function isHeaviestFirst(side: readonly Plate[]): boolean {
  return side.every((p, i) => i === 0 || side[i - 1].kg >= p.kg);
}
function fromInventory(side: readonly Plate[], rig: Rig): boolean {
  return side.every((p) => rig.inventory.includes(p));
}

describe('Decode core properties (ADR-0002, ADR-0003, ADR-0012)', () => {
  it('never overshoots a Target at or above the bare rig (ADR-0003)', () => {
    fc.assert(
      fc.property(rigTargetArb, ({ rig, t }) => {
        fc.pre(t >= rig.baselineKg);
        const { primary } = decode(t, rig.baselineKg, rig.inventory);
        expect(primary.total).toBeLessThanOrEqual(t + EPS);
      }),
      opts,
    );
  });

  it('lands on the greatest achievable Total at or under the Target; a sub-Bar Target floors at the bare rig (ADR-0003, ADR-0012)', () => {
    fc.assert(
      fc.property(rigTargetArb, ({ rig, t }) => {
        const { primary } = decode(t, rig.baselineKg, rig.inventory);
        expect(primary.total).toBeCloseTo(greatestAtOrUnder(rig, t), 9);
        if (t < rig.baselineKg) {
          expect(primary.side).toEqual([]);
          expect(primary.delta).toBeGreaterThan(0);
        }
      }),
      opts,
    );
  });

  it('loads every Side heaviest-first, round-up included (ADR-0003, CONTEXT Side Load order)', () => {
    fc.assert(
      fc.property(rigTargetArb, ({ rig, t }) => {
        const { primary, over } = decode(t, rig.baselineKg, rig.inventory);
        expect(isHeaviestFirst(primary.side)).toBe(true);
        if (over) expect(isHeaviestFirst(over.side)).toBe(true);
      }),
      opts,
    );
  });

  // ADR-0003: "Among loadouts reaching the same Total, the canonical pick is the fewest
  // plates." Checked exhaustively over every achievable Total (the round-up is one of
  // them, so this covers `over` too) against the oracle's fewest-Plate count.
  const fewestPlateMisses = (rigs: readonly Rig[]): string[] => {
    const misses: string[] = [];
    for (const rig of rigs) {
      for (const total of achievableTotals(rig)) {
        const { primary } = decode(total, rig.baselineKg, rig.inventory);
        const fewest = fewestPlatesFor(rig, total);
        if (primary.side.length !== fewest) {
          const plates = primary.side.map((p) => p.label ?? String(p.kg)).join('+');
          misses.push(`${rig.name}: ${total.toFixed(2)} kg -> ${plates} (fewest is ${fewest})`);
        }
      }
    }
    return misses;
  };

  it('loads the fewest Plates for every Competition Total, Sleeve-capped band included (ADR-0003, ADR-0012; exhaustive)', () => {
    expect(fewestPlateMisses(RIGS.filter((r) => r.set === 'comp'))).toEqual([]);
  });

  // Fixed by RBAR-69: the iron ladder {45,35,25,10,5,2.5} lb is not canonical for
  // fewest Plates (165 lb on the 45 lb Bar is 35 + 25 per Side, greedy loaded
  // 45 + 10 + 5), so the fill is an exact search now. lib/fewest.test.ts also pins the
  // exact Plates and order against an independent DP.
  it('loads the fewest Plates for every Training Total (ADR-0003 as amended by RBAR-69; exhaustive)', () => {
    expect(fewestPlateMisses(RIGS.filter((r) => r.set === 'training'))).toEqual([]);
  });

  // The full rule, not just the count: for ANY Target (on the grid, between it, past the
  // Sleeve), primary and round-up are the exact stack an independent DP picks -- fewest
  // Plates, then heaviest-first (lib/fewest.oracle.ts).
  it('loads the canonical stack for any Target: fewest Plates, then heaviest-first, round-up included (ADR-0003 as amended by RBAR-69)', () => {
    fc.assert(
      fc.property(rigTargetArb, ({ rig, t }) => {
        const o = fewestOracle(rig.inventory, GRID_KG[rig.set]);
        const { primary, over } = decode(t, rig.baselineKg, rig.inventory);
        const unitsOf = (total: number) => Math.round((total - rig.baselineKg) / 2 / o.gridKg);
        expect(primary.side).toEqual(o.pick(unitsOf(primary.total)));
        if (over) expect(over.side).toEqual(o.pick(unitsOf(over.total)));
      }),
      opts,
    );
  });

  it('never proposes a Side wider than the Sleeve, round-up included (ADR-0012)', () => {
    fc.assert(
      fc.property(rigTargetArb, ({ rig, t }) => {
        const { primary, over } = decode(t, rig.baselineKg, rig.inventory);
        expect(sideWidthMm(primary.side)).toBeLessThanOrEqual(SLEEVE_MM + EPS);
        if (over) expect(sideWidthMm(over.side)).toBeLessThanOrEqual(SLEEVE_MM + EPS);
      }),
      opts,
    );
  });

  it('offers the round-up exactly when short and one physically exists: the least achievable Total above the Target (ADR-0003 RBAR-11, ADR-0012)', () => {
    fc.assert(
      fc.property(rigTargetArb, ({ rig, t }) => {
        const { primary, over } = decode(t, rig.baselineKg, rig.inventory);
        const above = leastAbove(rig, t);
        const short = primary.total < t - EPS;
        if (short && above !== null) {
          expect(over).toBeDefined();
          expect(over!.total).toBeCloseTo(above, 9);
          expect(over!.delta).toBeGreaterThan(0);
        } else {
          expect(over).toBeUndefined();
        }
      }),
      opts,
    );
  });

  it('keeps every Loadout self-consistent: Total = Bar + 2 x Collar + 2 x Side Load, delta = Total - Target, Plates from the Inventory (CONTEXT, ADR-0008)', () => {
    fc.assert(
      fc.property(rigTargetArb, ({ rig, t }) => {
        const { primary, over } = decode(t, rig.baselineKg, rig.inventory);
        for (const l of over ? [primary, over] : [primary]) {
          expect(fromInventory(l.side, rig)).toBe(true);
          expect(l.total).toBeCloseTo(
            barWithCollars(rig.barKg, rig.collarKg) + 2 * sideLoadKg(l.side),
            9,
          );
          expect(l.total).toBe(totalKg(l.side, rig.baselineKg));
          expect(l.total - l.delta).toBeCloseTo(t, 9);
        }
      }),
      opts,
    );
  });

  // The capped band is a sliver random Targets rarely hit, so the round-up rule is
  // also checked at EVERY gap: a Target between two neighbouring achievable Totals must
  // offer exactly the upper one (RBAR-62 found 4 gaps per Competition rig, 2 per
  // Training rig, where the one-step refill missed it).
  it('offers the next achievable Total as the round-up in every gap of the grid (ADR-0003 RBAR-11, ADR-0012; exhaustive)', () => {
    const misses: string[] = [];
    for (const rig of RIGS) {
      const totals = achievableTotals(rig);
      for (let i = 0; i + 1 < totals.length; i++) {
        const t = (totals[i] + totals[i + 1]) / 2;
        const { primary, over } = decode(t, rig.baselineKg, rig.inventory);
        const ok =
          Math.abs(primary.total - totals[i]) < EPS &&
          over !== undefined &&
          Math.abs(over.total - totals[i + 1]) < EPS;
        if (!ok) {
          const got = over ? over.total.toFixed(2) : 'none';
          misses.push(`${rig.name}: ${t.toFixed(2)} -> over ${got}, want ${totals[i + 1].toFixed(2)}`);
        }
      }
    }
    expect(misses).toEqual([]);
  });

  it('solves every achievable Total exactly, with no round-up (exhaustive, every rig)', () => {
    const misses: string[] = [];
    for (const rig of RIGS) {
      for (const total of achievableTotals(rig)) {
        const { primary, over } = decode(total, rig.baselineKg, rig.inventory);
        if (Math.abs(primary.total - total) > EPS || over !== undefined) {
          misses.push(`${rig.name}: ${total} -> ${primary.total}${over ? ' +over' : ''}`);
        }
      }
    }
    expect(misses).toEqual([]);
  });

  it('degrades a non-finite Target to the bare rig and never throws (ADR-0003 never-null)', () => {
    fc.assert(
      fc.property(
        rigArb,
        fc.constantFrom(Number.NaN, Infinity, -Infinity),
        (rig, t) => {
          const { primary, over } = decode(t, rig.baselineKg, rig.inventory);
          expect(primary.side).toEqual([]);
          expect(primary.total).toBe(rig.baselineKg);
          expect(over).toBeUndefined();
        },
      ),
      { seed: SEED, numRuns: 30 },
    );
  });
});

describe('Decode as read: decodeWithin + displayCeilingKg (ADR-0010 RBAR-60, ADR-0003)', () => {
  // The console's solve, exactly: at or under the top of the Target's reading.
  const solveAsRead = (rig: Rig, t: number, u: Unit) =>
    decodeWithin(t, displayCeilingKg(t, u), rig.baselineKg, rig.inventory);

  it('read-back: every achievable Total, typed as its displayed reading in each unit, solves to that same Total (RBAR-60; exhaustive)', () => {
    const misses: string[] = [];
    for (const rig of RIGS) {
      for (const u of UNITS) {
        for (const total of achievableTotals(rig)) {
          const reading = shownIn(total, u);
          const typed = draftToKg(String(reading), u)!;
          const { primary } = solveAsRead(rig, typed, u);
          if (Math.abs(primary.total - total) > EPS || shownIn(primary.total, u) !== reading) {
            misses.push(`${rig.name} ${u}: ${total} reads ${reading} -> ${primary.total}`);
          }
        }
      }
    }
    expect(misses).toEqual([]);
  });

  it('never reads over the Target in the active unit, except the bare-rig floor (ADR-0003 as read)', () => {
    fc.assert(
      fc.property(rigTargetArb, unitArb, ({ rig, t }, u) => {
        const { primary } = solveAsRead(rig, t, u);
        if (shownIn(t, u) >= shownIn(rig.baselineKg, u)) {
          expect(shownIn(primary.total, u)).toBeLessThanOrEqual(shownIn(t, u));
        } else {
          expect(primary.side).toEqual([]); // the floor is the bare rig, nothing loaded
        }
      }),
      opts,
    );
  });

  it('lands on the greatest achievable Total within the reading, and offers the least one past it (ADR-0010 RBAR-60, ADR-0003)', () => {
    fc.assert(
      fc.property(rigTargetArb, unitArb, ({ rig, t }, u) => {
        const ceiling = displayCeilingKg(t, u);
        const { primary, over } = solveAsRead(rig, t, u);
        expect(primary.total).toBeCloseTo(greatestAtOrUnder(rig, ceiling), 9);
        if (over) {
          expect(over.total).toBeGreaterThan(ceiling);
          expect(over.total).toBeCloseTo(leastAbove(rig, ceiling)!, 9);
        }
      }),
      opts,
    );
  });

  it('reports every delta against the real Target, so total - delta recovers it (ADR-0010 RBAR-60)', () => {
    fc.assert(
      fc.property(rigTargetArb, unitArb, ({ rig, t }, u) => {
        const { primary, over } = solveAsRead(rig, t, u);
        expect(primary.total - primary.delta).toBeCloseTo(t, 9);
        if (over) expect(over.total - over.delta).toBeCloseTo(t, 9);
      }),
      opts,
    );
  });
});

describe('Plate limit properties (ADR-0016, ADR-0003)', () => {
  // A Plate limit per size, as the pairs on hand: mostly small counts (where the caps
  // bite), sometimes unlimited. One entry per size of the rig's set, in set order.
  const face = (p: Plate) => p.label ?? String(p.kg);
  const capArb = fc.oneof(
    fc.integer({ min: 0, max: 4 }),
    fc.constant(Infinity),
  );
  const capsArb = (rig: Rig) => fc.array(capArb, { minLength: rig.inventory.length, maxLength: rig.inventory.length });
  const limited = (rig: Rig, caps: readonly number[]) =>
    withLimits(rig.inventory, Object.fromEntries(rig.inventory.map((p, i) => [face(p), caps[i]])));
  const cappedArb = rigArb.chain((rig) =>
    fc.record({ rig: fc.constant(rig), caps: capsArb(rig), t: targetArb(rig) }),
  );
  const countOf = (side: readonly Plate[], p: Plate) => side.filter((q) => face(q) === face(p)).length;
  const sides = (d: { primary: { side: readonly Plate[] }; over?: { side: readonly Plate[] } }) =>
    d.over ? [d.primary.side, d.over.side] : [d.primary.side];
  // A Decode result as plain data, so loads from copied entries compare by value.
  const shape = (d: ReturnType<typeof decode>) => ({
    primary: { ...d.primary, side: d.primary.side.map(face) },
    over: d.over && { ...d.over, side: d.over.side.map(face) },
  });

  it('no cap is ever exceeded, round-up included (ADR-0016)', () => {
    fc.assert(
      fc.property(cappedArb, ({ rig, caps, t }) => {
        const inv = limited(rig, caps);
        const d = decode(t, rig.baselineKg, inv);
        for (const side of sides(d)) {
          rig.inventory.forEach((p, i) => expect(countOf(side, p)).toBeLessThanOrEqual(caps[i]));
        }
      }),
      opts,
    );
  });

  it("a 'none' size never appears in any load (ADR-0016)", () => {
    fc.assert(
      fc.property(cappedArb, ({ rig, caps, t }) => {
        const d = decode(t, rig.baselineKg, limited(rig, caps));
        const none = rig.inventory.filter((_, i) => caps[i] === 0).map(face);
        for (const side of sides(d)) expect(side.map(face).filter((f) => none.includes(f))).toEqual([]);
      }),
      opts,
    );
  });

  it('tightening caps never raises the at-or-under Total (ADR-0016, ADR-0003)', () => {
    const pairArb = cappedArb.chain(({ rig, caps, t }) =>
      fc
        .array(fc.integer({ min: 0, max: 4 }), { minLength: caps.length, maxLength: caps.length })
        .map((cut) => ({ rig, t, loose: caps, tight: caps.map((c, i) => Math.max(0, Math.min(c, 4) - cut[i])) })),
    );
    fc.assert(
      fc.property(pairArb, ({ rig, t, loose, tight }) => {
        const looser = decode(t, rig.baselineKg, limited(rig, loose)).primary.total;
        const tighter = decode(t, rig.baselineKg, limited(rig, tight)).primary.total;
        const unlimited = decode(t, rig.baselineKg, rig.inventory).primary.total;
        expect(tighter).toBeLessThanOrEqual(looser + EPS);
        expect(looser).toBeLessThanOrEqual(unlimited + EPS);
      }),
      opts,
    );
  });

  it('all-unlimited is identical to the uncapped output, every rig, exhaustively (ADR-0016)', () => {
    // Over the runtime-budget range (every 0.7 kg for 400 kg above the rig) and every
    // achievable Total, with explicit unlimited caps (Infinity) and with caps too large
    // to ever bind (99 pairs), which take the capped walk.
    const misses: string[] = [];
    for (const rig of RIGS) {
      const unlimited = limited(rig, rig.inventory.map(() => Infinity));
      const huge = limited(rig, rig.inventory.map(() => 99));
      const targets: number[] = [...achievableTotals(rig)];
      for (let t = rig.baselineKg; t < rig.baselineKg + 400; t += 0.7) targets.push(t);
      for (const t of targets) {
        const want = JSON.stringify(shape(decode(t, rig.baselineKg, rig.inventory)));
        for (const inv of [unlimited, huge]) {
          const got = JSON.stringify(shape(decode(t, rig.baselineKg, inv)));
          if (got !== want) misses.push(`${rig.name} ${t}: ${got} != ${want}`);
        }
      }
    }
    expect(misses).toEqual([]);
  });

  it("the capped Decode equals the bounded oracle's best, round-up included (ADR-0016, ADR-0003)", () => {
    fc.assert(
      fc.property(cappedArb, ({ rig, caps, t }) => {
        const inv: InventoryEntry[] = limited(rig, caps);
        const o = cappedFewestOracle(inv, GRID_KG[rig.set]);
        const budget = (t - rig.baselineKg) / 2;
        const best = greatestSumAtOrUnder(o, Math.floor((budget + EPS) / o.gridKg));
        const { primary, over } = decode(t, rig.baselineKg, inv);
        expect(primary.side).toEqual(o.pick(best));
        const above = o.sums.find((s) => s * o.gridKg > budget + EPS);
        if (primary.total < t - EPS && above !== undefined) {
          expect(over?.side).toEqual(o.pick(above));
        } else {
          expect(over).toBeUndefined();
        }
      }),
      { seed: SEED, numRuns: 80 },
    );
  });
});

describe('Warm-up Ramp properties (ADR-0015)', () => {
  // A template: up to two leading bare-Bar steps, then up to six percentages in any
  // order (the planner forces Totals non-decreasing itself), whole or fractional.
  const pctArb = fc.oneof(
    fc.integer({ min: 1, max: 100 }),
    fc.double({ min: 0.01, max: 100, noNaN: true }),
  );
  const stepsArb: fc.Arbitrary<RampStep[]> = fc
    .tuple(
      fc.integer({ min: 0, max: 2 }),
      fc.array(pctArb, { maxLength: 6 }),
    )
    .map(([bars, pcts]) => [
      ...Array.from({ length: bars }, (): RampStep => ({ kind: 'bar' })),
      ...pcts.map((pct): RampStep => ({ kind: 'pct', pct })),
    ]);
  const caseArb = fc.record({ rt: rigTargetArb, u: unitArb, steps: fc.oneof(stepsArb, fc.constant([...DEFAULT_RAMP])) });

  // The console's call, exactly: the Working set solved as read in the active unit.
  const plan = (rig: Rig, t: number, u: Unit, steps: readonly RampStep[]) =>
    planRamp(t, steps, { barKg: rig.barKg, collarKg: rig.collarKg, inventory: rig.inventory }, {
      ceilingKg: displayCeilingKg(t, u),
    });

  it('every row is loadable within the Sleeve: Total = its baseline + 2 x Side Load, Plates from the Inventory, the canonical stack (ADR-0015, ADR-0012, ADR-0003)', () => {
    fc.assert(
      fc.property(caseArb, ({ rt: { rig, t }, u, steps }) => {
        const o = fewestOracle(rig.inventory, GRID_KG[rig.set]);
        for (const row of plan(rig, t, u, steps).rows) {
          const baseline = row.collars ? rig.baselineKg : rig.barKg;
          expect(row.total).toBeCloseTo(totalKg(row.side, baseline), 9);
          expect(sideWidthMm(row.side)).toBeLessThanOrEqual(SLEEVE_MM + EPS);
          expect(fromInventory(row.side, rig)).toBe(true);
          const units = Math.round((row.total - baseline) / 2 / o.gridKg);
          expect(row.side).toEqual(o.pick(units));
        }
      }),
      opts,
    );
  });

  it('Totals never decrease, start at or above the bare Bar, and never pass the Working set; no row is dropped (ADR-0015)', () => {
    fc.assert(
      fc.property(caseArb, ({ rt: { rig, t }, u, steps }) => {
        const { rows } = plan(rig, t, u, steps);
        expect(rows).toHaveLength(steps.length + 1);
        const work = rows[rows.length - 1].total;
        rows.forEach((row, i) => {
          expect(row.total).toBeGreaterThanOrEqual(rig.barKg - EPS);
          expect(row.total).toBeLessThanOrEqual(work + EPS);
          if (i > 0) expect(row.total).toBeGreaterThanOrEqual(rows[i - 1].total - EPS);
        });
      }),
      opts,
    );
  });

  it('the Working set is the at-or-under solve as read and never overshoots (ADR-0015, ADR-0003)', () => {
    fc.assert(
      fc.property(caseArb, ({ rt: { rig, t }, u, steps }) => {
        const { rows, working } = plan(rig, t, u, steps);
        const solved = decodeWithin(t, displayCeilingKg(t, u), rig.baselineKg, rig.inventory);
        expect(working).toEqual(solved);
        const last = rows[rows.length - 1];
        expect(last.kind).toBe('working');
        expect(last.side).toEqual(solved.primary.side);
        expect(last.total).toBeCloseTo(greatestAtOrUnder(rig, displayCeilingKg(t, u)), 9);
        if (shownIn(t, u) >= shownIn(rig.baselineKg, u)) {
          expect(shownIn(last.total, u)).toBeLessThanOrEqual(shownIn(t, u));
        }
      }),
      opts,
    );
  });

  it('each Warm-up set is the nearest loadable Total to its percentage within its floor and the Working set, ties down (ADR-0015)', () => {
    fc.assert(
      fc.property(caseArb, ({ rt: { rig, t }, u, steps }) => {
        const got = plan(rig, t, u, steps).rows.map((r) => r.total);
        const want = rampTotalsOracle(rig, t, displayCeilingKg(t, u), steps);
        expect(got.length).toBe(want.length);
        got.forEach((g, i) => expect(g).toBeCloseTo(want[i], 9));
      }),
      opts,
    );
  });

  it('the default Ramp matches the oracle for every achievable Working Total on every rig (ADR-0015; exhaustive)', () => {
    const misses: string[] = [];
    for (const rig of RIGS) {
      for (const total of achievableTotals(rig)) {
        const got = plan(rig, total, 'kg', DEFAULT_RAMP).rows.map((r) => r.total);
        const want = rampTotalsOracle(rig, total, displayCeilingKg(total, 'kg'), DEFAULT_RAMP);
        if (got.some((g, i) => Math.abs(g - want[i]) > 1e-6)) {
          misses.push(`${rig.name}: ${total} -> ${got.join(',')} (want ${want.join(',')})`);
        }
      }
    }
    expect(misses).toEqual([]);
  });

  it('a bare-Bar row is the Bar alone: no Plates, no Collars (ADR-0015)', () => {
    fc.assert(
      fc.property(caseArb, ({ rt: { rig, t }, u, steps }) => {
        for (const row of plan(rig, t, u, steps).rows.filter((r) => r.kind === 'bar')) {
          expect(row.side).toEqual([]);
          expect(row.collars).toBe(false);
          expect(row.total).toBe(rig.barKg);
        }
      }),
      opts,
    );
  });

  it('warm-ups and the Working set carry Collars exactly when the rig has them (ADR-0015, ADR-0008)', () => {
    fc.assert(
      fc.property(caseArb, ({ rt: { rig, t }, u, steps }) => {
        for (const row of plan(rig, t, u, steps).rows.filter((r) => r.kind !== 'bar')) {
          expect(row.collars).toBe(rig.collarKg > 0);
          expect(row.total).toBeGreaterThanOrEqual(rig.baselineKg - EPS);
        }
      }),
      opts,
    );
  });

  it('sameAsPrevious marks exactly the rows repeating the previous Total, and realPct is Total over the Working Total (ADR-0015)', () => {
    fc.assert(
      fc.property(caseArb, ({ rt: { rig, t }, u, steps }) => {
        const { rows } = plan(rig, t, u, steps);
        const work = rows[rows.length - 1].total;
        rows.forEach((row, i) => {
          const repeats = i > 0 && Math.abs(row.total - rows[i - 1].total) <= EPS;
          expect(row.sameAsPrevious).toBe(repeats);
          expect(row.realPct).toBeCloseTo((row.total / work) * 100, 9);
        });
      }),
      opts,
    );
  });
});

describe('Fewest Plate moves properties (ADR-0015 as amended 2026-10-17)', () => {
  // Each full-rig run solves a whole-Ramp DP, so these take fewer runs than the rest.
  const movesOpts = { seed: SEED, numRuns: 100 };
  const RULE: MovesRule = {
    toleranceShare: RAMP_TOLERANCE,
    extraPlates: EXTRA_PLATES,
    changeMaxKg: CHANGE_PLATE_MAX_KG,
    changeCost: CHANGE_PLATE_MOVE_COST,
  };
  const pctStepsArb: fc.Arbitrary<RampStep[]> = fc
    .tuple(fc.integer({ min: 0, max: 1 }), fc.array(fc.integer({ min: 1, max: 100 }), { maxLength: 4 }))
    .map(([bars, pcts]) => [
      ...Array.from({ length: bars }, (): RampStep => ({ kind: 'bar' })),
      ...pcts.map((pct): RampStep => ({ kind: 'pct', pct })),
    ]);
  const fullCaseArb = fc.record({
    rt: rigTargetArb,
    u: unitArb,
    steps: fc.oneof(pctStepsArb, fc.constant([...DEFAULT_RAMP])),
  });
  const rigOf = (rig: Rig) => ({ barKg: rig.barKg, collarKg: rig.collarKg, inventory: rig.inventory });
  const nearest = (rig: Rig, t: number, u: Unit, steps: readonly RampStep[]) =>
    planRamp(t, steps, rigOf(rig), { ceilingKg: displayCeilingKg(t, u) });
  const easy = (rig: Rig, t: number, u: Unit, steps: readonly RampStep[]) =>
    planEasyRamp(t, steps, { barKg: rig.barKg, collarKg: rig.collarKg, inventory: rig.inventory }, {
      ceilingKg: displayCeilingKg(t, u),
    });

  // Small rigs the brute force can exhaust: a few Plates of each set (the Inventory's
  // own Plate objects, so Plate identity -- what a move compares -- is shared).
  const pick = (set: 'comp' | 'training', keep: (p: Plate) => boolean) =>
    PLATE_SETS[set].inventory.filter(keep);
  const SMALL_RIGS: readonly Rig[] = [
    { set: 'comp' as const, barKg: 20, collarKg: 0, inventory: pick('comp', (p) => [20, 10, 5, 2.5].includes(p.kg)) },
    { set: 'comp' as const, barKg: 20, collarKg: 2.5, inventory: pick('comp', (p) => [15, 5, 2.5].includes(p.kg)) },
    { set: 'comp' as const, barKg: 15, collarKg: 0, inventory: pick('comp', (p) => [25, 10, 5].includes(p.kg)) },
    { set: 'comp' as const, barKg: 20, collarKg: 0, inventory: pick('comp', (p) => [20, 5, 1, 0.5].includes(p.kg)) },
    { set: 'training' as const, barKg: lbToKg(45), collarKg: 0, inventory: pick('training', (p) => ['45', '25', '10', '5'].includes(p.label!)) },
  ].map((r) => ({ ...r, baselineKg: r.barKg + 2 * r.collarKg, name: `small ${r.set} ${r.inventory.map((p) => p.label ?? p.kg).join('/')} collar ${r.collarKg}` }));
  const smallCaseArb = fc
    .constantFrom(...SMALL_RIGS)
    .chain((rig) =>
      fc.record({
        rig: fc.constant(rig),
        t: fc.oneof(
          fc.integer({ min: 0, max: 14000 }).map((c) => c / 100),
          fc.constantFrom(...achievableTotals(rig).filter((x) => x <= 140)),
        ),
        u: unitArb,
        steps: fc.oneof(
          fc.constant([...DEFAULT_RAMP]),
          pctStepsArb.map((s) => s.slice(0, 4)),
        ),
      }),
    );
  const raws = (rows: readonly { kind: string; targetKg: number }[]) =>
    rows.map((r) => (r.kind === 'warmup' ? r.targetKg : null));

  it('the Ramp\'s weighted Plate moves are the fewest any Ramp within the rules reaches, ties to closeness then fewer Plates (ADR-0015 as amended; brute force)', () => {
    fc.assert(
      fc.property(smallCaseArb, ({ rig, t, u, steps }) => {
        const got = easy(rig, t, u, steps);
        const { best, tol } = easyRampOracle(rig, t, displayCeilingKg(t, u), steps, RULE);
        const cost = oracleRampCost(
          got.rows.map((r) => r.side),
          got.rows.map((r) => r.total),
          raws(got.rows),
          tol,
          RULE,
        );
        cost.forEach((c, i) => expect(c).toBeCloseTo(best[i], 6));
      }),
      { seed: SEED, numRuns: 150 },
    );
  });

  it('each row\'s moves are the stack moves from the row before, and they add up (ADR-0015 as amended)', () => {
    fc.assert(
      fc.property(fullCaseArb, ({ rt: { rig, t }, u, steps }) => {
        const got = easy(rig, t, u, steps);
        let prev: readonly Plate[] = [];
        let sum = 0;
        for (const row of got.rows) {
          expect(row.moves.cost).toBeCloseTo(oracleMoves(prev, row.side, RULE), 9);
          // Off then on turns the previous Side into this one.
          const kept = prev.slice(0, prev.length - row.moves.off.length);
          expect([...kept, ...row.moves.on]).toEqual(row.side);
          sum += row.moves.cost;
          prev = row.side;
        }
        expect(got.totalMoves).toBeCloseTo(sum, 9);
      }),
      movesOpts,
    );
  });

  it('every Warm-up set is within the tolerance of its percentage, or on planRamp\'s nearest Total when the floor forces it (ADR-0015 as amended)', () => {
    fc.assert(
      fc.property(fullCaseArb, ({ rt: { rig, t }, u, steps }) => {
        const got = easy(rig, t, u, steps);
        const near = nearest(rig, t, u, steps).rows;
        const work = got.rows[got.rows.length - 1].total;
        const grid = Math.min(...rig.inventory.map((p) => p.kg));
        const tol = Math.max(RAMP_TOLERANCE * work, grid);
        got.rows.forEach((row, i) => {
          if (row.kind !== 'warmup') return;
          const inside = Math.abs(row.total - row.targetKg) <= tol + 1e-9;
          expect(inside || Math.abs(row.total - near[i].total) <= 1e-9).toBe(true);
        });
      }),
      movesOpts,
    );
  });

  it('Totals never decrease, bare-Bar rows stay bare, and every Side is loadable within the Sleeve (ADR-0015 as amended, ADR-0012)', () => {
    fc.assert(
      fc.property(fullCaseArb, ({ rt: { rig, t }, u, steps }) => {
        const got = easy(rig, t, u, steps);
        got.rows.forEach((row, i) => {
          if (i > 0) expect(row.total).toBeGreaterThanOrEqual(got.rows[i - 1].total - EPS);
          const baseline = row.collars ? rig.baselineKg : rig.barKg;
          expect(row.total).toBeCloseTo(totalKg(row.side, baseline), 9);
          expect(sideWidthMm(row.side)).toBeLessThanOrEqual(SLEEVE_MM + EPS);
          expect(fromInventory(row.side, rig)).toBe(true);
          expect(isHeaviestFirst(row.side)).toBe(true);
          if (row.kind === 'bar') {
            expect(row.side).toEqual([]);
            expect(row.total).toBe(rig.barKg);
          }
          if (i > 0) expect(row.sameAsPrevious).toBe(Math.abs(row.total - got.rows[i - 1].total) <= EPS);
        });
      }),
      movesOpts,
    );
  });

  it('the Working set\'s Total is exactly the at-or-under solve as read; only its Side may differ (ADR-0015 as amended, ADR-0003)', () => {
    fc.assert(
      fc.property(fullCaseArb, ({ rt: { rig, t }, u, steps }) => {
        const got = easy(rig, t, u, steps);
        const solved = decodeWithin(t, displayCeilingKg(t, u), rig.baselineKg, rig.inventory);
        const last = got.rows[got.rows.length - 1];
        expect(last.kind).toBe('working');
        expect(last.total).toBeCloseTo(solved.primary.total, 9);
        expect(got.working).toEqual(solved);
      }),
      movesOpts,
    );
  });

  it('never needs more moves than the nearest-Total Ramp when that Ramp is within tolerance (ADR-0015 as amended)', () => {
    fc.assert(
      fc.property(fullCaseArb, ({ rt: { rig, t }, u, steps }) => {
        const got = easy(rig, t, u, steps);
        const near = nearest(rig, t, u, steps).rows;
        let prev: readonly Plate[] = [];
        let nearMoves = 0;
        for (const r of near) {
          nearMoves += oracleMoves(prev, r.side, RULE);
          prev = r.side;
        }
        const work = near[near.length - 1].total;
        const tol = Math.max(RAMP_TOLERANCE * work, Math.min(...rig.inventory.map((p) => p.kg)));
        const nearInside = near.every((r) => r.kind !== 'warmup' || Math.abs(r.total - r.targetKg) <= tol + 1e-9);
        if (nearInside) expect(got.totalMoves).toBeLessThanOrEqual(nearMoves + 1e-9);
      }),
      movesOpts,
    );
  });
});

describe('Units and conversion properties (ADR-0006, ADR-0010)', () => {
  const kgArb = fc.oneof(
    fc.integer({ min: 0, max: 100_000 }).map((c) => c / 100),
    fc.double({ min: 0, max: 1000, noNaN: true }),
  );

  it('displayCeilingKg is the top of the reading: never below the weight, same reading, and the next hair up reads differently (RBAR-60)', () => {
    fc.assert(
      fc.property(kgArb, unitArb, (kg, u) => {
        const c = displayCeilingKg(kg, u);
        expect(c).toBeGreaterThanOrEqual(kg);
        expect(shownIn(c, u)).toBe(shownIn(kg, u));
        expect(shownIn(c + 1e-6, u)).not.toBe(shownIn(kg, u));
      }),
      opts,
    );
  });

  it('draftToKg never yields NaN and never throws, for any string (ADR-0010 entry contract)', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), keypadDraftArb), unitArb, (draft, u) => {
        const kg = draftToKg(draft, u);
        if (kg !== null) expect(Number.isNaN(kg)).toBe(false);
        if (draft.trim() === '') expect(kg).toBeNull();
      }),
      opts,
    );
    // Non-keypad edge forms that parse to nothing: never NaN, always "no Target".
    for (const u of UNITS) {
      for (const d of ['.', ' . ', '-', 'abc']) expect(draftToKg(d, u)).toBeNull();
    }
  });

  it('a keypad draft (digits and one decimal point) always parses to a finite, non-negative kg (ADR-0010)', () => {
    fc.assert(
      fc.property(keypadDraftArb.filter((d) => d !== ''), unitArb, (draft, u) => {
        const kg = draftToKg(draft, u);
        expect(kg).not.toBeNull();
        expect(Number.isFinite(kg)).toBe(true);
        expect(kg!).toBeGreaterThanOrEqual(0);
      }),
      opts,
    );
  });

  it('a typed reading reads back as itself: <= 2 dp in kg, whole pounds in lb (ADR-0006 rounding)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 200_000 }), (n) => {
        const kgReading = n / 100;
        expect(shownIn(draftToKg(String(kgReading), 'kg')!, 'kg')).toBe(kgReading);
        expect(shownIn(draftToKg(String(n), 'lb')!, 'lb')).toBe(n);
      }),
      opts,
    );
  });

  it('kg <-> lb conversion is a lossless inverse pair (ADR-0006 exact factor)', () => {
    fc.assert(
      fc.property(kgArb, (kg) => {
        expect(lbToKg(kgToLb(kg))).toBeCloseTo(kg, 9);
        expect(kgToLb(lbToKg(kg))).toBeCloseTo(kg, 9);
      }),
      opts,
    );
  });

  it('the stepper grid is 1 kg / 5 lb (ADR-0010)', () => {
    expect(stepFor('kg')).toBe(1);
    expect(stepFor('lb')).toBe(5);
  });
});

// A draft the keypad can actually produce: digits with at most one decimal point,
// including the edge forms ("", "0.", "5.", "0.5", leading zeros, many decimals, huge).
// Modelled on entry.ts: a "." on an empty draft becomes "0.", so a lone "." (or ".5")
// is never a keypad draft -- it is covered as arbitrary input in the never-NaN property.
const keypadDraftArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.stringMatching(/^[0-9]{0,12}$/),
    fc.option(fc.stringMatching(/^[0-9]{0,8}$/), { nil: undefined }),
  )
  .map(([whole, frac]) =>
    frac === undefined ? whole : `${whole === '' ? '0' : whole}.${frac}`,
  );

describe('Encode properties (ADR-0005, ADR-0012)', () => {
  // A tap script: each step adds a Plate (by index) or removes one (by index).
  const tapsArb = (rig: Rig) =>
    fc.array(
      fc.record({
        add: fc.boolean(),
        i: fc.nat({ max: rig.inventory.length - 1 }),
      }),
      { maxLength: 40 },
    );
  const rigTapsArb = rigArb.chain((rig) => tapsArb(rig).map((taps) => ({ rig, taps })));

  it('every tap leaves a heaviest-first Side within the Sleeve and never mutates its input; a refused add is exactly a Plate that does not fit (ADR-0005, ADR-0012)', () => {
    fc.assert(
      fc.property(rigTapsArb, ({ rig, taps }) => {
        let side: readonly Plate[] = [];
        for (const { add, i } of taps) {
          const plate = rig.inventory[i];
          const before = [...side];
          const next = add ? addPlate(side, plate) : removePlate(side, plate);
          expect(side).toEqual(before); // input untouched
          expect(next).not.toBe(side); // always a fresh array
          expect(isHeaviestFirst(next)).toBe(true);
          expect(sideWidthMm(next)).toBeLessThanOrEqual(SLEEVE_MM + EPS);
          if (add) {
            const fits = sideWidthMm(side) + plate.widthMm <= SLEEVE_MM + EPS;
            expect(next.length).toBe(side.length + (fits ? 1 : 0));
          }
          side = next;
        }
      }),
      opts,
    );
  });

  it('adding then removing the same Plate restores the Side (ADR-0005)', () => {
    fc.assert(
      fc.property(rigTapsArb, fc.nat(), ({ rig, taps }, pick) => {
        let side: readonly Plate[] = [];
        for (const { i } of taps) side = addPlate(side, rig.inventory[i]);
        const plate = rig.inventory[pick % rig.inventory.length];
        const added = addPlate(side, plate);
        fc.pre(added.length > side.length);
        expect(removePlate(added, plate)).toEqual(side);
      }),
      opts,
    );
  });

  it('Encode reads Bar + 2 x Collar + 2 x Side Load, and Decode of that Total reaches it with no more Plates (ADR-0005, ADR-0008, ADR-0003)', () => {
    fc.assert(
      fc.property(rigTapsArb, ({ rig, taps }) => {
        let side: readonly Plate[] = [];
        for (const { i } of taps) side = addPlate(side, rig.inventory[i]);
        const t = encode(side, rig.baselineKg);
        expect(t).toBeCloseTo(rig.barKg + 2 * rig.collarKg + 2 * sideLoadKg(side), 9);
        const { primary } = decode(t, rig.baselineKg, rig.inventory);
        expect(primary.total).toBeCloseTo(t, 9);
        // On every set since RBAR-69 (a hand-built 35+35+35 used to beat Decode's
        // 45+45+10+5 on iron).
        expect(primary.side.length).toBeLessThanOrEqual(side.length);
      }),
      opts,
    );
  });
});

describe('Recents properties (ADR-0009)', () => {
  const targetLikeArb = fc.oneof(
    fc.integer({ min: 0, max: 50_000 }).map((c) => c / 100),
    fc.double({ noNaN: false }),
    fc.constantFrom(0, -1, Infinity, -Infinity, Number.NaN),
  );

  it('any push sequence keeps the row capped, deduped, rememberable and at 2 dp, newest first (ADR-0009)', () => {
    fc.assert(
      fc.property(fc.array(targetLikeArb, { maxLength: 30 }), (pushes) => {
        let list: readonly number[] = [];
        for (const t of pushes) {
          const next = pushRecent(list, t);
          // Remembered iff the STORED value is a loadable weight (a positive Target that
          // rounds to 0 is not -- the RBAR-62 fix).
          const stored = Number(t.toFixed(2));
          if (isRememberable(stored)) expect(next[0]).toBe(stored);
          else expect(next).toEqual(list);
          list = next;
          expect(list.length).toBeLessThanOrEqual(MAX_RECENTS);
          expect(new Set(list).size).toBe(list.length);
          for (const v of list) {
            expect(isRememberable(v)).toBe(true);
            expect(Number(v.toFixed(2))).toBe(v);
          }
        }
      }),
      opts,
    );
  });

  it('the persisted row round-trips through JSON exactly (ADR-0009)', () => {
    fc.assert(
      fc.property(fc.array(targetLikeArb, { maxLength: 30 }), (pushes) => {
        const list = pushes.reduce<readonly number[]>((l, t) => pushRecent(l, t), []);
        expect(parseRecents(JSON.stringify(list))).toEqual(list);
      }),
      opts,
    );
  });

  // A reachable row: any push sequence (the only way the live row is ever built).
  const rowArb = fc
    .array(targetLikeArb, { maxLength: 30 })
    .map((pushes) => pushes.reduce<readonly number[]>((l, t) => pushRecent(l, t), []));
  const isValidRow = (list: readonly number[]): void => {
    expect(list.length).toBeLessThanOrEqual(MAX_RECENTS);
    expect(new Set(list).size).toBe(list.length);
    for (const v of list) {
      expect(isRememberable(v)).toBe(true);
      expect(Number(v.toFixed(2))).toBe(v);
    }
  };

  it('removing a Target drops exactly that chip, keeps the rest in order, and leaves a valid row (ADR-0009 RBAR-73)', () => {
    // Half the time a held Target (by its index), so the "found it" path is exercised as
    // hard as the "not held" one.
    const caseArb = rowArb.chain((list) =>
      fc.oneof(
        targetLikeArb.map((t) => ({ list, t })),
        list.length > 0
          ? fc.nat({ max: list.length - 1 }).map((i) => ({ list, t: list[i] }))
          : fc.constant({ list, t: 100 }),
      ),
    );
    fc.assert(
      fc.property(caseArb, ({ list, t }) => {
        const next = removeRecent(list, t);
        const stored = Number(t.toFixed(2));
        expect(next).toEqual(list.filter((v) => v !== stored));
        expect(next).not.toContain(stored);
        isValidRow(next);
      }),
      opts,
    );
  });

  it('Undo restores a removed chip in place: restore(remove(row, t), t, i) is the row (ADR-0009 RBAR-73)', () => {
    fc.assert(
      fc.property(rowArb, fc.nat(), (list, n) => {
        fc.pre(list.length > 0);
        const i = n % list.length;
        const t = list[i];
        expect(restoreRecent(removeRecent(list, t), t, i)).toEqual(list);
      }),
      opts,
    );
  });

  it('restoring any subset of pending removals, in any order, gives the row minus the un-restored ones (ADR-0009 RBAR-73)', () => {
    // The rail's model while removals are pending: the row frozen into slots. Each
    // removal and each restore uses the slot's list index -- the live slots before it --
    // exactly as <rack-recents> hands them to the console.
    const caseArb = rowArb.chain((row) =>
      fc
        .shuffledSubarray([...row.keys()])
        .chain((removedIdx) =>
          fc
            .shuffledSubarray(removedIdx)
            .map((restoredIdx) => ({ row, removedIdx, restoredIdx })),
        ),
    );
    fc.assert(
      fc.property(caseArb, ({ row, removedIdx, restoredIdx }) => {
        const live = row.map(() => true);
        const at = (slot: number) => live.slice(0, slot).filter(Boolean).length;
        let list = row;
        for (const slot of removedIdx) {
          expect(list.indexOf(row[slot])).toBe(at(slot)); // the index the rail sends
          list = removeRecent(list, row[slot]);
          live[slot] = false;
        }
        for (const slot of restoredIdx) {
          list = restoreRecent(list, row[slot], at(slot));
          live[slot] = true;
        }
        const restored = new Set(restoredIdx);
        expect(list).toEqual(row.filter((_, i) => !removedIdx.includes(i) || restored.has(i)));
        isValidRow(list);
      }),
      opts,
    );
  });

  it('a restore never duplicates, never passes the cap, and never admits a non-loadable Target (ADR-0009 RBAR-73)', () => {
    fc.assert(
      fc.property(rowArb, targetLikeArb, fc.integer({ min: -10, max: 20 }), (list, t, i) => {
        const next = restoreRecent(list, t, i);
        isValidRow(next);
        const stored = Number(t.toFixed(2));
        if (!isRememberable(stored) || list.includes(stored)) {
          expect(next).toEqual(list);
          return;
        }
        // Below the cap the Target always comes back; at the cap at most one entry (the
        // oldest, or the restored one itself when placed last) falls off the end.
        if (list.length < MAX_RECENTS) expect(next).toContain(stored);
        const others = next.filter((v) => v !== stored);
        expect(others).toEqual(list.slice(0, others.length));
        expect(others.length).toBeGreaterThanOrEqual(list.length - 1);
      }),
      opts,
    );
  });

  it('a corrupt persisted row never throws and loads as a valid row (ADR-0009)', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string(), fc.json(), fc.jsonValue().map((v) => JSON.stringify(v))),
        (raw) => {
          const list = parseRecents(raw);
          expect(list.length).toBeLessThanOrEqual(MAX_RECENTS);
          expect(new Set(list).size).toBe(list.length);
          for (const v of list) expect(isRememberable(v)).toBe(true);
        },
      ),
      opts,
    );
  });
});

describe('Plate set properties (ADR-0010)', () => {
  it('any key resolves to an offered set, an unknown one to Competition (ADR-0007 validate-at-boundary)', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.constantFrom(...PLATE_SET_KEYS)), (key) => {
        const set = plateSetFor(key);
        expect(PLATE_SET_KEYS).toContain(set.key);
        expect(set.key).toBe(isOfferedPlateSet(key) ? key : 'comp');
      }),
      opts,
    );
  });

  it('every set offers its default Bar first, and every Plate is on that set\'s grid (ADR-0010)', () => {
    for (const key of PLATE_SET_KEYS) {
      const set = PLATE_SETS[key];
      expect(set.bars[0].kg).toBe(set.defaultBarKg);
      // The oracle asserts the grid when it builds; reaching here means it held.
      expect(achievableTotals(RIGS.find((r) => r.set === key)!).length).toBeGreaterThan(0);
    }
  });
});

// Share links (RBAR-50, ADR-0014). States are built only through the real core paths
// (an offered set, one of its Bars, an offered Collar, a Side Load grown by addPlate so
// the Sleeve caps it), so the round-trip is checked over exactly the loads the app can
// show. The fuzzers then aim arbitrary and grammar-shaped text at the parser.
describe('Share link properties (ADR-0014)', () => {
  const modeArb = fc.constantFrom<LinkMode>('decode', 'encode');

  // A deterministic shuffle keyed by generated noise (fast-check shrinks the noise, not
  // the order), shared by the generators that reorder pairs and Plates.
  const shuffleBy = <T,>(noise: readonly number[], xs: readonly T[]): T[] =>
    xs
      .map((x, i) => ({ x, k: noise[i % noise.length]! + i / 1000 }))
      .sort((a, b) => a.k - b.k)
      .map((e) => e.x);

  const linkStateArb: fc.Arbitrary<LinkState> = fc
    .record({
      key: fc.constantFrom(...PLATE_SET_KEYS),
      barIx: fc.nat(),
      collarKg: fc.constantFrom(...COLLAR_OPTIONS),
      unit: unitArb,
      mode: modeArb,
      picks: fc.array(fc.nat(), { maxLength: 40 }),
      cents: fc.option(fc.integer({ min: 1, max: MAX_TARGET_KG * 100 }), { nil: undefined }),
    })
    .map(({ key, barIx, collarKg, unit, mode, picks, cents }): LinkState => {
      const set = PLATE_SETS[key];
      const side = picks.reduce<readonly Plate[]>(
        (acc, i) => addPlate(acc, set.inventory[i % set.inventory.length]!),
        [],
      );
      const barKg = set.bars[barIx % set.bars.length]!.kg;
      const base = { set: key, barKg, collarKg, unit, mode, side };
      return mode === 'decode' && cents !== undefined ? { ...base, targetKg: cents / 100 } : base;
    });

  // Every invariant a parsed state must hold -- the parser's output contract.
  function expectValid(s: LinkState): void {
    expect(isOfferedPlateSet(s.set)).toBe(true);
    const set = PLATE_SETS[s.set];
    expect(set.bars.map((b) => b.kg)).toContain(s.barKg);
    expect(isOfferedCollar(s.collarKg)).toBe(true);
    expect(UNITS).toContain(s.unit);
    expect(['decode', 'encode']).toContain(s.mode);
    for (const p of s.side) expect(set.inventory).toContain(p);
    for (let i = 1; i < s.side.length; i++) {
      expect(s.side[i - 1]!.kg).toBeGreaterThanOrEqual(s.side[i]!.kg);
    }
    expect(sideWidthMm(s.side)).toBeLessThanOrEqual(SLEEVE_MM + EPS);
    // Read the Target off the runtime object, not the narrowed type, so an encode load
    // that somehow carried one would still be caught.
    const t = (s as { readonly targetKg?: number }).targetKg;
    if (t !== undefined) {
      expect(s.mode).toBe('decode');
      expect(Number.isFinite(t)).toBe(true);
      expect(t).toBeGreaterThan(0);
      expect(t).toBeLessThanOrEqual(MAX_TARGET_KG);
      expect(Number(t.toFixed(2))).toBe(t);
    }
  }

  // Grammar-shaped links: one optional value per key, MOSTLY valid for the chosen set
  // (so a real share is accepted and the post-acceptance checks bite), salted with
  // near-misses (the other set's faces and Bar stamps, counts 0 and past 99, piles past
  // the Sleeve, t with m=p, junk values, a duplicate key), in a shuffled order. Some
  // salt is tolerated, not rejected (`c=2.50`, a stamp both sets offer): the checks
  // below assert validity of whatever is accepted, not which inputs are rejected.
  const allFaces = [
    ...new Set(
      [...PLATE_SETS.comp.inventory, ...PLATE_SETS.training.inventory].map(
        (p) => p.label ?? String(p.kg),
      ),
    ),
  ];
  const allStamps = ['20kg', '15kg', '5kg', '45lb', '20lb', '20'];
  const opt = (arb: fc.Arbitrary<string>) => fc.option(arb, { nil: undefined, freq: 20 });
  const often = <T,>(good: fc.Arbitrary<T>, bad: fc.Arbitrary<T>): fc.Arbitrary<T> =>
    fc.oneof({ arbitrary: good, weight: 15 }, { arbitrary: bad, weight: 1 });
  const grammarArb = fc.constantFrom(...PLATE_SET_KEYS).chain((key) => {
    const set = PLATE_SETS[key];
    const ownFaces = set.inventory.map((p) => p.label ?? String(p.kg));
    const ownStamps = set.bars.map((b) => (b.unit === 'lb' ? `${Math.round(kgToLb(b.kg))}lb` : `${b.kg}kg`));
    const plateTokenArb = fc
      .tuple(
        often(
          fc.option(fc.integer({ min: 1, max: 3 }), { nil: undefined }),
          fc.constantFrom<number | undefined>(0, 99, 100, 120),
        ),
        often(fc.constantFrom(...ownFaces), fc.constantFrom(...allFaces, 'x', '')),
      )
      .map(([n, face]) => (n === undefined ? face : `${n}x${face}`));
    return fc
      .tuple(
        fc.record({
          v: opt(often(fc.constant('1'), fc.constantFrom('2', '', '01'))),
          s: opt(often(fc.constant(key), fc.constantFrom('x', '__proto__'))),
          b: opt(often(fc.constantFrom(...ownStamps), fc.constantFrom(...allStamps))),
          m: opt(often(fc.constantFrom('w', 'p'), fc.constant('q'))),
          c: opt(often(fc.constantFrom('0', '2.5'), fc.constantFrom('5', '', '2.50', '0x0'))),
          u: opt(often(fc.constantFrom('kg', 'lb'), fc.constant('st'))),
          p: opt(fc.array(plateTokenArb, { maxLength: 4 }).map((ts) => ts.join(','))),
          t: opt(
            often(
              fc.integer({ min: 1, max: 100_000 }).map((c) => String(c / 100)),
              fc.oneof(fc.integer({ min: -500, max: 110_000 }).map((c) => String(c / 100)), fc.string()),
            ),
          ),
          zz: opt(fc.string()),
        }),
        often(fc.constant(undefined), fc.constantFrom('v=1', `s=${key}`, 'p=25')),
        fc.array(fc.nat(), { minLength: 12, maxLength: 12 }),
      )
      .map(([rec, dup, noise]) =>
        shuffleBy(
          noise,
          [...Object.entries(rec).map(([k, v]) => (v === undefined ? undefined : `${k}=${v}`)), dup]
            .filter((kv): kv is string => kv !== undefined),
        ).join('&'),
      );
  });

  it('round-trips: parseLink(serializeLink(s)) is s for every showable load (ADR-0014)', () => {
    fc.assert(
      fc.property(linkStateArb, (s) => {
        expect(parseLink(serializeLink(s)!, 'kg')).toEqual(s);
      }),
      opts,
    );
  });

  it('canonical form is a fixed point: serializeLink(parseLink(x)) === x for every canonical x (ADR-0014)', () => {
    fc.assert(
      fc.property(linkStateArb, (s) => {
        const x = serializeLink(s)!;
        expect(serializeLink(parseLink(x, 'kg')!)).toBe(x);
      }),
      opts,
    );
  });

  it('canonicalization is idempotent: a reshuffled, defaulted, padded link parses to the same load (ADR-0014 ignore-unknown-keys, re-sort)', () => {
    fc.assert(
      fc.property(
        linkStateArb,
        fc.array(fc.nat(), { minLength: 50, maxLength: 50 }),
        fc.boolean(),
        fc.boolean(),
        (s, noise, dropDefaults, addUnknown) => {
          // Rewrite the canonical link: every Plate as a single token in a shuffled
          // order, defaulted keys dropped, unknown keys added, the pairs shuffled.
          const shuffle = <T,>(xs: readonly T[]): T[] => shuffleBy(noise, xs);
          const faces = s.side.map((p) => p.label ?? String(p.kg));
          const pairs = serializeLink(s)!
            .split('&')
            .filter((kv) => !kv.startsWith('p='))
            .filter((kv) => !(dropDefaults && (kv === 'c=0' || kv === `u=${s.unit}`)));
          if (!(dropDefaults && faces.length === 0)) pairs.push(`p=${shuffle(faces).join(',')}`);
          if (addUnknown) pairs.push('zz=later', 'q');
          const parsed = parseLink(shuffle(pairs).join('&'), s.unit);
          expect(parsed).toEqual(s);
          const canon = serializeLink(parsed!);
          expect(canon).toBe(serializeLink(s));
          expect(serializeLink(parseLink(canon!, 'kg')!)).toBe(canon);
        },
      ),
      opts,
    );
  });

  it('never throws on arbitrary text, and yields null or a fully valid load (ADR-0014 all-or-nothing)', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string(),
          fc.string({ unit: 'binary' }),
          grammarArb,
          linkStateArb.map((s) => serializeLink(s)!.slice(0, -1)),
        ),
        unitArb,
        (x, primary) => {
          const s = parseLink(x, primary);
          if (s === null) return;
          expectValid(s);
          // With no `u` in the link, the load reads in the recipient's Primary unit.
          const raw = x.startsWith('#') ? x.slice(1) : x;
          if (!raw.split('&').some((seg) => seg === 'u' || seg.startsWith('u='))) {
            expect(s.unit).toBe(primary);
          }
        },
      ),
      { ...opts, numRuns: 1000 },
    );
  });

  it('every accepted Side Load fits the Sleeve and every accepted Bar is one its set offers (ADR-0014, ADR-0012)', () => {
    let accepted = 0;
    fc.assert(
      fc.property(grammarArb, (x) => {
        const s = parseLink(x, 'kg');
        if (s === null) return;
        accepted++;
        expect(sideWidthMm(s.side)).toBeLessThanOrEqual(SLEEVE_MM + EPS);
        expect(PLATE_SETS[s.set].bars.map((b) => b.kg)).toContain(s.barKg);
      }),
      { ...opts, numRuns: 2000 },
    );
    // The grammar must actually reach acceptance, or this property is vacuous (the
    // fixed seed accepts ~22%; a tenth is the floor).
    expect(accepted).toBeGreaterThan(200);
  });

  it('a whole-lb Target reads back as the same whole pounds after the trip (ADR-0014, ADR-0006)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: Math.floor(kgToLb(MAX_TARGET_KG)) }), (n) => {
        const s: LinkState = {
          set: 'training',
          barKg: PLATE_SETS.training.defaultBarKg,
          collarKg: 0,
          unit: 'lb',
          mode: 'decode',
          side: [],
          targetKg: lbToKg(n),
        };
        const got = parseLink(serializeLink(s)!, 'kg');
        expect(got?.mode === 'decode' && shownIn(got.targetKg!, 'lb')).toBe(n);
      }),
      opts,
    );
  });

  it('the serializer refuses exactly the loads it cannot represent, and everything it writes opens to the same load (ADR-0014)', () => {
    // Loosely built loads: any Bar weight either set offers (plus an off-menu one), any
    // Collar-ish weight, Plates drawn from BOTH sets in any order and any number, any
    // Target double -- so foreign Plates, unsorted or over-Sleeve Sides, off-menu Bars
    // and unrepresentable Targets are all hit.
    const anyPlates = [...PLATE_SETS.comp.inventory, ...PLATE_SETS.training.inventory];
    const allBarKgs = [...PLATE_SETS.comp.bars, ...PLATE_SETS.training.bars].map((b) => b.kg);
    const looseArb = fc
      .record({
        key: fc.constantFrom(...PLATE_SET_KEYS),
        barKg: fc.constantFrom(...allBarKgs, 20.4),
        collarKg: fc.constantFrom(0, 2.5, 5),
        unit: unitArb,
        mode: modeArb,
        picks: fc.array(fc.nat(), { maxLength: 12 }),
        own: fc.boolean(),
        sorted: fc.boolean(),
        targetKg: fc.option(
          fc.oneof(fc.double({ min: -10, max: 1100 }), fc.constantFrom(0.004, 0.005, 1000, 1000.004, 1000.006)),
          { nil: undefined },
        ),
      })
      .map(({ key, barKg, collarKg, unit, mode, picks, own, sorted, targetKg }) => {
        const pool = own ? PLATE_SETS[key].inventory : anyPlates;
        const drawn = picks.map((i) => pool[i % pool.length]!);
        const side = sorted ? [...drawn].sort((a, b) => b.kg - a.kg) : drawn;
        return { set: key, barKg, collarKg, unit, mode, side, targetKg } as unknown as LinkState;
      });
    fc.assert(
      fc.property(looseArb, (s) => {
        const set = PLATE_SETS[s.set];
        const raw = s as unknown as { readonly targetKg?: number; readonly collarKg: number };
        const t = s.mode === 'decode' && raw.targetKg !== undefined ? Number(raw.targetKg.toFixed(2)) : undefined;
        const representable =
          set.bars.some((b) => b.kg === s.barKg) &&
          isOfferedCollar(raw.collarKg) &&
          s.side.every((p) => set.inventory.includes(p)) &&
          s.side.every((p, i) => i === 0 || s.side[i - 1]!.kg >= p.kg) &&
          sideWidthMm(s.side) <= SLEEVE_MM + EPS &&
          (t === undefined || (Number.isFinite(t) && t > 0 && t <= MAX_TARGET_KG));
        const x = serializeLink(s);
        expect(x !== null).toBe(representable);
        if (x === null) return;
        const { targetKg: _dropped, ...rest } = s as LinkState & { targetKg?: number };
        expect(parseLink(x, 'kg')).toEqual(t === undefined ? rest : { ...rest, targetKg: t });
      }),
      { ...opts, numRuns: 1000 },
    );
  });
});
