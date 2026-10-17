// Example tests for the warm-up Ramp planner (RBAR-65 slice 1, ADR-0015). The
// rule-wide invariants live in properties.test.ts against the independent oracle.
import { describe, it, expect } from 'vitest';
import { planRamp, DEFAULT_RAMP } from './plan.ts';
import type { RampRig, RampRow, RampStep } from './plan.ts';
import { ELEIKO_KG, IRON_LB, SLEEVE_MM, sideLoadKg } from './plates.ts';
import { decode, decodeWithin } from './decode.ts';
import { lbToKg, kgToLb, displayCeilingKg } from './units.ts';

const COMP: RampRig = { barKg: 20, collarKg: 0, inventory: ELEIKO_KG };
const COMP_COLLARS: RampRig = { barKg: 20, collarKg: 2.5, inventory: ELEIKO_KG };
const IRON: RampRig = { barKg: lbToKg(45), collarKg: 0, inventory: IRON_LB };

const kgs = (side: readonly { kg: number }[]) => side.map((p) => p.kg);
const lbs = (side: readonly { label?: string }[]) => side.map((p) => p.label);
const totals = (rows: readonly RampRow[]) => rows.map((r) => r.total);
const lbTotals = (rows: readonly RampRow[]) => rows.map((r) => Math.round(kgToLb(r.total)));

describe('DEFAULT_RAMP (Caitlin\'s deadlift ramp)', () => {
  it('is Bar x7, 50% x7, 70%, 90% -- the Working set is implicit', () => {
    expect(DEFAULT_RAMP).toEqual([
      { kind: 'bar', reps: 7 },
      { kind: 'pct', pct: 50, reps: 7 },
      { kind: 'pct', pct: 70 },
      { kind: 'pct', pct: 90 },
    ]);
  });
});

describe('planRamp: Caitlin\'s 140 kg deadlift ramp (Competition, 20 kg Bar, no collars)', () => {
  const { rows, working } = planRamp(140, DEFAULT_RAMP, COMP);

  it('lists the bare Bar, three warm-ups and the Working set, in order', () => {
    expect(rows.map((r) => r.kind)).toEqual(['bar', 'warmup', 'warmup', 'warmup', 'working']);
    expect(rows.map((r) => r.pct)).toEqual([null, 50, 70, 90, 100]);
    expect(rows.map((r) => r.reps)).toEqual([7, 7, undefined, undefined, undefined]);
  });

  it('lands every row on its percentage exactly (the 1 kg grid)', () => {
    expect(rows.map((r) => r.targetKg)).toEqual([20, 70, 98, 126, 140]);
    expect(totals(rows)).toEqual([20, 70, 98, 126, 140]);
    expect(rows.map((r) => r.realPct)).toEqual([(20 / 140) * 100, 50, 70, 90, 100]);
  });

  it('loads each warm-up as the canonical Side (fewest Plates, heaviest-first)', () => {
    expect(kgs(rows[0].side)).toEqual([]);
    expect(kgs(rows[1].side)).toEqual([25]);
    expect(kgs(rows[3].side)).toEqual([25, 25, 2.5, 0.5]);
    expect(kgs(rows[4].side)).toEqual([25, 25, 10]);
    for (const r of rows.slice(1)) expect(r.side).toEqual(decode(r.total, 20).primary.side);
  });

  it('marks no row as the same as the previous one', () => {
    expect(rows.map((r) => r.sameAsPrevious)).toEqual([false, false, false, false, false]);
  });

  it('returns the Working set\'s full Decode, so the round-up opt-in survives (ADR-0003)', () => {
    expect(working).toEqual(decode(140, 20));
    expect(working.over).toBeUndefined();
  });
});

describe('planRamp: rounding to the nearest loadable Total (ADR-0015)', () => {
  it('rounds a warm-up UP when the next Total is closer (an off-grid Working Total)', () => {
    // 137.5 kg on the Competition grid is 137 at or under; 70% of 137 = 95.9 -> 96.
    const { rows } = planRamp(137.5, [{ kind: 'pct', pct: 70 }], COMP);
    expect(rows[1].total).toBe(137);
    expect(rows[0].targetKg).toBeCloseTo(95.9, 9);
    expect(rows[0].total).toBe(96);
  });

  it('breaks an exact tie DOWN: 45 lb iron Bar, 225 lb Working set', () => {
    // 50% / 70% / 90% of 225 lb = 112.5 / 157.5 / 202.5 lb, each exactly halfway on the
    // 5 lb grid, so each goes to the lighter Total.
    const { rows } = planRamp(lbToKg(225), DEFAULT_RAMP, IRON);
    expect(lbTotals(rows)).toEqual([45, 110, 155, 200, 225]);
    expect(lbs(rows[1].side)).toEqual(['25', '5', '2.5']); // 45 + 2 x 32.5
    expect(rows[3].side).toEqual(decode(lbToKg(200), lbToKg(45), IRON_LB).primary.side);
    expect(lbs(rows[4].side)).toEqual(['45', '45']);
  });

  it('rounds to the nearest 5 lb when there is no tie: 45 lb Bar, 315 lb Working set', () => {
    // 157.5 / 220.5 / 283.5 lb -> 155 (2.5 away, tie down) / 220 / 285.
    const { rows } = planRamp(lbToKg(315), DEFAULT_RAMP, IRON);
    expect(lbTotals(rows)).toEqual([45, 155, 220, 285, 315]);
  });

  it('solves the Working set as read through the ceiling (decodeWithin, RBAR-60)', () => {
    // 55 lb on the Competition set: 24.95 kg raw, but 25 kg also reads 55 lb.
    const target = lbToKg(55);
    const ceiling = displayCeilingKg(target, 'lb');
    const { rows, working } = planRamp(target, [], COMP, { ceilingKg: ceiling });
    expect(working).toEqual(decodeWithin(target, ceiling, 20, ELEIKO_KG));
    expect(rows[0].total).toBe(25);
    expect(rows[0].targetKg).toBe(target);
  });
});

describe('planRamp: collars (ADR-0015 Q5, ADR-0008)', () => {
  const { rows } = planRamp(140, DEFAULT_RAMP, COMP_COLLARS);

  it('never collars the bare-Bar row: its Total is the Bar alone', () => {
    expect(rows[0].total).toBe(20);
    expect(rows[0].collars).toBe(false);
    expect(rows[0].side).toEqual([]);
  });

  it('collars every other row, warm-ups and Working set, when the rig has them', () => {
    expect(rows.slice(1).map((r) => r.collars)).toEqual([true, true, true, true]);
    expect(totals(rows)).toEqual([20, 70, 98, 126, 140]);
    // 70 = 20 + 2 x 2.5 + 2 x 22.5
    expect(sideLoadKg(rows[1].side)).toBe(22.5);
    for (const r of rows.slice(1)) expect(r.total).toBe(25 + 2 * sideLoadKg(r.side));
  });

  it('collars nothing when the rig has none', () => {
    const plain = planRamp(140, DEFAULT_RAMP, COMP).rows;
    expect(plain.map((r) => r.collars)).toEqual([false, false, false, false, false]);
  });

  it('floors a collared warm-up at the Bar plus collars, above the bare-Bar row', () => {
    const { rows: light } = planRamp(30, DEFAULT_RAMP, COMP_COLLARS);
    // 50% of 30 = 15 -> 25 (Bar + collars, no Plates); 70% = 21 -> 25 too; 90% = 27 -> 27.
    expect(totals(light)).toEqual([20, 25, 25, 27, 30]);
    expect(light.map((r) => r.sameAsPrevious)).toEqual([false, false, true, false, false]);
    expect(light[1].side).toEqual([]);
    expect(light[1].collars).toBe(true);
  });
});

describe('planRamp: degenerate ramps (ADR-0015 floor and monotone rules)', () => {
  it('30 kg: 50% falls under the Bar, floors at it, and reads as the same set', () => {
    const { rows } = planRamp(30, DEFAULT_RAMP, COMP);
    expect(rows.map((r) => r.targetKg)).toEqual([20, 15, 21, 27, 30]);
    expect(totals(rows)).toEqual([20, 20, 21, 27, 30]);
    expect(rows.map((r) => r.sameAsPrevious)).toEqual([false, true, false, false, false]);
    expect(rows).toHaveLength(5); // nothing dropped
  });

  it('40 kg: 50% rounds onto the bare Bar exactly', () => {
    const { rows } = planRamp(40, DEFAULT_RAMP, COMP);
    expect(totals(rows)).toEqual([20, 20, 28, 36, 40]);
    expect(rows[1].sameAsPrevious).toBe(true);
    expect(rows[1].side).toEqual([]);
  });

  it('a Working Target under the bare Bar plans the bare Bar throughout', () => {
    const { rows } = planRamp(10, DEFAULT_RAMP, COMP);
    expect(totals(rows)).toEqual([20, 20, 20, 20, 20]);
    expect(rows.map((r) => r.sameAsPrevious)).toEqual([false, true, true, true, true]);
    expect(rows[4].realPct).toBe(100);
  });

  it('forces Totals non-decreasing when the steps are out of order', () => {
    const { rows } = planRamp(140, [{ kind: 'pct', pct: 90 }, { kind: 'pct', pct: 50 }], COMP);
    expect(totals(rows)).toEqual([126, 126, 140]);
    expect(rows[1].sameAsPrevious).toBe(true);
    expect(rows[1].pct).toBe(50); // the nominal step is kept; only the Total moved
  });

  it('plans just the Working set for an empty template', () => {
    const { rows } = planRamp(140, [], COMP);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'working', pct: 100, total: 140, sameAsPrevious: false });
  });

  it('keeps every bare-Bar step at the Bar', () => {
    const { rows } = planRamp(100, [{ kind: 'bar' }, { kind: 'bar', reps: 5 }], COMP);
    expect(totals(rows)).toEqual([20, 20, 100]);
    expect(rows[1]).toMatchObject({ kind: 'bar', reps: 5, sameAsPrevious: true });
  });

  it('carries the Working set\'s reps from the options', () => {
    const { rows } = planRamp(140, DEFAULT_RAMP, COMP, { workingReps: 5 });
    expect(rows[4].reps).toBe(5);
  });

  it('degrades a non-finite Working Target to the bare rig without throwing', () => {
    const { rows } = planRamp(Number.NaN, DEFAULT_RAMP, COMP);
    expect(totals(rows)).toEqual([20, 20, 20, 20, 20]);
  });
});

describe('planRamp: a sleeve-capped Working set (ADR-0012)', () => {
  it('takes the percentages of the Total that actually fits, never the typed Target', () => {
    const { rows, working } = planRamp(1000, DEFAULT_RAMP, COMP);
    const top = decode(1000, 20).primary.total;
    expect(working.primary.total).toBe(top);
    expect(rows[4].total).toBe(top);
    expect(rows[4].targetKg).toBe(1000);
    expect(rows[2].targetKg).toBeCloseTo(0.7 * top, 9);
    for (const r of rows) {
      expect(r.side.reduce((mm, p) => mm + p.widthMm, 0)).toBeLessThanOrEqual(SLEEVE_MM);
      expect(r.total).toBeLessThanOrEqual(top);
    }
  });
});

describe('planRamp: malformed steps throw (the shell validates at the boundary, ADR-0007)', () => {
  const bad: RampStep[][] = [
    [{ kind: 'pct', pct: 0 }],
    [{ kind: 'pct', pct: -10 }],
    [{ kind: 'pct', pct: 101 }],
    [{ kind: 'pct', pct: Number.NaN }],
    [{ kind: 'pct', pct: 50, reps: 0 }],
    [{ kind: 'pct', pct: 50, reps: 2.5 }],
    [{ kind: 'bar', reps: -1 }],
    [{ kind: 'pct', pct: 50 }, { kind: 'bar' }],
  ];
  for (const steps of bad) {
    it(`rejects ${JSON.stringify(steps)}`, () => {
      expect(() => planRamp(140, steps, COMP)).toThrow(RangeError);
    });
  }

  it('rejects a non-positive Bar or a negative Collar', () => {
    expect(() => planRamp(140, DEFAULT_RAMP, { ...COMP, barKg: 0 })).toThrow(RangeError);
    expect(() => planRamp(140, DEFAULT_RAMP, { ...COMP, collarKg: -1 })).toThrow(RangeError);
  });

  it('rejects bad Working-set reps', () => {
    expect(() => planRamp(140, DEFAULT_RAMP, COMP, { workingReps: 0 })).toThrow(RangeError);
  });
});
