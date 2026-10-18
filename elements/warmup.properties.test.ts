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
import { draftToKg, displayCeilingKg, displayFloorKg, format, shownIn } from '../lib/units.ts';
import type { Unit } from '../lib/units.ts';
import {
  RIGS, rampTotalsOracle, achievableTotals, maxTotal, warmWorkingOracle,
} from '../lib/properties.oracle.ts';
import type { Rig } from '../lib/properties.oracle.ts';
import {
  SEED, EPS, other, fresh, resetPool, q, sr, unitBtn, modeBtn, totalText, sideOnScreen,
  stairs, nextBtn, workDraft, commitWorking, storedRecents, rigDraftCaseArb, nextRun,
  rigArb, unitArb, tapAdd, type, step, entryDraft, workRoot, expectedFor,
  statusEl, statusKind, statusLabel, shownTarget, drawnTotalKg,
} from './properties.drivers.ts';
import type { Console } from './properties.drivers.ts';

// A reload: a fresh console on the same rig with storage kept, the app's push order
// (Bar, Collar, then the set). The Primary unit comes back from its own key.
function reload(rig: Rig): Console {
  const again = document.createElement('rack-console') as Console;
  document.body.append(again);
  again.barKg = rig.barKg;
  again.collarKg = rig.collarKg;
  again.plateSet = rig.set;
  return again;
}

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

// The oracle's Ramp Totals for `draft` typed in `u` on `rig` (ADR-0015): the Working
// set rounds up when the at-or-under load reads short (RBAR-87).
function oracleTotals(rig: Rig, u: Unit, draft: string): number[] {
  const t = draftToKg(draft, u)!;
  return rampTotalsOracle(rig, t, displayCeilingKg(t, u), DEFAULT_RAMP, displayFloorKg(t, u));
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

  it('following the add caption literally rebuilds the Side Next loads: off from the outside, then on (ADR-0015 as amended)', async () => {
    // The caption is what the lifter does at the Bar. Press Next, read the add caption
    // beside "per side", apply it to the Side that was on screen, and the result must
    // be the Side Next loaded. The Next button itself reads just "Next" (RBAR-95).
    const faces = (rig: Rig, el: HTMLElement) =>
      sideOnScreen(el).map((d) => {
        const p = rig.inventory.find((x) => Math.abs(x.kg - d.kg) < 1e-9)!;
        return p.label ?? String(p.kg);
      });
    const apply = (side: string[], cap: string): string[] => {
      const body = cap.replace(/ (kg|lb)$/, '');
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
          expect(nextBtn(el).textContent).toBe('Next');
          nextBtn(el).click();
          const after = faces(rig, el);
          const cap = q<HTMLElement>(sr(el), '[data-viz-add]');
          if (cap.hidden) expect(after).toEqual(before);
          else expect(apply(before, cap.textContent ?? '')).toEqual(after);
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

  it('the Target is identical across mode switches and reloads (RBAR-87, ADR-0015)', async () => {
    // One Target for By Weight and Warm up: typed in either mode, then any run of mode
    // switches, reloads and stepper edits (in whichever mode is showing). After every
    // step the one field reads the same weight, the stored key holds exactly its kg,
    // and the screen is that Target's: By Weight's at-or-under Total (ADR-0003), or
    // the Ramp's Working set (ADR-0015). A reload lands in By Weight.
    type Mode = 'decode' | 'warmup';
    type Act = { kind: 'mode'; to: Mode } | { kind: 'reload' } | { kind: 'step' };
    const modeArb = fc.constantFrom<Mode>('decode', 'warmup');
    const actArb: fc.Arbitrary<Act> = fc.oneof(
      modeArb.map((to) => ({ kind: 'mode' as const, to })),
      fc.constant({ kind: 'reload' as const }),
      fc.constant({ kind: 'step' as const }),
    );
    await fc.assert(
      fc.asyncProperty(
        workCaseArb,
        modeArb,
        fc.array(actArb, { minLength: 1, maxLength: 6 }),
        async ([rig, u, draft], start, acts) => {
          await nextRun();
          let el = fresh(rig, u);
          let mode: Mode = start;
          if (start === 'warmup') {
            modeBtn(el, 'warmup').click();
            commitWorking(el, draft);
          } else {
            type(el, draft);
          }
          let want = draft;
          const check = () => {
            const kg = draftToKg(want, u)!;
            expect(entryDraft(el)).toBe(want);
            expect(localStorage.getItem('rackbar.target')).toBe(String(kg));
            if (mode === 'decode') {
              expect(totalText(el)).toBe(format(expectedFor(rig, u, want).totalKg, u));
            } else {
              expect(workDraft(el)).toBe(want);
              expect(stairTotals(el).at(-1)).toBe(format(oracleTotals(rig, u, want).at(-1)!, u));
            }
          };
          check();
          for (const a of acts) {
            if (a.kind === 'mode') {
              modeBtn(el, a.to).click();
              mode = a.to;
            } else if (a.kind === 'reload') {
              el.remove();
              el = reload(rig);
              mode = 'decode';
            } else {
              // An edit in either mode is an edit of the one Target.
              if (mode === 'decode') step(el, 'inc');
              else q<HTMLButtonElement>(workRoot(el), '[data-step="inc"]').click();
              const next = entryDraft(el);
              expect(Number(next)).toBeGreaterThan(Number(want));
              want = next;
            }
            check();
          }
        },
      ),
      { seed: SEED, numRuns: 25 },
    );
  });

  it("a By Plates load's Total becomes the Warm up working weight (RBAR-87, ADR-0015, ADR-0005)", async () => {
    // Build any load in By Plates and switch to Warm up: its Total is the working
    // weight (as read in the unit), the stored Target, and the Ramp's Working set; a
    // bare Bar is no Target. By Weight then shows the same Target.
    await fc.assert(
      fc.asyncProperty(rigArb, unitArb, fc.array(fc.nat(), { maxLength: 12 }), async (rig, u, picks) => {
        await nextRun();
        const el = fresh(rig, u);
        modeBtn(el, 'encode').click();
        for (const pick of picks) tapAdd(el, rig.inventory[pick % rig.inventory.length].kg);
        const built = sideOnScreen(el);
        const totalKg = rig.baselineKg + 2 * built.reduce((s, p) => s + p.kg, 0);
        modeBtn(el, 'warmup').click();
        if (built.length === 0) {
          expect(workDraft(el)).toBe('');
          expect(localStorage.getItem('rackbar.target')).toBeNull();
          expect(sideOnScreen(el)).toEqual([]);
          expect(nextBtn(el).disabled).toBe(true);
          return;
        }
        const reading = String(shownIn(totalKg, u));
        expect(workDraft(el)).toBe(reading);
        expect(Number(localStorage.getItem('rackbar.target'))).toBeCloseTo(totalKg, 9);
        const want = rampTotalsOracle(rig, totalKg, displayCeilingKg(totalKg, u), DEFAULT_RAMP);
        expect(stairTotals(el).at(-1)).toBe(format(want.at(-1)!, u));
        modeBtn(el, 'decode').click();
        expect(entryDraft(el)).toBe(reading);
        expect(totalText(el)).toBe(format(want.at(-1)!, u));
      }),
      { seed: SEED, numRuns: 25 },
    );
  });

  it("Warm up's Working set rounds up to the least loadable Total at or above the Target; By Weight still decodes the typed Target at or under (RBAR-87, ADR-0015 as amended, ADR-0003)", async () => {
    // Typed through the working-weight keypad and judged from the screen: the Work
    // stair, the sleeve, the readout and the pill all read the rounded-up Total when the
    // at-or-under load reads short and something loads above it; otherwise the
    // at-or-under load, as before. The field keeps the typed Target, and By Weight
    // decodes that Target never over (expectedFor: the ADR-0003 oracle, by reading).
    let roundedUp = 0;
    await fc.assert(
      fc.asyncProperty(workCaseArb, async ([rig, u, draft]) => {
        await nextRun();
        const el = warmOn(rig, u, draft);
        const t = draftToKg(draft, u)!;
        const { totalKg, short, roundUpKg } = expectedFor(rig, u, draft);
        const want = short && roundUpKg !== null ? roundUpKg : totalKg;
        stairs(el).at(-1)!.click();
        const work = drawnRowKg(el, rig, DEFAULT_RAMP.length);
        expect(work).toBeCloseTo(want, 6);
        expect(totalText(el)).toBe(format(want, u));
        expect(stairTotals(el).at(-1)).toBe(format(want, u));
        if (want !== totalKg) {
          roundedUp++;
          // Loadable, reads at or above the Target, and nothing loadable reads in between.
          expect(shownIn(work, u)).toBeGreaterThan(shownIn(t, u));
          expect(achievableTotals(rig).some((x) => shownIn(x, u) >= shownIn(t, u) && x < work - 1e-6)).toBe(false);
          expect(statusLabel(el)).toMatch(new RegExp(` ${u} over$`));
        }
        expect(workDraft(el)).toBe(draft);
        modeBtn(el, 'decode').click();
        expect(entryDraft(el)).toBe(draft);
        expect(totalText(el)).toBe(format(totalKg, u));
      }),
      { seed: SEED, numRuns: 40 },
    );
    // The generator lands between loadable Totals often enough to exercise the rule.
    expect(roundedUp).toBeGreaterThan(5);
  });

  it('a unit toggle keeps the working weight as read: an Exact Working set stays put, an at-or-under load never moves down, a rounded-up one is re-judged on the new reading, and a second round trip changes nothing (ADR-0010 RBAR-60, RBAR-87)', async () => {
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
        // A Working set rounded up past the Target (RBAR-87) is re-planned on the new
        // reading of the same Target, which may now read its at-or-under load exact.
        const roundedUp = shownIn(workBefore, u) > shownIn(kg, u) && kg >= rig.baselineKg;
        if (roundedUp) {
          const ou = other(u);
          expect(workAfter).toBeCloseTo(warmWorkingOracle(rig, kg, displayCeilingKg(kg, ou), displayFloorKg(kg, ou)), 6);
        } else {
          expect(workAfter).toBeGreaterThanOrEqual(workBefore - EPS);
        }
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

// One lifter action for the mode-switch status property (RBAR-79): a mode toggle, or an
// input only the mode on screen takes (a typed Target in By Weight, a working weight or
// a stair in Warm up, a Plate tap in By Plates). An input for another mode is a no-op.
type SwitchMode = 'decode' | 'encode' | 'warmup';
type SwitchAct =
  | { k: 'mode'; m: SwitchMode }
  | { k: 'type'; d: string }
  | { k: 'work'; d: string }
  | { k: 'stair'; i: number }
  | { k: 'plate'; i: number };

// A weight the lifter could type on `rig` in `u`: a Total's own reading (Exact) or any
// whole reading up to the rig's reach (mostly short).
const weightArb = (rig: Rig, u: Unit) =>
  fc.oneof(
    fc.constantFrom(...achievableTotals(rig)).map((kg) => String(shownIn(kg, u))),
    fc.integer({ min: 1, max: Math.round(shownIn(maxTotal(rig), u)) }).map(String),
  );
const switchCaseArb = rigArb.chain((rig) =>
  unitArb.chain((u) =>
    fc.tuple(
      fc.constant(rig),
      fc.constant(u),
      fc.array(
        fc.oneof(
          {
            weight: 4,
            arbitrary: fc
              .constantFrom<SwitchMode>('decode', 'encode', 'warmup')
              .map((m): SwitchAct => ({ k: 'mode', m })),
          },
          { weight: 1, arbitrary: weightArb(rig, u).map((d): SwitchAct => ({ k: 'type', d })) },
          { weight: 1, arbitrary: weightArb(rig, u).map((d): SwitchAct => ({ k: 'work', d })) },
          { weight: 1, arbitrary: fc.nat({ max: 4 }).map((i): SwitchAct => ({ k: 'stair', i })) },
          { weight: 1, arbitrary: fc.nat().map((i): SwitchAct => ({ k: 'plate', i })) },
        ),
        { minLength: 1, maxLength: 10 },
      ),
    ),
  ),
);

describe('<rack-console> mode-switch status properties (RBAR-79, ADR-0003, ADR-0005, ADR-0015)', () => {
  it('after any mode switch, the pill matches the shown Total vs Target: By Weight shows it whenever it decodes the Target, Warm up whenever it shows a Ramp, By Plates never (RBAR-79, ADR-0003, ADR-0005, ADR-0015)', async () => {
    // When By Weight decodes on entry (ADR-0015, RBAR-87 amendment): always from Warm
    // up, and from a By Plates visit that began in Warm up and left the Side as it found
    // it. Any other By Plates exit is the ADR-0005 carry: no live decode, so no pill.
    await fc.assert(
      fc.asyncProperty(switchCaseArb, async ([rig, u, acts]) => {
        await nextRun();
        const el = fresh(rig, u);
        let mode: SwitchMode = 'decode';
        let peekFrom: SwitchMode | null = null;
        let sideAtEntry = sideOnScreen(el);
        for (const a of acts) {
          if (a.k === 'type' && mode === 'decode') type(el, a.d);
          else if (a.k === 'work' && mode === 'warmup') commitWorking(el, a.d);
          else if (a.k === 'stair' && mode === 'warmup') stairs(el)[a.i]?.click();
          else if (a.k === 'plate' && mode === 'encode') {
            tapAdd(el, rig.inventory[a.i % rig.inventory.length].kg);
          }
          if (a.k !== 'mode' || a.m === mode) continue;
          const from = mode;
          const hasTarget = entryDraft(el) !== '';
          const untouched =
            JSON.stringify(sideOnScreen(el)) === JSON.stringify(sideAtEntry);
          if (a.m === 'encode') {
            peekFrom = from;
            sideAtEntry = sideOnScreen(el);
          }
          modeBtn(el, a.m).click();
          mode = a.m;
          const shown = !statusEl(el).hidden;
          if (mode === 'encode') {
            // By Plates has no Target to miss (ADR-0005).
            expect(shown).toBe(false);
            continue;
          }
          if (mode === 'warmup') {
            expect(shown).toBe(stairs(el).length > 0);
            continue;
          }
          const decodes =
            hasTarget && (from === 'warmup' || (peekFrom === 'warmup' && untouched));
          expect(shown).toBe(decodes);
          if (!shown) continue;
          // The pill reads the shown Total vs the field's Target, as read (ADR-0010).
          const target = shownTarget(el, u);
          const total = shownIn(drawnTotalKg(el, rig), u);
          const mag = String(Number(Math.abs(target - total).toFixed(2)));
          expect(statusLabel(el)).toBe(
            total === target ? 'Exact' : `${mag} ${u} ${total < target ? 'short' : 'over'}`,
          );
          const kinds =
            total === target ? ['exact'] : total > target ? ['over'] : ['short', 'capacity'];
          expect(kinds).toContain(statusKind(el));
        }
      }),
      {
        seed: SEED,
        numRuns: 40,
        // The ticket's repro: Warm up, Working set 115 kg selected, then By Weight.
        examples: [
          [
            [
              RIGS[0],
              'kg',
              [
                { k: 'mode', m: 'warmup' },
                { k: 'work', d: '115' },
                { k: 'stair', i: 4 },
                { k: 'mode', m: 'decode' },
              ],
            ],
          ],
        ],
      },
    );
  });
});
