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
import { SLEEVE_MM, sideLoadKg, sideWidthMm, totalKg, barWithCollars } from './plates.ts';
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
import { pushRecent, parseRecents, MAX_RECENTS, isRememberable } from './recents.ts';
import { plateSetFor, PLATE_SET_KEYS, isOfferedPlateSet, PLATE_SETS } from './platesets.ts';
import {
  RIGS,
  achievableTotals,
  greatestAtOrUnder,
  leastAbove,
  fewestPlatesFor,
  maxTotal,
} from './properties.oracle.ts';
import type { Rig } from './properties.oracle.ts';
import { GRID_KG, fewestOracle } from './fewest.oracle.ts';

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
