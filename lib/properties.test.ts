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
import {
  MAX_LIFTS,
  MAX_PERCENT,
  addMax,
  parseMaxes,
  percentOfMax,
  removeMax,
  restoreMax,
  serializeMaxes,
  setMax,
} from './maxes.ts';
import type { Max } from './maxes.ts';
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
import { SLEEVE_PAD_PX, sleeveLayout } from './sleevefit.ts';
import {
  draftToKg,
  displayCeilingKg,
  displayFloorKg,
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
import { plateFace, withLimits } from './plates.ts';
import type { InventoryEntry } from './plates.ts';
import { cappedFewestOracle, greatestSumAtOrUnder } from './fewest.oracle.ts';
import { sideLoads } from './sideloads.ts';
import { MAX_WAYS, waysFor } from './ways.ts';
import {
  RIGS,
  achievableTotals,
  greatestAtOrUnder,
  leastAbove,
  fewestPlatesFor,
  maxTotal,
  rampTotalsOracle,
  warmWorkingOracle,
  stationRampOracle,
  oracleStationCost,
  oracleMoveCost,
  oracleCaps,
  legalSides,
  onHand,
  oracleGridKg,
  storedPairsOracle,
  waysOracle,
} from './properties.oracle.ts';
import type { StationRule } from './properties.oracle.ts';
import {
  planEasyRamp,
  RAMP_BAND,
  RAMP_COST,
  PLATES_PER_SIZE,
  BIG_PLATE_DIAMETER_MM,
} from './moves.ts';
import { planRamp, DEFAULT_RAMP } from './plan.ts';
import type { RampStep } from './plan.ts';
import type { Rig } from './properties.oracle.ts';
import { GRID_KG, fewestOracle } from './fewest.oracle.ts';
import { parseLink, readingFits, serializeLink, MAX_TARGET_KG } from './link.ts';
import type { LinkState, LinkMode } from './link.ts';
import {
  MAX_CUSTOM_BARS,
  CUSTOM_BAR_MAX,
  barsFor,
  barLabel,
  isValidStamp,
  parseCustomBars,
  parseStampText,
  serializeCustomBars,
  stampKg,
  addCustomBar,
  removeCustomBar,
  restoreCustomBar,
} from './custombars.ts';
import type { BarStamp } from './custombars.ts';
import type { PlateSetKey } from './platesets.ts';
import {
  inventoryOnHand,
  parsePlatesOnHand,
  serializePlatesOnHand,
  setPairs,
  clearSet,
  ALL_PLATES,
} from './platesonhand.ts';
import type { PlatesOnHand } from './platesonhand.ts';
import {
  COLLARS_MODES,
  MAX_PLATES_CHOICES,
  diagnose,
  isRight,
  mistakes,
  parseQuizSaved,
  quizQuestion,
  serializeQuizSaved,
  smallestFullPlate,
  typeKey,
  answerOf,
  MAX_ANSWER_CHARS,
} from './quiz.ts';
import type { QuizRig, QuizSettings } from './quiz.ts';

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

  // RBAR-90: the exhaustive form of the rule above for the Targets a lifter types most,
  // every whole number. It replaces the ~600-Target DOM sweep the RBAR-63 Training 20 kg
  // Bar slice typed through the console (elements/console.test.ts keeps spot checks),
  // and widens it from that one rig to every rig. The pill reads "over" exactly when
  // the shown Total exceeds the shown Target (statusPill), so this is that check on the
  // console's own solve.
  it('never reads over for any whole-number Target from the bare rig to past the Sleeve, every rig and unit (ADR-0003 as read; exhaustive)', () => {
    const overs: string[] = [];
    for (const rig of RIGS) {
      for (const u of UNITS) {
        const lo = Math.ceil(shownIn(rig.baselineKg, u));
        const hi = Math.ceil(shownIn(maxTotal(rig) + 20, u));
        for (let n = lo; n <= hi; n++) {
          const t = draftToKg(String(n), u)!;
          const shown = shownIn(solveAsRead(rig, t, u).primary.total, u);
          if (shown > shownIn(t, u)) overs.push(`${rig.name} ${u}: ${n} -> ${shown}`);
        }
      }
    }
    expect(overs).toEqual([]);
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
  const face = plateFace;
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

  it('caps only remove candidate stacks, the rank order is unchanged (ADR-0016, ADR-0003)', () => {
    // The uncapped ranking is oracle-locked (RBAR-69), so it is the reference: the capped
    // enumeration must be exactly its within-cap stacks, in the same order. The reference
    // scan is bounded; whatever prefix of it was scanned pins a prefix of the capped list.
    const LIMIT = 20;
    const SCAN = 5000;
    const caseArb = rigArb.chain((rig) =>
      fc.record({
        rig: fc.constant(rig),
        caps: fc.array(fc.oneof(fc.integer({ min: 0, max: 3 }), fc.constant(Infinity)), {
          minLength: rig.inventory.length,
          maxLength: rig.inventory.length,
        }),
        units: fc.integer({ min: 0, max: Math.floor(150 / GRID_KG[rig.set]) }),
      }),
    );
    const key = (side: readonly Plate[]) => side.map(face).join('+');
    fc.assert(
      fc.property(caseArb, ({ rig, caps, units }) => {
        const sideKg = units * GRID_KG[rig.set];
        const within = (side: readonly Plate[]) => rig.inventory.every((p, i) => countOf(side, p) <= caps[i]);
        const got: string[] = [];
        for (const side of sideLoads(sideKg, limited(rig, caps))) {
          got.push(key(side));
          if (got.length >= LIMIT) break;
        }
        const want: string[] = [];
        let scanned = 0;
        let complete = true;
        for (const side of sideLoads(sideKg, rig.inventory)) {
          if (++scanned > SCAN) {
            complete = false;
            break;
          }
          if (within(side)) want.push(key(side));
          if (want.length >= LIMIT) break;
        }
        if (complete || want.length >= LIMIT) expect(got).toEqual(want);
        else expect(got.slice(0, want.length)).toEqual(want);
      }),
      { seed: SEED, numRuns: 150 },
    );
  });

  it('withLimits composes as the tighter cap, in either order (ADR-0016)', () => {
    // Absent (no key) counts as unlimited; an explicit All (Infinity) over a finite cap
    // must stay finite -- "today: All" never resets "this gym".
    const optCapArb = fc.oneof(fc.integer({ min: 0, max: 4 }), fc.constant(Infinity), fc.constant(undefined));
    const caseArb = rigArb.chain((rig) => {
      const arr = fc.array(optCapArb, { minLength: rig.inventory.length, maxLength: rig.inventory.length });
      return fc.record({ rig: fc.constant(rig), a: arr, b: arr, t: targetArb(rig) });
    });
    const record = (rig: Rig, caps: readonly (number | undefined)[]) =>
      Object.fromEntries(
        rig.inventory.flatMap((p, i) => (caps[i] === undefined ? [] : [[face(p), caps[i] as number]])),
      );
    fc.assert(
      fc.property(caseArb, ({ rig, a, b, t }) => {
        const min = rig.inventory.map((_, i) =>
          a[i] === undefined && b[i] === undefined ? undefined : Math.min(a[i] ?? Infinity, b[i] ?? Infinity),
        );
        const direct = withLimits(rig.inventory, record(rig, min));
        const want = JSON.stringify(shape(decode(t, rig.baselineKg, direct)));
        for (const composed of [
          withLimits(withLimits(rig.inventory, record(rig, a)), record(rig, b)),
          withLimits(withLimits(rig.inventory, record(rig, b)), record(rig, a)),
        ]) {
          rig.inventory.forEach((p, i) => {
            if (min[i] === undefined) expect(composed[i]).toBe(p);
            else expect(composed[i].maxPerSide).toBe(min[i]);
          });
          expect(JSON.stringify(shape(decode(t, rig.baselineKg, composed)))).toBe(want);
        }
      }),
      opts,
    );
  });

  it('every size none: Decode is the bare rig and planRamp and planEasyRamp give bare-rig rows (ADR-0016)', () => {
    fc.assert(
      fc.property(rigTargetArb, ({ rig, t }) => {
        const none = limited(rig, rig.inventory.map(() => 0));
        const { primary, over } = decode(t, rig.baselineKg, none);
        expect(primary.side).toEqual([]);
        expect(primary.total).toBe(rig.baselineKg);
        expect(over).toBeUndefined();
        fc.pre(t > 0);
        const ramp = planRamp(t, DEFAULT_RAMP, { barKg: rig.barKg, collarKg: rig.collarKg, inventory: none });
        // planEasyRamp guards with hasUsablePlates, so plateGridKg never sees all-none.
        const easy = planEasyRamp(t, DEFAULT_RAMP, { barKg: rig.barKg, collarKg: rig.collarKg, inventory: none });
        for (const row of [...ramp.rows, ...easy.rows]) {
          expect(row.side).toEqual([]);
          expect(row.total).toBeCloseTo(rig.barKg + (row.collars ? 2 * rig.collarKg : 0), 9);
        }
      }),
      opts,
    );
  });

  it('the Warm up Ramp never uses a none size nor exceeds a cap on any row (ADR-0016, RBAR-72)', () => {
    // Slice 2 passes the capped Inventory through; slice 3 owns the Ramp's shape under
    // limits. This pins only that every row is loadable from the plates on hand.
    fc.assert(
      fc.property(cappedArb, ({ rig, caps, t }) => {
        fc.pre(t > 0);
        const inv = limited(rig, caps);
        const ramp = planEasyRamp(t, DEFAULT_RAMP, { barKg: rig.barKg, collarKg: rig.collarKg, inventory: inv });
        for (const row of ramp.rows) {
          rig.inventory.forEach((p, i) => expect(countOf(row.side, p)).toBeLessThanOrEqual(caps[i]));
        }
      }),
      { seed: SEED, numRuns: 120 },
    );
  });
});

describe('Warm-up Ramp properties (ADR-0015)', () => {
  // A template: up to two leading bare-Bar steps, then up to six percentages that never
  // fall (planRamp rejects a falling one, ADR-0015 as amended), whole or fractional.
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
      ...[...pcts].sort((x, y) => x - y).map((pct): RampStep => ({ kind: 'pct', pct })),
    ]);
  const caseArb = fc.record({ rt: rigTargetArb, u: unitArb, steps: fc.oneof(stepsArb, fc.constant([...DEFAULT_RAMP])) });

  // The console's call, exactly: the Working set solved as read in the active unit, and
  // rounded up only when it reads short of the Target (RBAR-87).
  const plan = (rig: Rig, t: number, u: Unit, steps: readonly RampStep[]) =>
    planRamp(t, steps, { barKg: rig.barKg, collarKg: rig.collarKg, inventory: rig.inventory }, {
      ceilingKg: displayCeilingKg(t, u),
      floorKg: displayFloorKg(t, u),
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

  it('the Working set is the at-or-under solve as read when that reaches the Target, else its round-up; Decode is unchanged (ADR-0015 as amended RBAR-87, ADR-0003)', () => {
    fc.assert(
      fc.property(caseArb, ({ rt: { rig, t }, u, steps }) => {
        const { rows, working } = plan(rig, t, u, steps);
        const solved = decodeWithin(t, displayCeilingKg(t, u), rig.baselineKg, rig.inventory);
        // The Ramp still carries Decode's own solve, which never overshoots (ADR-0003).
        expect(working).toEqual(solved);
        const last = rows[rows.length - 1];
        expect(last.kind).toBe('working');
        // Its Total is the oracle's; its Side is Decode's canonical stack for that Total.
        const want = warmWorkingOracle(rig, t, displayCeilingKg(t, u), displayFloorKg(t, u));
        expect(last.total).toBeCloseTo(want, 9);
        expect(last.side).toEqual(decode(want, rig.baselineKg, rig.inventory).primary.side);
        // It overshoots only by rounding a short load up: the at-or-under one read short.
        if (shownIn(last.total, u) > shownIn(t, u) && shownIn(t, u) >= shownIn(rig.baselineKg, u)) {
          expect(shownIn(solved.primary.total, u)).toBeLessThan(shownIn(t, u));
          expect(last.total).toBeCloseTo(leastAbove(rig, displayCeilingKg(t, u))!, 9);
        }
      }),
      opts,
    );
  });

  it("Warm up's Working Total rounds up to the least loadable Total at or above the Target (RBAR-87, ADR-0015 as amended)", () => {
    // kg-canonical, floor = the Target (workingLoad's default): the Working Total is
    // loadable, at or above the Target whenever anything loadable is, and no loadable
    // Total lies between the Target and it. With nothing loadable at or above the
    // Target (past the Sleeve) it is the at-or-under Total, as before.
    fc.assert(
      fc.property(rigTargetArb, ({ rig, t }) => {
        fc.pre(Number.isFinite(t) && t > 0);
        const rigArg = { barKg: rig.barKg, collarKg: rig.collarKg, inventory: rig.inventory };
        const rows = planRamp(t, DEFAULT_RAMP, rigArg).rows;
        const w = rows[rows.length - 1].total;
        const totals = achievableTotals(rig);
        expect(totals.some((x) => Math.abs(x - w) < 1e-6)).toBe(true);
        const up = totals.find((x) => x >= t - 1e-9);
        if (up === undefined) {
          expect(w).toBeCloseTo(greatestAtOrUnder(rig, t), 9);
        } else {
          expect(w).toBeGreaterThanOrEqual(t - 1e-9);
          expect(totals.some((x) => x >= t - 1e-9 && x < w - 1e-6)).toBe(false);
          expect(w).toBeCloseTo(up, 9);
        }
        // planEasyRamp keeps that Working Total; only its Side may differ.
        const easyRows = planEasyRamp(t, DEFAULT_RAMP, rigArg).rows;
        expect(easyRows[easyRows.length - 1].total).toBeCloseTo(w, 9);
        // By Weight's Decode of the same Target is untouched: never over (ADR-0003).
        if (t >= rig.baselineKg) expect(decode(t, rig.baselineKg, rig.inventory).primary.total).toBeLessThanOrEqual(t + 1e-9);
      }),
      opts,
    );
  });

  it('each Warm-up set is the nearest loadable Total to its percentage within its floor and the Working set, ties down (ADR-0015)', () => {
    fc.assert(
      fc.property(caseArb, ({ rt: { rig, t }, u, steps }) => {
        const got = plan(rig, t, u, steps).rows.map((r) => r.total);
        const want = rampTotalsOracle(rig, t, displayCeilingKg(t, u), steps, displayFloorKg(t, u));
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
        const want = rampTotalsOracle(rig, total, displayCeilingKg(total, 'kg'), DEFAULT_RAMP, displayFloorKg(total, 'kg'));
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

describe("Station rule properties (ADR-0015 as amended 2026-10-17, Caitlin's station rule)", () => {
  // Each full-rig run plans a whole Ramp, so these take fewer runs than the rest.
  const rampOpts = { seed: SEED, numRuns: 100 };
  // The ADR-0015 numbers, stated here rather than read from moves.ts, so a changed
  // weight in the planner fails the oracle instead of moving it too.
  const RULE: StationRule = {
    band: 0.05,
    cap: 2,
    bigDiameterMm: 450,
    missPerKg: 1,
    overFactor: 1.5,
    perPlate: 1,
    bigOff: 2,
    perMove: 0.2,
    perStationPlate: 0.2,
  };
  it('the planner\'s constants are the ADR-0015 numbers the oracle states', () => {
    expect({ band: RAMP_BAND, cap: PLATES_PER_SIZE, bigDiameterMm: BIG_PLATE_DIAMETER_MM, ...RAMP_COST }).toEqual(RULE);
  });
  // Percentages ascending, as the template editor saves them (RBAR-65 Q15).
  const pctStepsArb: fc.Arbitrary<RampStep[]> = fc
    .tuple(fc.integer({ min: 0, max: 1 }), fc.uniqueArray(fc.integer({ min: 1, max: 99 }), { maxLength: 4 }))
    .map(([bars, pcts]) => [
      ...Array.from({ length: bars }, (): RampStep => ({ kind: 'bar' })),
      ...[...pcts].sort((x, y) => x - y).map((pct): RampStep => ({ kind: 'pct', pct })),
    ]);
  const fullCaseArb = fc.record({
    rt: rigTargetArb,
    u: unitArb,
    steps: fc.oneof(pctStepsArb, fc.constant([...DEFAULT_RAMP])),
  });
  const easy = (rig: Rig, t: number, u: Unit, steps: readonly RampStep[]) =>
    planEasyRamp(t, steps, { barKg: rig.barKg, collarKg: rig.collarKg, inventory: rig.inventory }, {
      ceilingKg: displayCeilingKg(t, u),
      floorKg: displayFloorKg(t, u),
    });
  const isBig = (p: Plate) => p.diameterMm >= RULE.bigDiameterMm;
  // Totals as map keys, to 1e-6 kg (the iron kg are lbToKg products).
  const key = (total: number) => Math.round(total * 1e6);
  // Every Total `rig` can load with at most caps(p) of each Plate within the Sleeve: an
  // order-free walk over capped multisets (order never changes loadability), cached.
  const cappedCache = new Map<string, Map<number, number>>();
  const cappedTotals = (rig: Rig, caps: (p: Plate) => number): Map<number, number> => {
    const id = `${rig.name}|${rig.inventory.map(caps).join(',')}`;
    const hit = cappedCache.get(id);
    if (hit) return hit;
    const out = new Map<number, number>();
    const walk = (j: number, kg: number, mm: number) => {
      if (j === rig.inventory.length) {
        const total = rig.baselineKg + 2 * kg;
        out.set(key(total), total);
        return;
      }
      const p = rig.inventory[j];
      for (let c = 0; c <= caps(p); c++) {
        if (mm + c * p.widthMm > SLEEVE_MM + 1e-9) break;
        walk(j + 1, kg + c * p.kg, mm + c * p.widthMm);
      }
    };
    walk(0, 0, 0);
    cappedCache.set(id, out);
    return out;
  };
  const mostOfOne = (side: readonly Plate[]) =>
    Math.max(0, ...side.map((p) => side.filter((q) => q === p).length));
  const sumKg = (side: readonly Plate[]) => side.reduce((x, p) => x + p.kg, 0);

  // Small rigs the brute force can exhaust: a few Plates of each set (the Inventory's
  // own Plate objects, so Plate identity -- what a move compares -- is shared).
  const pick = (set: 'comp' | 'training', keep: (p: Plate) => boolean) =>
    PLATE_SETS[set].inventory.filter(keep);
  const SMALL_RIGS: readonly Rig[] = [
    { set: 'comp' as const, barKg: 20, collarKg: 0, inventory: pick('comp', (p) => [20, 10, 5, 2.5].includes(p.kg)) },
    { set: 'comp' as const, barKg: 20, collarKg: 2.5, inventory: pick('comp', (p) => [15, 5, 2.5].includes(p.kg)) },
    { set: 'comp' as const, barKg: 15, collarKg: 0, inventory: pick('comp', (p) => [25, 10, 5].includes(p.kg)) },
    { set: 'comp' as const, barKg: 20, collarKg: 0, inventory: pick('comp', (p) => [25, 15, 1].includes(p.kg)) },
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
        steps: fc.oneof(fc.constant([...DEFAULT_RAMP]), pctStepsArb),
      }),
    );
  type Row = { kind: string; targetKg: number; side: readonly Plate[]; total: number };
  const costOf = (rows: readonly Row[], tol: number) =>
    oracleStationCost(
      rows.map((r) => r.side),
      rows.map((r) => r.total),
      rows.map((r) => (r.kind === 'warmup' ? r.targetKg : null)),
      rows.map((r) => r.kind),
      tol,
      RULE,
    );

  it("the planner's cost equals the brute-force minimum on small Inventories (ADR-0015 as amended, station rule)", () => {
    fc.assert(
      fc.property(smallCaseArb, ({ rig, t, u, steps }) => {
        const got = easy(rig, t, u, steps);
        const { best, tol } = stationRampOracle(rig, t, displayCeilingKg(t, u), steps, RULE, displayFloorKg(t, u));
        const cost = costOf(got.rows, tol);
        cost.forEach((c, i) => expect(c).toBeCloseTo(best[i], 6));
        expect(got.cost).toBeCloseTo(cost[2], 6);
      }),
      { seed: SEED, numRuns: 150 },
    );
  });

  it('no small Plate sits inside a big one, and small Plates go heaviest-first (ADR-0015 as amended)', () => {
    fc.assert(
      fc.property(fullCaseArb, ({ rt: { rig, t }, u, steps }) => {
        for (const row of easy(rig, t, u, steps).rows) {
          const firstSmall = row.side.findIndex((p) => !isBig(p));
          if (firstSmall < 0) continue;
          const outside = row.side.slice(firstSmall);
          expect(outside.some(isBig)).toBe(false);
          outside.forEach((p, i) => i > 0 && expect(outside[i - 1].kg).toBeGreaterThanOrEqual(p.kg));
        }
      }),
      rampOpts,
    );
  });

  it('no size exceeds PLATES_PER_SIZE per Side unless the Working Total needs more, and then no more than Decode\'s own Side uses (ADR-0015 as amended)', () => {
    fc.assert(
      fc.property(fullCaseArb, ({ rt: { rig, t }, u, steps }) => {
        const got = easy(rig, t, u, steps);
        if (Math.max(...got.rows.map((r) => mostOfOne(r.side))) <= PLATES_PER_SIZE) return;
        // A raised cap: 2 of each must not load the Working Total within the Sleeve (an
        // order-free capped walk), and no Plate goes past its count in Decode's own Side.
        const work = got.rows[got.rows.length - 1];
        expect(cappedTotals(rig, () => RULE.cap).has(key(work.total))).toBe(false);
        // Decode's canonical stack for the Working Total (its round-up's, when rounded up).
        const own = decode(work.total, rig.baselineKg, rig.inventory).primary.side;
        for (const r of got.rows) {
          for (const p of r.side) {
            const n = r.side.filter((q) => q === p).length;
            expect(n).toBeLessThanOrEqual(Math.max(PLATES_PER_SIZE, own.filter((q) => q === p).length));
          }
        }
      }),
      rampOpts,
    );
    fc.assert(
      fc.property(smallCaseArb, ({ rig, t, u, steps }) => {
        const got = easy(rig, t, u, steps);
        const caps = oracleCaps(rig, got.rows[got.rows.length - 1].total, RULE);
        for (const r of got.rows) {
          for (const p of r.side) expect(r.side.filter((q) => q === p).length).toBeLessThanOrEqual(caps(p));
        }
      }),
      { seed: SEED, numRuns: 60 },
    );
  });

  it('the Working Total is the at-or-under Total as read, rounded up when it reads short; only its Side may differ (ADR-0015 as amended, ADR-0003)', () => {
    fc.assert(
      fc.property(fullCaseArb, ({ rt: { rig, t }, u, steps }) => {
        const got = easy(rig, t, u, steps);
        const solved = decodeWithin(t, displayCeilingKg(t, u), rig.baselineKg, rig.inventory);
        const last = got.rows[got.rows.length - 1];
        expect(last.kind).toBe('working');
        expect(last.total).toBeCloseTo(warmWorkingOracle(rig, t, displayCeilingKg(t, u), displayFloorKg(t, u)), 9);
        expect(got.working).toEqual(solved);
      }),
      rampOpts,
    );
  });

  it('every Warm-up set is within the band of its percentage unless no loadable Total in the band can climb to it (ADR-0015 as amended)', () => {
    const check = (rig: Rig, t: number, u: Unit, steps: readonly RampStep[], small: boolean) => {
        const got = easy(rig, t, u, steps);
        const work = got.rows[got.rows.length - 1].total;
        const tol = Math.max(RULE.band * work, Math.min(...rig.inventory.map((p) => p.kg)));
        // The caps: brute force on a small rig; on a full one, 2 of each when that loads
        // the Working Total, else Decode's own counts (an order-free capped walk).
        const own = decode(work, rig.baselineKg, rig.inventory).primary.side;
        const caps: (p: Plate) => number = small
          ? oracleCaps(rig, work, RULE)
          : cappedTotals(rig, () => RULE.cap).has(key(work))
            ? () => RULE.cap
            : (p) => Math.max(RULE.cap, own.filter((q) => q === p).length);
        const loadable = small
          ? legalSides(rig.inventory, RULE, caps).map((s) => rig.baselineKg + 2 * sumKg(s))
          : [...cappedTotals(rig, caps).values()];
        got.rows.forEach((row, i) => {
          if (row.kind !== 'warmup') return;
          if (Math.abs(row.total - row.targetKg) <= tol + 1e-9) return;
          const floor = Math.max(rig.baselineKg, i > 0 ? got.rows[i - 1].total : -Infinity);
          const forced = !loadable.some(
            (x) => x >= floor - 1e-9 && x <= work + 1e-9 && Math.abs(x - row.targetKg) <= tol + 1e-9,
          );
          expect(forced).toBe(true);
        });
    };
    fc.assert(fc.property(smallCaseArb, ({ rig, t, u, steps }) => check(rig, t, u, steps, true)), { seed: SEED, numRuns: 150 });
    fc.assert(fc.property(fullCaseArb, ({ rt: { rig, t }, u, steps }) => check(rig, t, u, steps, false)), rampOpts);
  });

  it('the pruned search reaches the brute-force minimum on the full iron set (ADR-0015 as amended, station rule)', () => {
    // 6 iron sizes are 729 capped multisets, past EXHAUSTIVE_LIMIT: this is the pruned
    // path. Only the 45 is big, so the oracle stays tractable up to 100 kg.
    const ironRigs = RIGS.filter((r) => r.set === 'training');
    fc.assert(
      fc.property(
        fc.constantFrom(...ironRigs).chain((rig) => fc.record({
          rig: fc.constant(rig),
          t: fc.constantFrom(...achievableTotals(rig).filter((x) => x <= 100)),
          u: unitArb,
          steps: fc.oneof(fc.constant([...DEFAULT_RAMP]), pctStepsArb),
        })),
        ({ rig, t, u, steps }) => {
          const got = easy(rig, t, u, steps);
          const { best, tol } = stationRampOracle(rig, t, displayCeilingKg(t, u), steps, RULE, displayFloorKg(t, u));
          costOf(got.rows, tol).forEach((c, i) => expect(c).toBeCloseTo(best[i], 6));
        },
      ),
      { seed: SEED, numRuns: 40 },
    );
  }, 60000);

  it('the search never falls back to planRamp\'s own Ramp (degraded) (ADR-0015 as amended)', () => {
    fc.assert(
      fc.property(fullCaseArb, ({ rt: { rig, t }, u, steps }) => {
        expect(easy(rig, t, u, steps).degraded).toBe(false);
      }),
      rampOpts,
    );
    fc.assert(
      fc.property(smallCaseArb, ({ rig, t, u, steps }) => {
        expect(easy(rig, t, u, steps).degraded).toBe(false);
      }),
      { seed: SEED, numRuns: 60 },
    );
  });

  it('each row carries its stack moves from the row before, and they add up (ADR-0015 as amended)', () => {
    fc.assert(
      fc.property(fullCaseArb, ({ rt: { rig, t }, u, steps }) => {
        const got = easy(rig, t, u, steps);
        let prev: readonly Plate[] = [];
        let sum = 0;
        for (const row of got.rows) {
          expect(row.moves.cost).toBeCloseTo(oracleMoveCost(prev, row.side, RULE), 9);
          const kept = prev.slice(0, prev.length - row.moves.off.length);
          expect([...kept, ...row.moves.on]).toEqual(row.side);
          sum += row.moves.cost;
          prev = row.side;
        }
        expect(got.totalMoves).toBeCloseTo(sum, 9);
      }),
      rampOpts,
    );
  });

  it('Totals never decrease, Warm-up sets stay at or under the Working set, bare-Bar rows stay bare, and every Side fits the Sleeve (ADR-0015 as amended, ADR-0012)', () => {
    fc.assert(
      fc.property(fullCaseArb, ({ rt: { rig, t }, u, steps }) => {
        const got = easy(rig, t, u, steps);
        const work = got.rows[got.rows.length - 1].total;
        got.rows.forEach((row, i) => {
          if (i > 0) expect(row.total).toBeGreaterThanOrEqual(got.rows[i - 1].total - EPS);
          const baseline = row.collars ? rig.baselineKg : rig.barKg;
          expect(row.total).toBeCloseTo(totalKg(row.side, baseline), 9);
          expect(sideWidthMm(row.side)).toBeLessThanOrEqual(SLEEVE_MM + EPS);
          expect(fromInventory(row.side, rig)).toBe(true);
          if (row.kind === 'warmup') expect(row.total).toBeLessThanOrEqual(work + EPS);
          if (row.kind === 'bar') {
            expect(row.side).toEqual([]);
            expect(row.total).toBe(rig.barKg);
          }
          if (i > 0) expect(row.sameAsPrevious).toBe(Math.abs(row.total - got.rows[i - 1].total) <= EPS);
        });
      }),
      rampOpts,
    );
  });

  // RBAR-72 slice 3 (ADR-0016 as amended, Warm up under Plate limits): the station rule,
  // unchanged, on the Plates the lifter has. A drifted row says so (`drift`).
  describe('under Plate limits (ADR-0016 as amended, RBAR-72 slice 3)', () => {
    // Pairs on hand per size: mostly small counts, where the limits bite.
    const pairsArb = fc.oneof(
      { weight: 3, arbitrary: fc.integer({ min: 0, max: 4 }) },
      { weight: 2, arbitrary: fc.constant(Infinity) },
    );
    const limitRig = (rig: Rig, pairs: readonly number[]): Rig => {
      const inventory = withLimits(rig.inventory, Object.fromEntries(rig.inventory.map((p, i) => [plateFace(p), pairs[i]])));
      return { ...rig, inventory, name: `${rig.name} pairs ${pairs.join('/')}` };
    };
    // The limit shapes a lifter really sets, each named, plus a random mix: every size
    // none (the bare-rig early return); only the big Plates limited; only the change
    // Plates limited or none; one size none and the rest all.
    const n = (rig: Rig) => rig.inventory.length;
    const big = (p: Plate) => p.diameterMm >= RULE.bigDiameterMm;
    const shapeArb = (rig: Rig): fc.Arbitrary<number[]> =>
      fc.oneof(
        fc.constant(rig.inventory.map(() => 0)),
        fc.array(fc.integer({ min: 0, max: 4 }), { minLength: n(rig), maxLength: n(rig) })
          .map((c) => rig.inventory.map((p, i) => (big(p) ? c[i] : Infinity))),
        fc.array(fc.integer({ min: 0, max: 4 }), { minLength: n(rig), maxLength: n(rig) })
          .map((c) => rig.inventory.map((p, i) => (big(p) ? Infinity : c[i]))),
        fc.constant(rig.inventory.map((p) => (big(p) ? Infinity : 0))),
        fc.nat({ max: n(rig) - 1 }).map((k) => rig.inventory.map((_, i) => (i === k ? 0 : Infinity))),
        fc.array(pairsArb, { minLength: n(rig), maxLength: n(rig) }),
      );
    const limitedFullArb = rigArb.chain((rig) =>
      fc.record({
        rig: shapeArb(rig).map((pairs) => limitRig(rig, pairs)),
        // Plus the Working weights whose 70% set sits exactly on the band's edge (8 kg on
        // the 5 kg Bar, 60 lb on the 45 lb Bar), where float noise decides.
        t: fc.oneof({ weight: 9, arbitrary: targetArb(rig) }, { weight: 1, arbitrary: fc.constantFrom(8, lbToKg(60)) }),
        u: unitArb,
        steps: fc.oneof(pctStepsArb, fc.constant([...DEFAULT_RAMP])),
      }),
    );
    const count = (side: readonly Plate[], p: Plate) => side.filter((q) => q === p).length;

    it('every row is buildable from the pairs on hand: no size past its pairs, no none size (ADR-0016 as amended)', () => {
      fc.assert(
        fc.property(limitedFullArb, ({ rig, t, u, steps }) => {
          for (const row of easy(rig, t, u, steps).rows) {
            expect(fromInventory(row.side, rig)).toBe(true);
            for (const p of rig.inventory) expect(count(row.side, p)).toBeLessThanOrEqual(onHand(p));
          }
        }),
        rampOpts,
      );
    });

    const knapsack = new Map<string, ReturnType<typeof cappedFewestOracle>>();
    it('the Working row is the capped Decode as read, rounded up to the least capped Total above it when that reads short (ADR-0016, ADR-0015 as amended RBAR-87, ADR-0003)', () => {
      fc.assert(
        fc.property(limitedFullArb, ({ rig, t, u, steps }) => {
          const got = easy(rig, t, u, steps);
          const ceiling = displayCeilingKg(t, u);
          // The bounded-knapsack oracle's greatest Side sum at or under the reading
          // (cached per limited rig: building it is the slow part), and the least above.
          const o = knapsack.get(rig.name) ?? cappedFewestOracle(rig.inventory, GRID_KG[rig.set]);
          knapsack.set(rig.name, o);
          const budget = (Math.max(ceiling, t) - rig.baselineKg) / 2;
          const budgetUnits = Math.floor((budget + EPS) / o.gridKg);
          const best = greatestSumAtOrUnder(o, budgetUnits);
          const up = o.sums.find((x) => x > budgetUnits);
          const under = rig.baselineKg + 2 * best * o.gridKg;
          const want = under >= displayFloorKg(t, u) - EPS || up === undefined
            ? under
            : rig.baselineKg + 2 * up * o.gridKg;
          const last = got.rows[got.rows.length - 1];
          expect(last.kind).toBe('working');
          expect(last.total).toBeCloseTo(want, 6);
          expect(got.working).toEqual(decodeWithin(t, ceiling, rig.baselineKg, rig.inventory));
        }),
        rampOpts,
      );
    });

    it('a row says it drifted exactly when its load sits more than the band from its percentage, off the bare rig (ADR-0016 as amended, ADR-0015)', () => {
      // Judged from the loads alone: each row's Total is rebuilt from its Side on the
      // rig's baseline, the Working Total from the Working Side, and the percentage from
      // the step -- never from the row's own total, targetKg or realPct. A Warm-up set
      // with no Plates is the bare rig, which never drifts.
      type R = { kind: string; pct: number | null; side: readonly Plate[]; drift: boolean };
      const check = (rig: Rig, rows: readonly R[]) => {
        const load = (side: readonly Plate[]) => rig.baselineKg + 2 * sumKg(side);
        const work = load(rows[rows.length - 1].side);
        for (const row of rows) {
          const want = row.kind === 'warmup' && row.side.length > 0 &&
            Math.abs(load(row.side) - (row.pct! / 100) * work) > RULE.band * work + 1e-9;
          expect(row.drift).toBe(want);
        }
      };
      fc.assert(fc.property(limitedFullArb, ({ rig, t, u, steps }) => check(rig, easy(rig, t, u, steps).rows)), rampOpts);
      // planRamp's nearest Ramp flags the same way (the floor can force a drift too).
      fc.assert(
        fc.property(fullCaseArb, ({ rt: { rig, t }, u, steps }) =>
          check(rig, planRamp(t, steps, { barKg: rig.barKg, collarKg: rig.collarKg, inventory: rig.inventory }, {
            ceilingKg: displayCeilingKg(t, u),
          }).rows)),
        opts,
      );
    });

    it('the station rule holds under limits: legal stacks, moves that rebuild each Side, Totals that never fall, never degraded (ADR-0015 as amended, ADR-0016)', () => {
      fc.assert(
        fc.property(limitedFullArb, ({ rig, t, u, steps }) => {
          const got = easy(rig, t, u, steps);
          expect(got.degraded).toBe(false);
          let prev: readonly Plate[] = [];
          got.rows.forEach((row, i) => {
            const firstSmall = row.side.findIndex((p) => !isBig(p));
            if (firstSmall >= 0) {
              const outside = row.side.slice(firstSmall);
              expect(outside.some(isBig)).toBe(false);
              outside.forEach((p, k) => k > 0 && expect(outside[k - 1].kg).toBeGreaterThanOrEqual(p.kg));
            }
            expect(row.moves.cost).toBeCloseTo(oracleMoveCost(prev, row.side, RULE), 9);
            expect([...prev.slice(0, prev.length - row.moves.off.length), ...row.moves.on]).toEqual(row.side);
            if (i > 0) expect(row.total).toBeGreaterThanOrEqual(got.rows[i - 1].total - EPS);
            expect(sideWidthMm(row.side)).toBeLessThanOrEqual(SLEEVE_MM + EPS);
            prev = row.side;
          });
        }),
        rampOpts,
      );
    });

    it('the band widens only as far as the pairs on hand force it (ADR-0016 as amended, ADR-0015)', () => {
      fc.assert(
        fc.property(limitedFullArb, ({ rig, t, u, steps }) => {
          const got = easy(rig, t, u, steps);
          const work = got.rows[got.rows.length - 1].total;
          const tol = Math.max(RULE.band * work, oracleGridKg(rig.inventory));
          // The planner's caps: 2 of each within the pairs on hand when that loads the
          // Working Total, else Decode's own counts, still within the pairs on hand.
          const own = decode(work, rig.baselineKg, rig.inventory).primary.side;
          const flat = (p: Plate) => Math.min(RULE.cap, onHand(p));
          const caps = cappedTotals(rig, flat).has(key(work))
            ? flat
            : (p: Plate) => Math.min(onHand(p), Math.max(RULE.cap, count(own, p)));
          const loadable = [...cappedTotals(rig, caps).values()];
          // Whether no Total the row could climb to sits within `band` of its percentage.
          const forcedAt = (i: number, band: number) => {
            const row = got.rows[i];
            const floor = Math.max(rig.baselineKg, i > 0 ? got.rows[i - 1].total : -Infinity);
            return !loadable.some(
              (x) => x >= floor - 1e-9 && x <= work + 1e-9 && Math.abs(x - row.targetKg) <= band + 1e-9,
            );
          };
          got.rows.forEach((row, i) => {
            if (row.kind !== 'warmup') return;
            // Outside the planner's band (floored at one grid step) only when forced...
            if (Math.abs(row.total - row.targetKg) > tol + 1e-9) expect(forcedAt(i, tol)).toBe(true);
            // ...and a labelled drift leaves RAMP_BAND itself only when forced (the
            // ADR-0016 amendment's claim, without the grid floor).
            if (row.drift) expect(forcedAt(i, RULE.band * work)).toBe(true);
          });
        }),
        rampOpts,
      );
    });

    it("the planner's cost equals the brute-force minimum on small limited Inventories (ADR-0015 as amended, ADR-0016)", () => {
      const smallLimitedArb = smallCaseArb.chain(({ rig, t, u, steps }) =>
        fc.array(fc.constantFrom(0, 1, 2, Infinity), { minLength: rig.inventory.length, maxLength: rig.inventory.length })
          .map((pairs) => ({ rig: limitRig(rig, pairs), t, u, steps })),
      );
      fc.assert(
        fc.property(smallLimitedArb, ({ rig, t, u, steps }) => {
          const got = easy(rig, t, u, steps);
          const { best, tol } = stationRampOracle(rig, t, displayCeilingKg(t, u), steps, RULE, displayFloorKg(t, u));
          const cost = costOf(got.rows, tol);
          cost.forEach((c, i) => expect(c).toBeCloseTo(best[i], 6));
        }),
        { seed: SEED, numRuns: 150 },
      );
    });
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
  // RBAR-50 slice 3: the console solves the window of the DISPLAYED Target
  // (displayCeilingKg), so a link carries the sender's Target field text `d`. Whatever
  // set the Target -- typed in the unit (<= 2 dp), or a kg weight shown as its readout
  // (whole lb / 2 dp kg) -- the reading fits the 2 dp kg `t`, and solving from it
  // reproduces the sender's reading and window exactly.
  it('a Target reading fits its link Target and re-solves the same display window (ADR-0014 d, ADR-0010)', () => {
    const typedArb = fc
      .tuple(unitArb, fc.integer({ min: 1, max: 99_999 }))
      .map(([u, c]) => ({ u, reading: String(c / 100), kg: draftToKg(String(c / 100), u)! }));
    const readoutArb = fc
      .tuple(unitArb, fc.integer({ min: 1, max: MAX_TARGET_KG * 100 }))
      .map(([u, c]) => ({ u, reading: String(shownIn(c / 100, u)), kg: c / 100 }));
    fc.assert(
      fc.property(fc.oneof(typedArb, readoutArb), ({ u, reading, kg }) => {
        const t = Number(kg.toFixed(2));
        fc.pre(t > 0 && t <= MAX_TARGET_KG);
        expect(readingFits(reading, t, u)).toBe(true);
        const solved = draftToKg(reading, u)!;
        expect(shownIn(solved, u)).toBe(shownIn(kg, u));
        expect(displayCeilingKg(solved, u)).toBeCloseTo(displayCeilingKg(kg, u), 9);
      }),
      opts,
    );
  });

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
      // The Target field's text (RBAR-50 slice 3): none, the readout (whole lb / 2 dp kg,
      // a Target set from kg or a chip), or a 2 dp reading in the unit (typed).
      readingKind: fc.constantFrom('none', 'readout', 'typed'),
    })
    .map(({ key, barIx, collarKg, unit, mode, picks, cents, readingKind }): LinkState => {
      const set = PLATE_SETS[key];
      const side = picks.reduce<readonly Plate[]>(
        (acc, i) => addPlate(acc, set.inventory[i % set.inventory.length]!),
        [],
      );
      const barKg = set.bars[barIx % set.bars.length]!.kg;
      const base = { set: key, barKg, collarKg, unit, mode, side };
      if (mode !== 'decode' || cents === undefined) return base;
      const t = cents / 100;
      if (readingKind === 'none') return { ...base, targetKg: t };
      const reading =
        readingKind === 'readout' || unit === 'kg'
          ? String(shownIn(t, unit))
          : String(Number(kgToLb(t).toFixed(2)));
      return { ...base, targetKg: t, reading };
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
    const reading = (s as { readonly reading?: string }).reading;
    if (reading !== undefined) {
      expect(t).toBeDefined(); // a reading (`d`, RBAR-50 slice 3) only rides with a Target
      expect(readingFits(reading, t!, s.unit)).toBe(true);
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

describe('Sleeve layout properties (ADR-0004, ADR-0013; shared with the share picture, RBAR-70)', () => {
  const hostArb = fc.record({ w: fc.integer({ min: 200, max: 500 }), h: fc.integer({ min: 84, max: 204 }) });

  it('one scale for the whole row: centred, inside the host, disc height tracks diameter (ADR-0004)', () => {
    fc.assert(
      fc.property(rigTargetArb, hostArb, ({ rig, t }, host) => {
        const { side } = decode(t, rig.baselineKg, rig.inventory).primary;
        const parts = sleeveLayout(side, host.w, host.h);
        const first = parts[0]!;
        const last = parts[parts.length - 1]!;
        // Centred on both axes, like the element's flex row.
        expect(first.x).toBeCloseTo(host.w - (last.x + last.w), 6);
        for (const p of parts) expect(p.y + p.h / 2).toBeCloseTo(host.h / 2, 6);
        // A real Side Load never runs past the host (the fit zooms out instead).
        expect(first.x).toBeGreaterThanOrEqual(-1e-6);
        // Every disc stands within the host's padded height, and height / diameter is
        // one constant: the same scale for every Plate.
        const discs = parts.filter((p) => p.kind === 'disc');
        expect(discs.map((d) => d.plate)).toEqual([...side]);
        const ratios = discs.map((d) => d.h / d.plate!.diameterMm);
        for (const r of ratios) expect(r).toBeCloseTo(ratios[0]!, 9);
        for (const d of discs) expect(d.h).toBeLessThanOrEqual(host.h - SLEEVE_PAD_PX + 1e-6);
      }),
      opts,
    );
  });
});

// Custom Bars (RBAR-76, ADR-0017). A stamp is generated as the lifter types it (a Unit
// and a value at <= 2 dp, up to the cap); the oracle is ADR-0002/0008 arithmetic on the
// stamp's own kg, never a call into the list or solver under test.
describe('Custom Bar properties (ADR-0017)', () => {
  const stampArb: fc.Arbitrary<BarStamp> = unitArb.chain((unit) =>
    fc
      .integer({ min: 1, max: CUSTOM_BAR_MAX[unit] * 100 })
      .map((c) => ({ value: c / 100, unit })),
  );
  // The kg a stamp weighs, from the ADR alone: lb through the exact factor (ADR-0006).
  const oracleKg = (s: BarStamp) => (s.unit === 'lb' ? s.value * 0.45359237 : s.value);
  // Stamps biased toward the weights the sets offer themselves (20 / 15 / 5 kg, 45 lb),
  // where a custom Bar is hidden on one set and shown on the other (ADR-0017 rule 2).
  const builtInStampArb = fc.constantFrom<BarStamp>(
    { value: 20, unit: 'kg' },
    { value: 15, unit: 'kg' },
    { value: 5, unit: 'kg' },
    { value: 45, unit: 'lb' },
  );
  const biasedStampArb = fc.oneof(stampArb, builtInStampArb, fc.constantFrom<BarStamp>(
    { value: 35, unit: 'lb' },
    { value: 25, unit: 'kg' },
    { value: 7, unit: 'kg' },
  ));
  // The custom tiles a set shows, from the ADR: the stamps not weighing one of its Bars.
  const shownOn = (list: readonly BarStamp[], key: PlateSetKey) =>
    list.filter((s) => !PLATE_SETS[key].bars.some((b) => b.kg === oracleKg(s)));

  it('the Total on a custom Bar is the stamp\'s kg + 2 x Side Load + 2 x Collar, at the greatest achievable Total at or under the Target (ADR-0017, ADR-0002, ADR-0003, ADR-0008)', () => {
    const arb = fc
      .record({
        key: fc.constantFrom(...PLATE_SET_KEYS),
        stamp: stampArb,
        collarKg: fc.constantFrom(...COLLAR_OPTIONS),
      })
      .chain(({ key, stamp, collarKg }) => {
        const barKg = oracleKg(stamp);
        const rig: Rig = {
          set: key,
          barKg,
          collarKg,
          inventory: PLATE_SETS[key].inventory,
          baselineKg: barKg + 2 * collarKg,
          name: `${key} custom ${stamp.value} ${stamp.unit} collar ${collarKg}`,
        };
        return targetArb(rig).map((t) => ({ rig, stamp, t }));
      });
    fc.assert(
      fc.property(arb, ({ rig, stamp, t }) => {
        const baseline = barWithCollars(stampKg(stamp), rig.collarKg);
        const { primary } = decode(t, baseline, rig.inventory);
        expect(primary.total).toBeCloseTo(
          oracleKg(stamp) + 2 * sideLoadKg(primary.side) + 2 * rig.collarKg,
          9,
        );
        expect(primary.total).toBeCloseTo(greatestAtOrUnder(rig, t), 9);
      }),
      opts,
    );
  });

  it('a custom Bar is labelled exactly as typed and offered on every set, after the set\'s own (ADR-0017)', () => {
    fc.assert(
      fc.property(stampArb, fc.constantFrom(...PLATE_SET_KEYS), (s, key) => {
        expect(parseStampText(String(s.value), s.unit)).toEqual(s);
        const set = PLATE_SETS[key];
        const bars = barsFor(set, [s]);
        expect(bars.slice(0, set.bars.length)).toEqual(set.bars);
        const own = set.bars.some((b) => b.kg === oracleKg(s));
        expect(bars.length).toBe(set.bars.length + (own ? 0 : 1));
        if (!own) {
          const bar = bars[bars.length - 1]!;
          expect(barLabel(bar)).toBe(`${s.value} ${s.unit}`);
          expect(bar.kg).toBe(oracleKg(s));
        }
      }),
      opts,
    );
  });

  it('any stored value reads as a valid list: at most 3, valid stamps, distinct weights; a list round-trips (ADR-0017, ADR-0007)', () => {
    const rawArb = fc.oneof(
      fc.string(),
      fc.json(),
      fc
        .array(
          fc.oneof(
            stampArb,
            fc.record({ value: fc.double(), unit: fc.constantFrom('kg', 'lb', 'st', '') }),
            fc.anything(),
          ),
          { maxLength: 8 },
        )
        .map((xs) => JSON.stringify(xs)),
    );
    fc.assert(
      fc.property(rawArb, (raw) => {
        const list = parseCustomBars(raw);
        for (const key of PLATE_SET_KEYS) {
          expect(shownOn(list, key).length).toBeLessThanOrEqual(MAX_CUSTOM_BARS);
        }
        for (const s of list) expect(isValidStamp(s)).toBe(true);
        expect(new Set(list.map(oracleKg)).size).toBe(list.length);
        expect(parseCustomBars(serializeCustomBars(list))).toEqual(list);
      }),
      opts,
    );
    fc.assert(
      fc.property(fc.array(biasedStampArb, { maxLength: 6 }), (stamps) => {
        const list = stamps.reduce<readonly BarStamp[]>((acc, s) => addCustomBar(acc, s), []);
        expect(parseCustomBars(serializeCustomBars(list))).toEqual(list);
      }),
      opts,
    );
  });

  // RBAR-76 review: a custom Bar a set hides (it weighs what the set's own Bar weighs)
  // must not take a slot on that set, where it has no tile to remove. The cap is on
  // the tiles each set shows.
  it('the cap counts only the custom Bars a set shows: an add is accepted exactly when it is new by weight and no set would show more than 3 (ADR-0017)', () => {
    fc.assert(
      fc.property(fc.array(biasedStampArb, { maxLength: 8 }), (stamps) => {
        let list: readonly BarStamp[] = [];
        for (const s of stamps) {
          const fresh = !list.some((b) => oracleKg(b) === oracleKg(s));
          const fits = PLATE_SET_KEYS.every(
            (k) => shownOn([...list, s], k).length <= MAX_CUSTOM_BARS,
          );
          const next = addCustomBar(list, s);
          expect(next.length).toBe(list.length + (fresh && fits ? 1 : 0));
          list = next;
          for (const k of PLATE_SET_KEYS) {
            expect(shownOn(list, k).length).toBeLessThanOrEqual(MAX_CUSTOM_BARS);
          }
        }
      }),
      opts,
    );
  });

  it('Undo is the inverse of a removal: restoring a removed custom Bar at its index gives back the list (ADR-0017)', () => {
    fc.assert(
      fc.property(fc.array(biasedStampArb, { maxLength: 8 }), fc.nat(), (stamps, n) => {
        const list = stamps.reduce<readonly BarStamp[]>((acc, s) => addCustomBar(acc, s), []);
        fc.pre(list.length > 0);
        const i = n % list.length;
        expect(restoreCustomBar(removeCustomBar(list, i), list[i]!, i)).toEqual(list);
      }),
      opts,
    );
  });

  it('a custom Bar never produces a lossy share link: off the set\'s menu it serializes to null (ADR-0017, ADR-0014)', () => {
    const arb = fc.record({
      key: fc.constantFrom(...PLATE_SET_KEYS),
      stamp: stampArb,
      collarKg: fc.constantFrom(...COLLAR_OPTIONS),
      unit: unitArb,
      mode: fc.constantFrom<LinkMode>('decode', 'encode'),
      picks: fc.array(fc.nat(), { maxLength: 20 }),
    });
    fc.assert(
      fc.property(arb, ({ key, stamp, collarKg, unit, mode, picks }) => {
        const set = PLATE_SETS[key];
        // The Bar the lifter would actually have selected: the one Setup offers for it.
        const bar = barsFor(set, [stamp]).find((b) => b.kg === oracleKg(stamp))!;
        const side = picks.reduce<readonly Plate[]>(
          (acc, i) => addPlate(acc, set.inventory[i % set.inventory.length]!),
          [],
        );
        const s: LinkState = { set: key, barKg: bar.kg, collarKg, unit, mode, side };
        const x = serializeLink(s);
        if (bar.stamp !== undefined) expect(x).toBeNull();
        if (x !== null) expect(parseLink(x, 'kg')).toEqual(s);
      }),
      opts,
    );
  });
});

describe('Pairs of Plates on Hand properties (ADR-0016, ADR-0007)', () => {
  // A stored value as the lifter's storage might hold it: mostly well-formed limits with
  // a mix of good and bad entries (a face from either set or none, a count in range or
  // out of it, a fraction, a string), sometimes junk JSON or not JSON at all.
  const faces = (set: PlateSetKey) => PLATE_SETS[set].inventory.map(plateFace);
  const allFaces = [...new Set(PLATE_SET_KEYS.flatMap(faces))];
  const countArb = fc.oneof(
    fc.integer({ min: 0, max: 4 }),
    fc.integer({ min: -3, max: 9 }),
    fc.double({ min: -2, max: 6, noNaN: true }),
    fc.constantFrom<unknown>('2', null, true, [], {}, Infinity),
  );
  const limitsArb = fc.dictionary(
    fc.oneof(fc.constantFrom(...allFaces), fc.string({ maxLength: 4 })),
    countArb,
    { maxKeys: 8 },
  );
  const rawArb: fc.Arbitrary<string | null> = fc.oneof(
    { weight: 6, arbitrary: fc.record({ comp: limitsArb, training: limitsArb }, { requiredKeys: [] }).map((o) => JSON.stringify(o)) },
    { weight: 1, arbitrary: fc.json() },
    { weight: 1, arbitrary: fc.string() },
    { weight: 1, arbitrary: fc.constant(null) },
  );
  const setArb = fc.constantFrom(...PLATE_SET_KEYS);
  const capOf = (p: InventoryEntry) => p.maxPerSide ?? Infinity;

  it('a stored value reads as its valid limits and All for the rest, never a throw (ADR-0016, ADR-0007)', () => {
    fc.assert(
      fc.property(rawArb, setArb, (raw, set) => {
        const inv = inventoryOnHand(parsePlatesOnHand(raw), set);
        expect(inv.map(plateFace)).toEqual(faces(set));
        for (const p of inv) expect(capOf(p)).toBe(storedPairsOracle(raw, set, plateFace(p)));
      }),
      opts,
    );
  });

  it('what is stored reads back the same (ADR-0016, ADR-0007)', () => {
    fc.assert(
      fc.property(rawArb, (raw) => {
        const onHand = parsePlatesOnHand(raw);
        expect(parsePlatesOnHand(serializePlatesOnHand(onHand))).toEqual(onHand);
      }),
      opts,
    );
  });

  it('setting one size changes only that size of that set; All plates clears only that set (ADR-0016)', () => {
    const editArb = fc.record({
      raw: rawArb,
      set: setArb,
      i: fc.nat(),
      pairs: fc.constantFrom<number | null>(0, 1, 2, 3, 4, null),
    });
    fc.assert(
      fc.property(editArb, ({ raw, set, i, pairs }) => {
        const before = parsePlatesOnHand(raw);
        const face = faces(set)[i % faces(set).length];
        const after = setPairs(before, set, face, pairs);
        for (const s of PLATE_SET_KEYS) {
          const was = inventoryOnHand(before, s);
          const now = inventoryOnHand(after, s);
          now.forEach((p, j) =>
            expect(capOf(p)).toBe(s === set && plateFace(p) === face ? (pairs ?? Infinity) : capOf(was[j])),
          );
        }
        const cleared = clearSet(after, set);
        expect(inventoryOnHand(cleared, set)).toBe(PLATE_SETS[set].inventory);
        for (const s of PLATE_SET_KEYS) {
          if (s !== set) expect(cleared[s]).toEqual(after[s]);
        }
      }),
      opts,
    );
  });

  it('Decode on the stored limits never uses a None size and never exceeds a cap, round-up included (ADR-0016, ADR-0003)', () => {
    const caseArb = rigArb.chain((rig) => fc.record({ rig: fc.constant(rig), raw: rawArb, t: targetArb(rig) }));
    fc.assert(
      fc.property(caseArb, ({ rig, raw, t }) => {
        const d = decode(t, rig.baselineKg, inventoryOnHand(parsePlatesOnHand(raw), rig.set));
        for (const side of d.over ? [d.primary.side, d.over.side] : [d.primary.side]) {
          for (const face of faces(rig.set)) {
            const n = side.filter((p) => plateFace(p) === face).length;
            expect(n).toBeLessThanOrEqual(storedPairsOracle(raw, rig.set, face));
          }
        }
      }),
      opts,
    );
  });

  it('with nothing stored, Decode is the plain set (ADR-0016)', () => {
    const none: PlatesOnHand = ALL_PLATES;
    for (const set of PLATE_SET_KEYS) {
      expect(inventoryOnHand(none, set)).toBe(PLATE_SETS[set].inventory);
      expect(inventoryOnHand(parsePlatesOnHand(null), set)).toBe(PLATE_SETS[set].inventory);
    }
  });
});

describe('Another way properties (RBAR-66, ADR-0003, ADR-0012, ADR-0016)', () => {
  // A Decode answer to list the ways of: a Target on a rig, solved as read in a unit
  // (decodeWithin, as the console does), optionally with Plate limits, and either the
  // at-or-under primary or the round-up. Targets run past the heaviest Side the Sleeve
  // can hold, so the band where the Sleeve (ADR-0012) thins or reorders the ways is hit.
  const capArb = fc.oneof(fc.integer({ min: 0, max: 3 }), fc.constant(Infinity));
  const sleeveSideKg = (rig: Rig) =>
    Math.max(...rig.inventory.map((p) => p.kg / p.widthMm)) * SLEEVE_MM;
  const caseArb = rigArb.chain((rig) =>
    fc.record({
      rig: fc.constant(rig),
      u: unitArb,
      t: fc.oneof(
        fc.integer({ min: 0, max: Math.round((rig.baselineKg + 2 * sleeveSideKg(rig) + 10) * 100) }),
        // Half the runs inside the Sleeve band itself (the top ~40 kg of a Side).
        fc.integer({
          min: Math.round((rig.baselineKg + 2 * (sleeveSideKg(rig) - 40)) * 100),
          max: Math.round((rig.baselineKg + 2 * sleeveSideKg(rig) + 10) * 100),
        }),
      ).map((c) => c / 100),
      caps: fc.option(
        fc.array(capArb, { minLength: rig.inventory.length, maxLength: rig.inventory.length }),
      ),
      useOver: fc.boolean(),
    }),
  );
  interface WayCase {
    rig: Rig;
    u: Unit;
    t: number;
    caps: number[] | null;
    useOver: boolean;
  }
  const solveCase = ({ rig, u, t, caps, useOver }: WayCase) => {
    const inv: readonly InventoryEntry[] = caps
      ? withLimits(rig.inventory, Object.fromEntries(rig.inventory.map((p, i) => [plateFace(p), caps[i]])))
      : rig.inventory;
    const d = decodeWithin(t, displayCeilingKg(t, u), rig.baselineKg, inv);
    const loaded = useOver && d.over ? d.over : d.primary;
    return { inv, loaded, ways: waysFor(loaded.side, inv) };
  };

  it('every way reaches the same Total as the Decode answer, fits the Sleeve, and holds Inventory Plates heaviest-first within their limits (RBAR-66, ADR-0003, ADR-0012, ADR-0016)', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const { inv, loaded, ways } = solveCase(c);
        for (const w of ways) {
          expect(totalKg(w, c.rig.baselineKg)).toBeCloseTo(loaded.total, 9);
          expect(sideWidthMm(w)).toBeLessThanOrEqual(SLEEVE_MM);
          expect(isHeaviestFirst(w)).toBe(true);
          for (const p of w) {
            expect(inv).toContain(p);
            const cap = (p as InventoryEntry).maxPerSide ?? Infinity;
            expect(w.filter((q) => q === p).length).toBeLessThanOrEqual(cap);
          }
        }
      }),
      opts,
    );
  });

  it("the ways are distinct, at most MAX_WAYS, and the first is Decode's own stack, round-up included (RBAR-66, ADR-0003)", () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const { loaded, ways } = solveCase(c);
        expect(ways.length).toBeGreaterThanOrEqual(1);
        expect(ways.length).toBeLessThanOrEqual(MAX_WAYS);
        expect(ways[0]).toEqual(loaded.side);
        const keys = ways.map((w) => w.map(plateFace).join(','));
        expect(new Set(keys).size).toBe(ways.length);
      }),
      opts,
    );
  });

  it("the ways are exactly the oracle's first five stacks: fewest Plates, then heaviest-first (RBAR-66, ADR-0003 as amended by RBAR-69, ADR-0016)", () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const { inv, loaded, ways } = solveCase(c);
        expect(ways).toEqual(waysOracle(inv, sideLoadKg(loaded.side), MAX_WAYS));
      }),
      { seed: SEED, numRuns: 150 },
    );
  });
});

describe('Loadout quiz properties (RBAR-92, ADR-0002, ADR-0003, ADR-0008, ADR-0012, ADR-0016)', () => {
  // A quiz case: a rig (every set x Bar x Collar v1 offers), optional Plate limits, the
  // gear's settings, and a (seed, index) in the list.
  const capArb = fc.oneof(fc.integer({ min: 0, max: 3 }), fc.constant(Infinity));
  const settingsArb: fc.Arbitrary<QuizSettings> = fc.record({
    maxPlates: fc.constantFrom(...MAX_PLATES_CHOICES),
    change: fc.boolean(),
    collars: fc.constantFrom(...COLLARS_MODES),
    numbers: fc.boolean(),
  });
  const caseArb = rigArb.chain((rig) =>
    fc.record({
      rig: fc.constant(rig),
      caps: fc.option(
        fc.array(capArb, { minLength: rig.inventory.length, maxLength: rig.inventory.length }),
        { freq: 3 },
      ),
      settings: settingsArb,
      seed: fc.integer(),
      index: fc.integer({ min: 0, max: 500 }),
    }),
  );
  const quizRig = (rig: Rig, caps: number[] | null): QuizRig => ({
    set: rig.set,
    barKg: rig.barKg,
    collarKg: rig.collarKg,
    inventory: caps
      ? withLimits(rig.inventory, Object.fromEntries(rig.inventory.map((p, i) => [plateFace(p), caps[i]])))
      : rig.inventory,
  });
  // The Inventory the rule says a question draws from: the lifter's, minus the change
  // Plates when the gear has them off.
  const drawn = (qr: QuizRig, change: boolean): readonly InventoryEntry[] =>
    change
      ? qr.inventory
      : withLimits(
          qr.inventory,
          Object.fromEntries(
            qr.inventory
              .filter((p) => Number(plateFace(p)) < smallestFullPlate(qr.set))
              .map((p) => [plateFace(p), 0]),
          ),
        );
  const oracles = new Map<string, ReturnType<typeof cappedFewestOracle>>();
  const oracleFor = (inv: readonly InventoryEntry[], set: PlateSetKey) => {
    const key = set + inv.map((p) => `${plateFace(p)}:${p.maxPerSide ?? 'all'}`).join(',');
    let o = oracles.get(key);
    if (!o) {
      o = cappedFewestOracle(inv, GRID_KG[set]);
      oracles.set(key, o);
    }
    return o;
  };
  const quizOpts = { seed: SEED, numRuns: 150 };

  it("a question's Side is the oracle's fewest-Plate, heaviest-first stack for its sum, within the Sleeve and the Plate limits (RBAR-92, ADR-0003, ADR-0012, ADR-0016)", () => {
    fc.assert(
      fc.property(caseArb, ({ rig, caps, settings, seed, index }) => {
        const qr = quizRig(rig, caps);
        const q = quizQuestion(seed, index, qr, settings);
        if (!q) {
          expect(qr.inventory.every((p) => p.maxPerSide === 0)).toBe(true);
          return;
        }
        expect(q.side.length).toBeGreaterThan(0);
        expect(sideWidthMm(q.side)).toBeLessThanOrEqual(SLEEVE_MM + EPS);
        for (const p of qr.inventory) {
          const n = q.side.filter((x) => plateFace(x) === plateFace(p)).length;
          expect(n).toBeLessThanOrEqual(p.maxPerSide ?? Infinity);
        }
        const inv = drawn(qr, settings.change);
        const units = Math.round(sideLoadKg(q.side) / GRID_KG[rig.set]);
        const pick = oracleFor(inv, rig.set).pick(units);
        // The one-Plate fallback (no Side in range under tight limits) is still a
        // fewest-Plate stack: one Plate is the fewest there is.
        if (q.side.length > 1) expect(pick?.map(plateFace)).toEqual(q.side.map(plateFace));
      }),
      quizOpts,
    );
  });

  it('when the Plates on hand allow no Side in range, the question is one Plate: the heaviest the lifter has, by kg (RBAR-92, ADR-0016)', () => {
    // At most two sizes on hand, one pair each, and up to 6 per side (3 Plates at
    // least): no draw can fit, so every question is the fallback.
    const fallbackArb = rigArb.chain((rig) =>
      fc.record({
        rig: fc.constant(rig),
        keep: fc.uniqueArray(fc.nat({ max: rig.inventory.length - 1 }), { minLength: 1, maxLength: 2 }),
        change: fc.boolean(),
        seed: fc.integer(),
        index: fc.nat({ max: 50 }),
      }),
    );
    fc.assert(
      fc.property(fallbackArb, ({ rig, keep, change, seed, index }) => {
        const caps = rig.inventory.map((_, i) => (keep.includes(i) ? 1 : 0));
        const qr = quizRig(rig, caps);
        const settings: QuizSettings = { maxPlates: 6, change, collars: 'off', numbers: false };
        const q = quizQuestion(seed, index, qr, settings)!;
        const kept = keep.map((i) => rig.inventory[i]);
        const small = smallestFullPlate(rig.set);
        const full = kept.filter((p) => Number(plateFace(p)) >= small);
        // Change Plates off: the heaviest full Plate on hand, if there is one.
        const pool = !change && full.length > 0 ? full : kept;
        const heaviest = Math.max(...pool.map((p) => p.kg));
        expect(q.side.length).toBe(1);
        expect(q.side[0].kg).toBe(heaviest);
      }),
      quizOpts,
    );
  });

  it('a question keeps to the gear: at most its Plates per side, and no change Plate when they are off, unless the lifter has only change Plates (RBAR-92)', () => {
    fc.assert(
      fc.property(caseArb, ({ rig, caps, settings, seed, index }) => {
        const qr = quizRig(rig, caps);
        const q = quizQuestion(seed, index, qr, settings);
        if (!q) return;
        expect(q.side.length).toBeLessThanOrEqual(settings.maxPlates);
        const small = smallestFullPlate(rig.set);
        const hasFull = qr.inventory.some((p) => p.maxPerSide !== 0 && Number(plateFace(p)) >= small);
        if (!settings.change && hasFull) {
          expect(q.side.every((p) => Number(plateFace(p)) >= small)).toBe(true);
        }
      }),
      quizOpts,
    );
  });

  it('the Total is Bar + 2 x Collar + 2 x Side Load, an achievable Total, and the shown Total is the right answer (RBAR-92, ADR-0002, ADR-0008, ADR-0012)', () => {
    fc.assert(
      fc.property(caseArb, ({ rig, settings, seed, index }) => {
        const qr = quizRig(rig, null);
        const q = quizQuestion(seed, index, qr, settings)!;
        expect(q.totalKg).toBeCloseTo(rig.barKg + 2 * q.collarKg + 2 * sideLoadKg(q.side), 9);
        const baseline = { ...rig, baselineKg: rig.barKg + 2 * q.collarKg };
        expect(achievableTotals(baseline).some((t) => Math.abs(t - q.totalKg) < 1e-6)).toBe(true);
        expect(q.totalShown).toBe(shownIn(q.totalKg, q.unit));
        expect(isRight(q, q.totalShown)).toBe(true);
        expect(diagnose(q, q.totalShown)).toBe('');
      }),
      quizOpts,
    );
  });

  it('Collars only when Setup has them, on the kg set, never on a bare Bar; Always puts them on every question and Off on none (RBAR-92, ADR-0008)', () => {
    fc.assert(
      fc.property(caseArb, ({ rig, caps, settings, seed, index }) => {
        const qr = quizRig(rig, caps);
        const q = quizQuestion(seed, index, qr, settings);
        if (!q) return;
        const offered = rig.collarKg > 0 && PLATE_SETS[rig.set].unit === 'kg';
        if (q.collarKg > 0) {
          expect(offered).toBe(true);
          expect(q.collarKg).toBe(rig.collarKg);
          expect(q.side.length).toBeGreaterThan(0);
        }
        if (!offered || settings.collars === 'off') expect(q.collarKg).toBe(0);
        if (offered && settings.collars === 'always') expect(q.collarKg).toBe(rig.collarKg);
      }),
      quizOpts,
    );
  });

  it('the list is seeded: the same (seed, index, rig, gear) is the same question (RBAR-92)', () => {
    fc.assert(
      fc.property(caseArb, ({ rig, caps, settings, seed, index }) => {
        const qr = quizRig(rig, caps);
        expect(quizQuestion(seed, index, qr, settings)).toEqual(quizQuestion(seed, index, qr, settings));
      }),
      { seed: SEED, numRuns: 60 },
    );
  });

  it('every plausible mistake is a wrong answer that diagnoses as a named mistake (RBAR-92)', () => {
    fc.assert(
      fc.property(caseArb, ({ rig, settings, seed, index }) => {
        const q = quizQuestion(seed, index, quizRig(rig, null), settings)!;
        const ms = mistakes(q);
        expect(ms.length).toBeGreaterThan(0);
        const whys = new Set(ms.map((m) => m.why));
        for (const m of ms) {
          expect(m.value).toBeGreaterThan(0);
          expect(isRight(q, m.value)).toBe(false);
          const why = diagnose(q, m.value);
          if (q.unit === 'kg') expect(why).toBe(m.why);
          else expect(whys.has(why)).toBe(true);
        }
      }),
      quizOpts,
    );
  });

  it('any stored quiz value reads as valid settings and a record, and what is stored reads back the same (RBAR-92, ADR-0007)', () => {
    fc.assert(
      fc.property(fc.oneof(fc.json(), fc.string(), fc.constant(null)), (raw) => {
        const s = parseQuizSaved(raw);
        expect(MAX_PLATES_CHOICES).toContain(s.settings.maxPlates);
        expect(COLLARS_MODES).toContain(s.settings.collars);
        expect(s.record.best).toBeGreaterThanOrEqual(s.record.streak);
        expect(parseQuizSaved(serializeQuizSaved(s))).toEqual(s);
      }),
      opts,
    );
  });

  it('the keypad never types past its length or a second point, and what it types reads as a number (RBAR-92)', () => {
    const keyArb = fc.constantFrom('0', '1', '2', '5', '9', '.', 'del');
    fc.assert(
      fc.property(fc.array(keyArb, { maxLength: 20 }), (keys) => {
        const d = keys.reduce(typeKey, '');
        expect(d.length).toBeLessThanOrEqual(MAX_ANSWER_CHARS);
        expect(d.split('.').length).toBeLessThanOrEqual(2);
        if (d !== '') expect(Number.isFinite(answerOf(d))).toBe(true);
      }),
      opts,
    );
  });
});

describe('Saved maxes properties (RBAR-84, ADR-0020)', () => {
  const unitArb = fc.constantFrom<Unit>('kg', 'lb');
  const valueArb = fc.integer({ min: 1, max: 999_999 }).map((c) => c / 100);
  const nameArb = fc.constantFrom('Squat', 'Bench', 'Deadlift', 'Press', 'Clean', 'Snatch', 'Jerk', 'Front squat');
  const maxArb: fc.Arbitrary<Max> = fc.record({ name: nameArb, value: valueArb, unit: unitArb });
  const listArb = fc
    .array(maxArb, { maxLength: 9 })
    .map((ms) => ms.reduce<readonly Max[]>((acc, m) => addMax(acc, m.name, m.value, m.unit), []));
  const pctArb = fc.integer({ min: 1, max: MAX_PERCENT * 10 }).map((t) => t / 10);

  it("a percent of a max is that share of it, at two decimals in the max's own Unit, and grows with the percent and the max (RBAR-84, ADR-0020)", () => {
    fc.assert(
      fc.property(maxArb, pctArb, pctArb, (m, p, q) => {
        const t = percentOfMax(m, p)!;
        // Two decimals in the max's own Unit (an lb max's half-hundredth is finer in kg).
        const read = m.unit === 'lb' ? kgToLb(t) : t;
        expect(Math.abs(read - (m.value * p) / 100)).toBeLessThanOrEqual(0.005 + 1e-6);
        expect(Math.abs(read - Number(read.toFixed(2)))).toBeLessThan(1e-6);
        if (p <= q) expect(t).toBeLessThanOrEqual(percentOfMax(m, q)!);
        const heavier = { ...m, value: m.value + 1 };
        expect(t).toBeLessThanOrEqual(percentOfMax(heavier, p)!);
      }),
      opts,
    );
  });

  it('a max keeps its Unit as typed: 100% of it reads back its own value in its own Unit (RBAR-84, ADR-0020)', () => {
    fc.assert(
      fc.property(maxArb, (m) => {
        const t = percentOfMax(m, 100)!;
        const back = m.unit === 'lb' ? kgToLb(t) : t;
        expect(Math.abs(back - m.value)).toBeLessThan(1e-6);
      }),
      opts,
    );
  });

  it('the registry holds at most six lifts with distinct names, however it is edited (RBAR-84, ADR-0020)', () => {
    const opArb = fc.oneof(
      fc.record({ k: fc.constant('add' as const), m: maxArb }),
      fc.record({ k: fc.constant('set' as const), i: fc.nat(7), v: valueArb, u: unitArb }),
      fc.record({ k: fc.constant('remove' as const), i: fc.nat(7) }),
      fc.record({ k: fc.constant('restore' as const), m: maxArb, i: fc.integer({ min: -2, max: 9 }) }),
    );
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 30 }), (ops) => {
        let list: readonly Max[] = [];
        for (const op of ops) {
          if (op.k === 'add') list = addMax(list, op.m.name, op.m.value, op.m.unit);
          else if (op.k === 'set') list = setMax(list, op.i, op.v, op.u);
          else if (op.k === 'remove') list = removeMax(list, op.i);
          else list = restoreMax(list, op.m, op.i);
          expect(list.length).toBeLessThanOrEqual(MAX_LIFTS);
          const names = list.map((m) => m.name.toLowerCase());
          expect(new Set(names).size).toBe(names.length);
        }
      }),
      opts,
    );
  });

  it('Undo of a removal restores the row exactly (RBAR-84, ADR-0020)', () => {
    fc.assert(
      fc.property(listArb, fc.nat(5), (list, i) => {
        fc.pre(i < list.length);
        expect(restoreMax(removeMax(list, i), list[i], i)).toEqual(list);
      }),
      opts,
    );
  });

  it('any stored maxes value reads as a valid registry, and what is stored reads back the same (RBAR-84, ADR-0007, ADR-0020)', () => {
    fc.assert(
      fc.property(fc.oneof(fc.json(), fc.string(), fc.constant(null)), (raw) => {
        const list = parseMaxes(raw);
        expect(list.length).toBeLessThanOrEqual(MAX_LIFTS);
        expect(parseMaxes(serializeMaxes(list))).toEqual(list);
      }),
      opts,
    );
    fc.assert(
      fc.property(listArb, (list) => {
        expect(parseMaxes(serializeMaxes(list))).toEqual(list);
      }),
      opts,
    );
  });
});
