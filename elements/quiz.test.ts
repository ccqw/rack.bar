import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import './quiz.ts';
import './app.ts';
import { QUIZ_KEY, RIGHT_PAUSE_MS } from './quiz.ts';
import { SETUP_LINK } from './rig.ts';
import { parseQuizSaved } from '../lib/quiz.ts';
import type { Question } from '../lib/quiz.ts';
import type { Plate } from '../lib/plates.ts';
import { lbToKg } from '../lib/units.ts';
import { precacheUrls } from '../scripts/precache.ts';
import viteConfig from '../vite.config.ts';

type Quiz = HTMLElement & { question: Question | null };
type Sleeve = HTMLElement & { sideLoad: readonly Plate[]; collars: boolean; numerals: boolean };

function mount(seed = 7): { el: Quiz; root: ShadowRoot } {
  const el = document.createElement('rack-quiz') as Quiz;
  el.setAttribute('seed', String(seed));
  document.body.append(el);
  return { el, root: el.shadowRoot! };
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

const sleeveOf = (root: ShadowRoot) => root.querySelector('rack-sleeve') as Sleeve;
const key = (root: ShadowRoot, k: string) =>
  root.querySelector<HTMLButtonElement>(`[data-key="${k}"]`)!.click();
const typeOn = (root: ShadowRoot, s: string) => [...s].forEach((c) => key(root, c));
const go = (root: ShadowRoot) => root.querySelector<HTMLButtonElement>('[data-go]')!;
const text = (root: ShadowRoot, sel: string) => root.querySelector(sel)?.textContent ?? '';
const gearRoot = (root: ShadowRoot) => root.querySelector('rack-quiz-gear')!.shadowRoot!;

describe('<rack-quiz>', () => {
  it("draws the question's Side on the sleeve and asks for the Total in the set's Unit", () => {
    const { el, root } = mount();
    const q = el.question!;
    expect(sleeveOf(root).sideLoad).toEqual(q.side);
    expect(text(root, '[data-big]')).toBe('?kg');
    expect(text(root, '[data-qn]')).toBe('Loadout quiz \u00B7 20 kg bar');
    expect(go(root).disabled).toBe(true);
  });

  it('a right answer flashes green, counts the streak, saves it, and moves on', () => {
    vi.useFakeTimers();
    const { el, root } = mount();
    const q = el.question!;
    typeOn(root, String(q.totalShown));
    expect(go(root).disabled).toBe(false);
    go(root).click();
    expect(root.querySelector<HTMLElement>('[data-viz]')!.dataset.phase).toBe('right');
    expect(text(root, '[data-streak]')).toBe('1');
    expect(text(root, '[data-fb]')).toMatch(/^Right/);
    expect(parseQuizSaved(localStorage.getItem(QUIZ_KEY)).record.streak).toBe(1);
    vi.advanceTimersByTime(RIGHT_PAUSE_MS);
    expect(el.question!.index).toBe(1);
    expect(text(root, '[data-big]')).toBe('?kg');
  });

  it('a wrong answer flashes red, names the mistake, shows the breakdown, and waits for Next', () => {
    localStorage.setItem(QUIZ_KEY, JSON.stringify({ streak: 4, best: 6 }));
    const { el, root } = mount();
    const q = el.question!;
    const forgotBar = String(2 * q.sideShown);
    typeOn(root, forgotBar);
    go(root).click();
    expect(root.querySelector<HTMLElement>('[data-viz]')!.dataset.phase).toBe('wrong');
    expect(text(root, '[data-why]')).toBe('Forgot the Bar');
    expect(text(root, '[data-math]')).toContain(`= ${q.sideShown}x 2+ 20 kg bar`);
    expect(text(root, '[data-math]')).toContain(`= ${q.totalShown} kg`);
    expect(text(root, '[data-streak]')).toBe('0');
    expect(text(root, '[data-best]')).toBe('6');
    expect(text(root, 's')).toBe(forgotBar);
    expect(go(root).textContent).toBe('Next');
    go(root).click();
    expect(el.question!.index).toBe(1);
  });

  it('Show reveals the Total and ends the streak', () => {
    localStorage.setItem(QUIZ_KEY, JSON.stringify({ streak: 2, best: 2 }));
    const { el, root } = mount();
    root.querySelector<HTMLButtonElement>('[data-show]')!.click();
    expect(text(root, '[data-big]')).toBe(`${el.question!.totalShown}kg`);
    expect(text(root, '[data-streak]')).toBe('0');
    expect(root.querySelector('[data-why]')).toBeNull();
  });

  it('takes the physical keyboard: digits, Backspace, Enter', () => {
    const { el, root } = mount();
    const total = String(el.question!.totalShown);
    for (const k of [...total, '9', 'Backspace', 'Enter']) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: k }));
    }
    expect(text(root, '[data-streak]')).toBe('1');
  });

  it('Enter on a focused link or button is left to it: the back link and Show keep their own Enter', () => {
    const { el, root } = mount();
    typeOn(root, '1');
    const enterOn = (target: EventTarget) => {
      const e = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true, cancelable: true });
      target.dispatchEvent(e);
      return e;
    };
    // The back link navigates on its own Enter: not cancelled, nothing checked.
    expect(enterOn(root.querySelector('.back')!).defaultPrevented).toBe(false);
    expect(root.querySelector<HTMLElement>('[data-viz]')!.dataset.phase).toBe('ask');
    // Show: its Enter is its click (the browser's), which shows the answer -- not a
    // check of the typed draft.
    const show = root.querySelector<HTMLButtonElement>('[data-show]')!;
    expect(enterOn(show).defaultPrevented).toBe(false);
    expect(root.querySelector<HTMLElement>('[data-viz]')!.dataset.phase).toBe('ask');
    show.click();
    expect(text(root, '[data-big]')).toBe(`${el.question!.totalShown}kg`);
  });

  it('Enter elsewhere is cancelled only when it checks something', () => {
    const { root } = mount();
    const enter = () => {
      const e = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      document.body.dispatchEvent(e);
      return e;
    };
    expect(enter().defaultPrevented).toBe(false); // nothing typed: no check
    typeOn(root, '1');
    expect(enter().defaultPrevented).toBe(true);
    expect(root.querySelector<HTMLElement>('[data-viz]')!.dataset.phase).toBe('wrong');
  });

  it('numbers on the discs are off by default, and shown on a wrong answer', () => {
    const { root } = mount();
    expect(sleeveOf(root).numerals).toBe(false);
    root.querySelector<HTMLButtonElement>('[data-show]')!.click();
    expect(sleeveOf(root).numerals).toBe(true);
  });

  it('draws Collars only when Setup has them, and the breakdown adds them', () => {
    localStorage.setItem('rackbar.collarKg', '2.5');
    const { el, root } = mount();
    // Question 1 carries the Collars under the default "Some".
    expect(el.question!.collarKg).toBe(2.5);
    expect(sleeveOf(root).collars).toBe(true);
    root.querySelector<HTMLButtonElement>('[data-show]')!.click();
    expect(text(root, '[data-math]')).toContain('+ 2 x 2.5 kg collars');
  });

  it('never draws Collars when Setup has none', () => {
    const { el, root } = mount();
    expect(el.question!.collarKg).toBe(0);
    expect(sleeveOf(root).collars).toBe(false);
  });

  it("reads the Training set in lb on Setup's Bar", () => {
    localStorage.setItem('rackbar.plateSet', 'training');
    localStorage.setItem('rackbar.barKg', String(lbToKg(45)));
    const { el, root } = mount();
    expect(el.question!.unit).toBe('lb');
    expect(text(root, '[data-qn]')).toBe('Loadout quiz \u00B7 45 lb bar');
    expect(el.question!.side.every((p) => p.color === 'iron')).toBe(true);
  });

  it('says so when there are no Plates on hand, with a door into Setup', () => {
    localStorage.setItem(
      'rackbar.platesOnHand',
      JSON.stringify({ comp: { 25: 0, 20: 0, 15: 0, 10: 0, 5: 0, 2.5: 0, 2: 0, 1.5: 0, 1: 0, 0.5: 0 } }),
    );
    const { el, root } = mount();
    expect(el.question).toBeNull();
    expect(root.querySelector<HTMLElement>('[data-empty]')!.hidden).toBe(false);
    expect(root.querySelector('[data-empty] a')!.getAttribute('href')).toBe(SETUP_LINK);
  });
});

describe('the quiz gear', () => {
  const tile = (root: ShadowRoot, k: string, v: string) =>
    gearRoot(root).querySelector<HTMLButtonElement>(`[data-key="${k}"][data-val="${v}"]`)!;

  it('opens from the gear button and shows the defaults: up to 4, change on, some, colours only', () => {
    const { root } = mount();
    const gear = root.querySelector<HTMLElement>('rack-quiz-gear')!;
    expect(gear.hidden).toBe(true);
    root.querySelector<HTMLButtonElement>('[data-gear]')!.click();
    expect(gear.hidden).toBe(false);
    expect(tile(root, 'maxPlates', '4').getAttribute('aria-pressed')).toBe('true');
    expect(tile(root, 'change', 'true').getAttribute('aria-pressed')).toBe('true');
    expect(tile(root, 'numbers', 'false').getAttribute('aria-pressed')).toBe('true');
    expect(gearRoot(root).querySelector('[data-rig-name]')!.textContent).toBe('Competition, 20 kg bar');
    expect(gearRoot(root).querySelector('.from a')!.getAttribute('href')).toBe(SETUP_LINK);
  });

  it('a setting change is saved, applies to the next question, and starts a new streak', () => {
    localStorage.setItem(QUIZ_KEY, JSON.stringify({ streak: 3, best: 5 }));
    const { el, root } = mount();
    tile(root, 'maxPlates', '2').click();
    tile(root, 'numbers', 'true').click();
    const saved = parseQuizSaved(localStorage.getItem(QUIZ_KEY));
    expect(saved.settings.maxPlates).toBe(2);
    expect(saved.settings.numbers).toBe(true);
    expect(saved.record).toMatchObject({ streak: 0, best: 5 });
    expect(el.question!.side.length).toBeLessThanOrEqual(2);
    expect(sleeveOf(root).numerals).toBe(true);
  });

  it('the Collars row is off when Setup has no Collars', () => {
    const { root } = mount();
    expect(tile(root, 'collars', 'some').disabled).toBe(true);
    expect(tile(root, 'collars', 'off').getAttribute('aria-pressed')).toBe('true');
    expect(gearRoot(root).querySelector('[data-note="collars"]')!.textContent).toBe('(Setup has none)');
  });

  it('the numbers row is fixed on the iron set: always stamped', () => {
    localStorage.setItem('rackbar.plateSet', 'training');
    const { root } = mount();
    expect(tile(root, 'numbers', 'false').disabled).toBe(true);
    expect(tile(root, 'numbers', 'true').getAttribute('aria-pressed')).toBe('true');
  });

  it('closes from the scrim and the close button', () => {
    const { root } = mount();
    const gear = root.querySelector<HTMLElement>('rack-quiz-gear')!;
    root.querySelector<HTMLButtonElement>('[data-gear]')!.click();
    gearRoot(root).querySelector<HTMLElement>('[data-scrim]')!.click();
    expect(gear.hidden).toBe(true);
    root.querySelector<HTMLButtonElement>('[data-gear]')!.click();
    gearRoot(root).querySelector<HTMLButtonElement>('[data-close]')!.click();
    expect(gear.hidden).toBe(true);
  });
});

describe('the way in and the page', () => {
  it("the main header's graduation-cap button, left of Setup, opens the quiz", () => {
    const app = document.createElement('rack-app');
    document.body.append(app);
    const root = app.shadowRoot!;
    const link = root.querySelector<HTMLAnchorElement>('[data-quiz-link]')!;
    expect(link.getAttribute('href')).toBe('/game.html');
    expect(link.getAttribute('aria-label')).toBe('Loadout quiz');
    expect(link.nextElementSibling).toBe(root.querySelector('[data-setup-pill]'));
    // A 44x44 tap target: the 30px box (28px padding box) plus an 8px layer each way,
    // which stops 1px short of the pill across the row's 8px gap.
    const css = root.querySelector('style')!.textContent!;
    expect(css).toMatch(/\.quizlink::after\s*\{[^}]*inset:\s*-8px;/);
    expect(css).toMatch(/\.hdr\s*\{[^}]*gap:\s*8px;/);
  });

  it("the quiz's Setup link opens the calculator with Setup open, once: the query is stripped", () => {
    history.replaceState(null, '', '/?setup');
    const app = document.createElement('rack-app');
    document.body.append(app);
    const root = app.shadowRoot!;
    expect(root.querySelector('[data-setup-pill]')!.getAttribute('aria-expanded')).toBe('true');
    expect(root.querySelector<HTMLElement>('rack-setup')!.hidden).toBe(false);
    expect(location.search).toBe('');
    expect(location.pathname).toBe('/');
  });

  it('a plain visit leaves Setup closed', () => {
    history.replaceState(null, '', '/');
    const app = document.createElement('rack-app');
    document.body.append(app);
    expect(app.shadowRoot!.querySelector('[data-setup-pill]')!.getAttribute('aria-expanded')).toBe('false');
  });

  it('game.html is a build entry, loads the quiz and the offline worker, and is precached (ADR-0001, ADR-0018)', () => {
    const html = readFileSync(resolve(import.meta.dirname, '../game.html'), 'utf8');
    expect(html).toContain('<rack-quiz></rack-quiz>');
    expect(html).toContain('src="./elements/quiz.ts"');
    expect(html).toContain('src="./elements/update.ts"');
    const input = viteConfig.build!.rollupOptions!.input as Record<string, string>;
    expect(input.game).toMatch(/game\.html$/);
    const pages = Object.values(input).map((p) => p.slice(p.lastIndexOf('/') + 1));
    expect(precacheUrls(pages)).toEqual(['/', '/game.html']);
  });
});

describe('<rack-quiz> Build the bar (RBAR-101)', () => {
  type Built = Quiz & { quizMode: string };
  const mountBuild = (seed = 7, extra: Record<string, unknown> = {}) => {
    localStorage.setItem(QUIZ_KEY, JSON.stringify({ mode: 'build', ...extra }));
    return mount(seed) as { el: Built; root: ShadowRoot };
  };
  const keys = (root: ShadowRoot) => [
    ...root.querySelector('rack-palette')!.shadowRoot!.querySelectorAll<HTMLButtonElement>('.key'),
  ];
  const tapFaces = (root: ShadowRoot, faces: string[]) => {
    for (const f of faces) keys(root).find((k) => k.querySelector('.face')!.textContent === f)!.click();
  };
  const faces = (side: readonly Plate[]) => side.map((p) => p.label ?? String(p.kg));
  const btn = (root: ShadowRoot, sel: string) => root.querySelector<HTMLButtonElement>(sel)!;
  const phaseOf = (root: ShadowRoot) => root.querySelector<HTMLElement>('[data-viz]')!.dataset.phase;

  afterEach(() => localStorage.clear());

  it('the mode track switches drills, marks the active one, and the choice is saved', () => {
    localStorage.clear();
    const { el, root } = mount();
    expect((el as Built).quizMode).toBe('read');
    expect(btn(root, '[data-qmode="read"]').getAttribute('aria-pressed')).toBe('true');
    btn(root, '[data-qmode="build"]').click();
    expect((el as Built).quizMode).toBe('build');
    expect(el.dataset.mode).toBe('build');
    expect(btn(root, '[data-qmode="build"]').getAttribute('aria-pressed')).toBe('true');
    expect(parseQuizSaved(localStorage.getItem(QUIZ_KEY)).mode).toBe('build');
    expect(sleeveOf(root).sideLoad).toEqual([]);
    expect(text(root, '[data-target]')).toBe(`${el.question!.totalShown}kg`);
  });

  it("opens on the saved drill; the Target's fewest Side, tapped on, is right and moves on", () => {
    vi.useFakeTimers();
    const { el, root } = mountBuild();
    expect(el.quizMode).toBe('build');
    const q = el.question!;
    expect(btn(root, '[data-check]').disabled).toBe(true);
    tapFaces(root, faces(q.side));
    expect(sleeveOf(root).sideLoad.map((p) => p.kg)).toEqual(q.side.map((p) => p.kg));
    btn(root, '[data-check]').click();
    expect(phaseOf(root)).toBe('right');
    expect(text(root, '[data-streak]')).toBe('1');
    expect(root.querySelector('[data-note]')).toBeNull();
    vi.advanceTimersByTime(RIGHT_PAUSE_MS);
    expect(el.question!.index).toBe(1);
    expect(sleeveOf(root).sideLoad).toEqual([]);
  });

  it('a right Side with more Plates than the fewest gets the note and waits for Next', () => {
    vi.useFakeTimers();
    // Find a question whose Side has a 25 to split into 20 + 5.
    let seed = 1;
    let el: Built;
    let root: ShadowRoot;
    for (;;) {
      ({ el, root } = mountBuild(seed));
      if (faces(el.question!.side).includes('25')) break;
      document.body.innerHTML = '';
      seed++;
    }
    tapFaces(root, faces(el.question!.side).flatMap((f) => (f === '25' ? ['20', '5'] : [f])));
    btn(root, '[data-check]').click();
    expect(phaseOf(root)).toBe('right');
    expect(text(root, '[data-note]')).toMatch(/^Fewest plates: /);
    expect(btn(root, '[data-check]').textContent).toBe('Next');
    vi.advanceTimersByTime(RIGHT_PAUSE_MS * 4);
    expect(el.question!.index).toBe(0);
    btn(root, '[data-check]').click();
    expect(el.question!.index).toBe(1);
  });

  it('a wrong Side strikes its Total, names the miss, shows what was built and one way, then Next', () => {
    localStorage.setItem(QUIZ_KEY, JSON.stringify({ mode: 'build', streak: 3, best: 5 }));
    const { el, root } = mount();
    const q = el.question!;
    tapFaces(root, [...faces(q.side), ...faces(q.side)]);
    btn(root, '[data-check]').click();
    expect(phaseOf(root)).toBe('wrong');
    expect(text(root, '[data-streak]')).toBe('0');
    expect(text(root, '[data-why]')).not.toBe('');
    expect(text(root, '[data-math]')).toContain('x 2+ 20 kg bar');
    expect(text(root, '[data-oneway]')).toBe(`One way: ${faces(q.side).join('')}`);
    expect(root.querySelector('[data-target] s')).not.toBeNull();
    expect(root.querySelector('rack-palette')!.hasAttribute('inert')).toBe(true);
    expect((sleeveOf(root) as Sleeve & { interactive: boolean }).interactive).toBe(false);
    expect(btn(root, '[data-check]').textContent).toBe('Next');
    btn(root, '[data-check]').click();
    expect(el.question!.index).toBe(1);
  });

  it('Undo takes the last tap, Clear empties the Side, a tapped disc comes off, Backspace is Undo', () => {
    const { root } = mountBuild();
    expect(btn(root, '[data-undo]').disabled).toBe(true);
    tapFaces(root, ['10', '25', '5']);
    expect(faces(sleeveOf(root).sideLoad)).toEqual(['25', '10', '5']);
    btn(root, '[data-undo]').click();
    expect(faces(sleeveOf(root).sideLoad)).toEqual(['25', '10']);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace' }));
    expect(faces(sleeveOf(root).sideLoad)).toEqual(['10']);
    tapFaces(root, ['20']);
    sleeveOf(root).dispatchEvent(
      new CustomEvent('removeplate', { detail: { plate: sleeveOf(root).sideLoad[0] } }),
    );
    expect(faces(sleeveOf(root).sideLoad)).toEqual(['10']);
    btn(root, '[data-clear]').click();
    expect(sleeveOf(root).sideLoad).toEqual([]);
    expect(btn(root, '[data-check]').disabled).toBe(true);
  });

  it('a size limited to none is disabled, and a limited one once its pairs are on', () => {
    localStorage.setItem('rackbar.platesOnHand', JSON.stringify({ comp: { 25: 1, 15: 0 } }));
    const { root } = mountBuild();
    const key = (f: string) => keys(root).find((k) => k.querySelector('.face')!.textContent === f)!;
    expect(key('15').disabled).toBe(true);
    expect(key('25').disabled).toBe(false);
    key('25').click();
    expect(key('25').disabled).toBe(true);
    key('25').click();
    expect(faces(sleeveOf(root).sideLoad)).toEqual(['25']);
  });
});
