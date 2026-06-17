import { describe, it, expect } from 'vitest';
import { decode } from './decode.ts';
import { totalKg } from './plates.ts';

describe('decode (walking skeleton: exact Targets only)', () => {
  it('decodes an exact Target into the canonical fewest-Plate Side Load, biggest-first', () => {
    // 100 on a 20 kg Bar -> 40 per Side -> 25 + 15 (two Plates, heaviest-first)
    const side = decode(100);
    expect(side).not.toBeNull();
    expect(side!.map((p) => p.kg)).toEqual([25, 15]);
    expect(side!.map((p) => p.color)).toEqual(['red', 'yellow']);
    expect(totalKg(side!)).toBe(100);
  });

  it('returns an empty Side Load for a Target equal to the bare Bar', () => {
    expect(decode(20)).toEqual([]);
  });

  it('builds a half-kilo Side Load from change Plates', () => {
    // 61 -> 20.5 per Side -> 20 + 0.5
    const side = decode(61);
    expect(side!.map((p) => p.kg)).toEqual([20, 0.5]);
    expect(side!.map((p) => p.color)).toEqual(['blue', 'white']);
  });

  it('honors a non-default Bar weight', () => {
    // 15 kg Bar, Target 55 -> 20 per Side -> a single blue
    expect(decode(55, 15)!.map((p) => p.kg)).toEqual([20]);
  });

  it('returns null for a Target below the bare Bar', () => {
    expect(decode(10)).toBeNull();
  });

  it('returns null for an off-grid Target the Eleiko set cannot build exactly', () => {
    expect(decode(100.5)).toBeNull();
  });
});
