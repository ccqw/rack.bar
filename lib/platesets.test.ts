import { describe, it, expect } from 'vitest';
import {
  PLATE_SETS,
  PLATE_SET_KEYS,
  plateSetFor,
  isOfferedPlateSet,
  barUnit,
  offeredBarKgs,
} from './platesets.ts';
import { ELEIKO_KG, IRON_LB } from './plates.ts';
import { lbToKg } from './units.ts';

describe('plate sets (RBAR-17, ADR-0010)', () => {
  it('offers exactly Competition and Training', () => {
    expect(PLATE_SET_KEYS).toEqual(['comp', 'training']);
  });

  it('bundles the Competition set: Eleiko, kg, kg Bars, default 20 kg', () => {
    const comp = PLATE_SETS.comp;
    expect(comp.unit).toBe('kg');
    expect(comp.inventory).toBe(ELEIKO_KG);
    expect(comp.bars).toEqual([
      { kg: 20, unit: 'kg' },
      { kg: 15, unit: 'kg' },
      { kg: 5, unit: 'kg' },
    ]);
    expect(comp.defaultBarKg).toBe(20);
    expect(comp.label).toBe('Competition');
    expect(comp.shortLabel).toBe('Comp'); // the compact header-pill caption (RBAR-30)
  });

  it('bundles the Training set: iron, stamped in lb, a 45 lb and a 20 kg Bar', () => {
    const tr = PLATE_SETS.training;
    expect(tr.unit).toBe('lb');
    expect(tr.inventory).toBe(IRON_LB);
    // RBAR-63: many bars sold as "45 lb" are really 20 kg; each Bar is labelled in
    // the unit it is stamped in, not the set's, so the 20 kg Bar never reads "44 lb".
    expect(tr.bars).toEqual([
      { kg: lbToKg(45), unit: 'lb' },
      { kg: 20, unit: 'kg' },
    ]);
    expect(tr.defaultBarKg).toBe(lbToKg(45));
    expect(tr.label).toBe('Training');
    expect(tr.shortLabel).toBe('Training');
  });

  it('defaults every set to its first offered Bar', () => {
    for (const key of PLATE_SET_KEYS) {
      expect(PLATE_SETS[key].defaultBarKg).toBe(PLATE_SETS[key].bars[0].kg);
    }
  });

  it('names a Bar in its own stamped unit, falling back to the set unit', () => {
    expect(barUnit(PLATE_SETS.training, 20)).toBe('kg');
    expect(barUnit(PLATE_SETS.training, lbToKg(45))).toBe('lb');
    expect(barUnit(PLATE_SETS.comp, 15)).toBe('kg');
    // an off-menu Bar (never adopted, but must not throw) reads in the set's unit
    expect(barUnit(PLATE_SETS.training, 15)).toBe('lb');
  });

  it('lists the offered Bar weights for boundary validation', () => {
    expect(offeredBarKgs(PLATE_SETS.comp)).toEqual([20, 15, 5]);
    expect(offeredBarKgs(PLATE_SETS.training)).toEqual([lbToKg(45), 20]);
  });

  it('resolves a set by key, defaulting an unknown key to Competition', () => {
    expect(plateSetFor('training')).toBe(PLATE_SETS.training);
    expect(plateSetFor('comp')).toBe(PLATE_SETS.comp);
    // A corrupt/legacy persisted key must not strand the lifter (ADR-0007 pattern).
    expect(plateSetFor('bogus')).toBe(PLATE_SETS.comp);
  });

  it('guards the offered set for the shell boundary', () => {
    expect(isOfferedPlateSet('comp')).toBe(true);
    expect(isOfferedPlateSet('training')).toBe(true);
    expect(isOfferedPlateSet('bogus')).toBe(false);
  });
});
