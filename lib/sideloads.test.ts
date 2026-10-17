import { describe, it, expect } from 'vitest';
import { sideLoads, canonicalSide, sideAtOrUnder, sideAbove, plateGridKg } from './sideloads.ts';
import { ELEIKO_KG, IRON_LB, SLEEVE_MM, sideLoadKg, sideWidthMm, withLimits } from './plates.ts';
import type { Plate } from './plates.ts';
import { lbToKg } from './units.ts';

// The first `limit` ranked Side Loads (what RBAR-66's alternates will take).
const rankSides = (sideKg: number, inv: readonly Plate[], sleeveMm = SLEEVE_MM, limit = 1) => {
  const out: (readonly Plate[])[] = [];
  if (limit < 1) return out;
  for (const side of sideLoads(sideKg, inv, sleeveMm)) {
    out.push(side);
    if (out.length >= limit) break;
  }
  return out;
};
const kgs = (side: readonly Plate[]) => side.map((p) => p.kg);
const labels = (side: readonly Plate[]) => side.map((p) => p.label);

describe('plateGridKg: the step every Side sum lies on', () => {
  it('is the smallest Plate when it divides the rest', () => {
    expect(plateGridKg(ELEIKO_KG)).toBe(0.5);
    expect(plateGridKg(IRON_LB)).toBeCloseTo(lbToKg(2.5), 12);
  });

  it('is finer than the smallest Plate when the smallest does not divide the rest', () => {
    // Without the 0.5s the smallest is 1 kg, but 2.5 and 1.5 still make half-kg sums.
    expect(plateGridKg(ELEIKO_KG.filter((p) => p.kg !== 0.5))).toBe(0.5);
    // Iron without the 2.5s steps by 5 lb.
    expect(plateGridKg(IRON_LB.filter((p) => p.label !== '2.5'))).toBeCloseTo(lbToKg(5), 12);
  });

  it('throws a RangeError on an empty Inventory, a bad mass, or no common grid', () => {
    expect(() => plateGridKg([])).toThrow(RangeError);
    const odd: Plate = { kg: Math.PI, color: 'iron', diameterMm: 200, widthMm: 20 };
    expect(() => plateGridKg([ELEIKO_KG[0], odd])).toThrow(RangeError);
    expect(() => plateGridKg([{ ...odd, kg: 0 }])).toThrow(RangeError);
    expect(() => plateGridKg([{ ...odd, kg: Number.NaN }])).toThrow(RangeError);
    expect(() => plateGridKg([{ ...ELEIKO_KG[0], widthMm: 0 }])).toThrow(RangeError);
    // Eager: the throw comes at the call, not on the first next().
    expect(() => sideLoads(25, [{ ...ELEIKO_KG[0], widthMm: 0 }])).toThrow(RangeError);
    // And even when the budget would short-circuit to the bare Bar.
    expect(() => sideAtOrUnder(0, [{ ...ELEIKO_KG[0], widthMm: 0 }])).toThrow(RangeError);
  });

  it('rejects a Plate that is only NEAR the grid instead of silently skipping it', () => {
    // 1 / 0.3333333 is within 1e-6 of 3 but 1 kg is 3e-7 kg off the grid: accepting that
    // grid would make the walk never try a sum using the 1 kg Plate.
    const third: Plate = { kg: 0.3333333, color: 'iron', diameterMm: 100, widthMm: 10 };
    const one: Plate = { kg: 1, color: 'iron', diameterMm: 100, widthMm: 20 };
    expect(() => plateGridKg([one, third])).toThrow(RangeError);
    expect(() => sideAtOrUnder(1, [one, third])).toThrow(RangeError);
  });

  it('rejects a Sleeve that is not a positive finite length', () => {
    for (const mm of [Number.NaN, 0, -1, Infinity]) {
      expect(() => sideAtOrUnder(50, ELEIKO_KG, mm)).toThrow(RangeError);
      expect(() => sideAbove(50, ELEIKO_KG, mm)).toThrow(RangeError);
      expect(() => sideLoads(50, ELEIKO_KG, mm)).toThrow(RangeError);
    }
  });

  it('every shipped set and every single-size reduction has a grid (never throws in the app)', () => {
    for (const inv of [ELEIKO_KG, IRON_LB]) {
      expect(plateGridKg(inv)).toBeGreaterThan(0);
      for (const gone of inv) expect(plateGridKg(inv.filter((p) => p !== gone))).toBeGreaterThan(0);
    }
  });
});

describe('sideLoads: every Side Load reaching an exact Side sum, ranked (RBAR-69)', () => {
  it('ranks fewest Plates first, then heaviest-first (the RBAR-66 40 kg Side order)', () => {
    const ranked = rankSides(40, ELEIKO_KG, SLEEVE_MM, 6).map(kgs);
    expect(ranked).toEqual([
      [25, 15],
      [20, 20],
      [25, 10, 5],
      [20, 15, 5],
      [20, 10, 10],
      [15, 15, 10],
    ]);
  });

  it('puts 35 + 25 ahead of 45 + 10 + 5 for a 60 lb iron Side', () => {
    const ranked = rankSides(lbToKg(60), IRON_LB, SLEEVE_MM, 3).map(labels);
    expect(ranked[0]).toEqual(['35', '25']);
    expect(ranked[1]).toEqual(['45', '10', '5']);
  });

  it('is a stable ranking: a shorter limit is a prefix of a longer one', () => {
    const long = rankSides(62.5, ELEIKO_KG, SLEEVE_MM, 12);
    expect(rankSides(62.5, ELEIKO_KG, SLEEVE_MM, 5)).toEqual(long.slice(0, 5));
  });

  it('returns only distinct, heaviest-first, Sleeve-fitting stacks that hit the sum exactly', () => {
    const ranked = rankSides(50, ELEIKO_KG, 200, 50);
    expect(ranked.length).toBeGreaterThan(1);
    const keys = new Set(ranked.map((s) => kgs(s).join(',')));
    expect(keys.size).toBe(ranked.length);
    for (const side of ranked) {
      expect(sideLoadKg(side)).toBeCloseTo(50, 9);
      expect(sideWidthMm(side)).toBeLessThanOrEqual(200);
      expect(side.every((p, i) => i === 0 || side[i - 1].kg >= p.kg)).toBe(true);
    }
  });

  it('drops a stack the Sleeve cannot hold, even when it is the fewest Plates', () => {
    // 50 kg in 100 mm: 25 + 25 is 116 mm, so the two-Plate answer is gone and nothing
    // with three or more Plates fits either.
    expect(rankSides(50, ELEIKO_KG, 100, 3)).toEqual([]);
    expect(kgs(rankSides(50, ELEIKO_KG, 116, 1)[0])).toEqual([25, 25]);
  });

  it('returns [] for an off-grid or unbuildable sum, and [[]] for zero', () => {
    expect(rankSides(0.25, ELEIKO_KG)).toEqual([]);
    expect(rankSides(500, ELEIKO_KG)).toEqual([]);
    expect(rankSides(-1, ELEIKO_KG)).toEqual([]);
    expect(rankSides(0, ELEIKO_KG)).toEqual([[]]);
    expect(rankSides(10, [])).toEqual([]);
  });

  it('ranks two same-mass sizes narrower-first, whatever the Inventory order', () => {
    const wide: Plate = { kg: 20, color: 'iron', diameterMm: 450, widthMm: 60 };
    const slim: Plate = { kg: 20, color: 'blue', diameterMm: 450, widthMm: 50 };
    for (const inv of [[wide, slim], [slim, wide]]) {
      const ranked = rankSides(40, inv, SLEEVE_MM, 5);
      expect(ranked).toEqual([[slim, slim], [slim, wide], [wide, wide]]);
    }
  });

  it('returns Plates from the given Inventory (same objects), whatever its order', () => {
    const shuffled = [...IRON_LB].reverse();
    const [best] = rankSides(lbToKg(60), shuffled);
    expect(labels(best)).toEqual(['35', '25']);
    for (const p of best) expect(shuffled).toContain(p);
  });
});

describe('canonicalSide / sideAtOrUnder / sideAbove: the picks decode makes', () => {
  it('canonicalSide is the first ranked Side Load, or null', () => {
    expect(labels(canonicalSide(lbToKg(60), IRON_LB)!)).toEqual(['35', '25']);
    expect(canonicalSide(0.25, ELEIKO_KG)).toBeNull();
    expect(canonicalSide(0, ELEIKO_KG)).toEqual([]);
  });

  it('enumerates lazily: the first Side Load needs no full enumeration', () => {
    const it = sideLoads(100, ELEIKO_KG);
    expect(kgs(it.next().value as readonly Plate[])).toEqual([25, 25, 25, 25]);
    expect(kgs(it.next().value as readonly Plate[])).toEqual([25, 25, 25, 20, 5]);
  });

  it('fills the greatest loadable sum at or under the budget, fewest Plates', () => {
    expect(labels(sideAtOrUnder(lbToKg(61), IRON_LB))).toEqual(['35', '25']);
    expect(kgs(sideAtOrUnder(40.3, ELEIKO_KG))).toEqual([25, 15]);
    expect(sideAtOrUnder(0, ELEIKO_KG)).toEqual([]);
    expect(sideAtOrUnder(0.4, ELEIKO_KG)).toEqual([]);
    expect(sideAtOrUnder(10, [])).toEqual([]);
  });

  it('reaches a sum greedy cannot when the smallest Plate does not divide the rest', () => {
    // No 0.5s: a 3 kg Side is 2 + 1 (greedy would stop at 2.5).
    const no05 = ELEIKO_KG.filter((p) => p.kg !== 0.5);
    expect(kgs(sideAtOrUnder(3, no05))).toEqual([2, 1]);
  });

  it('sideAbove is the least loadable sum strictly above, or null past the Sleeve', () => {
    expect(kgs(sideAbove(40, ELEIKO_KG)!)).toEqual([25, 15, 0.5]);
    expect(kgs(sideAbove(40.2, ELEIKO_KG)!)).toEqual([25, 15, 0.5]);
    expect(labels(sideAbove(lbToKg(58), IRON_LB)!)).toEqual(['35', '25']);
    expect(sideAbove(10, [])).toBeNull();
    // The empty Side is never a round-up, even below zero.
    expect(kgs(sideAbove(-5, ELEIKO_KG)!)).toEqual([0.5]);
    expect(kgs(sideAbove(0, ELEIKO_KG)!)).toEqual([0.5]);
    const full = sideAtOrUnder(1000, ELEIKO_KG);
    expect(sideAbove(sideLoadKg(full), ELEIKO_KG)).toBeNull();
  });
});

describe('plate limits: a cap of pairs per Side on each size (RBAR-72, ADR-0016)', () => {
  const byKg = (kg: number) => ELEIKO_KG.find((p) => p.kg === kg)!;
  const everySize = (inv: readonly Plate[], n: number) =>
    Object.fromEntries(inv.map((p) => [p.label ?? String(p.kg), n]));

  it('withLimits caps the named sizes by face, keeps the rest as the same objects', () => {
    const inv = withLimits(ELEIKO_KG, { '25': 1, '0.5': 0 });
    expect(inv).toHaveLength(ELEIKO_KG.length);
    expect(inv[0]).toEqual({ ...byKg(25), maxPerSide: 1 });
    expect(inv[9]).toEqual({ ...byKg(0.5), maxPerSide: 0 });
    for (let i = 1; i < 9; i++) expect(inv[i]).toBe(ELEIKO_KG[i]);
    // Iron sizes are named by their stamped lb face.
    const iron = withLimits(IRON_LB, { '45': 2 });
    expect(iron[0]).toEqual({ ...IRON_LB[0], maxPerSide: 2 });
    // No limits at all: the very same Inventory entries.
    withLimits(ELEIKO_KG, {}).forEach((p, i) => expect(p).toBe(ELEIKO_KG[i]));
  });

  it('withLimits composes as the tighter of two caps (today within this gym)', () => {
    const gym = withLimits(ELEIKO_KG, { '25': 3, '20': 1 });
    const today = withLimits(gym, { '25': 1, '20': 2 });
    expect(today[0].maxPerSide).toBe(1);
    expect(today[1].maxPerSide).toBe(1);
  });

  it('withLimits rejects an unknown size or a cap that is not a whole count', () => {
    expect(() => withLimits(ELEIKO_KG, { '30': 1 })).toThrow(RangeError);
    for (const bad of [-1, 1.5, Number.NaN]) {
      expect(() => withLimits(ELEIKO_KG, { '25': bad })).toThrow(RangeError);
    }
    expect(() => sideAtOrUnder(50, [{ ...byKg(25), maxPerSide: -1 }])).toThrow(RangeError);
    expect(() => sideLoads(50, [{ ...byKg(25), maxPerSide: 0.5 }])).toThrow(RangeError);
    expect(() => sideAbove(50, [{ ...byKg(25), maxPerSide: Number.NaN }])).toThrow(RangeError);
  });

  it('one pair of 25s: a 60 kg Side is 25 + 20 + 15, not 25 + 25 + 10 (the design scenario)', () => {
    const inv = withLimits(ELEIKO_KG, { '25': 1 });
    expect(kgs(sideAtOrUnder(60, ELEIKO_KG))).toEqual([25, 25, 10]);
    expect(kgs(sideAtOrUnder(60, inv))).toEqual([25, 20, 15]);
    expect(rankSides(60, inv, SLEEVE_MM, 3).map(kgs)).toEqual([
      [25, 20, 15],
      [20, 20, 20],
      [25, 20, 10, 5],
    ]);
  });

  it('a none size never loads, and the grid follows the sizes left', () => {
    const no05 = withLimits(ELEIKO_KG, { '0.5': 0 });
    expect(kgs(sideAtOrUnder(3, no05))).toEqual([2, 1]);
    expect(plateGridKg(no05)).toBe(0.5);
    const noChange = withLimits(ELEIKO_KG, { '2.5': 0, '2': 0, '1.5': 0, '1': 0, '0.5': 0 });
    expect(plateGridKg(noChange)).toBe(5);
    expect(kgs(sideAtOrUnder(61, noChange))).toEqual([25, 25, 10]);
    expect(kgs(sideAbove(61, noChange)!)).toEqual([25, 25, 15]);
  });

  it('caps bound the heaviest Side: past what the pairs hold there is no round-up', () => {
    const few = withLimits(ELEIKO_KG, {
      ...everySize(ELEIKO_KG, 0),
      '25': 1,
      '20': 1,
      '5': 1,
    });
    expect(kgs(sideAtOrUnder(1000, few))).toEqual([25, 20, 5]);
    expect(sideAbove(50, few)).toBeNull();
    expect(kgs(sideAbove(44, few)!)).toEqual([25, 20]);
  });

  it('every size none is the bare Bar, with no round-up', () => {
    const none = withLimits(ELEIKO_KG, everySize(ELEIKO_KG, 0));
    expect(sideAtOrUnder(60, none)).toEqual([]);
    expect(sideAbove(60, none)).toBeNull();
    expect(rankSides(60, none)).toEqual([]);
    expect(rankSides(0, none)).toEqual([[]]);
    expect(() => plateGridKg(none)).toThrow(RangeError);
  });

  it('a cap that never binds changes nothing (explicit Infinity or a large count)', () => {
    const inf = ELEIKO_KG.map((p) => ({ ...p, maxPerSide: Infinity }));
    const big = withLimits(ELEIKO_KG, everySize(ELEIKO_KG, 99));
    for (const kg of [0.5, 13, 40, 60, 99.5, 150, 170]) {
      expect(kgs(sideAtOrUnder(kg, inf))).toEqual(kgs(sideAtOrUnder(kg, ELEIKO_KG)));
      expect(kgs(sideAtOrUnder(kg, big))).toEqual(kgs(sideAtOrUnder(kg, ELEIKO_KG)));
      expect(rankSides(kg, big, SLEEVE_MM, 8).map(kgs)).toEqual(
        rankSides(kg, ELEIKO_KG, SLEEVE_MM, 8).map(kgs),
      );
    }
  });
});
