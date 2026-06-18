import { describe, it, expect } from 'vitest';
import { encode, addPlate, removePlate } from './encode.ts';
import { ELEIKO_KG, DEFAULT_BAR_KG } from './plates.ts';
import type { Plate } from './plates.ts';

// A Plate from the canonical set, by kg -- so colors match CONTEXT.md.
function p(kg: number): Plate {
  return ELEIKO_KG.find((plate) => plate.kg === kg)!;
}

function side(...kgs: number[]): Plate[] {
  return kgs.map(p);
}

describe('encode (a hand-built Side Load -> its Total)', () => {
  it('reads an empty Side Load as the bare Bar', () => {
    expect(encode([])).toBe(DEFAULT_BAR_KG);
  });

  it('reads Bar + 2 x Side Load (20 + 15 + 5 per Side makes 100)', () => {
    expect(encode(side(20, 15, 5))).toBe(100);
  });

  it('honors a non-default Bar (the core is parameterized, ADR-0002)', () => {
    expect(encode(side(20, 15, 5), 15)).toBe(95);
    expect(encode([], 15)).toBe(15);
  });
});

describe('addPlate (a pure Side Load transform)', () => {
  it('returns a new heaviest-first Side Load with the Plate added', () => {
    expect(addPlate(side(25, 15), p(5)).map((x) => x.kg)).toEqual([25, 15, 5]);
  });

  it('keeps the result heaviest-first wherever the Plate slots in', () => {
    expect(addPlate(side(15, 5), p(25)).map((x) => x.kg)).toEqual([25, 15, 5]);
    expect(addPlate(side(25, 5), p(15)).map((x) => x.kg)).toEqual([25, 15, 5]);
  });

  it('adds onto an empty Side Load', () => {
    expect(addPlate([], p(20)).map((x) => x.kg)).toEqual([20]);
  });

  it('does not mutate the input Side Load', () => {
    const before = side(25, 15);
    addPlate(before, p(5));
    expect(before.map((x) => x.kg)).toEqual([25, 15]);
  });
});

describe('removePlate (a pure Side Load transform)', () => {
  it('returns a new heaviest-first Side Load with the Plate removed', () => {
    expect(removePlate(side(25, 15, 5), p(15)).map((x) => x.kg)).toEqual([
      25, 5,
    ]);
  });

  it('removes only one Plate when the Side Load holds duplicates', () => {
    expect(removePlate(side(25, 25, 15), p(25)).map((x) => x.kg)).toEqual([
      25, 15,
    ]);
  });

  it('returns an unchanged Side Load when the Plate is not loaded', () => {
    const result = removePlate(side(25, 15), p(10));
    expect(result.map((x) => x.kg)).toEqual([25, 15]);
  });

  it('does not mutate the input Side Load', () => {
    const before = side(25, 15, 5);
    removePlate(before, p(15));
    expect(before.map((x) => x.kg)).toEqual([25, 15, 5]);
  });
});

describe('add/remove round-trip with encode', () => {
  it('tapping plates on then reading the Total agrees with encode', () => {
    let s: readonly Plate[] = [];
    s = addPlate(s, p(25));
    s = addPlate(s, p(15));
    expect(encode(s)).toBe(100); // 20 + 2 x 40
    s = removePlate(s, p(15));
    expect(encode(s)).toBe(70); // 20 + 2 x 25
  });
});
