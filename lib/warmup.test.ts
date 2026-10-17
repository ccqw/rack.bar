// Example tests for the Warm up view logic (RBAR-65 slice 2): how a planned Ramp reads.
import { describe, it, expect } from 'vitest';
import {
  sideDelta,
  rowDelta,
  deltaText,
  deltaSpoken,
  stepName,
  stepFractions,
  walkIndex,
  warmStatus,
  warmupView,
  nextLabel,
  parseWorking,
} from './warmup.ts';
import { planRamp, DEFAULT_RAMP } from './plan.ts';
import type { RampRig } from './plan.ts';
import { ELEIKO_KG, IRON_LB } from './plates.ts';
import { lbToKg } from './units.ts';

const COMP: RampRig = { barKg: 20, collarKg: 0, inventory: ELEIKO_KG };
const IRON: RampRig = { barKg: lbToKg(45), collarKg: 0, inventory: IRON_LB };
const kg = (n: number) => ELEIKO_KG.find((p) => p.kg === n)!;
const lb = (s: string) => IRON_LB.find((p) => p.label === s)!;
const kgs = (side: readonly { kg: number }[]) => side.map((p) => p.kg);

// Caitlin's 140 kg ramp: 20 / 70 (25) / 98 (25+10+2.5+1.5) / 126 (25+25+2.5+0.5) / 140 (25+25+10).
const RAMP140 = planRamp(140, DEFAULT_RAMP, COMP).rows;

describe('sideDelta', () => {
  it('lists only the Plates to add when the next Side keeps the previous one', () => {
    const d = sideDelta([kg(25)], [kg(25), kg(15)]);
    expect(kgs(d.added)).toEqual([15]);
    expect(d.removed).toEqual([]);
  });

  it('lists Plates to take off and put on when the stack changes (a swap)', () => {
    const d = sideDelta([kg(25), kg(10), kg(2.5), kg(1.5)], [kg(25), kg(25), kg(2.5), kg(0.5)]);
    expect(kgs(d.added)).toEqual([25, 0.5]);
    expect(kgs(d.removed)).toEqual([10, 1.5]);
  });

  it('counts duplicates (a second 25 is an add)', () => {
    expect(kgs(sideDelta([kg(25)], [kg(25), kg(25)]).added)).toEqual([25]);
  });

  it('is empty for identical Sides', () => {
    expect(sideDelta([kg(25), kg(5)], [kg(25), kg(5)])).toEqual({ added: [], removed: [] });
  });

  it('never matches an iron Plate to an Eleiko one', () => {
    const d = sideDelta([kg(20)], [lb('45')]);
    expect(d.added).toEqual([lb('45')]);
    expect(d.removed).toEqual([kg(20)]);
  });
});

describe('rowDelta', () => {
  it('diffs each row against the previous one (the first against a bare Bar)', () => {
    expect(kgs(rowDelta(RAMP140, 0).added)).toEqual([]);
    expect(kgs(rowDelta(RAMP140, 1).added)).toEqual([25]);
    expect(kgs(rowDelta(RAMP140, 4).added)).toEqual([10]);
    expect(kgs(rowDelta(RAMP140, 4).removed)).toEqual([2.5, 0.5]);
  });
});

describe('deltaText / deltaSpoken (every number carries its unit)', () => {
  it('reads an add-only change as "+N unit", one unit at the end', () => {
    expect(deltaText({ added: [kg(15)], removed: [] }, 'kg')).toBe('+15 kg');
    expect(deltaText({ added: [kg(15), kg(2.5)], removed: [] }, 'kg')).toBe('+15 +2.5 kg');
    expect(deltaSpoken({ added: [kg(15), kg(2.5)], removed: [] }, 'kg')).toBe(
      'add 15 and 2.5 kilograms per side',
    );
  });

  it('reads a change with pops as a swap', () => {
    expect(deltaText({ added: [kg(5)], removed: [kg(2.5)] }, 'kg')).toBe('swap 2.5 -> 5 kg');
    expect(deltaSpoken({ added: [kg(5)], removed: [kg(2.5)] }, 'kg')).toBe(
      'swap 2.5 for 5 kilograms per side',
    );
  });

  it('reads a take-off-only change with minus signs', () => {
    expect(deltaText({ added: [], removed: [kg(2.5)] }, 'kg')).toBe('-2.5 kg');
    expect(deltaSpoken({ added: [], removed: [kg(2.5)] }, 'kg')).toBe(
      'take off 2.5 kilograms per side',
    );
  });

  it('uses the iron Plates\' stamped pound faces', () => {
    expect(deltaText({ added: [lb('45')], removed: [] }, 'lb')).toBe('+45 lb');
    expect(deltaSpoken({ added: [lb('45')], removed: [] }, 'lb')).toBe('add 45 pounds per side');
  });

  it('is null when nothing changes', () => {
    expect(deltaText({ added: [], removed: [] }, 'kg')).toBeNull();
    expect(deltaSpoken({ added: [], removed: [] }, 'kg')).toBeNull();
  });
});

describe('stepName', () => {
  it('names the stairs Bar, N%, Work -- the percent sign on every percentage', () => {
    expect(RAMP140.map(stepName)).toEqual(['Bar', '50%', '70%', '90%', 'Work']);
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

describe('nextLabel', () => {
  it('names the next step and its Total with the unit', () => {
    expect(nextLabel(RAMP140[3], 'kg')).toBe('Next: 90% - 126 kg');
    expect(nextLabel(RAMP140[4], 'lb')).toBe('Next: Work - 309 lb');
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
      'Set 5 of 5, working set, 140 kilograms, swap 2.5 and 0.5 for 10 kilograms per side',
    );
  });

  it('points Next at the following row with what to change', () => {
    const v = warmupView(RAMP140, 1, 'kg', 'kg');
    expect(v.next).toEqual({
      label: 'Next: 70% - 98 kg',
      sub: '+10 +2.5 +1.5 kg per side',
      disabled: false,
    });
    expect(warmupView(RAMP140, 3, 'kg', 'kg').next.sub).toBe('swap 2.5 + 0.5 -> 10 kg per side');
  });

  it('disables Next on the Working set', () => {
    expect(warmupView(RAMP140, 4, 'kg', 'kg').next).toEqual({
      label: 'Working set loaded',
      sub: '',
      disabled: true,
    });
  });

  it('captions the selected row\'s add beside "per side" (none on the bare Bar)', () => {
    expect(warmupView(RAMP140, 0, 'kg', 'kg').addCaption).toBeNull();
    expect(warmupView(RAMP140, 1, 'kg', 'kg').addCaption).toBe('+25 kg');
  });

  it('says "same plates" when the next row repeats the Side', () => {
    // 30 kg Working set: the 50% row lands on the bare Bar again (sameAsPrevious).
    const rows = planRamp(30, DEFAULT_RAMP, COMP).rows;
    expect(rows[1].sameAsPrevious).toBe(true);
    expect(warmupView(rows, 0, 'kg', 'kg').next.sub).toBe('same plates');
  });

  it('clamps the selection into the rows', () => {
    expect(warmupView(RAMP140, 9, 'kg', 'kg').selected).toBe(4);
    expect(warmupView(RAMP140, -1, 'kg', 'kg').selected).toBe(0);
  });

  it('reads Totals in the display unit and Plates in their stamped unit', () => {
    const v = warmupView(RAMP140, 0, 'lb', 'kg');
    expect(v.steps[4].totalNum).toBe('309');
    expect(v.steps[4].totalUnit).toBe('lb');
    expect(v.next.sub).toBe('+25 kg per side');
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
