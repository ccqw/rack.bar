// Exhaustive fewest-Plates regression suites (RBAR-69, ADR-0003). Every case is a SIDE
// SUM on the set's grid, not a typed Target, so each sweep is a few hundred decodes per
// rig. The oracle (fewest.oracle.ts) is an independent DP over Plate count; Decode must
// match it exactly -- the same Plates in the same order, so the heaviest-first
// tie-break is pinned along with the count.
import { describe, it, expect } from 'vitest';
import { decode, decodeWithin } from './decode.ts';
import { ELEIKO_KG, IRON_LB, SLEEVE_MM } from './plates.ts';
import type { Plate } from './plates.ts';
import { PLATE_SETS, PLATE_SET_KEYS } from './platesets.ts';
import type { PlateSetKey } from './platesets.ts';
import { displayCeilingKg, draftToKg, lbToKg, shownIn } from './units.ts';
import type { Unit } from './units.ts';
import { RIGS } from './properties.oracle.ts';
import type { Rig } from './properties.oracle.ts';
import { GRID_KG, fewestOracle, show } from './fewest.oracle.ts';
import type { FewestOracle } from './fewest.oracle.ts';

const UNITS: readonly Unit[] = ['kg', 'lb'];

/**
 * Sweep every loadable Side sum on one rig: the exact Total, the gap above it (which
 * must load this sum and round up to the next) and, past the last sum, a Target the
 * Sleeve cannot reach. Returns one line per disagreement with the oracle.
 */
function sweep(
  label: string,
  baselineKg: number,
  inventory: readonly Plate[],
  o: FewestOracle,
  sleeveMm: number = SLEEVE_MM,
): string[] {
  const misses: string[] = [];
  const g = o.gridKg;
  const check = (what: string, got: readonly Plate[] | undefined, want: Plate[] | null) => {
    const ok = want === null ? got === undefined : got !== undefined && sameStack(got, want);
    if (!ok) misses.push(`${label} ${what}: got ${got ? show(got) : 'none'}, want ${show(want)}`);
  };
  for (let k = 0; k < o.sums.length; k++) {
    const s = o.sums[k];
    const exact = decode(baselineKg + 2 * s * g, baselineKg, inventory, sleeveMm);
    check(`side ${s}u exact`, exact.primary.side, o.pick(s));
    if (exact.over) misses.push(`${label} side ${s}u exact: unexpected over ${show(exact.over.side)}`);
    const next = o.sums[k + 1];
    const gapT = baselineKg + 2 * (next === undefined ? s + 0.5 : (s + next) / 2) * g;
    const gap = decode(gapT, baselineKg, inventory, sleeveMm);
    check(`side ${s}u gap`, gap.primary.side, o.pick(s));
    check(`side ${s}u gap over`, gap.over?.side, next === undefined ? null : o.pick(next));
  }
  // Far past the Sleeve: the heaviest loadable Side, and no round-up.
  const last = o.sums[o.sums.length - 1];
  const far = decode(baselineKg + 2 * (last + 200) * g, baselineKg, inventory, sleeveMm);
  check('far past the Sleeve', far.primary.side, o.pick(last));
  check('far past the Sleeve over', far.over?.side, null);
  return misses;
}

function sameStack(a: readonly Plate[], b: readonly Plate[]): boolean {
  return a.length === b.length && a.every((p, i) => p === b[i]);
}

const oracleFor = (set: PlateSetKey, inventory: readonly Plate[] = PLATE_SETS[set].inventory, sleeveMm = SLEEVE_MM) =>
  fewestOracle(inventory, GRID_KG[set], sleeveMm);

function rigSweep(rigs: readonly Rig[]): string[] {
  return rigs.flatMap((rig) => sweep(rig.name, rig.baselineKg, rig.inventory, oracleFor(rig.set)));
}

/** The console's solve: at or under the top of the reading the lifter typed (RBAR-60). */
function readBackSweep(rigs: readonly Rig[]): string[] {
  const misses: string[] = [];
  for (const rig of rigs) {
    const o = oracleFor(rig.set);
    for (const u of UNITS) {
      for (const s of o.sums) {
        const total = rig.baselineKg + 2 * s * o.gridKg;
        const typed = draftToKg(String(shownIn(total, u)), u)!;
        const { primary } = decodeWithin(typed, displayCeilingKg(typed, u), rig.baselineKg, rig.inventory);
        // The as-read solve may land on a neighbouring Total that shares the reading; the
        // Plates must still be the oracle's pick for whatever Side it landed on.
        const landed = Math.round((primary.total - rig.baselineKg) / 2 / o.gridKg);
        const want = o.pick(landed);
        if (want === null || !sameStack(primary.side, want)) {
          misses.push(`${rig.name} ${u} ${shownIn(total, u)}: got ${show(primary.side)}, want ${show(want)}`);
        }
      }
    }
  }
  return misses;
}

describe('the named regression (RBAR-69)', () => {
  it('165 lb on the 45 lb Bar loads 35 + 25 per Side, not 45 + 10 + 5', () => {
    const { primary, over } = decode(lbToKg(165), lbToKg(45), IRON_LB);
    expect(primary.side.map((p) => p.label)).toEqual(['35', '25']);
    expect(shownIn(primary.total, 'lb')).toBe(165);
    expect(over).toBeUndefined();
  });

  it('the same 60 lb Side loads 35 + 25 on the 20 kg Bar and under a Collar', () => {
    for (const bar of [20, 20 + 2 * 2.5, lbToKg(45) + 2 * 2.5]) {
      const { primary } = decode(bar + 2 * lbToKg(60), bar, IRON_LB);
      expect(primary.side.map((p) => p.label)).toEqual(['35', '25']);
    }
  });

  it('greedy-optimal loads keep their exact Plates and order (heaviest-first tie-break)', () => {
    // 100 kg Competition: 25 + 15 per Side, not 20 + 20 (both 2 Plates; the heavier first
    // Plate wins). 225 lb iron: 45 + 45 per Side, not 45 + 35 + 10 or anything reshuffled.
    expect(decode(100).primary.side.map((p) => p.kg)).toEqual([25, 15]);
    expect(decode(lbToKg(225), lbToKg(45), IRON_LB).primary.side.map((p) => p.label)).toEqual(['45', '45']);
  });
});

describe('exhaustive fewest-Plates oracle (RBAR-69, ADR-0003, ADR-0012)', () => {
  it('iron Training set: every loadable Side sum, both Bars, with and without a Collar', () => {
    const rigs = RIGS.filter((r) => r.set === 'training');
    expect(rigs).toHaveLength(4);
    expect(rigSweep(rigs)).toEqual([]);
  });

  it('Eleiko Competition set: every loadable Side sum, every Bar, with and without a Collar', () => {
    const rigs = RIGS.filter((r) => r.set === 'comp');
    expect(rigs).toHaveLength(6);
    expect(rigSweep(rigs)).toEqual([]);
  });

  it('as read: every loadable Total typed back in kg and in lb picks the fewest Plates, both sets (RBAR-60)', () => {
    expect(readBackSweep(RIGS)).toEqual([]);
  });

  it('the oracle sees the iron gap the old greedy missed (the sweep is not vacuous)', () => {
    // On iron 20 Side sums need fewer Plates than heaviest-first greedy would load; the
    // 60 lb Side (24 grid units) is the smallest. Pin that the oracle agrees.
    const o = oracleFor('training');
    expect(o.fewest(24)).toBe(2);
    expect(show(o.pick(24))).toBe('35+25');
  });
});

describe('Sleeve-capacity interplay (RBAR-69, ADR-0012)', () => {
  // A shorter Sleeve moves the binding band down into everyday sums, so the band where the
  // fewest-Plates stack is too wide (and a longer-but-narrower one, or a lighter sum, wins)
  // is covered on both sets, not only at the extreme end of the 415 mm Sleeve.
  const SLEEVES = [SLEEVE_MM, 300, 200, 120];

  for (const set of PLATE_SET_KEYS) {
    it(`${set}: matches the oracle near capacity on Sleeves of ${SLEEVES.join(', ')} mm`, () => {
      const bar = PLATE_SETS[set].defaultBarKg;
      const inv = PLATE_SETS[set].inventory;
      let binding = 0;
      const misses: string[] = [];
      for (const mm of SLEEVES) {
        const o = oracleFor(set, inv, mm);
        misses.push(...sweep(`${set} sleeve ${mm}`, bar, inv, o, mm));
        for (const s of o.sums) if (o.fewest(s) !== o.fewestUncapped(s)) binding++;
      }
      expect(misses).toEqual([]);
      // The Sleeve really does force extra Plates somewhere in the sweep.
      expect(binding).toBeGreaterThan(0);
    });
  }
});

describe('reduced Inventories: each single Plate size removed (RBAR-69; RBAR-66 groundwork)', () => {
  for (const set of PLATE_SET_KEYS) {
    const inv = PLATE_SETS[set].inventory;
    const bar = PLATE_SETS[set].defaultBarKg;
    it(`${set}: fewest Plates stays exact with any one size missing`, () => {
      const misses: string[] = [];
      for (const gone of inv) {
        const reduced = inv.filter((p) => p !== gone);
        const name = `${set} without ${gone.label ?? gone.kg}`;
        misses.push(...sweep(name, bar, reduced, oracleFor(set, reduced)));
      }
      expect(misses).toEqual([]);
    });
  }

  it('an unordered Inventory decodes the same as the heaviest-first one', () => {
    const shuffled = [...ELEIKO_KG].reverse();
    for (const t of [61, 100, 143, 250, 371]) {
      expect(decode(t, 20, shuffled).primary.side).toEqual(decode(t).primary.side);
    }
  });
});

describe('runtime budget (RBAR-69: the exhaustive suites stay fast)', () => {
  it('one decode on each set stays well under a millisecond on average', () => {
    const t0 = performance.now();
    let n = 0;
    for (const rig of RIGS) {
      for (let t = rig.baselineKg; t < rig.baselineKg + 400; t += 0.7) {
        decode(t, rig.baselineKg, rig.inventory);
        n++;
      }
    }
    const perCall = (performance.now() - t0) / n;
    expect(perCall).toBeLessThan(1);
  });
});
