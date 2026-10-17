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
// This file: Bar, Collar and plate-set changes under action scripts.
import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { draftToKg, displayCeilingKg, format } from '../lib/units.ts';
import type { Unit } from '../lib/units.ts';
import { PLATE_SETS } from '../lib/platesets.ts';
import type { PlateSetKey } from '../lib/platesets.ts';
import { RIGS, COLLARS_KG, greatestAtOrUnder } from '../lib/properties.oracle.ts';
import type { Rig } from '../lib/properties.oracle.ts';
import {
  SEED, fresh, resetPool, unitBtn, modeBtn, type, roundUp, tapAdd, totalText,
  entryDraft, sideOnScreen, drawnTotalKg, unitArb, draftArb, rigDraftCaseArb,
} from './properties.drivers.ts';

beforeEach(resetPool);

describe('<rack-console> rig change properties (ADR-0007, ADR-0008, ADR-0010)', () => {
  // An action script over every input that can move the Side: typing, mode switches,
  // palette taps, unit toggles, and the app-driven Bar / Collar / plate-set setters.
  type Action =
    | { kind: 'type'; draft: string }
    | { kind: 'mode' } // flip By Weight <-> By Plates
    | { kind: 'add'; pick: number }
    | { kind: 'unit'; unit: Unit }
    | { kind: 'set' } // switch to the other plate set
    | { kind: 'bar'; pick: number }
    | { kind: 'collar'; kg: number }
    | { kind: 'roundup' };
  // Mode and set actions always FLIP (never a no-op) and are weighted up: the bug class
  // this guards (RBAR-32: a Side carried into By Weight leaking onto the new set) needs a
  // mode switch AND a set switch in one short script (and the property also pins those
  // shapes as always-run examples, below).
  const actionArb: fc.Arbitrary<Action> = fc.oneof(
    { weight: 2, arbitrary: draftArb.map((draft) => ({ kind: 'type' as const, draft })) },
    { weight: 3, arbitrary: fc.constant({ kind: 'mode' as const }) },
    { weight: 2, arbitrary: fc.nat().map((pick) => ({ kind: 'add' as const, pick })) },
    { weight: 1, arbitrary: unitArb.map((unit) => ({ kind: 'unit' as const, unit })) },
    { weight: 3, arbitrary: fc.constant({ kind: 'set' as const }) },
    { weight: 1, arbitrary: fc.nat().map((pick) => ({ kind: 'bar' as const, pick })) },
    {
      weight: 1,
      arbitrary: fc.constantFrom(...COLLARS_KG).map((kg) => ({ kind: 'collar' as const, kg })),
    },
    { weight: 1, arbitrary: fc.constant({ kind: 'roundup' as const }) },
  );

  it('no Plate from another set ever survives, in any mode or sequence; a set switch keeps the unit and re-solves a live Target on the new rig (ADR-0010 RBAR-60, RBAR-32)', () => {
    fc.assert(
      fc.property(fc.array(actionArb, { maxLength: 15 }), (actions) => {
        const el = fresh(RIGS[0], 'kg');
        let set: PlateSetKey = 'comp';
        let barKg = PLATE_SETS.comp.defaultBarKg;
        let collarKg = 0;
        let unit: Unit = 'kg';
        let mode: 'decode' | 'encode' = 'decode';
        let live = false; // a Target typed in Decode since the last mode switch
        const rig = (): Rig =>
          RIGS.find((r) => r.set === set && r.barKg === barKg && r.collarKg === collarKg)!;
        for (const a of actions) {
          if (a.kind === 'type') {
            if (mode !== 'decode') continue;
            type(el, a.draft);
            live = true;
          } else if (a.kind === 'mode') {
            mode = mode === 'decode' ? 'encode' : 'decode';
            live = false;
            modeBtn(el, mode).click();
          } else if (a.kind === 'add') {
            if (mode !== 'encode') continue;
            const inv = PLATE_SETS[set].inventory;
            tapAdd(el, inv[a.pick % inv.length].kg);
          } else if (a.kind === 'unit') {
            unit = a.unit;
            unitBtn(el, a.unit).click();
          } else if (a.kind === 'set') {
            const draftBefore = entryDraft(el);
            set = set === 'comp' ? 'training' : 'comp';
            barKg = PLATE_SETS[set].defaultBarKg;
            el.barKg = barKg; // the app's order (adoptPlateSet): Bar, then set
            el.plateSet = set;
            expect(unitBtn(el, unit).getAttribute('aria-pressed')).toBe('true');
            if (mode === 'decode' && live && draftBefore !== '') {
              const t = draftToKg(draftBefore, unit)!;
              expect(drawnTotalKg(el, rig())).toBeCloseTo(
                greatestAtOrUnder(rig(), displayCeilingKg(t, unit)),
                9,
              );
            }
          } else if (a.kind === 'bar') {
            const bars = PLATE_SETS[set].bars;
            barKg = bars[a.pick % bars.length].kg;
            el.barKg = barKg;
          } else if (a.kind === 'collar') {
            collarKg = a.kg;
            el.collarKg = collarKg;
          } else if (!roundUp(el).hidden) {
            roundUp(el).click();
          }
          const inv = PLATE_SETS[set].inventory;
          for (const p of sideOnScreen(el)) {
            expect(inv.some((x) => x.kg === p.kg && x.color === p.color)).toBe(true);
          }
          expect(totalText(el)).toBe(format(drawnTotalKg(el, rig()), unit));
        }
      }),
      {
        seed: SEED,
        numRuns: 20,
        // Always-run anchors: the RBAR-32 shapes (a Side carried into By Weight, built
        // or decoded, then a set switch). Random scripts reach them only rarely at this
        // run count, so they are pinned as examples on top of the generated runs.
        examples: [
          [[{ kind: 'mode' }, { kind: 'add', pick: 0 }, { kind: 'mode' }, { kind: 'set' }]],
          [[{ kind: 'type', draft: '21' }, { kind: 'mode' }, { kind: 'mode' }, { kind: 'set' }]],
        ],
      },
    );
  });

  it('a Bar or Collar change re-solves the same Target on the new baseline (total - delta invariant, ADR-0002, ADR-0008)', () => {
    // A Target sized to the rig (mostly within reach, so "re-solve the Target" and
    // "keep the old Total" give different answers), then any other Bar/Collar of the set.
    const changeArb = rigDraftCaseArb.chain(([from, u, draft]) =>
      fc
        .constantFrom(...RIGS.filter((r) => r.set === from.set))
        .map((to) => [from, to, u, draft] as const),
    );
    fc.assert(
      fc.property(changeArb, ([from, to, u, draft]) => {
        const el = fresh(from, u);
        type(el, draft);
        const draftBefore = entryDraft(el);
        el.barKg = to.barKg;
        el.collarKg = to.collarKg;
        expect(entryDraft(el)).toBe(draftBefore); // the Target is untouched
        const t = draftToKg(draftBefore, u)!;
        expect(drawnTotalKg(el, to)).toBeCloseTo(greatestAtOrUnder(to, displayCeilingKg(t, u)), 9);
      }),
      { seed: SEED, numRuns: 15 },
    );
  });
});
