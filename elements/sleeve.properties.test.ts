// Property: a Collar is drawn iff collars are on and the Bar has Plates (RBAR-96,
// ADR-0008). Setup's Collar already counts in the Total (ADR-0008); RBAR-96 also DRAWS
// it, clamped on the outer disc, and never on a bare Bar (no disc to clamp). Each
// surface that draws the sleeve is judged through its real input path: the console's
// sleeve in By Weight (the keypad), By Plates (palette taps) and Warm up (the stairs),
// the fullscreen card's sleeve, and the share picture's layout (lib/sleevefit's
// sleeveLayout, which the canvas paints). Every sleeve also ends in the bare stub, never
// the old end collar + cap.
import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import './fullscreen.ts';
import { SLEEVE_BLOCK_PX, sleeveLayout } from '../lib/sleevefit.ts';
import type { LoadSummary } from '../lib/summary.ts';
import { draftToKg, shownIn } from '../lib/units.ts';
import {
  SEED, resetPool, on, fresh, q, sr, modeBtn, type, tapAdd, rigArb, unitArb, draftArb,
  linkStateArb, rigDraftCaseArb, commitWorking, stairs,
} from './properties.drivers.ts';

beforeEach(resetPool);

const RULE = 'a Collar is drawn iff collars are on and the Bar has Plates (RBAR-96, ADR-0008)';

/**
 * The rule on one rendered sleeve: a Collar exactly when `collarsOn` and a disc is
 * drawn; when drawn there is one, right after the outer disc and right before the bare
 * end; every sleeve ends in the bare stub with no end collar or cap.
 */
function expectCollarRule(sleeve: ShadowRoot, collarsOn: boolean, where: string): void {
  const discs = sleeve.querySelectorAll('.disc').length;
  const collars = [...sleeve.querySelectorAll<HTMLElement>('.collar-on')];
  expect(collars.length, `${where}: collars drawn (discs ${discs}, on ${collarsOn})`).toBe(
    collarsOn && discs > 0 ? 1 : 0,
  );
  const end = sleeve.querySelectorAll('.bare-end');
  expect(end.length, `${where}: one bare end`).toBe(1);
  expect(sleeve.querySelector('.collar-end, .cap'), `${where}: no end collar or cap`).toBeNull();
  if (collars.length === 1) {
    expect(collars[0]!.previousElementSibling!.classList.contains('disc'), where).toBe(true);
    expect(collars[0]!.nextElementSibling, where).toBe(end[0]);
  }
}

const consoleSleeve = (el: HTMLElement) => sr(q(sr(el), 'rack-sleeve'));

describe(RULE, () => {
  it('By Weight: for any Target on any rig, collars on or off', () => {
    fc.assert(
      fc.property(rigArb, unitArb, draftArb, (rig, u, draft) => {
        const el = on(rig, u);
        type(el, draft);
        expectCollarRule(consoleSleeve(el), rig.collarKg > 0, `${rig.name} ${draft} ${u}`);
      }),
      { seed: SEED, numRuns: 80 },
    );
  });

  it('By Plates: for any taps on any rig, collars on or off', () => {
    fc.assert(
      fc.property(rigArb, unitArb, fc.array(fc.nat(), { maxLength: 24 }), (rig, u, picks) => {
        const el = on(rig, u);
        modeBtn(el, 'encode').click();
        expectCollarRule(consoleSleeve(el), rig.collarKg > 0, `${rig.name} bare`);
        for (const i of picks) tapAdd(el, rig.inventory[i % rig.inventory.length]!.kg);
        expectCollarRule(consoleSleeve(el), rig.collarKg > 0, `${rig.name} ${picks}`);
      }),
      { seed: SEED, numRuns: 40 },
    );
  });

  it('Warm up: every row of the Ramp, the bare-Bar row included', () => {
    const workArb = rigDraftCaseArb.filter(([, u, d]) => {
      const kg = draftToKg(d, u) ?? 0;
      return kg > 0 && String(shownIn(kg, u)) === d;
    });
    fc.assert(
      fc.property(workArb, ([rig, u, draft]) => {
        const el = fresh(rig, u);
        modeBtn(el, 'warmup').click();
        commitWorking(el, draft);
        const rows = stairs(el);
        rows.forEach((row, i) => {
          row.click();
          expectCollarRule(consoleSleeve(el), rig.collarKg > 0, `${rig.name} ${draft} row ${i}`);
        });
      }),
      { seed: SEED, numRuns: 15 },
    );
  });

  it('Setup turning collars on or off redraws the loaded sleeve at once', () => {
    fc.assert(
      fc.property(rigArb, unitArb, draftArb, (rig, u, draft) => {
        const el = fresh(rig, u);
        type(el, draft);
        el.collarKg = rig.collarKg > 0 ? 0 : 2.5;
        expectCollarRule(consoleSleeve(el), el.collarKg > 0, `${rig.name} ${draft} toggled`);
        el.collarKg = rig.collarKg;
        expectCollarRule(consoleSleeve(el), rig.collarKg > 0, `${rig.name} ${draft} back`);
      }),
      { seed: SEED, numRuns: 20 },
    );
  });

  it('the fullscreen sleeve and the share picture layout, for any shared load', () => {
    fc.assert(
      fc.property(linkStateArb, (s) => {
        document.body.innerHTML = '';
        const load: LoadSummary = {
          side: s.side,
          barKg: s.barKg,
          collarKg: s.collarKg,
          unit: s.unit,
        };
        const fs = document.createElement('rack-fullscreen') as HTMLElement & {
          load: LoadSummary;
          open(): void;
        };
        document.body.append(fs);
        fs.load = load;
        fs.open();
        const on = s.collarKg > 0;
        expectCollarRule(sr(q(sr(fs), 'rack-sleeve')), on, `fullscreen ${s.set}`);

        const kinds = sleeveLayout(s.side, 360, SLEEVE_BLOCK_PX, on).map((p) => p.kind);
        expect(kinds.filter((k) => k === 'collar').length).toBe(on && s.side.length > 0 ? 1 : 0);
        expect(kinds[kinds.length - 1]).toBe('bare-end');
      }),
      { seed: SEED, numRuns: 40 },
    );
  });
});
