import { describe, it, expect } from 'vitest';
import { groupSide, loadingSummary } from './summary.ts';
import { ELEIKO_KG, IRON_LB } from './plates.ts';
import type { Plate } from './plates.ts';

// Pull denominations by kg from a set, so tests read in domain terms.
const eleiko = (kg: number): Plate => {
  const p = ELEIKO_KG.find((x) => x.kg === kg);
  if (!p) throw new Error(`no Eleiko ${kg}`);
  return p;
};
const iron = (label: string): Plate => {
  const p = IRON_LB.find((x) => x.label === label);
  if (!p) throw new Error(`no iron ${label}`);
  return p;
};

describe('groupSide', () => {
  it('folds a heaviest-first Side Load into count x face groups', () => {
    const side = [eleiko(25), eleiko(25), eleiko(15), eleiko(2.5)];
    expect(groupSide(side)).toEqual([
      { face: '25', color: 'red', count: 2 },
      { face: '15', color: 'yellow', count: 1 },
      { face: '2.5', color: 'red', count: 1 },
    ]);
  });

  it('uses the Plate stamp (label) for iron, its kg for Eleiko', () => {
    expect(groupSide([iron('45'), iron('45'), iron('25')])).toEqual([
      { face: '45', color: 'iron', count: 2 },
      { face: '25', color: 'iron', count: 1 },
    ]);
  });

  it('an empty Side Load groups to nothing', () => {
    expect(groupSide([])).toEqual([]);
  });
});

describe('loadingSummary', () => {
  it('is three lines: wordmark + Total (secondary), per-Side, config', () => {
    const text = loadingSummary({
      totalKg: 100,
      side: [eleiko(25), eleiko(15)],
      barKg: 20,
      collarKg: 0,
      unit: 'kg',
    });
    const lines = text.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('rack.bar 100 kg (220 lb)');
    expect(lines[1]).toBe('Per side: 25, 15');
    expect(lines[2]).toBe('Bar 20 kg');
  });

  it('groups repeated Plates as N x face on the per-Side line', () => {
    const text = loadingSummary({
      totalKg: 110,
      side: [eleiko(25), eleiko(25), eleiko(2.5)],
      barKg: 20,
      collarKg: 0,
      unit: 'kg',
    });
    expect(text.split('\n')[1]).toBe('Per side: 2x 25, 2.5');
  });

  it('names the Collars on the config line when fitted', () => {
    const text = loadingSummary({
      totalKg: 105,
      side: [eleiko(25), eleiko(15)],
      barKg: 20,
      collarKg: 2.5,
      unit: 'kg',
    });
    expect(text.split('\n')[2]).toBe('Bar 20 kg, collars 2.5 kg');
  });

  it('reads the Total and config in the display Unit, secondary in the other', () => {
    const text = loadingSummary({
      totalKg: 100,
      side: [eleiko(25), eleiko(15)],
      barKg: 20,
      collarKg: 0,
      unit: 'lb',
    });
    expect(text.split('\n')[0]).toBe('rack.bar 220 lb (100 kg)');
    expect(text.split('\n')[2]).toBe('Bar 44 lb');
  });

  it('bare bar: the per-Side line says no plates', () => {
    const text = loadingSummary({
      totalKg: 20,
      side: [],
      barKg: 20,
      collarKg: 0,
      unit: 'kg',
    });
    const lines = text.split('\n');
    expect(lines[0]).toBe('rack.bar 20 kg (44 lb)');
    expect(lines[1]).toBe('Bare bar - no plates');
    expect(lines[2]).toBe('Bar 20 kg');
  });
});
