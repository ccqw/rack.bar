// Property-based invariants for the console shell (RBAR-62), driven through the REAL
// input paths -- keypad taps, stepper taps, the kg|lb and mode toggles, the round-up
// button, palette taps, and the Bar/Collar/plate-set setters the app uses -- and judged
// from what is on screen. Each `it` is named after the rule it guards, with its ADR.
// Expected values come from the ADR-derived oracle (lib/properties.oracle.ts), never
// from the solver under test; the pure-core counterparts are lib/properties.test.ts.
// The shell suites are split across files so they run in parallel workers (and stay
// inside happy-dom's heap); drivers + generators are in properties.drivers.ts.
// Deterministic: a fixed seed and modest run counts. A failure prints the shrunk
// script; change SEED locally to explore further. Add a property per new on-screen rule.
// This file: the entry, readout, pill and round-up rules.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { draftToKg, displayCeilingKg, format, shownIn } from '../lib/units.ts';
import { RIGS, leastAbove } from '../lib/properties.oracle.ts';
import {
  SEED, other, on, press, step, type, roundUp, totalText, secondaryText,
  statusKind, statusLabel, atcapShown, barnoteShown, loadLine, entryDraft,
  sideOnScreen, drawnTotalKg, shownTarget, rigArb, unitArb, draftArb, gridCaseArb,
  offGridCaseArb,
} from './properties.drivers.ts';

// The pool is kept across this file's tests (each checkout resets the entry, mode and
// unit -- see on()), so the 20 rig x unit consoles are mounted once, not once per test.

describe('<rack-console> entry and readout properties (ADR-0003, ADR-0010)', () => {
  it('read-back: typing a displayed Total lands on that Total and reads Exact, every rig and unit (RBAR-60)', () => {
    fc.assert(
      fc.property(gridCaseArb, ([rig, u, total]) => {
        const el = on(rig, u);
        const reading = String(shownIn(total, u));
        type(el, reading);
        expect(drawnTotalKg(el, rig)).toBeCloseTo(total, 9);
        expect(totalText(el)).toBe(`${reading} ${u}`);
        expect(statusKind(el)).toBe('exact');
      }),
      // Always-run anchor: the 25 kg Total on the default rig reads 55 lb; the pre-RBAR-60
      // raw-kg solve took "55 lb" (24.95 kg) one Plate step low, to 24 kg ("53 lb").
      { seed: SEED, numRuns: 40, examples: [[[RIGS[0], 'lb', 25]]] },
    );
  });

  it('never shows the Total over the Target by default, except the bare-rig floor, which names itself (ADR-0003 as read, RBAR-55)', () => {
    fc.assert(
      fc.property(rigArb, unitArb, draftArb, (rig, u, draft) => {
        const el = on(rig, u);
        type(el, draft);
        const target = shownTarget(el, u);
        const total = shownIn(drawnTotalKg(el, rig), u);
        const belowBar = target < shownIn(rig.baselineKg, u);
        expect(barnoteShown(el)).toBe(belowBar);
        if (belowBar) {
          expect(sideOnScreen(el)).toEqual([]);
          expect(statusKind(el)).toBe('over');
        } else {
          expect(total).toBeLessThanOrEqual(target);
          expect(statusKind(el)).not.toBe('over');
        }
      }),
      { seed: SEED, numRuns: 40 },
    );
  });

  it('the pill, the round-up, the capacity caption and the keypad line all tell the same story (ADR-0003, ADR-0010, ADR-0012)', () => {
    fc.assert(
      fc.property(rigArb, unitArb, draftArb, (rig, u, draft) => {
        const el = on(rig, u);
        type(el, draft);
        const target = shownTarget(el, u);
        const total = shownIn(drawnTotalKg(el, rig), u);
        const mag = String(Number(Math.abs(target - total).toFixed(2)));
        const kind = statusKind(el);
        const offered = !roundUp(el).hidden;
        if (kind === 'exact') {
          expect(total).toBe(target);
          expect(offered).toBe(false);
          expect(atcapShown(el)).toBe(false);
          expect(loadLine(el)).toBe('exact');
        } else if (kind === 'short') {
          expect(statusLabel(el)).toBe(`${mag} ${u} short`);
          expect(offered).toBe(true);
          expect(atcapShown(el)).toBe(false);
          expect(loadLine(el)).toBe(`On the bar: ${total} ${u} (${mag} under)`);
        } else if (kind === 'capacity') {
          expect(statusLabel(el)).toBe(`${mag} ${u} short`);
          expect(offered).toBe(false);
          expect(atcapShown(el)).toBe(true);
          expect(loadLine(el)).toBe(`On the bar: ${total} ${u} (${mag} under, at capacity)`);
        } else {
          expect(kind).toBe('over'); // only the bare-rig floor (previous property)
          expect(statusLabel(el)).toBe(`${mag} ${u} over`);
          expect(offered).toBe(false);
          expect(loadLine(el)).toBe(`On the bar: ${total} ${u} (${mag} over)`);
        }
      }),
      { seed: SEED, numRuns: 40 },
    );
  });

  it('the round-up offers the least achievable Total past the reading; taking it then stepping back restores the primary (ADR-0003 RBAR-11, ADR-0010 RBAR-60)', () => {
    fc.assert(
      fc.property(offGridCaseArb, ([rig, u, draft]) => {
        const el = on(rig, u);
        type(el, draft);
        fc.pre(!roundUp(el).hidden); // rare: a reading that still lands Exact
        const primarySide = sideOnScreen(el);
        const primaryText = totalText(el);
        const ceiling = displayCeilingKg(draftToKg(entryDraft(el), u)!, u);
        const want = leastAbove(rig, ceiling)!;
        expect(roundUp(el).textContent).toBe(`Round up -> ${format(want, u)}`);
        roundUp(el).click();
        expect(drawnTotalKg(el, rig)).toBeCloseTo(want, 9);
        expect(statusKind(el)).toBe('over');
        roundUp(el).click(); // "Use <primary>"
        expect(sideOnScreen(el)).toEqual(primarySide);
        expect(totalText(el)).toBe(primaryText);
      }),
      { seed: SEED, numRuns: 30 },
    );
  });

  it('the readout is always a clean number: no NaN, primary = drawn Total in the unit, secondary = the same Total in the other unit, under any keypad/stepper script (ADR-0010)', () => {
    const keyArb = fc.constantFrom(
      '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '.', 'del', 'clear', 'inc', 'dec',
    );
    fc.assert(
      fc.property(rigArb, unitArb, fc.array(keyArb, { maxLength: 15 }), (rig, u, keys) => {
        const el = on(rig, u);
        for (const k of keys) {
          if (k === 'inc' || k === 'dec') step(el, k);
          else press(el, k);
          const kg = drawnTotalKg(el, rig);
          expect(totalText(el)).toMatch(/^\d+(\.\d{1,2})? (kg|lb)$/);
          expect(totalText(el)).toBe(format(kg, u));
          expect(secondaryText(el)).toBe(format(kg, other(u)));
          expect(entryDraft(el)).not.toMatch(/NaN|Infinity/);
        }
      }),
      { seed: SEED, numRuns: 25 },
    );
  });
});
