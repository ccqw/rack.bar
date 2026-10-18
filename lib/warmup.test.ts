// Example tests for the Warm up view logic (RBAR-65 slice 2): how a planned Ramp reads.
import { describe, it, expect } from 'vitest';
import {
  rowDelta,
  deltaText,
  deltaSpoken,
  stepName,
  stepFractions,
  walkIndex,
  warmStatus,
  warmupView,
  parseWorking,
} from './warmup.ts';
import { planRamp, DEFAULT_RAMP } from './plan.ts';
import { planEasyRamp } from './moves.ts';
import type { RampRig } from './plan.ts';
import { ELEIKO_KG, IRON_LB, withLimits } from './plates.ts';
import { lbToKg } from './units.ts';

const COMP: RampRig = { barKg: 20, collarKg: 0, inventory: ELEIKO_KG };
const IRON: RampRig = { barKg: lbToKg(45), collarKg: 0, inventory: IRON_LB };
const kg = (n: number) => ELEIKO_KG.find((p) => p.kg === n)!;
const lb = (s: string) => IRON_LB.find((p) => p.label === s)!;
const kgs = (side: readonly { kg: number }[]) => side.map((p) => p.kg);

// Caitlin's 140 kg ramp: 20 / 70 (25) / 98 (25+10+2.5+1.5) / 126 (25+25+2.5+0.5) / 140 (25+25+10).
const RAMP140 = planRamp(140, DEFAULT_RAMP, COMP).rows;

// The planner's rows as the console loads them: Caitlin's 75 kg Ramp by the station rule
// (ADR-0015): 20 / 37 (5+2.5+1) / 52 (15+1) / 67 (15+5+2.5+1) / 75 (15+5+5+2.5).
const RAMP75 = planEasyRamp(75, DEFAULT_RAMP, COMP).rows;

describe('rowDelta: the stack moves, not a set difference (ADR-0015 as amended)', () => {
  it("reads Caitlin's 75 kg Ramp move by move", () => {
    expect(RAMP75.map((r) => kgs(r.side))).toEqual([[], [5, 2.5, 1], [15, 1], [15, 5, 2.5, 1], [15, 5, 5, 2.5]]);
    const d = RAMP75.map((_, i) => rowDelta(RAMP75, i));
    expect(d.map((x) => [kgs(x.off), kgs(x.on)])).toEqual([
      [[], []],
      [[], [5, 2.5, 1]],
      [[1, 2.5, 5], [15, 1]],
      // 15+1 -> 15+5+2.5+1: the 1 is outside where the 5 goes, so it comes off first.
      [[1], [5, 2.5, 1]],
      [[1, 2.5], [5, 2.5]],
    ]);
    expect(d.map((x) => deltaText(x, 'kg'))).toEqual([
      null,
      '+5 +2.5 +1 kg',
      'off 1 + 2.5 + 5, on 15 + 1 kg',
      'off 1, on 5 + 2.5 + 1 kg',
      'off 1 + 2.5, on 5 + 2.5 kg',
    ]);
    expect(deltaSpoken(d[3], 'kg')).toBe('take off 1, then add 5 and 2.5 and 1 kilograms per side');
  });

  it('a swap deeper in the stack takes off everything outside it, outermost first', () => {
    // Was pinned as "remove 10 and 1.5"; the 2.5 sits outside the 10, so it comes off too.
    const rows = [
      { ...RAMP140[2], side: [kg(25), kg(10), kg(2.5), kg(1.5)] },
      { ...RAMP140[3], side: [kg(25), kg(25), kg(2.5), kg(0.5)] },
    ];
    const d = rowDelta(rows, 1);
    expect(kgs(d.off)).toEqual([1.5, 2.5, 10]);
    expect(kgs(d.on)).toEqual([25, 2.5, 0.5]);
  });

  it('the first row loads from a bare Bar; an add-only row takes nothing off', () => {
    expect(kgs(rowDelta(RAMP140, 0).on)).toEqual([]);
    expect(kgs(rowDelta(RAMP140, 1).on)).toEqual([25]);
    expect(kgs(rowDelta(RAMP140, 1).off)).toEqual([]);
  });

  it('identical Sides are no moves', () => {
    const rows = [RAMP140[1], { ...RAMP140[1] }];
    expect(rowDelta(rows, 1)).toEqual({ off: [], on: [] });
  });
});

describe('deltaText / deltaSpoken (every number carries its unit)', () => {
  it('reads an add-only change as "+N unit", one unit at the end', () => {
    expect(deltaText({ on: [kg(15)], off: [] }, 'kg')).toBe('+15 kg');
    expect(deltaText({ on: [kg(15), kg(2.5)], off: [] }, 'kg')).toBe('+15 +2.5 kg');
    expect(deltaSpoken({ on: [kg(15), kg(2.5)], off: [] }, 'kg')).toBe(
      'add 15 and 2.5 kilograms per side',
    );
  });

  it('reads a change with Plates off as "off ..., on ...", in the order it is done', () => {
    expect(deltaText({ on: [kg(5)], off: [kg(2.5)] }, 'kg')).toBe('off 2.5, on 5 kg');
    expect(deltaSpoken({ on: [kg(5)], off: [kg(2.5)] }, 'kg')).toBe(
      'take off 2.5, then add 5 kilograms per side',
    );
  });

  it('reads a take-off-only change with minus signs', () => {
    expect(deltaText({ on: [], off: [kg(2.5)] }, 'kg')).toBe('-2.5 kg');
    expect(deltaSpoken({ on: [], off: [kg(2.5)] }, 'kg')).toBe(
      'take off 2.5 kilograms per side',
    );
  });

  it('uses the iron Plates\' stamped pound faces', () => {
    expect(deltaText({ on: [lb('45')], off: [] }, 'lb')).toBe('+45 lb');
    expect(deltaSpoken({ on: [lb('45')], off: [] }, 'lb')).toBe('add 45 pounds per side');
  });

  it('is null when nothing changes', () => {
    expect(deltaText({ on: [], off: [] }, 'kg')).toBeNull();
    expect(deltaSpoken({ on: [], off: [] }, 'kg')).toBeNull();
  });
});

describe('stepName', () => {
  it('names the stairs Bar, N%, Work -- the percent sign on every percentage', () => {
    expect(RAMP140.map(stepName)).toEqual(['Bar', '50%', '70%', '90%', 'Work']);
  });
});

describe('stepName: a drifted row (RBAR-72 slice 3)', () => {
  // No change Plates on hand: a 60 kg 90% set can only be 50 or 60 kg.
  const NO_CHANGE: RampRig = {
    ...COMP,
    inventory: withLimits(ELEIKO_KG, { '2.5': 0, '2': 0, '1.5': 0, '1': 0, '0.5': 0 }),
  };
  const rows = planEasyRamp(60, DEFAULT_RAMP, NO_CHANGE).rows;

  it('names what the row really loads, with a tilde: "~83%"', () => {
    expect(rows.map(stepName)).toEqual(['Bar', '50%', '70%', '~83%', 'Work']);
  });

  it('carries the tilde onto the stair and says both percentages to a screen reader', () => {
    const v = warmupView(rows, 2, 'kg', 'kg');
    expect(v.steps[3].name).toBe('~83%');
    expect(v.steps[3].label).toBe(
      'Set 4 of 5, 90 percent planned, about 83 percent loaded, 50 kilograms, add 5 kilograms per side',
    );
  });

});

describe('stepName: a Warm-up set on the bare rig never reads a tilde (RBAR-72 slice 3 review)', () => {
  // The Bar cannot be lighter, so stairs sharing the bare Bar share their step names
  // instead of reading "~74%" beside "70%" at the same 20 kg.
  const names = (w: number, rig: RampRig) => [
    planRamp(w, DEFAULT_RAMP, rig).rows.map(stepName),
    planEasyRamp(w, DEFAULT_RAMP, rig).rows.map(stepName),
  ];
  const STEPS = ['Bar', '50%', '70%', '90%', 'Work'];

  it('Comp 22 kg: three Warm-up sets on the 20 kg Bar keep their step names', () => {
    expect(names(22, COMP)).toEqual([STEPS, STEPS]);
  });

  it('Comp 27 kg: 50% and 70% both on the 20 kg Bar read "50%" and "70%"', () => {
    expect(names(27, COMP)).toEqual([STEPS, STEPS]);
  });

  it('Comp 30 kg: the 50% set on the 20 kg Bar reads "50%"', () => {
    expect(names(30, COMP)).toEqual([STEPS, STEPS]);
  });

  it('Training 60 lb: 50% and 70% on the 45 lb Bar read "50%" and "70%"', () => {
    expect(names(lbToKg(60), IRON)).toEqual([STEPS, STEPS]);
  });

  it('a Working set at or under the Bar reads no tilde anywhere', () => {
    expect(names(20, COMP)).toEqual([STEPS, STEPS]);
    expect(names(lbToKg(45), IRON)).toEqual([STEPS, STEPS]);
  });
});

describe('drift at the exact band edge (RBAR-72 slice 3 review)', () => {
  it('Comp, 5 kg Bar, 8 kg: the 70% set at 6 kg is exactly 5% of 8 kg off, so it does not drift', () => {
    // 0.4 kg off in float is 5% of 8 kg plus 3e-16: only the EPS in drifted() keeps it in.
    const rig: RampRig = { ...COMP, barKg: 5 };
    for (const r of [planRamp(8, DEFAULT_RAMP, rig), planEasyRamp(8, DEFAULT_RAMP, rig)]) {
      expect(r.rows[2].total).toBe(6);
      expect(r.rows[2].drift).toBe(false);
      expect(stepName(r.rows[2])).toBe('70%');
    }
  });

  it('Training, 45 lb Bar, 60 lb: the 70% set (42 lb asked, 45 lb loaded, exactly 5% off) reads "70%"', () => {
    for (const r of [planRamp(lbToKg(60), DEFAULT_RAMP, IRON), planEasyRamp(lbToKg(60), DEFAULT_RAMP, IRON)]) {
      expect(r.rows[2].drift).toBe(false);
      expect(stepName(r.rows[2])).toBe('70%');
    }
  });
});

describe('a drifted row in pounds (RBAR-72 slice 3 review)', () => {
  it('the stair keeps the tilde and reads the Total in lb', () => {
    const NO_CHANGE: RampRig = {
      ...COMP,
      inventory: withLimits(ELEIKO_KG, { '2.5': 0, '2': 0, '1.5': 0, '1': 0, '0.5': 0 }),
    };
    const rows = planEasyRamp(60, DEFAULT_RAMP, NO_CHANGE).rows;
    const step = warmupView(rows, 2, 'lb', 'kg').steps[3];
    expect([step.name, `${step.totalNum} ${step.totalUnit}`]).toEqual(['~83%', '110 lb']);
  });
});

describe('stepFractions', () => {
  it('scales each stair to its Total over the Working Total', () => {
    expect(stepFractions(RAMP140)).toEqual([20 / 140, 0.5, 0.7, 0.9, 1]);
  });
});

describe('walkIndex', () => {
  it('walks one step with Left/Right and stops at the ends', () => {
    expect(walkIndex(2, 'ArrowRight', 5)).toBe(3);
    expect(walkIndex(2, 'ArrowLeft', 5)).toBe(1);
    expect(walkIndex(4, 'ArrowRight', 5)).toBe(4);
    expect(walkIndex(0, 'ArrowLeft', 5)).toBe(0);
  });

  it('jumps with Home/End and ignores other keys', () => {
    expect(walkIndex(2, 'Home', 5)).toBe(0);
    expect(walkIndex(2, 'End', 5)).toBe(4);
    expect(walkIndex(2, 'ArrowUp', 5)).toBeNull();
    expect(walkIndex(0, 'ArrowRight', 0)).toBeNull();
  });
});

describe('warmStatus', () => {
  it('reads Bare bar on the bare-Bar row', () => {
    expect(warmStatus(RAMP140[0], 140, 'kg')).toEqual({ kind: 'bare', label: 'Bare bar' });
  });

  it('reads "N% - exact" when the Total lands on the percentage', () => {
    expect(warmStatus(RAMP140[2], 140, 'kg')).toEqual({ kind: 'exact', label: '70% - exact' });
    expect(warmStatus(RAMP140[4], 140, 'kg')).toEqual({ kind: 'exact', label: '100% - exact' });
  });

  it('reads the real percentage of the Working Total, with its unit, when rounding moved it', () => {
    // 225 lb on iron: 50% = 112.5 lb ties down to 110 lb (48.9%).
    const rows = planRamp(lbToKg(225), DEFAULT_RAMP, IRON).rows;
    expect(warmStatus(rows[1], rows[4].total, 'lb')).toEqual({ kind: 'pct', label: '49% of 225 lb' });
  });

  it('hands a short Working set back to the By Weight pill (null)', () => {
    const rows = planRamp(140.3, DEFAULT_RAMP, COMP).rows;
    expect(warmStatus(rows[4], rows[4].total, 'kg')).toBeNull();
  });
});

describe('warmupView', () => {
  it('builds one stair per row with its unit-carrying Total, name, height and accessible name', () => {
    const v = warmupView(RAMP140, 2, 'kg', 'kg');
    expect(v.steps.map((s) => s.name)).toEqual(['Bar', '50%', '70%', '90%', 'Work']);
    expect(v.steps.map((s) => `${s.totalNum} ${s.totalUnit}`)).toEqual([
      '20 kg', '70 kg', '98 kg', '126 kg', '140 kg',
    ]);
    expect(v.steps.map((s) => s.working)).toEqual([false, false, false, false, true]);
    expect(v.steps[0].label).toBe('Set 1 of 5, bare bar, 20 kilograms');
    expect(v.steps[1].label).toBe('Set 2 of 5, 50 percent, 70 kilograms, add 25 kilograms per side');
    expect(v.steps[4].label).toBe(
      'Set 5 of 5, working set, 140 kilograms, take off 0.5 and 2.5, then add 10 kilograms per side',
    );
  });

  it('keeps Next live, with no copy of its own, before the Working set (RBAR-95)', () => {
    for (const i of [0, 1, 2, 3]) expect(warmupView(RAMP140, i, 'kg', 'kg').next).toEqual({ disabled: false });
  });

  it('disables Next on the Working set (RBAR-95: it still reads just "Next")', () => {
    expect(warmupView(RAMP140, 4, 'kg', 'kg').next).toEqual({ disabled: true });
  });

  it('captions the selected row\'s add beside "per side" (none on the bare Bar)', () => {
    expect(warmupView(RAMP140, 0, 'kg', 'kg').addCaption).toBeNull();
    expect(warmupView(RAMP140, 1, 'kg', 'kg').addCaption).toBe('+25 kg');
  });

  it('captions nothing when the row repeats the previous Side', () => {
    // 30 kg Working set: the 50% row lands on the bare Bar again (sameAsPrevious).
    const rows = planRamp(30, DEFAULT_RAMP, COMP).rows;
    expect(rows[1].sameAsPrevious).toBe(true);
    expect(warmupView(rows, 1, 'kg', 'kg').addCaption).toBeNull();
  });

  it('clamps the selection into the rows', () => {
    expect(warmupView(RAMP140, 9, 'kg', 'kg').selected).toBe(4);
    expect(warmupView(RAMP140, -1, 'kg', 'kg').selected).toBe(0);
  });

  it('reads Totals in the display unit and Plates in their stamped unit', () => {
    const v = warmupView(RAMP140, 0, 'lb', 'kg');
    expect(v.steps[4].totalNum).toBe('309');
    expect(v.steps[4].totalUnit).toBe('lb');
    expect(warmupView(RAMP140, 1, 'lb', 'kg').addCaption).toBe('+25 kg');
  });
});

describe('parseWorking (rackbar.working read validation, ADR-0007)', () => {
  it('reads a positive finite kg weight', () => {
    expect(parseWorking('140')).toBe(140);
    expect(parseWorking('142.88')).toBe(142.88);
  });

  it('reads missing, blank, garbage, zero, negative and non-finite values as no Working set', () => {
    for (const raw of [null, '', '  ', 'abc', '0', '-5', 'Infinity', 'NaN', '1e999']) {
      expect(parseWorking(raw)).toBeNull();
    }
  });
});
