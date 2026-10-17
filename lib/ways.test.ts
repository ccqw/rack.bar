import { describe, it, expect } from 'vitest';
import { MAX_WAYS, waysFor } from './ways.ts';
import { decode } from './decode.ts';
import { ELEIKO_KG, IRON_LB, sideLoadKg, sideWidthMm, SLEEVE_MM, withLimits } from './plates.ts';
import type { Plate } from './plates.ts';
import { lbToKg } from './units.ts';

const kgs = (side: readonly Plate[]) => side.map((p) => p.kg);
const labels = (side: readonly Plate[]) => side.map((p) => p.label);

describe('waysFor: the other loads of the same Total (RBAR-66)', () => {
  it('lists 140 kg on a 20 kg Bar fewest Plates first, then heaviest-first, capped at five', () => {
    const { primary } = decode(140, 20, ELEIKO_KG);
    expect(waysFor(primary.side, ELEIKO_KG).map(kgs)).toEqual([
      [25, 25, 10],
      [25, 20, 15],
      [20, 20, 20],
      [25, 25, 5, 5],
      [25, 20, 10, 5],
    ]);
  });

  it('starts with the very stack Decode loads, Plate for Plate', () => {
    for (const target of [60, 105, 142, 200, 301]) {
      const { primary } = decode(target, 20, ELEIKO_KG);
      const ways = waysFor(primary.side, ELEIKO_KG);
      expect(ways[0]).toEqual(primary.side);
      ways[0].forEach((p, i) => expect(p).toBe(primary.side[i]));
    }
  });

  it('keeps every way on the same Side sum, within the Sleeve, distinct', () => {
    const { primary } = decode(105, 20, ELEIKO_KG);
    const ways = waysFor(primary.side, ELEIKO_KG);
    expect(ways).toHaveLength(MAX_WAYS);
    for (const w of ways) {
      expect(sideLoadKg(w)).toBeCloseTo(42.5, 9);
      expect(sideWidthMm(w)).toBeLessThanOrEqual(SLEEVE_MM);
    }
    expect(new Set(ways.map((w) => kgs(w).join(','))).size).toBe(ways.length);
  });

  it('a bare Side has one way, the bare Bar; a single-Plate Side may have only a few', () => {
    expect(waysFor([], ELEIKO_KG)).toEqual([[]]);
    const half = ELEIKO_KG.find((p) => p.kg === 0.5)!;
    expect(waysFor([half], ELEIKO_KG).map(kgs)).toEqual([[0.5]]);
    const one = ELEIKO_KG.find((p) => p.kg === 1)!;
    expect(waysFor([one], ELEIKO_KG).map(kgs)).toEqual([[1], [0.5, 0.5]]);
  });

  it('includes the greedy stack RBAR-69 replaced on iron (165 lb on a 45 lb Bar)', () => {
    const bar = lbToKg(45);
    const { primary } = decode(lbToKg(165), bar, IRON_LB);
    const ways = waysFor(primary.side, IRON_LB);
    expect(labels(ways[0])).toEqual(['35', '25']);
    expect(ways.map(labels)).toContainEqual(['45', '10', '5']);
  });

  it('respects Plate limits (ADR-0016): one pair of 25s at 140 kg', () => {
    const inv = withLimits(ELEIKO_KG, { '25': 1 });
    const { primary } = decode(140, 20, inv);
    const ways = waysFor(primary.side, inv);
    expect(ways.map(kgs)[0]).toEqual([25, 20, 15]);
    for (const w of ways) expect(w.filter((p) => p.kg === 25).length).toBeLessThanOrEqual(1);
  });

  it('works for the round-up too', () => {
    const { over } = decode(140.5, 20, ELEIKO_KG);
    const ways = waysFor(over!.side, ELEIKO_KG);
    expect(ways[0]).toEqual(over!.side);
    for (const w of ways) expect(sideLoadKg(w)).toBeCloseTo(sideLoadKg(over!.side), 9);
  });

  it('falls back to the Side itself when the Inventory cannot build it', () => {
    const iron = IRON_LB[0];
    expect(waysFor([iron], ELEIKO_KG)).toEqual([[iron]]);
  });
});
