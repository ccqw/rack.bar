import { describe, it, expect } from 'vitest';
import {
  BUMPER_MM,
  DISC_GAP_PX,
  DISC_INK,
  END_GAP_PX,
  MAX_SCALE,
  MIN_DISC_PX,
  SLEEVE_BLOCK_PX,
  SLEEVE_PAD_PX,
  TARGET_BUMPER_PX,
  darkInk,
  fitRow,
  plateLabel,
  rowWidthAt,
  sleeveFit,
  sleeveLayout,
} from './sleevefit.ts';
import type { SleevePart } from './sleevefit.ts';
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

describe('sleeveFit (the host fit <rack-sleeve> and the share picture share)', () => {
  it('a tall host keeps full zoom; a short host lowers the cap by the bumper height', () => {
    expect(sleeveFit([eleiko(25)], 360, SLEEVE_BLOCK_PX).scale).toBe(MAX_SCALE);
    const short = sleeveFit([eleiko(25)], 360, 84);
    expect(short.scale).toBeCloseTo((84 - SLEEVE_PAD_PX) / BUMPER_MM, 9);
  });

  it('an unmeasured height (0) leaves the cap at full zoom', () => {
    expect(sleeveFit([eleiko(25)], 360, 0).scale).toBe(MAX_SCALE);
  });
});

describe('sleeveLayout (one Side, as the sleeve lays it out)', () => {
  const side = [eleiko(25), eleiko(25), eleiko(10), eleiko(1)];
  const W = 360;
  const H = SLEEVE_BLOCK_PX;
  const right = (p: SleevePart) => p.x + p.w;

  it('orders shaft, inner collar, discs heaviest-first, end collar, cap', () => {
    expect(sleeveLayout(side, W, H).map((p) => p.kind)).toEqual([
      'shaft', 'collar-inner', 'disc', 'disc', 'disc', 'disc', 'collar-end', 'cap',
    ]);
    expect(
      sleeveLayout(side, W, H).filter((p) => p.plate).map((p) => p.plate!.kg),
    ).toEqual([25, 25, 10, 1]);
  });

  it('centres the row in the host on both axes', () => {
    const parts = sleeveLayout(side, W, H);
    const l = parts[0]!.x;
    const r = right(parts[parts.length - 1]!);
    expect(l).toBeCloseTo(W - r, 9);
    for (const p of parts) expect(p.y + p.h / 2).toBeCloseTo(H / 2, 9);
  });

  it('spaces the pieces with the sleeve gaps: flush collar, 1.5px between discs, 3px before the end collar', () => {
    const parts = sleeveLayout(side, W, H);
    expect(parts[2]!.x).toBeCloseTo(right(parts[1]!), 9);
    expect(parts[3]!.x - right(parts[2]!)).toBeCloseTo(DISC_GAP_PX, 9);
    expect(parts[6]!.x - right(parts[5]!)).toBeCloseTo(END_GAP_PX, 9);
    expect(parts[1]!.x).toBeCloseTo(right(parts[0]!), 9);
  });

  it('sizes discs at the sleeveFit scale: a full-zoom bumper is 168px, the 25 fatter than the 10', () => {
    const d = sleeveLayout(side, W, H).filter((p) => p.kind === 'disc');
    expect(d[0]!.h).toBeCloseTo(TARGET_BUMPER_PX, 9);
    expect(d[0]!.w).toBeCloseTo(58 * MAX_SCALE, 9);
    expect(d[2]!.h).toBeCloseTo(d[0]!.h, 9);
    expect(d[0]!.w).toBeGreaterThan(d[2]!.w);
  });

  it('carries the sleeve numeral buckets', () => {
    const d = sleeveLayout([eleiko(25), eleiko(0.5)], W, H).filter((p) => p.kind === 'disc');
    expect(d[0]!.numeral).toEqual({ px: 11, text: '25' });
    expect(d[1]!.numeral).toEqual({ px: 8, text: '.5' });
  });

  it('draws a bare Bar as the empty box, 5px off the inner collar', () => {
    const parts = sleeveLayout([], W, H);
    expect(parts.map((p) => p.kind)).toEqual([
      'shaft', 'collar-inner', 'empty', 'collar-end', 'cap',
    ]);
    expect(parts[2]!.x - right(parts[1]!)).toBeCloseTo(5, 9);
    expect(parts[2]!.h).toBeCloseTo(120, 9); // the 120px box at full zoom
  });

  it('a full sleeve zooms out to fit the host width', () => {
    const wall = Array(7).fill(eleiko(25));
    const parts = sleeveLayout(wall, W, H);
    expect(parts[0]!.x).toBeGreaterThanOrEqual(-1e-9);
    expect(right(parts[parts.length - 1]!)).toBeLessThanOrEqual(W + 1e-9);
  });
});

describe('DISC_INK', () => {
  it('dark ink only on the light Plates', () => {
    expect(['white', 'yellow', 'red', 'blue', 'green', 'iron'].map((c) => darkInk(c as never))).toEqual([
      true, true, false, false, false, false,
    ]);
    // The prototype's plateInk (L416) is the accent ink, #0d0e10 (RBAR-74).
    expect(DISC_INK.dark).toBe('#0d0e10');
  });
});

describe('plateLabel', () => {
  it('drops the leading zero on sub-1 kg Plates and keeps iron stamps', () => {
    expect(plateLabel(eleiko(0.5))).toBe('.5');
    expect(plateLabel(eleiko(2.5))).toBe('2.5');
    expect(plateLabel(IRON_LB[0]!)).toBe('45');
  });
});
