// Example tests for the Warm up fullscreen view model (RBAR-85): how one Ramp row reads
// from a meter away, and where a swipe goes.
import { describe, it, expect } from 'vitest';
import { planEasyRamp } from './moves.ts';
import { DEFAULT_RAMP } from './plan.ts';
import type { RampRig } from './plan.ts';
import { ELEIKO_KG, IRON_LB } from './plates.ts';
import { lbToKg } from './units.ts';
import { warmupView } from './warmup.ts';
import {
  SWIPE_MIN_PX,
  setLabel,
  swipeDirection,
  swipeIndex,
  warmupFullscreenView,
} from './warmupfullscreen.ts';

const COMP: RampRig = { barKg: 20, collarKg: 0, inventory: ELEIKO_KG };
const IRON: RampRig = { barKg: lbToKg(45), collarKg: 0, inventory: IRON_LB };

// 115 kg by the station rule: 20 / 57 (15+2+1.5) / 80 (15+15) / 103 (15+15+10+1.5) /
// 115 (15+15+10+5+2.5).
const RAMP115 = planEasyRamp(115, DEFAULT_RAMP, COMP).rows;

describe('setLabel: the set name, step then Total', () => {
  it('reads "70% - 80 kg", "Bar - 20 kg", "Work - 115 kg"', () => {
    expect(RAMP115.map((r) => setLabel(r, 'kg'))).toEqual([
      'Bar - 20 kg',
      '50% - 57 kg',
      '70% - 80 kg',
      '90% - 103 kg',
      'Work - 115 kg',
    ]);
  });
  it('reads the Total in the display Unit', () => {
    expect(setLabel(RAMP115[2], 'lb')).toBe('70% - 176 lb');
  });
});

describe('warmupFullscreenView', () => {
  it('reads the 70% set: its name, the moves line, and a live Next to 90%', () => {
    expect(warmupFullscreenView(RAMP115, 2, 'kg', 'kg')).toEqual({
      index: 2,
      count: 5,
      label: '70% - 80 kg',
      reps: null,
      moves: 'off 1.5 + 2, on 15 kg',
      next: { live: true, to: 3, label: '90% - 103 kg' },
    });
  });
  it('the bare Bar has no moves line and carries its reps', () => {
    const v = warmupFullscreenView(RAMP115, 0, 'kg', 'kg');
    expect(v.label).toBe('Bar - 20 kg');
    expect(v.moves).toBeNull();
    expect(v.reps).toBe(7);
    expect(v.next).toEqual({ live: true, to: 1, label: '50% - 57 kg' });
  });
  it('on the Work set Next is not live and names nothing', () => {
    const v = warmupFullscreenView(RAMP115, 4, 'kg', 'kg');
    expect(v.label).toBe('Work - 115 kg');
    expect(v.moves).toBe('off 1.5, on 5 + 2.5 kg');
    expect(v.next).toEqual({ live: false, to: null, label: null });
  });
  it('clamps the selection into the rows, as warmupView does', () => {
    expect(warmupFullscreenView(RAMP115, -3, 'kg', 'kg').index).toBe(0);
    expect(warmupFullscreenView(RAMP115, 99, 'kg', 'kg').index).toBe(4);
    expect(warmupFullscreenView(RAMP115, 99, 'kg', 'kg').index).toBe(warmupView(RAMP115, 99, 'kg', 'kg').selected);
  });
  it('a pound Ramp reads its Totals in lb and its moves by the iron faces', () => {
    const rows = planEasyRamp(lbToKg(225), DEFAULT_RAMP, IRON, { ceilingKg: lbToKg(225.4) }).rows;
    const v = warmupFullscreenView(rows, rows.length - 1, 'lb', 'lb');
    expect(v.label).toBe('Work - 225 lb');
    expect(v.moves).toMatch(/ lb$/);
  });
  it('an empty Ramp is a caller error', () => {
    expect(() => warmupFullscreenView([], 0, 'kg', 'kg')).toThrow(RangeError);
  });
  it('a one-row Ramp (only the Working set) has no live Next', () => {
    const rows = planEasyRamp(115, [], COMP).rows;
    expect(warmupFullscreenView(rows, 0, 'kg', 'kg').next.live).toBe(false);
  });
});

describe('swipeDirection: a horizontal drag past the threshold', () => {
  it('reads a left or right drag of at least SWIPE_MIN_PX', () => {
    expect(swipeDirection(-SWIPE_MIN_PX, 0)).toBe('left');
    expect(swipeDirection(SWIPE_MIN_PX, 5)).toBe('right');
  });
  it('ignores a short drag, a mostly vertical one, and a non-finite one', () => {
    expect(swipeDirection(SWIPE_MIN_PX - 1, 0)).toBeNull();
    expect(swipeDirection(60, 80)).toBeNull();
    expect(swipeDirection(Number.NaN, 0)).toBeNull();
    expect(swipeDirection(60, Number.POSITIVE_INFINITY)).toBeNull();
    expect(swipeDirection(60, -60)).toBeNull(); // a diagonal tie is not sideways

  });
});

describe('swipeIndex: left goes forward, right goes back, stopping at the ends', () => {
  it('walks the Ramp', () => {
    expect(swipeIndex(2, 'left', 5)).toBe(3);
    expect(swipeIndex(2, 'right', 5)).toBe(1);
    expect(swipeIndex(4, 'left', 5)).toBe(4);
    expect(swipeIndex(0, 'right', 5)).toBe(0);
  });
});
