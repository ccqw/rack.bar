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

describe('real plate dimensions (ADR-0004 reference table)', () => {
  // The Eleiko reference dimensions ADR-0004 fixes: diameter (mm) drives a disc's
  // rendered height, thickness (mm) its width. These are the source of the sleeve's
  // glance-test against a physical bar, so the model must carry them verbatim.
  const TABLE: ReadonlyArray<[kg: number, diameterMm: number, widthMm: number]> = [
    [25, 450, 58],
    [20, 450, 50],
    [15, 450, 39],
    [10, 450, 35],
    [5, 228, 20],
    [2.5, 207, 15],
    [2, 193, 22],
    [1.5, 170, 20],
    [1, 148, 19],
    [0.5, 127, 16],
  ];

  const byKg = new Map(ELEIKO_KG.map((p) => [p.kg, p]));

  it.each(TABLE)(
    'the %i kg Plate is %i mm across and %i mm thick',
    (kg, diameterMm, widthMm) => {
      const plate = byKg.get(kg)!;
      expect(plate.diameterMm).toBe(diameterMm);
      expect(plate.widthMm).toBe(widthMm);
    },
  );

  it('keeps the four competition bumpers (25-10) at one 450 mm diameter', () => {
    const bumpers = [25, 20, 15, 10].map((kg) => byKg.get(kg)!);
    expect(bumpers.every((p) => p.diameterMm === 450)).toBe(true);
  });

  it('steps the diameter down below the bumpers for the 5 kg and change plates', () => {
    // ADR-0004: "bigger reads as bigger" is honored where physically true -- the
    // small plates really do nest down in diameter, the bumpers do not.
    const smalls = [5, 2.5, 2, 1.5, 1, 0.5].map((kg) => byKg.get(kg)!);
    expect(smalls.every((p) => p.diameterMm < 450)).toBe(true);
  });

  it('gives every Plate a positive diameter and thickness', () => {
    expect(
      ELEIKO_KG.every((p) => p.diameterMm > 0 && p.widthMm > 0),
    ).toBe(true);
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
