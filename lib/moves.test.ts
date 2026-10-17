// Example tests for fewest Plate moves across a Ramp (RBAR-65 slice 4, ADR-0015 as
// amended 2026-10-17). Rule-wide invariants live in properties.test.ts against the
// brute-force easyRampOracle.
import { describe, it, expect } from 'vitest';
import {
  planEasyRamp,
  movesBetween,
  moveCost,
  CHANGE_PLATE_MAX_KG,
  CHANGE_PLATE_MOVE_COST,
} from './moves.ts';
import type { EasyRow } from './moves.ts';
import { planRamp, DEFAULT_RAMP } from './plan.ts';
import type { RampRig } from './plan.ts';
import { ELEIKO_KG, IRON_LB, sideLoadKg } from './plates.ts';
import type { Plate } from './plates.ts';
import { decode } from './decode.ts';
import { lbToKg, kgToLb } from './units.ts';

const COMP: RampRig = { barKg: 20, collarKg: 0, inventory: ELEIKO_KG };
const COMP_COLLARS: RampRig = { barKg: 20, collarKg: 2.5, inventory: ELEIKO_KG };
const IRON: RampRig = { barKg: lbToKg(45), collarKg: 0, inventory: IRON_LB };

const kg = (n: number): Plate => ELEIKO_KG.find((p) => p.kg === n)!;
const kgs = (side: readonly Plate[]) => side.map((p) => p.kg);
const lbs = (side: readonly Plate[]) => side.map((p) => p.label);
const totals = (rows: readonly EasyRow[]) => rows.map((r) => r.total);

describe('movesBetween: the stack model (Caitlin\'s examples)', () => {
  it('25+10 -> 25+10+5 is one move: put on the 5', () => {
    const m = movesBetween([kg(25), kg(10)], [kg(25), kg(10), kg(5)]);
    expect(kgs(m.off)).toEqual([]);
    expect(kgs(m.on)).toEqual([5]);
    expect(m.cost).toBe(1);
  });

  it('25+10 -> 25+15 is two moves: off with the 10, on with the 15', () => {
    const m = movesBetween([kg(25), kg(10)], [kg(25), kg(15)]);
    expect(kgs(m.off)).toEqual([10]);
    expect(kgs(m.on)).toEqual([15]);
    expect(m.cost).toBe(2);
  });

  it('changing an inside Plate strips everything outside it, outermost first', () => {
    const m = movesBetween([kg(15), kg(10), kg(5)], [kg(25), kg(10), kg(5)]);
    expect(kgs(m.off)).toEqual([5, 10, 15]);
    expect(kgs(m.on)).toEqual([25, 10, 5]);
    expect(m.cost).toBe(6);
  });

  it('change Plates cost half a move: swapping a 2.5 for a 1.5 + 1 costs 1.5', () => {
    const m = movesBetween([kg(25), kg(2.5)], [kg(25), kg(1.5), kg(1)]);
    expect(m.cost).toBe(3 * CHANGE_PLATE_MOVE_COST);
  });

  it('change Plates are Competition 2.5 kg and below and iron 5 lb and below', () => {
    expect(CHANGE_PLATE_MAX_KG).toBe(2.5);
    expect(ELEIKO_KG.filter((p) => moveCost(p) < 1).map((p) => p.kg)).toEqual([2.5, 2, 1.5, 1, 0.5]);
    expect(IRON_LB.filter((p) => moveCost(p) < 1).map((p) => p.label)).toEqual(['5', '2.5']);
  });

  it('the same Side is zero moves; from the bare Bar it is every Plate', () => {
    expect(movesBetween([kg(25)], [kg(25)]).cost).toBe(0);
    expect(movesBetween([], [kg(25), kg(10), kg(2.5)]).cost).toBe(2.5);
  });
});

describe('planEasyRamp: Caitlin\'s 140 kg ramp (Competition, 20 kg Bar)', () => {
  const easy = planEasyRamp(140, DEFAULT_RAMP, COMP);

  it('only ever adds Plates until the last swap, for 5 weighted moves', () => {
    expect(totals(easy.rows)).toEqual([20, 70, 100, 125, 140]);
    expect(easy.rows.map((r) => kgs(r.side))).toEqual([
      [],
      [25],
      [25, 15],
      [25, 15, 10, 2.5],
      [25, 15, 10, 10],
    ]);
    expect(easy.rows.map((r) => r.moves.cost)).toEqual([0, 1, 1, 1.5, 1.5]);
    expect(easy.totalMoves).toBe(5);
    expect(kgs(easy.rows[4].moves.off)).toEqual([2.5]);
    expect(kgs(easy.rows[4].moves.on)).toEqual([10]);
  });

  it('beats the nearest-Total Ramp on moves (which strips the 10 and 2.5 to go from 98 to 126)', () => {
    const near = planRamp(140, DEFAULT_RAMP, COMP).rows;
    let prev: readonly Plate[] = [];
    let nearMoves = 0;
    for (const r of near) {
      nearMoves += movesBetween(prev, r.side).cost;
      prev = r.side;
    }
    expect(nearMoves).toBeGreaterThan(easy.totalMoves);
  });

  it('keeps every Warm-up set within 2.5% of the Working Total from its percentage', () => {
    for (const r of easy.rows.filter((x) => x.kind === 'warmup')) {
      expect(Math.abs(r.total - r.targetKg)).toBeLessThanOrEqual(0.025 * 140);
    }
    expect(easy.rows.map((r) => Number(r.realPct.toFixed(1)))).toEqual([14.3, 50, 71.4, 89.3, 100]);
  });

  it('loads the Working set\'s exact Total, on an equal-Total Side that saves moves', () => {
    const work = easy.rows[4];
    expect(work.total).toBe(decode(140, 20).primary.total);
    expect(kgs(decode(140, 20).primary.side)).toEqual([25, 25, 10]); // Decode's own stack
    expect(easy.working).toEqual(decode(140, 20)); // the Decode (and its round-up) unchanged
  });
});

describe('planEasyRamp: a 225 lb Training ramp (45 lb Bar)', () => {
  const easy = planEasyRamp(lbToKg(225), DEFAULT_RAMP, IRON);

  it('loads 45 / 115 / 155 / 205 / 225 lb for 7 weighted moves', () => {
    expect(easy.rows.map((r) => Math.round(kgToLb(r.total)))).toEqual([45, 115, 155, 205, 225]);
    expect(easy.rows.map((r) => lbs(r.side))).toEqual([
      [],
      ['35'],
      ['45', '10'],
      ['45', '35'],
      ['45', '35', '10'],
    ]);
    expect(easy.totalMoves).toBe(7);
    expect(easy.rows[4].total).toBeCloseTo(lbToKg(225), 9);
  });
});

describe('planEasyRamp: floors, collars and degenerate Ramps', () => {
  it('a 30 kg Working set keeps the forced floor (50% sits on the bare Bar)', () => {
    const easy = planEasyRamp(30, DEFAULT_RAMP, COMP);
    expect(totals(easy.rows)[1]).toBe(20);
    expect(easy.rows[1].sameAsPrevious).toBe(true);
    expect(easy.rows[1].moves.cost).toBe(0);
    expect(easy.rows[4].total).toBe(30);
  });

  it('collars stay as planRamp sets them; the bare-Bar row stays bare', () => {
    const easy = planEasyRamp(140, DEFAULT_RAMP, COMP_COLLARS);
    expect(easy.rows.map((r) => r.collars)).toEqual([false, true, true, true, true]);
    expect(easy.rows[0].total).toBe(20);
    for (const r of easy.rows.slice(1)) expect(r.total).toBe(25 + 2 * sideLoadKg(r.side));
    expect(easy.rows[4].total).toBe(140);
  });

  it('an empty template is just the Working set, loaded from the bare Bar', () => {
    const easy = planEasyRamp(100, [], COMP);
    expect(easy.rows).toHaveLength(1);
    expect(easy.rows[0].total).toBe(100);
    expect(easy.totalMoves).toBe(easy.rows[0].moves.cost);
  });

  it('carries the nominal step, reps and kind unchanged from planRamp', () => {
    const easy = planEasyRamp(140, DEFAULT_RAMP, COMP, { workingReps: 3 });
    const near = planRamp(140, DEFAULT_RAMP, COMP, { workingReps: 3 });
    expect(easy.rows.map((r) => [r.kind, r.pct, r.reps, r.targetKg])).toEqual(
      near.rows.map((r) => [r.kind, r.pct, r.reps, r.targetKg]),
    );
  });

  it('throws what planRamp throws', () => {
    expect(() => planEasyRamp(140, [{ kind: 'pct', pct: 0 }], COMP)).toThrow(RangeError);
  });

  it('an empty Inventory leaves every row on the bare rig', () => {
    const easy = planEasyRamp(140, DEFAULT_RAMP, { ...COMP, inventory: [] });
    expect(totals(easy.rows)).toEqual([20, 20, 20, 20, 20]);
    expect(easy.totalMoves).toBe(0);
  });
});
