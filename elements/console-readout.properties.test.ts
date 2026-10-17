// Property-based invariants for the console shell (RBAR-62), driven through the REAL
// input paths -- keypad taps, the hero's steppers and tap, the "You asked" chip, the
// kg|lb toggle -- and judged from what is on screen. Each `it` is named after the rule it
// guards, with its ADR. Expected values come from the ADR-derived oracle
// (lib/properties.oracle.ts), never from the solver under test. Drivers + generators are
// in properties.drivers.ts. Deterministic: a fixed seed and modest run counts.
// This file: RBAR-58's By Weight readout, option C "split when different" -- one hero
// number that is always the Total on the bar and is also the Target's editor; the Target
// splits off as a "You asked" chip only when the load misses it as read.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { format, shownIn, stepFor } from '../lib/units.ts';
import { RIGS } from '../lib/properties.oracle.ts';
import {
  SEED, on, step, type, press, roundUp, totalText, statusKind, statusLabel, entryDraft,
  drawnTotalKg, shownTarget, askedText, askedBtn, secondaryShown, heroTap, done,
  sheetOpen, sheetNumber, stepBtn, recentFaces, rigDraftCaseArb, offGridCaseArb, expectedFor, rigArb, unitArb,
  draftArb,
} from './properties.drivers.ts';

const fmt = (n: number) => String(Number(n.toFixed(2)));

describe('<rack-console> By Weight readout properties (RBAR-58)', () => {
  it('split when different: the hero is always the Total on the bar; the "You asked" chip shows exactly when that Total misses the Target as read, names the reading, and sits the pill\'s magnitude from the hero (RBAR-58, ADR-0010, ADR-0003)', () => {
    fc.assert(
      fc.property(rigDraftCaseArb, fc.boolean(), ([rig, u, draft], takeRoundUp) => {
        const el = on(rig, u);
        type(el, draft);
        if (takeRoundUp && !roundUp(el).hidden) roundUp(el).click();
        const want = expectedFor(rig, u, draft);
        if (!takeRoundUp) expect(drawnTotalKg(el, rig)).toBeCloseTo(want.totalKg, 9);
        // The hero names what is on the bar -- the sleeve's own sum -- in every state.
        expect(totalText(el)).toBe(format(drawnTotalKg(el, rig), u));
        const target = shownTarget(el, u);
        const total = shownIn(drawnTotalKg(el, rig), u);
        if (total === target) {
          // They agree as read: the Target is not shown twice; the Secondary keeps its place.
          expect(statusKind(el)).toBe('exact');
          expect(askedText(el)).toBeNull();
          expect(secondaryShown(el)).toBe(true);
        } else {
          expect(statusKind(el)).not.toBe('exact');
          expect(askedText(el)).toBe(`You asked ${fmt(target)} ${u}`);
          expect(secondaryShown(el)).toBe(false);
          // "You asked" minus the hero is exactly the miss the pill reads.
          expect(statusLabel(el)).toBe(
            `${fmt(Math.abs(target - total))} ${u} ${total < target ? 'short' : 'over'}`,
          );
        }
      }),
      { seed: SEED, numRuns: 40, examples: [[[RIGS[0], 'kg', '142.3'], false]] },
    );
  });

  it('the hero steppers act on the Target, not the Total: from a split load + and - move the Target\'s reading to the next grid line, and the hero re-solves for it (RBAR-58, ADR-0010 RBAR-38)', () => {
    fc.assert(
      fc.property(
        offGridCaseArb,
        fc.constantFrom<'inc' | 'dec'>('inc', 'dec'),
        ([rig, u, draft], dir) => {
          const el = on(rig, u);
          type(el, draft);
          const grid = stepFor(u);
          const t = Number(entryDraft(el));
          const q = t / grid;
          const onGrid = Math.abs(q - Math.round(q)) < 1e-9;
          const n =
            dir === 'inc'
              ? onGrid ? Math.round(q) + 1 : Math.ceil(q - 1e-9)
              : onGrid ? Math.round(q) - 1 : Math.floor(q + 1e-9);
          const next = String(Math.max(0, Number((n * grid).toFixed(2))));
          step(el, dir);
          // The Target moved from its own reading (142.3 -> 143), not from the hero's
          // Total (142 -> 143 would be the same here, but 142 -> 141 on "-" would not).
          expect(entryDraft(el)).toBe(next);
          expect(drawnTotalKg(el, rig)).toBeCloseTo(expectedFor(rig, u, next).totalKg, 9);
          expect(totalText(el)).toBe(format(drawnTotalKg(el, rig), u));
        },
      ),
      // The ticket's own case: + from "142, asked 142.3" goes to 143, - goes to 142.
      {
        seed: SEED,
        numRuns: 30,
        examples: [
          [[RIGS[0], 'kg', '142.3'], 'inc'],
          [[RIGS[0], 'kg', '142.3'], 'dec'],
        ],
      },
    );
  });

  it('the keypad opens on the Target, not the Total: from the hero and the "You asked" chip the open sheet shows the Target as typed, which differs from the hero whenever they split; a hero re-tap keeps it open (RBAR-58, RBAR-57, ADR-0010)', () => {
    fc.assert(
      fc.property(rigDraftCaseArb, ([rig, u, draft]) => {
        const el = on(rig, u);
        type(el, draft);
        const typed = String(Number(draft)); // the reading the lifter typed
        const hero = String(shownIn(drawnTotalKg(el, rig), u)); // the number on the bar
        const split = askedText(el) !== null;
        for (const open of split ? [heroTap, askedBtn] : [heroTap]) {
          open(el).click();
          expect(sheetOpen(el)).toBe(true);
          // What the OPEN sheet shows is the Target -- never the hero's Total when the
          // two differ (142.3 on Competition: the sheet reads 142.3, the hero 142).
          expect(sheetNumber(el)).toBe(typed);
          if (split) expect(sheetNumber(el)).not.toBe(hero);
          heroTap(el).click(); // open-only (RBAR-57): a re-tap keeps editing
          expect(sheetOpen(el)).toBe(true);
          done(el);
          expect(sheetOpen(el)).toBe(false);
        }
      }),
      { seed: SEED, numRuns: 30, examples: [[[RIGS[0], 'kg', '142.3']]] },
    );
  });

  it('Enter on any Target editor control while the keypad is open is Done -- never a repeat of the last tap (RBAR-49, RBAR-58)', () => {
    fc.assert(
      fc.property(
        rigDraftCaseArb,
        fc.constantFrom<'dec' | 'inc' | 'hero' | 'asked'>('dec', 'inc', 'hero', 'asked'),
        ([rig, u, draft], which) => {
          const el = on(rig, u);
          type(el, draft);
          if (which === 'asked' && askedText(el) === null) return; // no chip to focus
          heroTap(el).click();
          const before = entryDraft(el);
          const ctl =
            which === 'hero' ? heroTap(el) : which === 'asked' ? askedBtn(el) : stepBtn(el, which);
          const enter = new KeyboardEvent('keydown', {
            key: 'Enter',
            bubbles: true,
            composed: true,
            cancelable: true,
          });
          ctl.dispatchEvent(enter);
          // Claimed (so the browser's native Enter activation of the focused control is
          // cancelled), the pad closed, and the Target untouched.
          expect(enter.defaultPrevented).toBe(true);
          expect(sheetOpen(el)).toBe(false);
          expect(entryDraft(el)).toBe(before);
        },
      ),
      { seed: SEED, numRuns: 30 },
    );
  });

  it('every number carries its unit: each Recent chip reads "<n> <unit>" in the active unit, as the hero does (RBAR-58, ADR-0009, ADR-0010)', () => {
    fc.assert(
      fc.property(
        rigArb,
        unitArb,
        fc.array(draftArb.filter((d) => Number(d) > 0), { minLength: 1, maxLength: 3 }),
        (rig, u, drafts) => {
          const el = on(rig, u);
          for (const d of drafts) {
            heroTap(el).click();
            press(el, 'clear');
            for (const ch of d) press(el, ch);
            done(el);
          }
          // (Pooled consoles share one storage key, so judge the faces' own form.)
          const faces = recentFaces(el);
          expect(faces.length).toBeGreaterThan(0);
          for (const f of faces) expect(f).toMatch(new RegExp(`^\\d+(\\.\\d{1,2})? ${u}$`));
          expect(totalText(el)).toMatch(new RegExp(` ${u}$`));
        },
      ),
      { seed: SEED, numRuns: 20 },
    );
  });
});
