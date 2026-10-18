// Shell tests for the Warm up mode (RBAR-65 slice 2): the <rack-warmup> stairs + Next
// element on its own, and the console wiring -- the third mode segment, the working-
// weight field and its keypad, the shared Side Load, the status pill, Recents and
// persistence. The rule-wide invariants are in warmup.properties.test.ts.
import { describe, it, expect, beforeEach } from 'vitest';
import './console.ts';
import './warmup.ts';
import { planRamp, DEFAULT_RAMP } from '../lib/plan.ts';
import { ELEIKO_KG } from '../lib/plates.ts';
import { warmupView } from '../lib/warmup.ts';
import type { WarmupView } from '../lib/warmup.ts';
import {
  q, sr, modeBtn, totalText, sideOnScreen, statusKind, statusLabel, stairs,
  nextBtn, workRoot, workValue, workDraft, commitWorking, storedRecents, type,
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

  it('with no working weight shows the prompt, a bare Bar and no pill', () => {
    const el = mountConsole();
    modeBtn(el, 'warmup').click();
    expect((warmup(el) as Warmup).view).toBeNull();
    expect(nextBtn(el).disabled).toBe(true);
    expect(sideOnScreen(el)).toEqual([]);
    expect(q(sr(el), '[data-status]').hidden).toBe(true);
    expect(workDraft(el)).toBe('');
  });

  it('seeds the working weight from the By Weight Target the first time it opens', () => {
    const el = mountConsole();
    type(el, '140');
    modeBtn(el, 'warmup').click();
    expect(workDraft(el)).toBe('140');
    expect(localStorage.getItem('rackbar.working')).toBe('140');
    expect(stairs(el)).toHaveLength(5);
  });

  it('does not re-seed once the lifter has cleared it (the saved key is blank, not absent)', () => {
    localStorage.setItem('rackbar.working', '');
    const el = mountConsole();
    type(el, '140');
    modeBtn(el, 'warmup').click();
    expect(workDraft(el)).toBe('');
  });

  it('restores a saved working weight and ignores a corrupt one (ADR-0007)', () => {
    localStorage.setItem('rackbar.working', '120');
    let el = mountConsole();
    modeBtn(el, 'warmup').click();
    expect(workDraft(el)).toBe('120');
    el.remove();
    localStorage.setItem('rackbar.working', 'garbage');
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

  it('reads a short Working set with the By Weight pill (ADR-0003)', () => {
    const el = mountConsole();
    modeBtn(el, 'warmup').click();
    commitWorking(el, '140.3');
    stairs(el)[4].click();
    expect(statusKind(el)).toBe('short');
    expect(statusLabel(el)).toBe('0.3 kg short');
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
    expect(localStorage.getItem('rackbar.working')).toBe('141');
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

  it('carries the selected row\'s Side back into By Weight (ADR-0005)', () => {
    const el = mountConsole();
    modeBtn(el, 'warmup').click();
    commitWorking(el, '140');
    stairs(el)[1].click();
    modeBtn(el, 'decode').click();
    expect(kgs(el)).toEqual([25]);
    expect(totalText(el)).toBe('70 kg');
    expect(warmup(el).hidden).toBe(true);
  });
});
