import { describe, it, expect } from 'vitest';
import {
  ELEIKO_KG,
  IRON_LB,
  DEFAULT_BAR_KG,
  SLEEVE_MM,
  sideLoadKg,
  sideWidthMm,
  minPlateWidthMm,
  atSleeveCapacity,
  totalKg,
  barWithCollars,
} from './plates.ts';
import type { Plate } from './plates.ts';
import { toLbWhole, lbToKg } from './units.ts';

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

describe('barWithCollars (the effective Bar baseline, ADR-0008)', () => {
  it('is the bare Bar when no collar is chosen (None)', () => {
    expect(barWithCollars(20, 0)).toBe(20);
    expect(barWithCollars(15, 0)).toBe(15);
  });

  it('adds a collar to each Side: Bar + 2 x collar', () => {
    // A Standard 2.5 kg collar on each Side adds 5 kg to the bare-rig baseline.
    expect(barWithCollars(20, 2.5)).toBe(25);
    expect(barWithCollars(15, 2.5)).toBe(20);
    expect(barWithCollars(5, 2.5)).toBe(10);
  });

  it('feeds the parameterized Total: Total = Bar + 2 x collar + 2 x Side Load', () => {
    // The baseline is exactly what totalKg loads from, so a collared Total is the
    // bare-rig baseline plus the Plate weight on both Sides.
    const side: Plate[] = [ELEIKO_KG[1], ELEIKO_KG[2]]; // 20 + 15 = 35 per Side
    expect(totalKg(side, barWithCollars(20, 2.5))).toBe(25 + 70); // 95
  });
});

describe('the iron training plate set (RBAR-17, ADR-0010)', () => {
  it('runs heaviest-first, 45 lb down to 2.5 lb, all iron-colored', () => {
    expect(IRON_LB.map((p) => p.label)).toEqual(['45', '35', '25', '10', '5', '2.5']);
    expect(IRON_LB.every((p) => p.color === 'iron')).toBe(true);
  });

  it('stores each Plate true mass in kg, derived from its lb label so it reads exact', () => {
    // Mass is canonical kg; the lb FACE is the `label`. Deriving the mass from the
    // label through the same factor (lbToKg) is what makes the lb readout land exact
    // and a whole-lb Target decode without float drift.
    IRON_LB.forEach((p) => {
      expect(toLbWhole(p.kg)).toBe(Math.round(Number(p.label)));
      expect(p.kg).toBeCloseTo(lbToKg(Number(p.label)), 9);
    });
  });

  it('carries real render dimensions for the sleeve (ADR-0004)', () => {
    expect(IRON_LB.every((p) => p.diameterMm > 0 && p.widthMm > 0)).toBe(true);
  });

  it('totals to whole pounds: a 45 lb Bar + one 45 lb pair = 135 lb', () => {
    const bar = lbToKg(45);
    const side = [IRON_LB[0]]; // one 45 lb plate per side
    expect(toLbWhole(totalKg(side, bar))).toBe(135);
  });
});

describe('sleeve capacity (RBAR-28, view-layer physical cap)', () => {
  it('exposes the usable per-Side sleeve length (handoff engine.js)', () => {
    expect(SLEEVE_MM).toBe(415);
  });

  it('sums Plate thickness on one Side, in millimetres', () => {
    // 25 (58) + 15 (39) = 97 mm.
    const side = [ELEIKO_KG[0], ELEIKO_KG[2]];
    expect(sideWidthMm(side)).toBe(58 + 39);
    expect(sideWidthMm([])).toBe(0);
  });

  it('finds the narrowest Plate in a set (the smallest width that still fits)', () => {
    // The 2.5 kg change plate is the thinnest Eleiko at 15 mm.
    expect(minPlateWidthMm(ELEIKO_KG)).toBe(15);
  });

  it('reads an empty and a lightly-loaded Side as having room', () => {
    expect(atSleeveCapacity([], ELEIKO_KG)).toBe(false);
    expect(atSleeveCapacity([ELEIKO_KG[0]], ELEIKO_KG)).toBe(false); // one 25, 58 mm
  });

  it('treats an empty plate set as not-at-capacity (no Plate to add, no Infinity trap)', () => {
    // Math.min() of nothing is Infinity; guard it so an empty Inventory does not report
    // every Side as full (mirrors decode.ts's empty-Inventory guard).
    expect(atSleeveCapacity([ELEIKO_KG[0]], [])).toBe(false);
    expect(minPlateWidthMm([])).toBe(Infinity); // documents the underlying trap
  });

  it('flags a Side as full when not even the narrowest Plate would fit', () => {
    // Stack 25 kg bumpers (58 mm each) until the narrowest (15 mm) no longer fits
    // within 415 mm: 7 x 58 = 406, and 406 + 15 = 421 > 415 -> full.
    const seven = Array(7).fill(ELEIKO_KG[0]);
    expect(sideWidthMm(seven)).toBe(406);
    expect(atSleeveCapacity(seven, ELEIKO_KG)).toBe(true);
    // Six (348 mm) still leaves room for a 15 mm plate (348 + 15 = 363 <= 415).
    const six = Array(6).fill(ELEIKO_KG[0]);
    expect(atSleeveCapacity(six, ELEIKO_KG)).toBe(false);
  });
});
