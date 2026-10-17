// Property-based invariants for the Warm up mode (RBAR-65 slice 2), driven through the
// REAL input paths -- the working-weight keypad, stair taps, the Next button, the kg|lb
// and mode toggles, Share, and a reload -- and judged from what is on screen. Each `it`
// is named after the rule it guards, with its ADR. Expected Totals come from the
// ADR-derived oracle (rampTotalsOracle, lib/properties.oracle.ts), never from the
// planner under test; Warm-up sets are judged against the station rule's 5% band
// (ADR-0015 as amended), since the screen loads planEasyRamp. Drivers + generators are in properties.drivers.ts.
import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { DEFAULT_RAMP } from '../lib/plan.ts';
import { RAMP_BAND } from '../lib/moves.ts';
import { pushRecent } from '../lib/recents.ts';
import { draftToKg, displayCeilingKg, format, shownIn } from '../lib/units.ts';
import type { Unit } from '../lib/units.ts';
import { rampTotalsOracle, achievableTotals } from '../lib/properties.oracle.ts';
import type { Rig } from '../lib/properties.oracle.ts';
import {
  SEED, EPS, other, fresh, resetPool, q, sr, unitBtn, modeBtn, totalText, sideOnScreen,
  stairs, nextBtn, workDraft, commitWorking, storedRecents, rigDraftCaseArb, nextRun,
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

// Whether `shown` is a Total the station-rule Ramp may load on row `i` (ADR-0015 as
// amended): the bare-Bar row is the Bar, the Working set is the oracle's Total exactly,
// and a Warm-up set is any Total within the band (RAMP_BAND of the Working Total) of
// its raw target (pct x Working Total), between the loaded bare rig and the Working
// Total -- or, when the floor forces it out (nothing achievable in the band), its
// nearest Total or any Total up to the Working set.
function allowedRowKg(rig: Rig, want: readonly number[], i: number, shown: number): boolean {
  const last = want.length - 1;
  const step = DEFAULT_RAMP[i];
  if (i === last || step.kind === 'bar') return Math.abs(shown - want[i]) < 1e-6;
  if (Math.abs(shown - want[i]) < 1e-6) return true;
  const working = want[last];
  const grid = Math.min(...rig.inventory.map((p) => p.kg));
  const tol = Math.max(RAMP_BAND * working, grid);
  const raw = (working * step.pct) / 100;
  const between = shown >= rig.baselineKg - 1e-6 && shown <= working + 1e-6;
  const forced = !achievableTotals(rig).some(
    (t) => t >= rig.baselineKg - 1e-6 && t <= working + 1e-6 && Math.abs(t - raw) <= tol + 1e-6,
  );
  return between && (forced || Math.abs(shown - raw) <= tol + 1e-6);
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
  it('selecting any step shows exactly that row\'s Side and Total on the sleeve and readout (ADR-0005, ADR-0015)', async () => {
    await fc.assert(
      fc.asyncProperty(workCaseArb, fc.nat({ max: 4 }), async ([rig, u, draft], i) => {
        await nextRun();
        const el = warmOn(rig, u, draft);
        const want = oracleTotals(rig, u, draft);
        stairs(el)[i].click();
        expect(selected(el)).toBe(i);
        const shown = drawnRowKg(el, rig, i);
        expect(allowedRowKg(rig, want, i, shown)).toBe(true);
        expect(totalText(el)).toBe(format(shown, u));
        // The stair itself names the same Total, with its unit.
        expect(stairTotals(el)[i]).toBe(format(shown, u));
      }),
      { seed: SEED, numRuns: 30 },
    );
  });

  it('Next from row i selects row i+1, and only the Working set disables it (ADR-0015)', async () => {
    await fc.assert(
      fc.asyncProperty(workCaseArb, fc.nat({ max: 4 }), async ([rig, u, draft], i) => {
        await nextRun();
        const el = warmOn(rig, u, draft);
        const want = oracleTotals(rig, u, draft);
        stairs(el)[i].click();
        const last = want.length - 1;
        expect(nextBtn(el).disabled).toBe(i === last);
        const before = drawnRowKg(el, rig, i);
        nextBtn(el).click();
        const j = Math.min(i + 1, last);
        expect(selected(el)).toBe(j);
        const after = drawnRowKg(el, rig, j);
        expect(allowedRowKg(rig, want, j, after)).toBe(true);
        expect(totalText(el)).toBe(format(after, u));
        // The Ramp never steps down (ADR-0015 as amended).
        if (j > i && i > 0) expect(after).toBeGreaterThanOrEqual(before - 1e-6);
      }),
      { seed: SEED, numRuns: 25 },
    );
  });

  it('following the Next caption literally rebuilds the next Side exactly: off from the outside, then on (ADR-0015 as amended)', async () => {
    // The caption is what the lifter does at the Bar. Read it off the Next button,
    // apply it to the Side on screen, and the result must be the Side Next loads.
    const faces = (rig: Rig, el: HTMLElement) =>
      sideOnScreen(el).map((d) => {
        const p = rig.inventory.find((x) => Math.abs(x.kg - d.kg) < 1e-9)!;
        return p.label ?? String(p.kg);
      });
    const apply = (side: string[], sub: string): string[] => {
      const body = sub.replace(/ per side$/, '').replace(/ (kg|lb)$/, '');
      const out = [...side];
      let off: string[] = [];
      let on: string[] = [];
      const m = /^off (.+), on (.+)$/.exec(body);
      if (m) {
        off = m[1].split(' + ');
        on = m[2].split(' + ');
      } else {
        for (const t of body.split(' ')) (t.startsWith('-') ? off : on).push(t.slice(1));
      }
      for (const f of off) {
        // Only the outermost Plate can come off.
        expect(out[out.length - 1]).toBe(f);
        out.pop();
      }
      return [...out, ...on];
    };
    await fc.assert(
      fc.asyncProperty(workCaseArb, async ([rig, u, draft]) => {
        await nextRun();
        const el = warmOn(rig, u, draft);
        const n = stairs(el).length;
        for (let i = 0; i < n - 1; i++) {
          stairs(el)[i].click();
          const before = faces(rig, el);
          const sub = nextBtn(el).querySelector('[data-next-sub]')!.textContent ?? '';
          nextBtn(el).click();
          const after = faces(rig, el);
          if (sub === 'same plates') expect(after).toEqual(before);
          else expect(apply(before, sub)).toEqual(after);
        }
      }),
      { seed: SEED, numRuns: 30 },
    );
  });

  it('Warm up never pushes a warm-up row onto Recents; only the working-weight commit does (ADR-0009)', async () => {
    type Act = { kind: 'stair'; i: number } | { kind: 'next' } | { kind: 'share' } | { kind: 'unit' };
    const actArb: fc.Arbitrary<Act> = fc.oneof(
      fc.nat({ max: 4 }).map((i) => ({ kind: 'stair' as const, i })),
      fc.constant({ kind: 'next' as const }),
      fc.constant({ kind: 'share' as const }),
      fc.constant({ kind: 'unit' as const }),
    );
    await fc.assert(
      fc.asyncProperty(workCaseArb, fc.array(actArb, { maxLength: 6 }), async ([rig, u, draft], acts) => {
        await nextRun();
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

  it('the working weight round-trips through rackbar.working across a reload (ADR-0007, ADR-0009)', async () => {
    await fc.assert(
      fc.asyncProperty(workCaseArb, async ([rig, u, draft]) => {
        await nextRun();
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

  it('a unit toggle keeps the working weight as read: an Exact Working set stays put, a load never moves down, and a second round trip changes nothing (ADR-0010 RBAR-60)', async () => {
    await fc.assert(
      fc.asyncProperty(workCaseArb, async ([rig, u, draft]) => {
        await nextRun();
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
