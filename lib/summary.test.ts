import { describe, it, expect } from 'vitest';
import { configText, groupSide, groupText, loadingSummary, loadTotalKg } from './summary.ts';
import { ELEIKO_KG, IRON_LB } from './plates.ts';
import type { Plate } from './plates.ts';
import { lbToKg } from './units.ts';

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

describe('groupText', () => {
  // Prototype L888: the count ALWAYS shows, including a single ('1x 25'), so a
  // glance never has to infer whether a bare face means one Plate (RBAR-44).
  it('labels a single Plate with its count too', () => {
    expect(groupText({ face: '25', color: 'red', count: 1 })).toBe('1x 25');
  });

  it('labels a run as N x face', () => {
    expect(groupText({ face: '25', color: 'red', count: 2 })).toBe('2x 25');
  });
});

describe('configText', () => {
  // Prototype L891: '{kg} kg / {lb} lb bar - {setName}' -- the Bar always reads in
  // BOTH Units, and the plate-set name rides the config line (RBAR-44).
  it('names the Bar in both Units plus the plate set', () => {
    expect(configText(20, 0, 'Competition')).toBe('20 kg / 44 lb bar - Competition');
  });

  it('appends the Collars when fitted (in-house addition kept)', () => {
    expect(configText(20, 2.5, 'Competition')).toBe(
      '20 kg / 44 lb bar, collars 2.5 kg - Competition',
    );
  });

  it('reads an iron Bar dual-unit too (whole-lb side exact)', () => {
    expect(configText(lbToKg(45), 0, 'Training')).toBe('20.41 kg / 45 lb bar - Training');
  });
});

describe('loadingSummary', () => {
  // Prototype L906 (RBAR-44): line 1 'rack.bar - {total} {unit}', line 2 the per-Side
  // groups with counts always, line 3 the same config caption the card shows.
  it('is three lines: wordmark + Total, per-Side, config', () => {
    const text = loadingSummary(
      {
        side: [eleiko(25), eleiko(15)],
        barKg: 20,
        collarKg: 0,
        unit: 'kg',
      },
      'Competition',
    );
    const lines = text.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('rack.bar - 100 kg');
    expect(lines[1]).toBe('Per side: 1x 25  1x 15');
    expect(lines[2]).toBe('20 kg / 44 lb bar - Competition');
  });

  it('groups repeated Plates, counts always, on the per-Side line', () => {
    const text = loadingSummary(
      {
        side: [eleiko(25), eleiko(25), eleiko(2.5)],
        barKg: 20,
        collarKg: 0,
        unit: 'kg',
      },
      'Competition',
    );
    expect(text.split('\n')[1]).toBe('Per side: 2x 25  1x 2.5');
  });

  it('names the Collars on the config line when fitted', () => {
    const text = loadingSummary(
      {
        side: [eleiko(25), eleiko(15)],
        barKg: 20,
        collarKg: 2.5,
        unit: 'kg',
      },
      'Competition',
    );
    expect(text.split('\n')[2]).toBe('20 kg / 44 lb bar, collars 2.5 kg - Competition');
  });

  it('reads the Total in the display Unit; the config line is dual-unit regardless', () => {
    const text = loadingSummary(
      {
        side: [eleiko(25), eleiko(15)],
        barKg: 20,
        collarKg: 0,
        unit: 'lb',
      },
      'Competition',
    );
    expect(text.split('\n')[0]).toBe('rack.bar - 220 lb');
    expect(text.split('\n')[2]).toBe('20 kg / 44 lb bar - Competition');
  });

  it('bare bar: the per-Side line says no plates', () => {
    const text = loadingSummary(
      {
        side: [],
        barKg: 20,
        collarKg: 0,
        unit: 'kg',
      },
      'Competition',
    );
    const lines = text.split('\n');
    expect(lines[0]).toBe('rack.bar - 20 kg');
    expect(lines[1]).toBe('Bare bar - no plates');
    expect(lines[2]).toBe('20 kg / 44 lb bar - Competition');
  });
});

describe('loadTotalKg', () => {
  it('derives the Total from the rig + Side Load (Bar + 2 x Side Load)', () => {
    expect(loadTotalKg({ side: [eleiko(25), eleiko(15)], barKg: 20, collarKg: 0, unit: 'kg' })).toBe(100);
  });

  it('folds the Collars into the baseline (Bar + 2 x Collar + 2 x Side Load)', () => {
    expect(loadTotalKg({ side: [eleiko(25), eleiko(15)], barKg: 20, collarKg: 2.5, unit: 'kg' })).toBe(105);
  });

  it('a bare Bar Totals to the Bar', () => {
    expect(loadTotalKg({ side: [], barKg: 20, collarKg: 0, unit: 'kg' })).toBe(20);
  });
});
