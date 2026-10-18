import { describe, it, expect } from 'vitest';
import {
  MAX_LIFTS,
  MAX_NAME_LENGTH,
  addMax,
  addRefusal,
  cleanName,
  findMax,
  maxKg,
  maxShown,
  parseMaxes,
  parsePercent,
  percentOfMax,
  removeMax,
  restoreMax,
  serializeMaxes,
  setMax,
} from './maxes.ts';
import type { Max } from './maxes.ts';

const squat: Max = { name: 'Squat', value: 140, unit: 'kg' };
const bench: Max = { name: 'Bench', value: 185, unit: 'lb' };
const FOUR: readonly Max[] = [
  squat,
  { name: 'Bench', value: 85, unit: 'kg' },
  { name: 'Deadlift', value: 170, unit: 'kg' },
  { name: 'Press', value: 55, unit: 'kg' },
];

describe('percentOfMax', () => {
  it('80% of a 140 kg Squat is a 112 kg Target', () => {
    expect(percentOfMax(squat, 80)).toBe(112);
  });

  it('82.5% of 140 kg is 115.5 kg (a Target Decode may miss)', () => {
    expect(percentOfMax(squat, 82.5)).toBe(115.5);
  });

  it('keeps two decimals: 77% of 85 kg is 65.45 kg', () => {
    expect(percentOfMax({ name: 'Bench', value: 85, unit: 'kg' }, 77)).toBe(65.45);
  });

  it('an lb max converts exactly: 80% of 185 lb reads 148 lb', () => {
    const kg = percentOfMax(bench, 80)!;
    expect(kg).toBeCloseTo(148 * 0.45359237, 9);
  });

  it('refuses a percent of 0, below 0, past 150, or not a number', () => {
    for (const p of [0, -5, 150.5, NaN, Infinity]) expect(percentOfMax(squat, p)).toBeNull();
    expect(percentOfMax(squat, 150)).toBe(210);
  });
});

describe('parsePercent', () => {
  it('reads a typed percent, mid-entry decimal included', () => {
    expect(parsePercent('80')).toBe(80);
    expect(parsePercent('82.')).toBe(82);
    expect(parsePercent('82.5')).toBe(82.5);
  });

  it('reads blank, 0 and out-of-range as no percent', () => {
    for (const d of ['', ' ', '0', '0.', '151', 'x']) expect(parsePercent(d)).toBeNull();
  });
});

describe('maxShown', () => {
  it('shows a max in its own Unit as typed', () => {
    expect(maxShown(squat, 'kg')).toBe(140);
    expect(maxShown(bench, 'lb')).toBe(185);
  });

  it('converts to one decimal in the other Unit', () => {
    expect(maxShown(squat, 'lb')).toBe(308.6);
    expect(maxShown(bench, 'kg')).toBe(83.9);
  });

  it('maxKg is the canonical weight', () => {
    expect(maxKg(squat)).toBe(140);
    expect(maxKg(bench)).toBeCloseTo(83.91, 2);
  });
});

describe('the maxes registry', () => {
  it('cleans names: trims, collapses spaces, caps the length', () => {
    expect(cleanName('  Front   squat ')).toBe('Front squat');
    expect(cleanName('x'.repeat(30))).toHaveLength(MAX_NAME_LENGTH);
  });

  it('adds at the end, keeping the Unit typed', () => {
    expect(addMax([squat], 'Bench', 185, 'lb')).toEqual([squat, bench]);
  });

  it('refuses a blank name, a bad value, a taken name (any case), and a seventh lift', () => {
    expect(addRefusal([], ' ', 100)).toBe('name');
    expect(addRefusal([], 'Squat', 0)).toBe('value');
    expect(addRefusal([squat], 'squat', 100)).toBe('taken');
    const six = [...FOUR, { name: 'Clean', value: 100, unit: 'kg' as const }, { name: 'Snatch', value: 80, unit: 'kg' as const }];
    expect(six).toHaveLength(MAX_LIFTS);
    expect(addRefusal(six, 'Jerk', 100)).toBe('full');
    expect(addMax(six, 'Jerk', 100, 'kg')).toEqual(six);
  });

  it('a new PR retypes the value and its Unit, keeping the name and slot', () => {
    expect(setMax(FOUR, 0, 145, 'kg')[0]).toEqual({ name: 'Squat', value: 145, unit: 'kg' });
    expect(setMax(FOUR, 0, 320, 'lb')[0]).toEqual({ name: 'Squat', value: 320, unit: 'lb' });
    expect(setMax(FOUR, 9, 145, 'kg')).toEqual(FOUR);
    expect(setMax(FOUR, 0, 0, 'kg')).toEqual(FOUR);
  });

  it('remove then restore puts the lift back in its slot', () => {
    const gone = removeMax(FOUR, 3);
    expect(gone.map((m) => m.name)).toEqual(['Squat', 'Bench', 'Deadlift']);
    expect(restoreMax(gone, FOUR[3], 3)).toEqual(FOUR);
    expect(restoreMax(FOUR, FOUR[3], 0)).toEqual(FOUR); // never duplicates
  });

  it('finds a lift by name, any case', () => {
    expect(findMax(FOUR, 'deadlift')).toBe(2);
    expect(findMax(FOUR, 'Clean')).toBe(-1);
  });
});

describe('parseMaxes', () => {
  it('reads what serializeMaxes wrote', () => {
    const list = [squat, bench, { name: 'Front squat', value: 102.5, unit: 'kg' as const }];
    expect(parseMaxes(serializeMaxes(list))).toEqual(list);
  });

  it('reads nothing, junk and non-arrays as no maxes', () => {
    for (const raw of [null, '', 'not json', '{}', '42', 'null']) expect(parseMaxes(raw)).toEqual([]);
  });

  it('drops bad entries, keeps the first of a repeated name, caps at six', () => {
    const raw = JSON.stringify([
      { name: 'Squat', value: 140, unit: 'kg' },
      { name: 'squat', value: 150, unit: 'kg' },
      { name: '', value: 100, unit: 'kg' },
      { name: 'Bench', value: -1, unit: 'kg' },
      { name: 'Press', value: 55, unit: 'st' },
      { name: 'A', value: 1, unit: 'kg' },
      { name: 'B', value: 2, unit: 'kg' },
      { name: 'C', value: 3, unit: 'kg' },
      { name: 'D', value: 4, unit: 'kg' },
      { name: 'E', value: 5, unit: 'kg' },
      { name: 'F', value: 6, unit: 'kg' },
    ]);
    expect(parseMaxes(raw).map((m) => m.name)).toEqual(['Squat', 'A', 'B', 'C', 'D', 'E']);
  });
});
