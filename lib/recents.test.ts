import { describe, it, expect } from 'vitest';
import { MAX_RECENTS, pushRecent, parseRecents } from './recents.ts';

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

  it('dedupes and caps a corrupt over-long / duplicate-laden payload', () => {
    const raw = JSON.stringify([10, 10, 9, 8, 7, 6, 5, 4, 3]);
    const parsed = parseRecents(raw);
    expect(parsed).toEqual([10, 9, 8, 7, 6, 5]);
    expect(parsed).toHaveLength(MAX_RECENTS);
  });
});
