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
