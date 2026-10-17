import { describe, it, expect } from 'vitest';
import { MAX_SCALE, MIN_DISC_PX, fitRow, plateLabel, rowWidthAt } from './sleevefit.ts';
import { ELEIKO_KG, IRON_LB } from './plates.ts';
import type { Plate } from './plates.ts';

const eleiko = (kg: number): Plate => ELEIKO_KG.find((p) => p.kg === kg)!;

describe('fitRow (the sleeve fit, shared with the share image)', () => {
  it('keeps the cap when the row fits', () => {
    expect(fitRow([eleiko(25)], 1000, MAX_SCALE)).toEqual({ scale: MAX_SCALE, shrink: 1 });
  });

  it('zooms out to the largest scale whose floored row fits', () => {
    const side = Array(6).fill(eleiko(25));
    const { scale, shrink } = fitRow(side, 100, MAX_SCALE);
    expect(scale).toBeLessThan(MAX_SCALE);
    expect(shrink).toBe(1);
    expect(rowWidthAt(side, scale)).toBeLessThanOrEqual(100);
    expect(rowWidthAt(side, scale * 1.01)).toBeGreaterThan(100);
  });

  it('shrinks proportionally when even the floored row overflows', () => {
    const side = Array(10).fill(eleiko(0.5)); // 10 x the 9px floor = 90px
    const { shrink } = fitRow(side, 45, MAX_SCALE);
    expect(shrink).toBeCloseTo(0.5, 6);
  });

  it('floors each disc at the minimum (in the caller px)', () => {
    expect(rowWidthAt([eleiko(0.5)], 0.001)).toBe(MIN_DISC_PX);
    expect(rowWidthAt([eleiko(0.5)], 0.001, 18)).toBe(18);
  });

  it('an empty row never divides by zero', () => {
    expect(fitRow([], -10, MAX_SCALE).shrink).toBe(1);
  });
});

describe('plateLabel', () => {
  it('drops the leading zero on sub-1 kg Plates and keeps iron stamps', () => {
    expect(plateLabel(eleiko(0.5))).toBe('.5');
    expect(plateLabel(eleiko(2.5))).toBe('2.5');
    expect(plateLabel(IRON_LB[0]!)).toBe('45');
  });
});
