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
          const by = fewest !== null && primary.side.length === fewest + 1 ? ' (one over)' : '';
          misses.push(`${rig.name}: ${total.toFixed(2)} kg -> ${plates} (fewest is ${fewest})${by}`);
        }
      }
    }
    return misses;
  };

  it('loads the fewest Plates for every Competition Total, Sleeve-capped band included (ADR-0003, ADR-0012; exhaustive)', () => {
    expect(fewestPlateMisses(RIGS.filter((r) => r.set === 'comp'))).toEqual([]);
  });

  // KNOWN GAP, filed as RBAR-69 (not fixed here: it changes visible output). The iron
  // ladder {45,35,25,10,5,2.5} lb is canonical for "greatest at or under" (ADR-0010's DP
  // check) but NOT for fewest Plates, so the heaviest-first greedy loads one Plate too
  // many on 14 of the 143 Totals of every Training rig. Smallest counterexample, the
  // default 45 lb Bar: 165 lb -> greedy 45 + 10 + 5 per Side (3 Plates), while 35 + 25
  // (2 Plates) reaches the same Total; likewise 255 lb -> 45+45+10+5 vs 45+35+25.
  // Which rule wins for iron (fewest Plates, or "45s first" gym habit) is a product
  // call, so the property stays pinned as an expected failure until it is decided.
  // When the loader is fixed this starts passing and `it.fails` flags it -- flip it.
  it.fails('loads the fewest Plates for every Training Total (ADR-0003; KNOWN GAP RBAR-69)', () => {
    expect(fewestPlateMisses(RIGS.filter((r) => r.set === 'training'))).toEqual([]);
  });

  // `it.fails` passes on ANY throw, so on its own it would stay green if the gap grew
  // or the helper broke. This pins the gap's exact size and shape in both directions:
  // 14 Totals per Training rig, each exactly one Plate over, the 165 lb case among
  // them. When RBAR-69 lands, delete this and flip the it.fails above to `it`.
  it('pins the RBAR-69 gap exactly: 14 Totals per Training rig, one extra Plate each (ADR-0003)', () => {
    const training = RIGS.filter((r) => r.set === 'training');
    const misses = fewestPlateMisses(training);
    expect(misses).toHaveLength(14 * training.length);
    for (const m of misses) expect(m).toMatch(/\(one over\)$/);
    expect(misses).toContain(
      'training bar 20.412 kg collar 0: 74.84 kg -> 45+10+5 (fewest is 2) (one over)',
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

  it('Encode reads Bar + 2 x Collar + 2 x Side Load, and Decode of that Total reaches it (with no more Plates on Competition) (ADR-0005, ADR-0008, ADR-0003)', () => {
    fc.assert(
      fc.property(rigTapsArb, ({ rig, taps }) => {
        let side: readonly Plate[] = [];
        for (const { i } of taps) side = addPlate(side, rig.inventory[i]);
        const t = encode(side, rig.baselineKg);
        expect(t).toBeCloseTo(rig.barKg + 2 * rig.collarKg + 2 * sideLoadKg(side), 9);
        const { primary } = decode(t, rig.baselineKg, rig.inventory);
        expect(primary.total).toBeCloseTo(t, 9);
        // Fewest Plates is only guaranteed on Competition today -- the Training gap is
        // pinned by the RBAR-69 it.fails above (a hand-built 35+35+35 beats Decode's
        // 45+45+10+5).
        if (rig.set === 'comp') expect(primary.side.length).toBeLessThanOrEqual(side.length);
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
        (x) => {
          const s = parseLink(x, 'kg');
          if (s !== null) expectValid(s);
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
