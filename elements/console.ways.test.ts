// Another way (RBAR-66): tap the bar for the next way of making the same Total, or open
// the list. Driven through the real input paths and judged from what is on screen.
import { describe, it, expect, beforeEach } from 'vitest';
import './console.ts';
import './app.ts';
import { parseLink } from '../lib/link.ts';
import type { LinkLoad } from './console.ts';
import { ELEIKO_KG } from '../lib/plates.ts';
import {
  q, sr, modeBtn, roundUp, sideOnScreen, statusKind, totalText, type, unitBtn,
} from './properties.drivers.ts';
import type { Console } from './properties.drivers.ts';
import type { LoadSummary } from '../lib/summary.ts';

type Sheet = HTMLElement & { hidden: boolean };

function mountConsole(): Console {
  const el = document.createElement('rack-console') as Console;
  document.body.append(el);
  return el;
}
const bar = (el: HTMLElement) => q<HTMLElement>(sr(el), 'rack-sleeve');
const tapBar = (el: HTMLElement) => bar(el).click();
const pill = (el: HTMLElement) => q<HTMLButtonElement>(sr(el), '[data-another]');
const count = (el: HTMLElement) => q(sr(el), '[data-another-count]').textContent;
const sheet = (el: HTMLElement) => q<Sheet>(sr(el), 'rack-ways');
const rows = (el: HTMLElement) => [...sr(sheet(el)).querySelectorAll<HTMLButtonElement>('[data-way]')];
const rowKg = (row: HTMLElement) =>
  [...row.querySelectorAll<HTMLElement>('.mc')].map((c) => Number(c.textContent));
const checked = (el: HTMLElement) => rows(el).findIndex((r) => r.getAttribute('aria-checked') === 'true');
const kgs = (el: HTMLElement) => sideOnScreen(el).map((p) => p.kg);
const announced = (el: HTMLElement) => q(sr(el), '[data-announce]').textContent;

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
});

describe('<rack-console> Another way: tap the bar (RBAR-66)', () => {
  it('steps through the ways of 140 kg, fewest Plates first, then wraps to the first', () => {
    const el = mountConsole();
    type(el, '140');
    expect(kgs(el)).toEqual([25, 25, 10]);
    const seen = [];
    for (let i = 0; i < 5; i++) {
      tapBar(el);
      seen.push(kgs(el));
      expect(totalText(el)).toBe('140 kg');
      expect(statusKind(el)).toBe('exact');
    }
    expect(seen).toEqual([
      [25, 20, 15],
      [20, 20, 20],
      [25, 25, 5, 5],
      [25, 20, 10, 5],
      [25, 25, 10],
    ]);
  });

  it('the bar is a focusable button only with more than one way, and Enter or Space steps', () => {
    const el = mountConsole();
    expect(bar(el).getAttribute('role')).toBeNull(); // bare Bar, no Target
    type(el, '21'); // a single 0.5 per side: one way
    expect(bar(el).getAttribute('role')).toBeNull();
    expect(bar(el).hasAttribute('tabindex')).toBe(false);
    tapBar(el);
    expect(kgs(el)).toEqual([0.5]);
    type(el, '140');
    expect(bar(el).getAttribute('role')).toBe('button');
    expect(bar(el).tabIndex).toBe(0);
    bar(el).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(kgs(el)).toEqual([25, 20, 15]);
    bar(el).dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(kgs(el)).toEqual([20, 20, 20]);
    expect(bar(el).getAttribute('aria-label')).toBe('Another way, 3 of 5');
  });

  it('a long press is not a tap: long-press stays free (RBAR-73)', () => {
    const el = mountConsole();
    type(el, '140');
    const at = (type: string, t: number) => {
      const e = new Event(type, { bubbles: true });
      Object.defineProperty(e, 'timeStamp', { value: t });
      bar(el).dispatchEvent(e);
    };
    at('pointerdown', 1000);
    at('click', 1600);
    expect(kgs(el)).toEqual([25, 25, 10]);
    at('pointerdown', 2000);
    at('click', 2120);
    expect(kgs(el)).toEqual([25, 20, 15]);
  });

  it('By Plates and Warm up never step the bar', () => {
    const el = mountConsole();
    type(el, '140');
    modeBtn(el, 'encode').click();
    expect(bar(el).getAttribute('role')).toBeNull();
    expect(pill(el).hidden).toBe(true);
    modeBtn(el, 'warmup').click();
    const before = kgs(el);
    tapBar(el);
    expect(kgs(el)).toEqual(before);
    expect(bar(el).getAttribute('role')).toBeNull();
  });

  it('says which way is on the Bar once off the first', () => {
    const el = mountConsole();
    type(el, '140');
    tapBar(el);
    expect(announced(el)).toBe('140 kilograms, Exact, way 2 of 5');
  });
});

describe('<rack-console> the Another way pill and sheet (RBAR-66)', () => {
  it('the pill shows only with more than one way, and "2/5" once off the first', () => {
    const el = mountConsole();
    expect(pill(el).hidden).toBe(true);
    type(el, '21');
    expect(pill(el).hidden).toBe(true);
    type(el, '140');
    expect(pill(el).hidden).toBe(false);
    expect(pill(el).textContent).toBe('Another way');
    tapBar(el);
    expect(count(el)).toBe('2/5');
    expect(pill(el).getAttribute('aria-label')).toBe('Another way, 2 of 5');
    for (let i = 0; i < 4; i++) tapBar(el);
    expect(count(el)).toBe('');
  });

  it('sits beside the round-up in the same row', () => {
    const el = mountConsole();
    type(el, '140.5');
    expect(roundUp(el).hidden).toBe(false);
    expect(pill(el).hidden).toBe(false);
    expect(pill(el).parentElement).toBe(roundUp(el).parentElement);
  });

  it('opens a sheet listing the ways, the loaded one selected; a row loads it; Done closes', () => {
    const el = mountConsole();
    type(el, '140');
    tapBar(el);
    expect(sheet(el).hidden).toBe(true);
    pill(el).click();
    expect(sheet(el).hidden).toBe(false);
    const root = sr(sheet(el));
    expect(root.querySelector('[data-heading]')!.textContent).toBe('Load 140 kg another way');
    expect(rows(el).map(rowKg)).toEqual([
      [25, 25, 10],
      [25, 20, 15],
      [20, 20, 20],
      [25, 25, 5, 5],
      [25, 20, 10, 5],
    ]);
    expect(rows(el).map((r) => r.querySelector('.count')!.textContent)).toEqual([
      '3 per side', '3 per side', '3 per side', '4 per side', '4 per side',
    ]);
    expect(checked(el)).toBe(1);
    rows(el)[3].click();
    expect(kgs(el)).toEqual([25, 25, 5, 5]);
    expect(checked(el)).toBe(3);
    expect(sheet(el).hidden).toBe(false); // stays open to compare
    expect(count(el)).toBe('4/5');
    root.querySelector<HTMLButtonElement>('[data-done]')!.click();
    expect(sheet(el).hidden).toBe(true);
    expect(kgs(el)).toEqual([25, 25, 5, 5]);
  });

  it('the sheet has no list label or helper text: a title, the rows, Done, and Set Plate Inventory', () => {
    const el = mountConsole();
    type(el, '140');
    pill(el).click();
    const panel = sr(sheet(el)).querySelector('[data-panel]')!;
    const kids = [...panel.children].map((c) => c.className);
    expect(kids).toEqual(['head', 'list', 'inv']);
    expect(panel.querySelector('[data-inventory]')!.textContent!.trim()).toBe('Set Plate Inventory');
  });

  it('titles the sheet with the Total on the Bar (not the Target), in the display unit', () => {
    const el = mountConsole();
    unitBtn(el, 'lb').click();
    type(el, '310'); // loads 309 lb
    pill(el).click();
    expect(totalText(el)).toBe('309 lb');
    expect(sr(sheet(el)).querySelector('[data-heading]')!.textContent).toBe(
      'Load 309 lb another way',
    );
  });

  it('Set Plate Inventory closes the sheet and asks for Setup (opensetup)', () => {
    const el = mountConsole();
    type(el, '140');
    pill(el).click();
    let asked = 0;
    el.addEventListener('opensetup', () => asked++);
    sr(sheet(el)).querySelector<HTMLButtonElement>('[data-inventory]')!.click();
    expect(asked).toBe(1);
    expect(sheet(el).hidden).toBe(true);
  });

  it('in the app, Set Plate Inventory opens the same Setup sheet as the header pill', () => {
    const app = document.createElement('rack-app');
    document.body.append(app);
    const c = q<Console>(sr(app), 'rack-console');
    type(c, '140');
    pill(c).click();
    sr(sheet(c)).querySelector<HTMLButtonElement>('[data-inventory]')!.click();
    expect(q<HTMLElement>(sr(app), 'rack-setup').hidden).toBe(false);
    expect(q(sr(app), '[data-setup-pill]').getAttribute('aria-expanded')).toBe('true');
    // The same sliders glyph as the header pill.
    const glyph = (svg: Element) => svg.innerHTML.replace(/\s+/g, ' ').trim();
    expect(glyph(sr(sheet(c)).querySelector('[data-inventory] svg')!)).toBe(
      glyph(q(sr(app), '[data-pill-icon]')),
    );
  });
});

describe('<rack-console> which way is kept (RBAR-66)', () => {
  const onSecondWay = () => {
    const el = mountConsole();
    type(el, '140');
    tapBar(el);
    expect(kgs(el)).toEqual([25, 20, 15]);
    return el;
  };

  it('a new Target goes back to the first way', () => {
    const el = onSecondWay();
    type(el, '140');
    expect(kgs(el)).toEqual([25, 25, 10]);
    expect(count(el)).toBe('');
  });

  it('a Bar, Collar or Plate set change goes back to the first way', () => {
    let el = onSecondWay();
    el.barKg = 15;
    expect(kgs(el)).toEqual([25, 25, 10, 2.5]);
    el = onSecondWay();
    el.collarKg = 2.5;
    expect(kgs(el)).toEqual([25, 25, 5, 2.5]);
    el = onSecondWay();
    el.plateSet = 'training';
    expect(count(el)).toBe('');
  });

  it('Round up and back each start on the first way, and the round-up cycles too', () => {
    const el = mountConsole();
    type(el, '139.5');
    tapBar(el);
    roundUp(el).click(); // 140
    expect(kgs(el)).toEqual([25, 25, 10]);
    tapBar(el);
    expect(kgs(el)).toEqual([25, 20, 15]);
    expect(totalText(el)).toBe('140 kg');
    expect(statusKind(el)).toBe('over');
    roundUp(el).click(); // Use 139
    expect(count(el)).toBe('');
    expect(totalText(el)).toBe('139 kg');
  });

  it('a kg|lb toggle that keeps the Total keeps the way', () => {
    const el = onSecondWay();
    unitBtn(el, 'lb').click();
    expect(kgs(el)).toEqual([25, 20, 15]);
    expect(count(el)).toBe('2/5');
    unitBtn(el, 'kg').click();
    expect(kgs(el)).toEqual([25, 20, 15]);
  });

  it('a mode round trip reseeds the Target from the loaded way and starts over', () => {
    const el = onSecondWay();
    modeBtn(el, 'encode').click();
    expect(kgs(el)).toEqual([25, 20, 15]); // the carried Side (ADR-0005)
    modeBtn(el, 'decode').click();
    expect(pill(el).hidden).toBe(true); // a carry, no live decode
  });
});

describe('<rack-console> the loaded way is what is shared (RBAR-66)', () => {
  it('the share card, fullscreen card and share link carry the way on the Bar', () => {
    const el = mountConsole();
    type(el, '140');
    tapBar(el);
    q<HTMLButtonElement>(sr(el), '[data-share]').click();
    const share = q<HTMLElement & { load: LoadSummary; link: string | null }>(sr(el), 'rack-share');
    expect(share.load.side.map((p) => p.kg)).toEqual([25, 20, 15]);
    const link = parseLink(share.link!.slice(share.link!.indexOf('#')), 'kg')!;
    expect(link.side.map((p) => p.kg)).toEqual([25, 20, 15]);
    expect(link.mode === 'decode' && link.targetKg).toBe(140);
    q<HTMLButtonElement>(sr(el), '[data-fullscreen]').click();
    const fs = q<HTMLElement & { load: LoadSummary }>(sr(el), 'rack-fullscreen');
    expect(fs.load.side.map((p) => p.kg)).toEqual([25, 20, 15]);
  });

  it('opening a link to another way shows that way, still a live decode', () => {
    const el = mountConsole() as Console & { applyLink(l: LinkLoad): void };
    const kg = (w: number) => ELEIKO_KG.find((p) => p.kg === w)!;
    el.applyLink({ mode: 'decode', side: [kg(20), kg(20), kg(20)], targetKg: 140, unit: 'kg' });
    expect(kgs(el)).toEqual([20, 20, 20]);
    expect(count(el)).toBe('3/5');
    expect(statusKind(el)).toBe('exact');
    tapBar(el);
    expect(kgs(el)).toEqual([25, 25, 5, 5]);
  });

  it("opening a link to another way of the round-up shows the round-up on that way", () => {
    const el = mountConsole() as Console & { applyLink(l: LinkLoad): void };
    const kg = (w: number) => ELEIKO_KG.find((p) => p.kg === w)!;
    el.applyLink({ mode: 'decode', side: [kg(25), kg(20), kg(15)], targetKg: 139.5, unit: 'kg' });
    expect(kgs(el)).toEqual([25, 20, 15]);
    expect(statusKind(el)).toBe('over');
    expect(count(el)).toBe('2/5');
  });
});
