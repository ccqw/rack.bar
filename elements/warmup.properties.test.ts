// Property-based invariants for the Warm up mode (RBAR-65 slice 2), driven through the
// REAL input paths -- the working-weight keypad, stair taps, the Next button, the kg|lb
// and mode toggles, Share, and a reload -- and judged from what is on screen. Each `it`
// is named after the rule it guards, with its ADR. Expected Totals come from the
// ADR-derived oracle (rampTotalsOracle, lib/properties.oracle.ts), never from the
// planner under test. Drivers + generators are in properties.drivers.ts.
import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { DEFAULT_RAMP } from '../lib/plan.ts';
import { pushRecent } from '../lib/recents.ts';
import { draftToKg, displayCeilingKg, format, shownIn } from '../lib/units.ts';
import type { Unit } from '../lib/units.ts';
import { rampTotalsOracle } from '../lib/properties.oracle.ts';
import type { Rig } from '../lib/properties.oracle.ts';
import {
  SEED, EPS, other, fresh, resetPool, q, sr, unitBtn, modeBtn, totalText, sideOnScreen,
  stairs, nextBtn, workDraft, commitWorking, storedRecents, rigDraftCaseArb,
} from './properties.drivers.ts';
import type { Console } from './properties.drivers.ts';

beforeEach(resetPool);

// A working weight the lifter could type: any of the rig-sized drafts above 0 that is a
// reading in its unit (lb readings are whole pounds -- a "0.01 lb" draft is not one, and
// re-reads as 0 after a toggle or a reload, exactly as the By Weight Target does).
const workCaseArb = rigDraftCaseArb.filter(([, u, d]) => {
  const kg = draftToKg(d, u) ?? 0;
  return kg > 0 && String(shownIn(kg, u)) === d;
});

// A console on `rig` in `u`, in Warm up, with `draft` committed as the working weight.
function warmOn(rig: Rig, u: Unit, draft: string): Console {
  const el = fresh(rig, u);
  modeBtn(el, 'warmup').click();
  commitWorking(el, draft);
  return el;
}

// The oracle's Ramp Totals for `draft` typed in `u` on `rig` (ADR-0015).
function oracleTotals(rig: Rig, u: Unit, draft: string): number[] {
  const t = draftToKg(draft, u)!;
  return rampTotalsOracle(rig, t, displayCeilingKg(t, u), DEFAULT_RAMP);
}

// The Total the sleeve's discs add up to for Ramp row `i`: the bare-Bar row carries no
// Collars (ADR-0015 Q5), every other row sits on the effective Bar (ADR-0008).
function drawnRowKg(el: HTMLElement, rig: Rig, i: number): number {
  const base = i === 0 ? rig.barKg : rig.baselineKg;
  return base + 2 * sideOnScreen(el).reduce((s, p) => s + p.kg, 0);
}

const selected = (el: HTMLElement) =>
  stairs(el).findIndex((b) => b.getAttribute('aria-pressed') === 'true');
const stairTotals = (el: HTMLElement) =>
  stairs(el).map((b) => b.querySelector('.tot')!.textContent ?? '');

describe('<rack-console> Warm up properties (RBAR-65, ADR-0005, ADR-0015)', () => {
  it('selecting any step shows exactly that row\'s Side and Total on the sleeve and readout (ADR-0005, ADR-0015)', () => {
    fc.assert(
      fc.property(workCaseArb, fc.nat({ max: 4 }), ([rig, u, draft], i) => {
        const el = warmOn(rig, u, draft);
        const want = oracleTotals(rig, u, draft);
        stairs(el)[i].click();
        expect(selected(el)).toBe(i);
        expect(Math.abs(drawnRowKg(el, rig, i) - want[i])).toBeLessThan(1e-6);
        expect(totalText(el)).toBe(format(want[i], u));
        // The stair itself names the same Total, with its unit.
        expect(stairTotals(el)[i]).toBe(format(want[i], u));
      }),
      { seed: SEED, numRuns: 30 },
    );
  });

  it('Next from row i selects row i+1, and only the Working set disables it (ADR-0015)', () => {
    fc.assert(
      fc.property(workCaseArb, fc.nat({ max: 4 }), ([rig, u, draft], i) => {
        const el = warmOn(rig, u, draft);
        const want = oracleTotals(rig, u, draft);
        stairs(el)[i].click();
        const last = want.length - 1;
        expect(nextBtn(el).disabled).toBe(i === last);
        nextBtn(el).click();
        const j = Math.min(i + 1, last);
        expect(selected(el)).toBe(j);
        expect(totalText(el)).toBe(format(want[j], u));
      }),
      { seed: SEED, numRuns: 25 },
    );
  });

  it('Warm up never pushes a warm-up row onto Recents; only the working-weight commit does (ADR-0009)', () => {
    type Act = { kind: 'stair'; i: number } | { kind: 'next' } | { kind: 'share' } | { kind: 'unit' };
    const actArb: fc.Arbitrary<Act> = fc.oneof(
      fc.nat({ max: 4 }).map((i) => ({ kind: 'stair' as const, i })),
      fc.constant({ kind: 'next' as const }),
      fc.constant({ kind: 'share' as const }),
      fc.constant({ kind: 'unit' as const }),
    );
    fc.assert(
      fc.property(workCaseArb, fc.array(actArb, { maxLength: 6 }), ([rig, u, draft], acts) => {
        const el = warmOn(rig, u, draft);
        let unit = u;
        for (const a of acts) {
          if (a.kind === 'stair') stairs(el)[a.i].click();
          else if (a.kind === 'next') nextBtn(el).click();
          else if (a.kind === 'share') q<HTMLButtonElement>(sr(el), '[data-share]').click();
          else {
            unit = other(unit);
            unitBtn(el, unit).click();
          }
        }
        expect(storedRecents()).toEqual(pushRecent([], draftToKg(draft, u)!));
      }),
      { seed: SEED, numRuns: 20 },
    );
  });

  it('the working weight round-trips through rackbar.working across a reload (ADR-0007, ADR-0009)', () => {
    fc.assert(
      fc.property(workCaseArb, ([rig, u, draft]) => {
        const el = warmOn(rig, u, draft);
        const shown = workDraft(el);
        const totals = stairTotals(el);
        el.remove();
        // A fresh console on the same rig, storage kept (a reload).
        const again = document.createElement('rack-console') as Console;
        document.body.append(again);
        again.barKg = rig.barKg;
        again.collarKg = rig.collarKg;
        again.plateSet = rig.set;
        modeBtn(again, 'warmup').click();
        expect(workDraft(again)).toBe(shown);
        expect(stairTotals(again)).toEqual(totals);
      }),
      { seed: SEED, numRuns: 20 },
    );
  });

  it('a unit toggle keeps the working weight as read: an Exact Working set stays put, a load never moves down, and a second round trip changes nothing (ADR-0010 RBAR-60)', () => {
    fc.assert(
      fc.property(workCaseArb, ([rig, u, draft]) => {
        const el = warmOn(rig, u, draft);
        const kg = draftToKg(draft, u)!;
        const workBefore = oracleTotals(rig, u, draft).at(-1)!;
        const exact = shownIn(workBefore, u) === shownIn(kg, u);
        unitBtn(el, other(u)).click();
        // As read: the field shows the same weight in the other unit -- the load itself
        // when it read Exact (RBAR-60), else the typed weight.
        expect(workDraft(el)).toBe(String(shownIn(exact ? workBefore : kg, other(u))));
        stairs(el).at(-1)!.click();
        const workAfter = drawnRowKg(el, rig, 4);
        expect(workAfter).toBeGreaterThanOrEqual(workBefore - EPS);
        if (exact) expect(Math.abs(workAfter - workBefore)).toBeLessThan(1e-6);
        unitBtn(el, u).click();
        const settled = [workDraft(el), ...stairTotals(el)];
        unitBtn(el, other(u)).click();
        unitBtn(el, u).click();
        expect([workDraft(el), ...stairTotals(el)]).toEqual(settled);
      }),
      { seed: SEED, numRuns: 25 },
    );
  });
});
