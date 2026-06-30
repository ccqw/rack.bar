import { describe, it, expect } from 'vitest';
import {
  PLATE_SETS,
  PLATE_SET_KEYS,
  plateSetFor,
  isOfferedPlateSet,
} from './platesets.ts';
import { ELEIKO_KG, IRON_LB } from './plates.ts';
import { lbToKg } from './units.ts';

describe('plate sets (RBAR-17, ADR-0010)', () => {
  it('offers exactly Competition and Training', () => {
    expect(PLATE_SET_KEYS).toEqual(['comp', 'training']);
  });

  it('bundles the Competition set: Eleiko, kg, free toggle, kg Bars, default 20 kg', () => {
    const comp = PLATE_SETS.comp;
    expect(comp.unit).toBe('kg');
    expect(comp.unitLocked).toBe(false); // a kg bar may still be read in lb
    expect(comp.inventory).toBe(ELEIKO_KG);
    expect(comp.bars).toEqual([20, 15, 5]);
    expect(comp.defaultBarKg).toBe(20);
    expect(comp.label).toBe('Competition');
    expect(comp.shortLabel).toBe('Comp'); // the compact header-pill caption (RBAR-30)
  });

  it('bundles the Training set: iron, lb-locked, a single 45 lb Bar', () => {
    const tr = PLATE_SETS.training;
    expect(tr.unit).toBe('lb');
    expect(tr.unitLocked).toBe(true); // an iron rack is lb-only
    expect(tr.inventory).toBe(IRON_LB);
    expect(tr.bars).toEqual([lbToKg(45)]);
    expect(tr.defaultBarKg).toBe(lbToKg(45));
    expect(tr.label).toBe('Training');
    expect(tr.shortLabel).toBe('Training');
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
