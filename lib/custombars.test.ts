import { describe, it, expect } from 'vitest';
import {
  MAX_CUSTOM_BARS,
  CUSTOM_BAR_MAX,
  isValidStamp,
  parseStampText,
  stampKg,
  stampLabel,
  addCustomBar,
  removeCustomBar,
  restoreCustomBar,
  parseCustomBars,
  serializeCustomBars,
  barsFor,
  barLabel,
  readStamp,
  visibleCustomCount,
  addRefusal,
} from './custombars.ts';
import { PLATE_SETS } from './platesets.ts';
import { lbToKg } from './units.ts';

describe('custom Bar stamps (RBAR-76, ADR-0017)', () => {
  it('caps the list at 3 and the stamp at 50 kg / 110 lb', () => {
    expect(MAX_CUSTOM_BARS).toBe(3);
    expect(CUSTOM_BAR_MAX).toEqual({ kg: 50, lb: 110 });
  });

  it('accepts a stamp above 0, up to the cap, at no more than 2 decimals', () => {
    expect(isValidStamp({ value: 35, unit: 'lb' })).toBe(true);
    expect(isValidStamp({ value: 15.9, unit: 'kg' })).toBe(true);
    expect(isValidStamp({ value: 0.01, unit: 'kg' })).toBe(true);
    expect(isValidStamp({ value: 50, unit: 'kg' })).toBe(true);
    expect(isValidStamp({ value: 110, unit: 'lb' })).toBe(true);
    expect(isValidStamp({ value: 0, unit: 'kg' })).toBe(false);
    expect(isValidStamp({ value: -5, unit: 'kg' })).toBe(false);
    expect(isValidStamp({ value: 50.01, unit: 'kg' })).toBe(false);
    expect(isValidStamp({ value: 110.5, unit: 'lb' })).toBe(false);
    expect(isValidStamp({ value: 7.125, unit: 'kg' })).toBe(false);
    expect(isValidStamp({ value: NaN, unit: 'kg' })).toBe(false);
    expect(isValidStamp({ value: 20, unit: 'st' as 'kg' })).toBe(false);
  });

  it('parses typed text: plain decimals, a comma decimal, surrounding space; nothing else', () => {
    expect(parseStampText('35', 'lb')).toEqual({ value: 35, unit: 'lb' });
    expect(parseStampText(' 15.9 ', 'kg')).toEqual({ value: 15.9, unit: 'kg' });
    expect(parseStampText('15,9', 'kg')).toEqual({ value: 15.9, unit: 'kg' });
    expect(parseStampText('7.50', 'kg')).toEqual({ value: 7.5, unit: 'kg' });
    for (const bad of ['', ' ', '0', '1e1', '0x10', '-5', '7.125', '51', 'abc', '.', '.5x']) {
      expect(parseStampText(bad, 'kg')).toBeNull();
    }
    expect(parseStampText('.5', 'kg')).toEqual({ value: 0.5, unit: 'kg' });
    // A trailing dot is easy to leave on a decimal pad; it reads as the whole number.
    expect(parseStampText('35.', 'lb')).toEqual({ value: 35, unit: 'lb' });
  });

  it('says why an entry fails: its format, too many decimals, or the range', () => {
    expect(readStamp('35', 'lb')).toEqual({ stamp: { value: 35, unit: 'lb' } });
    for (const t of ['', ' ', 'abc', '1e1', '0x10', '-5', '.', '1.2.3', '.5x']) {
      expect(readStamp(t, 'kg')).toEqual({ error: 'format' });
    }
    for (const t of ['35.555', '7.125', '.125']) {
      expect(readStamp(t, 'kg')).toEqual({ error: 'decimals' });
    }
    for (const t of ['0', '0.00', '50.01', '51', '1234']) {
      expect(readStamp(t, 'kg')).toEqual({ error: 'range' });
    }
    expect(readStamp('110', 'lb')).toEqual({ stamp: { value: 110, unit: 'lb' } });
    expect(readStamp('110.01', 'lb')).toEqual({ error: 'range' });
  });

  it('derives kg from the stamp: lb through the exact factor, kg as is', () => {
    expect(stampKg({ value: 35, unit: 'lb' })).toBe(lbToKg(35));
    expect(stampKg({ value: 7, unit: 'kg' })).toBe(7);
  });

  it('labels a Bar by its stamp as typed, never a rounded conversion', () => {
    expect(stampLabel({ value: 35, unit: 'lb' })).toBe('35 lb');
    expect(stampLabel({ value: 15.9, unit: 'kg' })).toBe('15.9 kg');
    expect(stampLabel({ value: 35.5, unit: 'lb' })).toBe('35.5 lb');
  });
});

describe('the custom Bar list (RBAR-76, ADR-0017)', () => {
  const s35 = { value: 35, unit: 'lb' } as const;
  const s7 = { value: 7, unit: 'kg' } as const;
  const s25 = { value: 25, unit: 'kg' } as const;
  const s15 = { value: 15, unit: 'lb' } as const;

  it('adds newest last, skips a duplicate weight, and stops at the cap', () => {
    let list = addCustomBar([], s35);
    list = addCustomBar(list, s7);
    expect(list).toEqual([s35, s7]);
    expect(addCustomBar(list, { value: 35.0, unit: 'lb' })).toEqual([s35, s7]);
    list = addCustomBar(list, s25);
    expect(addCustomBar(list, s15)).toEqual([s35, s7, s25]);
  });

  // The cap counts the custom Bars a set SHOWS (RBAR-76 review): a custom Bar weighing
  // what a set's own Bar weighs is not a tile there, so it takes no slot there -- but
  // no set may ever show more than 3.
  it('caps the custom Bars each set shows, not the stored list', () => {
    const s45 = { value: 45, unit: 'lb' } as const; // Training's own Bar: hidden there
    const list = [s45, s35, s25];
    expect(visibleCustomCount(list, 'comp')).toBe(3);
    expect(visibleCustomCount(list, 'training')).toBe(2);
    // On Training there is room for one more -- unless Competition would then show 4.
    expect(addCustomBar(list, s7)).toBe(list);
    expect(addRefusal(list, s7)).toBe('comp');
    // A Bar Competition offers itself (15 kg) shows only on Training: it fits.
    const s15kg = { value: 15, unit: 'kg' } as const;
    expect(addRefusal(list, s15kg)).toBeNull();
    expect(addCustomBar(list, s15kg)).toEqual([s45, s35, s25, s15kg]);
    expect(addRefusal([s35, s7, s25], s15)).toBe('comp');
  });

  it('ignores an invalid stamp', () => {
    expect(addCustomBar([s7], { value: 0, unit: 'kg' })).toEqual([s7]);
  });

  it('removes by index and restores at that index', () => {
    const list = [s35, s7, s25];
    const removed = removeCustomBar(list, 1);
    expect(removed).toEqual([s35, s25]);
    expect(restoreCustomBar(removed, s7, 1)).toEqual(list);
    expect(removeCustomBar(list, 9)).toEqual(list);
    // A restore never breaks the rules: a duplicate or a full list is left alone.
    expect(restoreCustomBar(list, s15, 0)).toEqual(list);
    expect(restoreCustomBar([s7], s7, 0)).toEqual([s7]);
  });

  it('round-trips through storage', () => {
    const list = [s35, { value: 15.9, unit: 'kg' as const }];
    expect(parseCustomBars(serializeCustomBars(list))).toEqual(list);
  });

  it('reads a missing or corrupt key as no custom Bars, never throwing (ADR-0007)', () => {
    for (const raw of [null, '', '{', 'null', '42', '{"value":35}', '"35lb"']) {
      expect(parseCustomBars(raw)).toEqual([]);
    }
  });

  it('drops bad entries, duplicates and the overflow from a stored list', () => {
    const raw = JSON.stringify([
      { value: 35, unit: 'lb' },
      { value: 35, unit: 'lb' },
      { value: 0, unit: 'kg' },
      { value: '7', unit: 'kg' },
      null,
      { value: 7, unit: 'kg', extra: true },
      { value: 25, unit: 'kg' },
      { value: 15, unit: 'lb' },
    ]);
    expect(parseCustomBars(raw)).toEqual([s35, s7, s25]);
  });
});

describe('the Bars Setup offers (RBAR-76, ADR-0017)', () => {
  it('adds the custom Bars after a set\'s own, on every set', () => {
    const customs = [{ value: 35, unit: 'lb' as const }];
    for (const set of Object.values(PLATE_SETS)) {
      const bars = barsFor(set, customs);
      expect(bars.slice(0, set.bars.length)).toEqual(set.bars);
      expect(bars[set.bars.length]).toEqual({ kg: lbToKg(35), unit: 'lb', stamp: 35 });
    }
  });

  it('hides a custom Bar that weighs the same as one the set already offers', () => {
    const customs = [
      { value: 20, unit: 'kg' as const },
      { value: 45, unit: 'lb' as const },
    ];
    expect(barsFor(PLATE_SETS.comp, customs).map((b) => b.kg)).toEqual([20, 15, 5, lbToKg(45)]);
    expect(barsFor(PLATE_SETS.training, customs)).toEqual(PLATE_SETS.training.bars);
  });

  it('names a Bar by its stamp: built-in by its stamped Unit, custom as typed', () => {
    expect(barLabel({ kg: 20, unit: 'kg' })).toBe('20 kg');
    expect(barLabel(PLATE_SETS.training.bars[0])).toBe('45 lb');
    expect(barLabel({ kg: lbToKg(35.5), unit: 'lb', stamp: 35.5 })).toBe('35.5 lb');
  });
});
