import { describe, it, expect } from 'vitest';
import {
  ALL_PLATES,
  MAX_PAIRS,
  PAIR_CHOICES,
  clearSet,
  hasLimits,
  inventoryOnHand,
  pairsLabel,
  pairsOf,
  parsePlatesOnHand,
  serializePlatesOnHand,
  setPairs,
} from './platesonhand.ts';
import { PLATE_SETS } from './platesets.ts';
import { decode } from './decode.ts';
import { plateFace } from './plates.ts';

describe('Pairs of Plates on Hand (RBAR-72, ADR-0016)', () => {
  it('offers None, 1 to 4 pairs, and All', () => {
    expect(PAIR_CHOICES).toEqual([0, 1, 2, 3, 4, null]);
    expect(MAX_PAIRS).toBe(4);
  });

  it('reads nothing stored, junk, and non-objects as All plates', () => {
    for (const raw of [null, '', 'nope', '[]', '[1]', '"x"', '3', 'null', '{']) {
      expect(parsePlatesOnHand(raw)).toEqual({});
    }
  });

  it('keeps the valid entries and drops each bad one on its own', () => {
    const raw = JSON.stringify({
      comp: { '15': 2, '0.5': 0, '25': 5, '20': 1.5, '10': -1, '5': '1', '45': 1, '2.5': 4 },
      training: { '45': 1, '20': 2 },
      other: { '15': 1 },
    });
    expect(parsePlatesOnHand(raw)).toEqual({
      comp: { '15': 2, '0.5': 0, '2.5': 4 },
      training: { '45': 1 },
    });
  });

  it('a set whose limits are not an object reads as All', () => {
    expect(parsePlatesOnHand('{"comp":[1,2],"training":{"45":0}}')).toEqual({ training: { '45': 0 } });
  });

  it('round-trips through storage, leaving out sets with no limits', () => {
    const onHand = setPairs(setPairs(ALL_PLATES, 'comp', '15', 2), 'training', '45', 0);
    const raw = serializePlatesOnHand(onHand);
    expect(JSON.parse(raw)).toEqual({ comp: { '15': 2 }, training: { '45': 0 } });
    expect(parsePlatesOnHand(raw)).toEqual(onHand);
    expect(serializePlatesOnHand(clearSet(onHand, 'comp'))).toBe('{"training":{"45":0}}');
  });

  it('setPairs stores a count, null is All, and a bad face or count changes nothing', () => {
    const a = setPairs(ALL_PLATES, 'comp', '25', 1);
    expect(pairsOf(a, 'comp', '25')).toBe(1);
    expect(pairsOf(a, 'training', '25')).toBeNull();
    expect(hasLimits(a, 'comp')).toBe(true);
    const b = setPairs(a, 'comp', '25', null);
    expect(b).toEqual({});
    expect(hasLimits(b, 'comp')).toBe(false);
    expect(setPairs(a, 'comp', '45', 1)).toBe(a); // no 45 on Competition
    expect(setPairs(a, 'comp', '20', 5)).toBe(a);
    expect(setPairs(a, 'comp', '20', 1.5)).toBe(a);
    expect(setPairs(a, 'comp', '25', 1)).toBe(a); // already so
  });

  it('clearSet leaves the other set alone', () => {
    const both = setPairs(setPairs(ALL_PLATES, 'comp', '15', 0), 'training', '35', 2);
    expect(clearSet(both, 'comp')).toEqual({ training: { '35': 2 } });
    expect(clearSet(ALL_PLATES, 'comp')).toBe(ALL_PLATES);
  });

  it('inventoryOnHand caps the sizes and is the set itself with no limits', () => {
    expect(inventoryOnHand(ALL_PLATES, 'comp')).toBe(PLATE_SETS.comp.inventory);
    const inv = inventoryOnHand(setPairs(ALL_PLATES, 'comp', '15', 0), 'comp');
    expect(inv.map(plateFace)).toEqual(PLATE_SETS.comp.inventory.map(plateFace));
    expect(inv.find((p) => plateFace(p) === '15')?.maxPerSide).toBe(0);
    // Built by hand past the validators: a stray face or count is skipped, not thrown.
    expect(inventoryOnHand({ comp: { '45': 1, '20': 9 } }, 'comp')).toBe(PLATE_SETS.comp.inventory);
  });

  it('one pair of 25s still makes 140 kg exactly, as 25 + 20 + 15', () => {
    const inv = inventoryOnHand(setPairs(ALL_PLATES, 'comp', '25', 1), 'comp');
    const d = decode(140, 20, inv);
    expect(d.primary.total).toBe(140);
    expect(d.primary.side.map(plateFace)).toEqual(['25', '20', '15']);
  });

  it('every size None decodes to the bare Bar', () => {
    let onHand = ALL_PLATES;
    for (const p of PLATE_SETS.training.inventory) onHand = setPairs(onHand, 'training', plateFace(p), 0);
    const d = decode(135, 20, inventoryOnHand(onHand, 'training'));
    expect(d.primary.side).toEqual([]);
    expect(d.primary.total).toBe(20);
    expect(d.over).toBeUndefined();
  });

  it('labels a tile all, N pair(s), or none', () => {
    expect([null, 0, 1, 2, 4].map(pairsLabel)).toEqual(['all', 'none', '1 pair', '2 pairs', '4 pairs']);
  });
});
