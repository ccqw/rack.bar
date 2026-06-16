import { describe, it, expect } from 'vitest';
import { ELEIKO_KG, DEFAULT_BAR_KG, sideLoadKg, totalKg } from './plates.ts';
import type { Plate } from './plates.ts';

describe('the Eleiko plate set', () => {
  it('runs heaviest-first, 25 kg down to 0.5 kg', () => {
    expect(ELEIKO_KG.map((p) => p.kg)).toEqual([
      25, 20, 15, 10, 5, 2.5, 2, 1.5, 1, 0.5,
    ]);
  });

  it('mirrors each change plate onto its 10x bumper color', () => {
    const colorOf = new Map(ELEIKO_KG.map((p) => [p.kg, p.color]));
    expect(colorOf.get(2.5)).toBe(colorOf.get(25)); // red
    expect(colorOf.get(2)).toBe(colorOf.get(20)); // blue
    expect(colorOf.get(1.5)).toBe(colorOf.get(15)); // yellow
    expect(colorOf.get(1)).toBe(colorOf.get(10)); // green
    expect(colorOf.get(0.5)).toBe(colorOf.get(5)); // white
  });
});

describe('totals', () => {
  it('an empty bar weighs exactly the bar', () => {
    expect(totalKg([])).toBe(DEFAULT_BAR_KG);
  });

  it('20 + 15 + 5 per side makes 100 kg on a 20 kg bar', () => {
    const side: Plate[] = [ELEIKO_KG[1], ELEIKO_KG[2], ELEIKO_KG[4]]; // 20, 15, 5
    expect(sideLoadKg(side)).toBe(40);
    expect(totalKg(side)).toBe(100);
  });
});
