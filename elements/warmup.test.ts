// Shell tests for the Warm up mode (RBAR-65 slice 2): the <rack-warmup> stairs + Next
// element on its own, and the console wiring -- the third mode segment, the working-
// weight field and its keypad, the shared Side Load, the status pill, Recents and
// persistence. The rule-wide invariants are in warmup.properties.test.ts.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import './console.ts';
import './warmup.ts';
import { planRamp, DEFAULT_RAMP } from '../lib/plan.ts';
import { ELEIKO_KG } from '../lib/plates.ts';
import { warmupView } from '../lib/warmup.ts';
import type { WarmupView } from '../lib/warmup.ts';
import {
  q, sr, modeBtn, totalText, sideOnScreen, statusKind, statusLabel, stairs,
  nextBtn, workRoot, workValue, workDraft, commitWorking, storedRecents, type, entryDraft, tapAdd,
} from './properties.drivers.ts';

type Warmup = HTMLElement & { view: WarmupView | null };
type Console = HTMLElement & { barKg: number; collarKg: number; plateSet: string };

const VIEW140 = (sel: number) =>
  warmupView(planRamp(140, DEFAULT_RAMP, { barKg: 20, collarKg: 0, inventory: ELEIKO_KG }).rows, sel, 'kg', 'kg');

function mountWarmup(view: WarmupView | null): { el: Warmup; picks: number[] } {
  const el = document.createElement('rack-warmup') as Warmup;
  document.body.append(el);
  el.view = view;
  const picks: number[] = [];
  el.addEventListener('warmupselect', (e) =>
    picks.push((e as CustomEvent<{ index: number }>).detail.index),
  );
  return { el, picks };
}
const steps = (el: HTMLElement) => [...sr(el).querySelectorAll<HTMLButtonElement>('.st')];
const next = (el: HTMLElement) => q<HTMLButtonElement>(sr(el), '[data-next]');

beforeEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe('<rack-warmup> stairs + Next (RBAR-65 slice 2)', () => {
  it('shows the "Enter your working weight" prompt and a disabled Next with no Ramp', () => {
    const { el } = mountWarmup(null);
    const prompt = q(sr(el), '[data-prompt]');
    expect(prompt.hidden).toBe(false);
    expect(prompt.textContent).toBe('Enter your working weight');
    expect(q(sr(el), '[data-stairs]').hidden).toBe(true);
    expect(next(el).disabled).toBe(true);
    expect(next(el).textContent).toBe('Next');
  });

  it('draws one stair per row: Total above, short name below, the selected one pressed and current', () => {
    const { el } = mountWarmup(VIEW140(2));
    const st = steps(el);
    expect(st.map((b) => b.querySelector('.nm')!.textContent)).toEqual(['Bar', '50%', '70%', '90%', 'Work']);
    expect(st.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true', 'false', 'false']);
    expect(st[2].getAttribute('aria-current')).toBe('step');
    expect(st.filter((b) => b.hasAttribute('aria-current'))).toHaveLength(1);
    expect(st.map((b) => b.classList.contains('past'))).toEqual([true, true, false, false, false]);
    expect(st.map((b) => b.tabIndex)).toEqual([-1, -1, 0, -1, -1]);
    expect(st[4].classList.contains('wk')).toBe(true);
    // The bar heights scale with the Totals (fraction of the Working Total).
    expect(st.map((b) => Number(b.style.getPropertyValue('--f')))).toEqual([20 / 140, 0.5, 0.7, 0.9, 1]);
  });

  it('carries a unit on every Total and a percent sign on every percentage, visible and spoken', () => {
    const { el } = mountWarmup(VIEW140(0));
    for (const b of steps(el)) {
      expect(b.querySelector('.tot')!.textContent).toMatch(/^\d+(\.\d+)? kg$/);
      const name = b.querySelector('.nm')!.textContent!;
      expect(name === 'Bar' || name === 'Work' || /^\d+%$/.test(name)).toBe(true);
      expect(b.getAttribute('aria-label')).toMatch(/\d+ kilograms/);
    }
    const labels = steps(el).map((b) => b.getAttribute('aria-label'));
    expect(labels[2]).toBe('Set 3 of 5, 70 percent, 98 kilograms, add 10 and 2.5 and 1.5 kilograms per side');
    expect(next(el).textContent).toBe('Next');
  });

  it('reports a stair tap as a warmupselect of that row', () => {
    const { el, picks } = mountWarmup(VIEW140(0));
    steps(el)[3].click();
    expect(picks).toEqual([3]);
  });

  it('walks with Left/Right and jumps with Home/End when focus is in the stairs', () => {
    const { el, picks } = mountWarmup(VIEW140(2));
    const key = (k: string) =>
      steps(el)[2].dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    key('ArrowRight');
    key('ArrowLeft');
    key('Home');
    key('End');
    key('a');
    expect(picks).toEqual([3, 1, 0, 4]);
  });

  it('Next selects the following row; on the Working set it still reads just "Next", disabled (RBAR-95)', () => {
    const { el, picks } = mountWarmup(VIEW140(1));
    next(el).click();
    expect(picks).toEqual([2]);
    el.view = VIEW140(4);
    expect(next(el).disabled).toBe(true);
    expect(next(el).textContent).toBe('Next');
    expect(next(el).children).toHaveLength(0);
  });
});

// ---- The console in Warm up ---------------------------------------------------------

function mountConsole(): Console {
  const el = document.createElement('rack-console') as Console;
  document.body.append(el);
  return el;
}
const warmup = (el: HTMLElement) => q<HTMLElement>(sr(el), 'rack-warmup');
const vizAdd = (el: HTMLElement) => q<HTMLElement>(sr(el), '[data-viz-add]');
const vizLabel = (el: HTMLElement) => q<HTMLElement>(sr(el), '[data-viz-label]');
const kgs = (el: HTMLElement) => sideOnScreen(el).map((p) => p.kg);

describe('<rack-console> Warm up mode (RBAR-65 slice 2)', () => {
  it('adds a third mode segment labelled exactly "Warm up"', () => {
    const el = mountConsole();
    const labels = [...sr(el).querySelectorAll('.modes button')].map((b) => b.textContent);
    expect(labels).toEqual(['By Weight', 'By Plates', 'Warm up']);
    modeBtn(el, 'warmup').click();
    expect(modeBtn(el, 'warmup').getAttribute('aria-pressed')).toBe('true');
    expect(modeBtn(el, 'decode').getAttribute('aria-pressed')).toBe('false');
  });

  it('labels the working-weight field "Working weight" and opens the same keypad sheet', () => {
    const el = mountConsole();
    modeBtn(el, 'warmup').click();
    expect(q(workRoot(el), '[data-caption]').textContent).toBe('Working weight');
    expect(q(workRoot(el), '[data-sheet]').getAttribute('aria-label')).toBe('Enter working weight');
    workValue(el).click();
    expect(q(workRoot(el), '[data-sheet]').hidden).toBe(false);
    expect(workValue(el).getAttribute('aria-expanded')).toBe('true');
  });

  it('is the one Target field: "Working weight" in Warm up, the headless Target in By Weight (RBAR-87)', () => {
    const el = mountConsole();
    expect(sr(el).querySelectorAll('rack-entry')).toHaveLength(1);
    const field = q<HTMLElement>(sr(el), 'rack-entry');
    expect(field.hasAttribute('headless')).toBe(true);
    modeBtn(el, 'warmup').click();
    expect(field.hasAttribute('headless')).toBe(false);
    expect(field.getAttribute('variant')).toBe('working');
    modeBtn(el, 'decode').click();
    expect(field.hasAttribute('headless')).toBe(true);
    expect(field.hasAttribute('variant')).toBe(false);
    expect(q(workRoot(el), '[data-caption]').textContent).toBe('Target');
    expect(q(workRoot(el), '[data-sheet]').getAttribute('aria-label')).toBe('Enter Target');
    expect(q(workRoot(el), '[data-keypad]').getAttribute('aria-label')).toBe('Enter Target');
    modeBtn(el, 'encode').click();
    expect(field.hidden).toBe(true);
  });

  it('with no working weight shows the prompt, a bare Bar and no pill', () => {
    const el = mountConsole();
    modeBtn(el, 'warmup').click();
    expect((warmup(el) as Warmup).view).toBeNull();
    expect(nextBtn(el).disabled).toBe(true);
    expect(sideOnScreen(el)).toEqual([]);
    expect(q(sr(el), '[data-status]').hidden).toBe(true);
    expect(workDraft(el)).toBe('');
  });

  it('plans from the By Weight Target, and a working-weight edit is the Target By Weight shows (RBAR-87)', () => {
    const el = mountConsole();
    type(el, '140');
    modeBtn(el, 'warmup').click();
    expect(workDraft(el)).toBe('140');
    expect(stairs(el)).toHaveLength(5);
    commitWorking(el, '120');
    modeBtn(el, 'decode').click();
    expect(entryDraft(el)).toBe('120');
    expect(totalText(el)).toBe('120 kg');
    expect(localStorage.getItem('rackbar.target')).toBe('120');
  });

  it('a cleared Target clears the working weight too, and is not stored (RBAR-87)', () => {
    const el = mountConsole();
    type(el, '140');
    type(el, '');
    expect(localStorage.getItem('rackbar.target')).toBeNull();
    modeBtn(el, 'warmup').click();
    expect(workDraft(el)).toBe('');
    expect((warmup(el) as Warmup).view).toBeNull();
  });

  it('restores the stored Target in Warm up and ignores a corrupt one (ADR-0007)', () => {
    localStorage.setItem('rackbar.target', '120');
    let el = mountConsole();
    modeBtn(el, 'warmup').click();
    expect(workDraft(el)).toBe('120');
    el.remove();
    localStorage.setItem('rackbar.target', 'garbage');
    el = mountConsole();
    modeBtn(el, 'warmup').click();
    expect(workDraft(el)).toBe('');
  });

  it('after Next the announcer says what to change to load the new row (RBAR-95)', () => {
    // The Next button names nothing, so the spoken line carries the moves.
    const el = mountConsole();
    modeBtn(el, 'warmup').click();
    commitWorking(el, '140');
    const said = () => q(sr(el), '[data-announce]').textContent;
    expect(said()).toBe('20 kilograms, Bare bar');
    nextBtn(el).click();
    expect(said()).toBe('70 kilograms, 50% - exact, add 25 kilograms per side');
    nextBtn(el).click();
    expect(said()).toBe('100 kilograms, 71% of 140 kg, add 15 kilograms per side');
    nextBtn(el).click();
    nextBtn(el).click();
    expect(said()).toBe('140 kilograms, 100% - exact, take off 2.5, then add 10 kilograms per side');
    // The spoken moves match what the visible add caption says.
    expect(vizAdd(el).textContent).toBe('off 2.5, on 10 kg');
  });

  it('loads the selected row on the shared sleeve and Total, starting at the bare Bar', () => {
    const el = mountConsole();
    modeBtn(el, 'warmup').click();
    commitWorking(el, '140');
    expect(kgs(el)).toEqual([]);
    expect(totalText(el)).toBe('20 kg');
    expect(statusKind(el)).toBe('bare');
    expect(statusLabel(el)).toBe('Bare bar');
    expect(vizLabel(el).textContent).toBe('per side');
    expect(vizAdd(el).hidden).toBe(true);
    stairs(el)[1].click();
    expect(kgs(el)).toEqual([25]);
    expect(totalText(el)).toBe('70 kg');
    expect(statusKind(el)).toBe('exact');
    expect(statusLabel(el)).toBe('50% - exact');
    expect(vizAdd(el).hidden).toBe(false);
    expect(vizAdd(el).textContent).toBe('+25 kg');
    nextBtn(el).click();
    // 70% is 100 kg (25 + 15), not the nearest 98 kg: the 25 stays on (ADR-0015, the
    // station rule).
    expect(totalText(el)).toBe('100 kg');
    expect(kgs(el)).toEqual([25, 15]);
  });

  it("loads the station-rule Ramp: at 70 kg, 5+2.5 / 15 / 15+5+1.5 / 15+5+5 (ADR-0015)", () => {
    const el = mountConsole();
    modeBtn(el, 'warmup').click();
    commitWorking(el, '70');
    const sides: number[][] = [];
    for (let i = 0; i < 5; i++) {
      stairs(el)[i].click();
      sides.push(kgs(el));
    }
    expect(sides).toEqual([[], [5, 2.5], [15], [15, 5, 1.5], [15, 5, 5]]);
  });

  it('reads the real percentage of the Working Total, with its unit, when rounding moved a row', () => {
    const el = mountConsole();
    modeBtn(el, 'warmup').click();
    commitWorking(el, '141'); // 50% = 70.5 kg, a tie on the 1 kg grid: down to 70 kg (49.6%)
    stairs(el)[1].click();
    expect(totalText(el)).toBe('70 kg');
    expect(statusKind(el)).toBe('pct');
    expect(statusLabel(el)).toBe('50% of 141 kg');
  });

  it('rounds a Working set that cannot load exactly UP, and its pill says so (RBAR-87)', () => {
    const el = mountConsole();
    modeBtn(el, 'warmup').click();
    commitWorking(el, '140.3');
    stairs(el)[4].click();
    expect(totalText(el)).toBe('141 kg');
    expect(stairs(el)[4].querySelector('.tot')!.textContent).toBe('141 kg');
    expect(statusKind(el)).toBe('over');
    expect(statusLabel(el)).toBe('0.7 kg over');
    // The field keeps the typed Target; By Weight still decodes it at or under (ADR-0003).
    expect(workDraft(el)).toBe('140.3');
    modeBtn(el, 'decode').click();
    expect(totalText(el)).toBe('140 kg');
    expect(statusLabel(el)).toBe('0.3 kg short');
  });

  it('reads a short Working set with the By Weight pill when nothing loads above it (ADR-0003)', () => {
    const el = mountConsole();
    modeBtn(el, 'warmup').click();
    commitWorking(el, '500'); // past the Sleeve: no round-up to take
    stairs(el)[4].click();
    expect(statusLabel(el)).toMatch(/ kg short$/);
  });

  it('keeps the bare-Bar row Collar-free: its Total is the Bar alone (ADR-0015 Q5)', () => {
    const el = mountConsole();
    el.collarKg = 2.5;
    modeBtn(el, 'warmup').click();
    commitWorking(el, '140');
    expect(totalText(el)).toBe('20 kg');
    stairs(el)[1].click();
    expect(totalText(el)).toBe('70 kg'); // 25 kg baseline + 2 x 22.5
  });

  it('re-plans when the Bar changes, keeping the selected row', () => {
    const el = mountConsole();
    modeBtn(el, 'warmup').click();
    commitWorking(el, '140');
    stairs(el)[4].click();
    el.barKg = 15;
    expect(totalText(el)).toBe('140 kg');
    expect(stairs(el)[4].getAttribute('aria-pressed')).toBe('true');
    stairs(el)[0].click();
    expect(totalText(el)).toBe('15 kg');
    expect(workDraft(el)).toBe('140');
  });

  it('pushes the working weight to Recents on its keypad commit, and nothing else does', () => {
    const el = mountConsole();
    modeBtn(el, 'warmup').click();
    commitWorking(el, '140');
    expect(storedRecents()).toEqual([140]);
    // A stepper nudge edits it live but is not a commit.
    q<HTMLButtonElement>(workRoot(el), '[data-step="inc"]').click();
    expect(workDraft(el)).toBe('141');
    expect(localStorage.getItem('rackbar.target')).toBe('141');
    stairs(el)[2].click();
    nextBtn(el).click();
    q<HTMLButtonElement>(sr(el), '[data-share]').click(); // By Weight's share push does not run here
    expect(storedRecents()).toEqual([140]);
  });

  it('shows the Working set on the keypad sheet\'s "On the bar" line while it is open', () => {
    const el = mountConsole();
    modeBtn(el, 'warmup').click();
    commitWorking(el, '140');
    workValue(el).click();
    expect(q(workRoot(el), '[data-live-load]').textContent).toBe('exact');
  });

  it('takes physical keyboard entry while its keypad is open (RBAR-49)', () => {
    const el = mountConsole();
    modeBtn(el, 'warmup').click();
    workValue(el).click();
    for (const k of ['1', '0', '0', 'Enter']) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    }
    expect(q(workRoot(el), '[data-sheet]').hidden).toBe(true);
    expect(workDraft(el)).toBe('100');
    expect(storedRecents()).toEqual([100]);
    expect(stairs(el)).toHaveLength(5);
  });

  it('back in By Weight shows the Target, not the selected warm-up row (RBAR-87)', () => {
    const el = mountConsole();
    modeBtn(el, 'warmup').click();
    commitWorking(el, '140');
    stairs(el)[1].click();
    modeBtn(el, 'decode').click();
    expect(kgs(el)).toEqual([25, 25, 10]);
    expect(totalText(el)).toBe('140 kg');
    expect(statusKind(el)).toBe('exact');
    expect(entryDraft(el)).toBe('140');
    expect(warmup(el).hidden).toBe(true);
  });

  it('carries the selected row into By Plates; only a Plate edit there changes the Target (ADR-0005, RBAR-87)', () => {
    const el = mountConsole();
    modeBtn(el, 'warmup').click();
    commitWorking(el, '140');
    stairs(el)[1].click();
    modeBtn(el, 'encode').click();
    expect(kgs(el)).toEqual([25]); // the shared Side Load: the 70 kg row
    // An untouched visit holds a warm-up row, not a built load: the Target stays.
    modeBtn(el, 'warmup').click();
    expect(workDraft(el)).toBe('140');
    stairs(el)[1].click();
    modeBtn(el, 'encode').click();
    modeBtn(el, 'decode').click();
    expect(entryDraft(el)).toBe('140');
    expect(totalText(el)).toBe('140 kg');
    // A Plate tapped on is a built load: its Total becomes the Target.
    modeBtn(el, 'warmup').click();
    stairs(el)[1].click();
    modeBtn(el, 'encode').click();
    tapAdd(el, 10);
    modeBtn(el, 'warmup').click();
    expect(workDraft(el)).toBe('90');
    expect(localStorage.getItem('rackbar.target')).toBe('90');
  });
});

describe('<rack-console> the pre-RBAR-87 rackbar.working key migrates once (ADR-0015 as amended, ADR-0007)', () => {
  it('becomes the Target when no Target is stored, then the key is gone', () => {
    localStorage.setItem('rackbar.working', '120');
    const el = mountConsole();
    expect(localStorage.getItem('rackbar.working')).toBeNull();
    expect(localStorage.getItem('rackbar.target')).toBe('120');
    // By Weight opens on it, and Warm up plans from it.
    expect(entryDraft(el)).toBe('120');
    expect(totalText(el)).toBe('120 kg');
    modeBtn(el, 'warmup').click();
    expect(workDraft(el)).toBe('120');
    expect(stairs(el)).toHaveLength(5);
  });

  it('never overrides a stored Target, and is removed anyway', () => {
    localStorage.setItem('rackbar.target', '100');
    localStorage.setItem('rackbar.working', '120');
    const el = mountConsole();
    expect(localStorage.getItem('rackbar.working')).toBeNull();
    expect(localStorage.getItem('rackbar.target')).toBe('100');
    modeBtn(el, 'warmup').click();
    expect(workDraft(el)).toBe('100');
  });

  it('drops a cleared or corrupt value without inventing a Target', () => {
    for (const raw of ['', 'garbage', '0', '-5']) {
      localStorage.clear();
      localStorage.setItem('rackbar.working', raw);
      const el = mountConsole();
      expect(localStorage.getItem('rackbar.working')).toBeNull();
      expect(localStorage.getItem('rackbar.target')).toBeNull();
      modeBtn(el, 'warmup').click();
      expect(workDraft(el)).toBe('');
      el.remove();
    }
  });

  it('a restored Target that reads as the default Bar keeps reading itself when the app pushes another Bar (RBAR-87)', () => {
    // The entry re-seeds an untouched field that reads the old Bar; a restored Target of
    // 20 kg is shown that way, so the Bar push must not turn it into "15".
    localStorage.setItem('rackbar.target', '20');
    const el = mountConsole();
    el.barKg = 15;
    expect(entryDraft(el)).toBe('20');
    expect(totalText(el)).toBe('20 kg');
    modeBtn(el, 'warmup').click();
    expect(workDraft(el)).toBe('20');
  });

  it('runs once: a cleared Target stays cleared across a reload', () => {
    // Clearing removes rackbar.target, so a legacy key left behind would migrate again.
    localStorage.setItem('rackbar.working', '120');
    let el = mountConsole();
    expect(localStorage.getItem('rackbar.working')).toBeNull();
    type(el, '');
    el.remove();
    el = mountConsole();
    expect(localStorage.getItem('rackbar.target')).toBeNull();
    modeBtn(el, 'warmup').click();
    expect(workDraft(el)).toBe('');
  });

  it('a stored Target that is not a plain decimal the app writes is no Target (ADR-0007)', () => {
    for (const raw of ['0x8C', '1e300', '1001']) {
      localStorage.clear();
      localStorage.setItem('rackbar.target', raw);
      const el = mountConsole();
      expect(entryDraft(el)).toBe('20'); // the untouched Bar seed: no Target
      expect(sideOnScreen(el)).toEqual([]);
      modeBtn(el, 'warmup').click();
      expect(workDraft(el)).toBe('');
      el.remove();
    }
  });

  it('a failed write removes the stored Target instead of leaving a stale one (ADR-0009)', () => {
    localStorage.setItem('rackbar.target', '100');
    const el = mountConsole();
    const real = localStorage.setItem.bind(localStorage);
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation((k: string, v: string) => {
      if (k === 'rackbar.target') throw new DOMException('full', 'QuotaExceededError');
      real(k, v);
    });
    try {
      // A stepper nudge, so no Clear removes the key first: 100 -> 101.
      q<HTMLButtonElement>(sr(el), '[data-hero-step="inc"]').click();
      expect(totalText(el)).toBe('101 kg'); // the session keeps working
    } finally {
      spy.mockRestore();
    }
    expect(localStorage.getItem('rackbar.target')).toBeNull();
  });
});

describe('<rack-console> leaving By Plates keeps the Target unless a load was built there (RBAR-87)', () => {
  it('a set switch while in By Plates is not a built load: the Target and its key stay', () => {
    const el = mountConsole();
    type(el, '140');
    modeBtn(el, 'encode').click();
    el.plateSet = 'training'; // the rig empties the Bar; the lifter tapped nothing
    modeBtn(el, 'warmup').click();
    expect(workDraft(el)).toBe('140');
    expect(localStorage.getItem('rackbar.target')).toBe('140');
    modeBtn(el, 'encode').click();
    el.plateSet = 'comp';
    modeBtn(el, 'decode').click();
    expect(entryDraft(el)).toBe('140');
    expect(totalText(el)).toBe('140 kg'); // decoded again on the new set
  });

  it('a peek at By Plates from By Weight does not rewrite 141.3 as the 141 load', () => {
    const el = mountConsole();
    type(el, '141.3');
    modeBtn(el, 'encode').click();
    modeBtn(el, 'warmup').click();
    expect(workDraft(el)).toBe('141.3');
    expect(localStorage.getItem('rackbar.target')).toBe('141.3');
    modeBtn(el, 'decode').click();
    modeBtn(el, 'encode').click();
    modeBtn(el, 'decode').click();
    expect(entryDraft(el)).toBe('141.3');
    expect(localStorage.getItem('rackbar.target')).toBe('141.3');
  });

  it('an opened By Plates link is a built load, even when it matches the Side the visit began with (ADR-0014)', () => {
    const el = mountConsole() as Console & {
      applyLink(l: { mode: 'encode'; side: readonly unknown[]; unit: 'kg' }): void;
    };
    modeBtn(el, 'warmup').click();
    commitWorking(el, '140');
    stairs(el)[1].click(); // the 70 kg row: 25 per Side
    modeBtn(el, 'encode').click();
    el.applyLink({ mode: 'encode', side: [ELEIKO_KG.find((p) => p.kg === 25)!], unit: 'kg' });
    modeBtn(el, 'warmup').click();
    expect(workDraft(el)).toBe('70');
    expect(localStorage.getItem('rackbar.target')).toBe('70');
  });
});
