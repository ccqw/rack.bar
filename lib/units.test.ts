import { describe, it, expect } from 'vitest';
import {
  KG_PER_LB,
  lbToKg,
  kgToLb,
  toLbWhole,
  shownIn,
  draftToKg,
  stepFor,
  format,
  displayCeilingKg,
  displayFloorKg,
} from './units.ts';

describe('units (kg|lb conversion, ADR-0010/ADR-0006)', () => {
  it('uses the exact 1 lb = 0.45359237 kg factor', () => {
    expect(KG_PER_LB).toBe(0.45359237);
  });

  it('round-trips kg <-> lb through the exact factor', () => {
    expect(lbToKg(45)).toBeCloseTo(20.41166, 4);
    expect(kgToLb(lbToKg(135))).toBeCloseTo(135, 9);
  });

  describe('toLbWhole -- the lb readout rounds to whole pounds', () => {
    it('rounds a 20 kg Bar to 44 lb', () => {
      expect(toLbWhole(20)).toBe(44);
    });
    it('reads an exact-lb mass as its whole pounds (a 45 lb iron Bar)', () => {
      expect(toLbWhole(lbToKg(45))).toBe(45);
      expect(toLbWhole(lbToKg(135))).toBe(135);
    });
  });

  describe('shownIn -- the number to display for a kg value in a Unit', () => {
    it('shows whole pounds in lb', () => {
      expect(shownIn(lbToKg(135), 'lb')).toBe(135);
    });
    it('shows kg trimmed to <=2dp with trailing zeros stripped', () => {
      expect(shownIn(60.5, 'kg')).toBe(60.5);
      expect(shownIn(100, 'kg')).toBe(100);
      expect(shownIn(100.5, 'kg')).toBe(100.5);
    });
  });

  describe('draftToKg -- parse a display-Unit entry string to canonical kg', () => {
    it('passes a kg entry through unchanged', () => {
      expect(draftToKg('142.5', 'kg')).toBe(142.5);
    });
    it('converts an lb entry to kg with the exact factor', () => {
      expect(draftToKg('135', 'lb')).toBeCloseTo(lbToKg(135), 9);
    });
    it('reads blank, whitespace, or unparseable as null (never NaN)', () => {
      expect(draftToKg('', 'kg')).toBeNull();
      expect(draftToKg('   ', 'lb')).toBeNull();
      expect(draftToKg('abc', 'kg')).toBeNull();
    });
    it('tolerates a mid-entry trailing decimal', () => {
      expect(draftToKg('142.', 'kg')).toBe(142);
    });
  });

  describe('stepFor -- the stepper increment in the display Unit', () => {
    it('nudges 5 lb in lb and 1 kg in kg', () => {
      expect(stepFor('lb')).toBe(5);
      expect(stepFor('kg')).toBe(1);
    });
  });

  describe('format -- the "<n> <unit>" readout string', () => {
    it('formats kg and lb readouts', () => {
      expect(format(100, 'kg')).toBe('100 kg');
      expect(format(lbToKg(135), 'lb')).toBe('135 lb');
    });
  });
});

// RBAR-60: the Target the lifter sees is a rounded reading (whole lb, or kg to 2 dp), so
// "at or under the Target" must mean at or under what the READING covers -- else typing
// back a displayed Total (55 lb = 24.95 kg vs a 25 kg load reading 55 lb) solves one
// step low. The ceiling is the top of the reading's rounding bucket, still in kg.
describe('displayCeilingKg (RBAR-60)', () => {
  const cases: [number, 'kg' | 'lb'][] = [
    [lbToKg(55), 'lb'],
    [lbToKg(313), 'lb'],
    [lbToKg(45), 'lb'],
    [29.48, 'kg'],
    [100, 'kg'],
    [61.234, 'kg'], // typed past display precision: the bucket is still 61.23's
    [0, 'kg'],
  ];

  it('never lowers the Target and still reads the same as it', () => {
    for (const [kg, unit] of cases) {
      const top = displayCeilingKg(kg, unit);
      expect(top, `${kg} ${unit}`).toBeGreaterThanOrEqual(kg);
      expect(shownIn(top, unit), `${kg} ${unit}`).toBe(shownIn(kg, unit));
    }
  });

  it('is the top of the bucket: a hair above it reads differently', () => {
    for (const [kg, unit] of cases) {
      const top = displayCeilingKg(kg, unit);
      const hair = unit === 'lb' ? lbToKg(1e-6) : 1e-6;
      expect(shownIn(top + hair, unit), `${kg} ${unit}`).not.toBe(shownIn(kg, unit));
    }
  });

  it('covers the real load a reading stands for', () => {
    // 25 kg reads 55 lb; the 55 lb ceiling must reach it
    expect(displayCeilingKg(lbToKg(55), 'lb')).toBeGreaterThanOrEqual(25);
    // 65 lb of iron = 29.4835 kg reads 29.48 kg; the 29.48 kg ceiling must reach it
    expect(displayCeilingKg(29.48, 'kg')).toBeGreaterThanOrEqual(lbToKg(65));
  });

  it('passes a non-finite Target through untouched', () => {
    expect(displayCeilingKg(Number.NaN, 'kg')).toBeNaN();
    expect(displayCeilingKg(Infinity, 'lb')).toBe(Infinity);
  });
});

// RBAR-87: Warm up rounds its Working set up only when the load reads SHORT of the
// Target, so it needs the bottom of the reading's bucket as well as the top.
describe('displayFloorKg (RBAR-87)', () => {
  const cases: [number, 'kg' | 'lb'][] = [
    [lbToKg(146), 'lb'],
    [lbToKg(55), 'lb'],
    [lbToKg(313), 'lb'],
    [29.48, 'kg'],
    [100, 'kg'],
    [61.234, 'kg'],
  ];

  it('never raises the Target and still reads the same as it', () => {
    for (const [kg, unit] of cases) {
      const bottom = displayFloorKg(kg, unit);
      expect(bottom, `${kg} ${unit}`).toBeLessThanOrEqual(kg);
      expect(shownIn(bottom, unit), `${kg} ${unit}`).toBe(shownIn(kg, unit));
    }
  });

  it('is the bottom of the bucket: a hair below it reads differently', () => {
    for (const [kg, unit] of cases) {
      const bottom = displayFloorKg(kg, unit);
      const hair = unit === 'lb' ? lbToKg(1e-6) : 1e-6;
      expect(shownIn(bottom - hair, unit), `${kg} ${unit}`).not.toBe(shownIn(kg, unit));
    }
  });

  it('reaches the real load a reading stands for: 66 kg reads 146 lb', () => {
    expect(66).toBeLessThan(lbToKg(146));
    expect(displayFloorKg(lbToKg(146), 'lb')).toBeLessThanOrEqual(66);
  });

  it('passes a non-finite Target through untouched', () => {
    expect(displayFloorKg(Number.NaN, 'kg')).toBeNaN();
    expect(displayFloorKg(Infinity, 'lb')).toBe(Infinity);
  });
});
