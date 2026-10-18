import { describe, it, expect } from 'vitest';
import {
  MAX_RECENTS,
  pushRecent,
  parseRecents,
  parseTarget,
  removeRecent,
  restoreRecent,
} from './recents.ts';
import { lbToKg } from './units.ts';
import { MAX_TARGET_KG } from './link.ts';

describe('pushRecent', () => {
  it('adds a Target to the front (most-recent-first)', () => {
    expect(pushRecent([100, 80], 120)).toEqual([120, 100, 80]);
  });

  it('starts an empty history', () => {
    expect(pushRecent([], 100)).toEqual([100]);
  });

  it('dedupes: re-pushing an existing Target moves it to the front, no duplicate', () => {
    expect(pushRecent([100, 80, 60], 80)).toEqual([80, 100, 60]);
  });

  it('re-pushing the most-recent Target is a no-op on order', () => {
    expect(pushRecent([100, 80], 100)).toEqual([100, 80]);
  });

  it('caps the list at MAX_RECENTS, dropping the oldest', () => {
    const full = [60, 50, 40, 30, 20, 10]; // already MAX_RECENTS (6)
    expect(pushRecent(full, 70)).toEqual([70, 60, 50, 40, 30, 20]);
    expect(pushRecent(full, 70)).toHaveLength(MAX_RECENTS);
  });

  it('dedup before cap: re-pushing a held Target never grows the list past the cap', () => {
    const full = [60, 50, 40, 30, 20, 10];
    expect(pushRecent(full, 20)).toEqual([20, 60, 50, 40, 30, 10]);
    expect(pushRecent(full, 20)).toHaveLength(MAX_RECENTS);
  });

  it('keeps a fractional Target distinct (142.5 != 142)', () => {
    expect(pushRecent([142], 142.5)).toEqual([142.5, 142]);
  });

  it('ignores a non-finite or non-positive Target (never persisted as a chip)', () => {
    expect(pushRecent([100], NaN)).toEqual([100]);
    expect(pushRecent([100], Infinity)).toEqual([100]);
    expect(pushRecent([100], 0)).toEqual([100]);
    expect(pushRecent([100], -20)).toEqual([100]);
  });

  it('ignores a positive Target that rounds to 0 at stored precision (RBAR-62)', () => {
    // Found by the RBAR-62 property suite: 0.004 is > 0 but stores as 0, which would
    // put a "0 kg" chip in the row (and parseRecents would then drop it on reload).
    expect(pushRecent([100], 0.004)).toEqual([100]);
    expect(pushRecent([100], 5e-324)).toEqual([100]);
    expect(pushRecent([100], 0.005)).toEqual([0.01, 100]); // rounds up: a real chip
  });

  it('does not mutate the input list', () => {
    const original = [100, 80];
    pushRecent(original, 120);
    expect(original).toEqual([100, 80]);
  });

  it('normalizes a Target to two decimals (stored == displayed == dedupe key)', () => {
    expect(pushRecent([], 60.123)).toEqual([60.12]);
    // An incoming Target that rounds onto a held (already-normalized) one dedupes to a
    // single chip rather than a second look-alike -- every entry passes through here, so
    // the list is always normalized and the dedupe key matches the displayed value.
    expect(pushRecent([60.12], 60.124)).toEqual([60.12]);
  });
});

describe('parseRecents', () => {
  it('round-trips a serialized list', () => {
    expect(parseRecents(JSON.stringify([120, 100, 80]))).toEqual([120, 100, 80]);
  });

  it('reads null (nothing persisted) as an empty history', () => {
    expect(parseRecents(null)).toEqual([]);
  });

  it('reads malformed JSON as an empty history (never throws)', () => {
    expect(parseRecents('not json')).toEqual([]);
  });

  it('reads a non-array payload as an empty history', () => {
    expect(parseRecents(JSON.stringify({ a: 1 }))).toEqual([]);
    expect(parseRecents(JSON.stringify(42))).toEqual([]);
  });

  it('drops non-finite, non-positive, and non-number entries', () => {
    expect(parseRecents(JSON.stringify([100, 'x', null, 0, -5, 80]))).toEqual([
      100, 80,
    ]);
  });

  it('drops an entry that rounds to 0 at stored precision (RBAR-62)', () => {
    expect(parseRecents(JSON.stringify([100, 0.001, 5e-324, 80]))).toEqual([100, 80]);
  });

  it('dedupes and caps a corrupt over-long / duplicate-laden payload', () => {
    const raw = JSON.stringify([10, 10, 9, 8, 7, 6, 5, 4, 3]);
    const parsed = parseRecents(raw);
    expect(parsed).toEqual([10, 9, 8, 7, 6, 5]);
    expect(parsed).toHaveLength(MAX_RECENTS);
  });
});

describe('removeRecent (RBAR-73)', () => {
  it('drops just that Target, keeping the rest in order', () => {
    expect(removeRecent([120, 100, 80], 100)).toEqual([120, 80]);
  });

  it('matches at stored precision (the chip data value finds its entry)', () => {
    expect(removeRecent([60.55, 40], 60.554)).toEqual([40]);
  });

  it('returns an equal list when the Target is not held, and never mutates', () => {
    const list = Object.freeze([120, 100]);
    expect(removeRecent(list, 90)).toEqual([120, 100]);
    expect(list).toEqual([120, 100]);
  });

  it('removing the only Target leaves an empty history', () => {
    expect(removeRecent([100], 100)).toEqual([]);
  });
});

describe('restoreRecent (RBAR-73 Undo)', () => {
  it('puts a removed Target back in place', () => {
    const list = [120, 100, 80];
    expect(restoreRecent(removeRecent(list, 100), 100, 1)).toEqual(list);
    expect(restoreRecent(removeRecent(list, 120), 120, 0)).toEqual(list);
    expect(restoreRecent(removeRecent(list, 80), 80, 2)).toEqual(list);
  });

  it('clamps an out-of-range index to the front or back', () => {
    expect(restoreRecent([120, 80], 100, -3)).toEqual([100, 120, 80]);
    expect(restoreRecent([120, 80], 100, 99)).toEqual([120, 80, 100]);
    expect(restoreRecent([], 100, 4)).toEqual([100]);
  });

  it('never duplicates a Target the row already holds', () => {
    expect(restoreRecent([100, 120], 100, 1)).toEqual([100, 120]);
  });

  it('ignores a non-loadable Target', () => {
    expect(restoreRecent([100], NaN, 0)).toEqual([100]);
    expect(restoreRecent([100], 0, 0)).toEqual([100]);
    expect(restoreRecent([100], 0.004, 0)).toEqual([100]);
  });

  it('keeps the cap', () => {
    const full = [60, 50, 40, 30, 20, 10];
    expect(restoreRecent(full, 70, 0)).toEqual([70, 60, 50, 40, 30, 20]);
    expect(restoreRecent(full, 70, 0)).toHaveLength(MAX_RECENTS);
  });
});

describe('parseTarget (rackbar.target and legacy rackbar.working read validation, RBAR-87, ADR-0007)', () => {
  it('reads a positive finite kg weight back at full precision', () => {
    expect(parseTarget('140')).toBe(140);
    expect(parseTarget('142.88')).toBe(142.88);
    // An lb Target is an irrational-looking kg: String() round-trips it exactly.
    expect(parseTarget(String(lbToKg(309)))).toBe(lbToKg(309));
  });

  it('reads missing, blank, garbage, zero, negative and non-finite values as no Target', () => {
    for (const raw of [null, '', '  ', 'abc', '0', '-5', 'Infinity', 'NaN', '1e999']) {
      expect(parseTarget(raw)).toBeNull();
    }
  });

  it('reads only a plain decimal the app could have written, within the Target cap', () => {
    // Number() would take these (0x8C is 140); the field would then show "1e+300".
    for (const raw of ['0x8C', '1e300', '1e2', '+140', '140.', '.5', '1_000', '1000.01']) {
      expect(parseTarget(raw)).toBeNull();
    }
    expect(parseTarget(String(MAX_TARGET_KG))).toBe(MAX_TARGET_KG);
    expect(parseTarget(' 140 ')).toBe(140);
  });
});
