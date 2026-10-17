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
// This file: steppers, the unit toggle, and mode switches.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { format, stepFor } from '../lib/units.ts';
import {
  SEED, EPS, other, on, unitBtn, modeBtn, step, type, roundUp, tapAdd,
  totalText, secondaryText, statusKind, entryDraft, sideOnScreen, drawnTotalKg, rigArb,
  unitArb, draftArb, offGridCaseArb,
} from './properties.drivers.ts';

// The pool is kept across this file's tests (each checkout resets the entry, mode and
// unit -- see on()), so the 20 rig x unit consoles are mounted once, not once per test.

describe('<rack-console> stepper properties (ADR-0010 stepFor)', () => {
  it('steppers land on the 1 kg / 5 lb grid, never go negative, and +1 then -1 returns to the same grid value, on every set (ADR-0010)', () => {
    const scriptArb = fc.array(fc.constantFrom<'inc' | 'dec'>('inc', 'dec'), {
      minLength: 1,
      maxLength: 5,
    });
    fc.assert(
      fc.property(rigArb, unitArb, fc.option(draftArb), scriptArb, (rig, u, draft, script) => {
        const el = on(rig, u);
        if (draft !== null) type(el, draft);
        const grid = stepFor(u);
        for (const dir of script) {
          step(el, dir);
          const v = Number(entryDraft(el));
          expect(v).toBeGreaterThanOrEqual(0);
          expect(Math.abs(v / grid - Math.round(v / grid))).toBeLessThan(1e-9);
          step(el, 'inc');
          step(el, 'dec');
          expect(Number(entryDraft(el))).toBe(v);
        }
      }),
      { seed: SEED, numRuns: 20 },
    );
  });
});

describe('<rack-console> unit toggle properties (ADR-0010 RBAR-60 amendment)', () => {
  it('a kg -> lb -> kg round trip never moves the load down, keeps an Exact load identical, and settles (a second round trip changes nothing)', () => {
    fc.assert(
      fc.property(rigArb, unitArb, draftArb, (rig, u, draft) => {
        const el = on(rig, u);
        type(el, draft);
        const beforeKg = drawnTotalKg(el, rig);
        const beforeSide = sideOnScreen(el);
        const wasExact = statusKind(el) === 'exact';
        unitBtn(el, other(u)).click();
        unitBtn(el, u).click();
        expect(drawnTotalKg(el, rig)).toBeGreaterThanOrEqual(beforeKg - EPS);
        if (wasExact) {
          expect(sideOnScreen(el)).toEqual(beforeSide);
          expect(statusKind(el)).toBe('exact');
        }
        const settledSide = sideOnScreen(el);
        const settledDraft = entryDraft(el);
        unitBtn(el, other(u)).click();
        unitBtn(el, u).click();
        expect(sideOnScreen(el)).toEqual(settledSide);
        expect(entryDraft(el)).toBe(settledDraft);
      }),
      { seed: SEED, numRuns: 30 },
    );
  });

  it('a chosen round-up survives a toggle: the same load stays on the Bar, as the round-up or as the Exact primary, never a stale over (ADR-0010 RBAR-60)', () => {
    fc.assert(
      fc.property(offGridCaseArb, ([rig, u, draft]) => {
        const el = on(rig, u);
        type(el, draft);
        fc.pre(!roundUp(el).hidden); // rare: a reading that still lands Exact
        roundUp(el).click();
        const chosen = drawnTotalKg(el, rig);
        unitBtn(el, other(u)).click();
        expect(drawnTotalKg(el, rig)).toBeCloseTo(chosen, 9);
        const kind = statusKind(el);
        expect(['over', 'exact']).toContain(kind);
        if (kind === 'exact') expect(roundUp(el).hidden).toBe(true);
        else expect(roundUp(el).textContent).toMatch(/^Use /);
      }),
      { seed: SEED, numRuns: 25 },
    );
  });
});

describe('<rack-console> mode properties (ADR-0005)', () => {
  it('By Plates -> By Weight -> By Plates carries the Side Load untouched; the Total is Bar + 2 x Collar + 2 x Side Load in both units (ADR-0005, ADR-0008)', () => {
    fc.assert(
      fc.property(rigArb, unitArb, fc.array(fc.nat(), { maxLength: 12 }), (rig, u, picks) => {
        const el = on(rig, u);
        modeBtn(el, 'encode').click();
        for (const pick of picks) tapAdd(el, rig.inventory[pick % rig.inventory.length].kg);
        const built = sideOnScreen(el);
        const kg = rig.baselineKg + 2 * built.reduce((s, p) => s + p.kg, 0);
        modeBtn(el, 'decode').click();
        expect(sideOnScreen(el)).toEqual(built);
        expect(totalText(el)).toBe(format(kg, u));
        modeBtn(el, 'encode').click();
        expect(sideOnScreen(el)).toEqual(built);
        for (const unit of [other(u), u]) {
          unitBtn(el, unit).click();
          expect(totalText(el)).toBe(format(kg, unit));
          expect(secondaryText(el)).toBe(format(kg, other(unit)));
        }
      }),
      { seed: SEED, numRuns: 25 },
    );
  });
});
