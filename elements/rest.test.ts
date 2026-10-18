// RBAR-94 (ADR-0019): the Rest timer in the app, driven through the real controls --
// the console's stopwatch, Warm up's Next, the dock, the timer screen and its settings
// card -- on a fake clock (Date and the timers are vitest's fakes).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import './app.ts';
import {
  ALERT_GRACE_MS,
  RestClock,
  REST_STORAGE_KEY,
  REST_SETTINGS_STORAGE_KEY,
  ZERO_VIBRATION,
} from './restclock.ts';
import { STALE_PAUSE_MS } from '../lib/rest.ts';
import type { Chime } from './chime.ts';
import { CHIME_SESSION_TYPE, preferMixingSession } from './chime.ts';
import { DOCK_PX, DOCK_SHORT_PX } from './restdock.ts';
import { SLEEVE_DOCKED_MIN_PX } from '../lib/sleevefit.ts';
import { stubWakeLock } from './wakelock.stub.ts';
import type { WakeStub } from './wakelock.stub.ts';

const T0 = Date.UTC(2026, 9, 17, 18, 0, 0);
let vibrate: ReturnType<typeof vi.fn>;
let wake: WakeStub | null = null;

beforeEach(() => {
  vi.useFakeTimers({
    now: T0,
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
  vibrate = vi.fn(() => true);
  Object.defineProperty(navigator, 'vibrate', { configurable: true, value: vibrate });
});
afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  wake?.restore();
  wake = null;
  delete (navigator as { vibrate?: unknown }).vibrate;
  vi.useRealTimers();
});

const sr = (el: Element): ShadowRoot => el.shadowRoot!;
function mountApp(): HTMLElement {
  const el = document.createElement('rack-app');
  document.body.append(el);
  return el;
}
const con = (app: HTMLElement) => sr(app).querySelector('rack-console')!;
const rest = (app: HTMLElement) => sr(app).querySelector('rack-rest')!;
const dock = (app: HTMLElement) => sr(rest(app)).querySelector('rack-rest-dock') as HTMLElement;
const screen = (app: HTMLElement) => sr(rest(app)).querySelector('rack-rest-screen') as HTMLElement;
const inDock = <T extends Element = HTMLButtonElement>(app: HTMLElement, sel: string) =>
  sr(dock(app)).querySelector<T & Element>(sel) as T;
const inScreen = <T extends Element = HTMLButtonElement>(app: HTMLElement, sel: string) =>
  sr(screen(app)).querySelector<T & Element>(sel) as T;
const stopwatch = (app: HTMLElement) =>
  sr(con(app)).querySelector<HTMLButtonElement>('[data-rest]')!;
const dockTime = (app: HTMLElement) => inDock<HTMLElement>(app, '[data-time]').textContent;
// The pill's visible buttons, left to right, by their data-pill name.
const pill = (app: HTMLElement) =>
  [...sr(dock(app)).querySelectorAll<HTMLButtonElement>('[data-open], [data-pill]')]
    .filter((b) => !b.hidden)
    .map((b) => b.dataset.pill ?? 'time');
const flashOn = (app: HTMLElement) =>
  sr(rest(app)).querySelector('[data-flash]')!.classList.contains('on');
const later = (ms: number) => vi.advanceTimersByTime(ms);

describe('the stopwatch (RBAR-94)', () => {
  it('sits first in the head row and, idle, starts the remembered 2:00 Rest: the dock comes up', () => {
    const app = mountApp();
    const icons = sr(con(app)).querySelector('.icons')!;
    expect(icons.firstElementChild).toBe(stopwatch(app));
    expect(stopwatch(app).getAttribute('aria-label')).toBe('Rest timer');
    expect(dock(app).hidden).toBe(true);
    expect(app.hasAttribute('resting')).toBe(false);
    stopwatch(app).click();
    expect(dock(app).hidden).toBe(false);
    expect(app.hasAttribute('resting')).toBe(true);
    expect(con(app).hasAttribute('resting')).toBe(true);
    expect(dockTime(app)).toBe('2:00');
    expect(screen(app).hidden).toBe(true);
  });

  it('while a Rest shows, opens the timer screen; the chevron closes it and focus returns', () => {
    const app = mountApp();
    stopwatch(app).click();
    stopwatch(app).click();
    expect(screen(app).hidden).toBe(false);
    expect(sr(screen(app)).activeElement).toBe(inScreen(app, '[data-close]'));
    inScreen(app, '[data-close]').click();
    expect(screen(app).hidden).toBe(true);
    expect(sr(con(app)).activeElement).toBe(stopwatch(app));
  });

  it('the dock time opens the screen too; Escape closes it and focus returns to the time', () => {
    const app = mountApp();
    stopwatch(app).click();
    inDock(app, '[data-open]').click();
    expect(screen(app).hidden).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(screen(app).hidden).toBe(true);
    expect(sr(dock(app)).activeElement).toBe(inDock(app, '[data-open]'));
  });

  it('closing a screen whose dock opener has gone (a reset) focuses the stopwatch', () => {
    const app = mountApp();
    stopwatch(app).click();
    inDock(app, '[data-open]').click();
    inScreen(app, '[data-reset]').click();
    expect(dock(app).hidden).toBe(true);
    inScreen(app, '[data-close]').click();
    expect(sr(con(app)).activeElement).toBe(stopwatch(app));
  });

  it("the dock's time button is named with the time left, and says when paused", () => {
    const app = mountApp();
    stopwatch(app).click();
    later(36_000);
    const name = () => inDock(app, '[data-open]').textContent!.replace(/\s+/g, ' ').trim();
    expect(name()).toBe('Rest 1:24 left, open timer');
    expect(inDock(app, '[data-open]').hasAttribute('aria-label')).toBe(false);
    stopwatch(app).click();
    inScreen(app, '[data-primary]').click();
    expect(name()).toBe('Rest 1:24 left, paused, open timer');
  });

  it('Escape still closes the screen after the timer is re-mounted', () => {
    const el = document.createElement('rack-rest') as HTMLElement & { tap(): void };
    document.body.append(el);
    el.remove();
    document.body.append(el);
    el.tap();
    el.tap();
    const scr = sr(el).querySelector('rack-rest-screen') as HTMLElement;
    expect(scr.hidden).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(scr.hidden).toBe(true);
  });
});

describe('counting, from the clock not the ticks', () => {
  it('counts down on the dock and the screen, with the ring draining', () => {
    const app = mountApp();
    stopwatch(app).click();
    stopwatch(app).click();
    later(30_000);
    expect(dockTime(app)).toBe('1:30');
    expect(inScreen<HTMLElement>(app, '[data-time]').textContent).toBe('1:30');
    expect(inScreen<HTMLElement>(app, '[data-sub]').textContent).toBe('of 2:00');
    expect(inScreen<SVGElement>(app, '[data-r]').style.getPropertyValue('--r')).toBe('0.7500');
  });

  it('a jump in time with no ticks in between (a throttled tab) reads the true time', () => {
    const app = mountApp();
    stopwatch(app).click();
    vi.setSystemTime(T0 + 75_000); // the clock moved; no interval fired
    later(250);
    expect(dockTime(app)).toBe('0:45');
  });

  it('a reload resumes the running Rest from its stored end time', () => {
    let app = mountApp();
    stopwatch(app).click();
    later(20_000);
    app.remove();
    vi.setSystemTime(T0 + 50_000);
    app = mountApp();
    expect(dock(app).hidden).toBe(false);
    expect(app.hasAttribute('resting')).toBe(true);
    expect(dockTime(app)).toBe('1:10');
  });
});

describe('zero', () => {
  it('flashes the screen edge, buzzes, then counts overtime on a grey pill with a check', () => {
    const app = mountApp();
    stopwatch(app).click();
    later(120_000);
    expect(flashOn(app)).toBe(true);
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenCalledWith(ZERO_VIBRATION);
    expect(inDock<HTMLElement>(app, '[data-dock]').classList.contains('is-over')).toBe(true);
    expect(pill(app)).toEqual(['time', 'restart', 'clear']);
    expect(inDock<HTMLElement>(app, '[data-check]').hidden).toBe(false);
    expect(inDock<SVGElement>(app, '[data-mini]').hasAttribute('hidden')).toBe(true);
    expect(inDock(app, '[data-open]').textContent!.replace(/\s+/g, ' ').trim()).toBe(
      'Rest over, +0:00, open timer',
    );
    expect(inDock<HTMLElement>(app, '[data-announce]').textContent).toBe('Rest over');
    later(12_000);
    expect(dockTime(app)).toBe('+0:12');
    expect(flashOn(app)).toBe(false); // the flash is a moment, not a state
    expect(vibrate).toHaveBeenCalledTimes(1); // once
  });

  it('the edge flash rests at opacity 0: a forwards animation over a 0 base, never a lit class', () => {
    const src = readFileSync(resolve(import.meta.dirname, 'rest.ts'), 'utf8');
    expect(src).toMatch(/\.flash \{[^}]*opacity: 0;/);
    expect(src).toContain('inset 0 0 0 3px var(--rack-accent)');
    expect(src).not.toMatch(/\.flash\.on \{[^}]*opacity: 1/);
    const anims = [...src.matchAll(/\.flash\.on \{ animation: (\w+) [^}]*\}/g)];
    expect(anims.length).toBe(2);
    for (const [rule, name] of anims) {
      expect(rule).toContain('forwards');
      const frames = src.match(new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\s*\\}`))![1];
      expect(frames.trim()).toMatch(/100% \{ opacity: 0; \}$/);
    }
    // Three blinks: three keyframes at full opacity.
    expect(src.match(/@keyframes edgeblink[\s\S]*?100%/)![0].match(/opacity: 1;/g)!.length).toBe(3);
  });

  it('a finished pill restarts the last Rest on a tap; its x clears it', () => {
    const app = mountApp();
    stopwatch(app).click();
    stopwatch(app).click();
    inScreen(app, '[data-preset="90"]').click();
    inScreen(app, '[data-close]').click();
    later(100_000);
    expect(inDock(app, '[data-again]').getAttribute('aria-label')).toBe('Restart 1:30');
    inDock(app, '[data-again]').click();
    expect(dockTime(app)).toBe('1:30');
    later(95_000);
    inDock(app, '[data-clear]').click();
    expect(dock(app).hidden).toBe(true);
    expect(app.hasAttribute('resting')).toBe(false);
    expect(con(app).hasAttribute('resting')).toBe(false);
  });

  it('a Rest that ended while the app was closed shows its overtime, with no alert', () => {
    let app = mountApp();
    stopwatch(app).click();
    app.remove();
    vi.setSystemTime(T0 + 130_000);
    app = mountApp();
    expect(dockTime(app)).toBe('+0:10');
    expect(flashOn(app)).toBe(false);
    expect(vibrate).not.toHaveBeenCalled();
    expect(inDock<HTMLElement>(app, '[data-announce]').textContent).toBe('');
  });

  it('a stored finish or pause in the future is dropped (a clock set back, an edited key)', () => {
    for (const rest of [
      { phase: 'done', last: 90, dur: 90, endAt: T0 + 60_000 },
      { phase: 'pause', last: 90, dur: 90, leftMs: 30_000, pausedAt: T0 + 60_000 },
    ]) {
      localStorage.setItem(REST_STORAGE_KEY, JSON.stringify(rest));
      const app = mountApp();
      expect(dock(app).hidden).toBe(true);
      app.remove();
    }
  });

  it('a stored end time further off than the longest Rest is dropped', () => {
    localStorage.setItem(
      REST_STORAGE_KEY,
      JSON.stringify({ phase: 'run', last: 90, dur: 90, endAt: T0 + 86_400_000 }),
    );
    const app = mountApp();
    expect(dock(app).hidden).toBe(true);
    stopwatch(app).click();
    expect(dockTime(app)).toBe('1:30');
  });
});

describe('the floating pill (option B)', () => {
  it('counting: the time, pause right on the pill, and the dots; pause freezes the clock', () => {
    const app = mountApp();
    stopwatch(app).click();
    expect(pill(app)).toEqual(['time', 'pp', 'more']);
    later(10_000);
    const pp = inDock(app, '[data-pp]');
    expect(pp.getAttribute('aria-label')).toBe('Pause');
    pp.click();
    expect(pp.getAttribute('aria-label')).toBe('Resume');
    later(60_000);
    expect(dockTime(app)).toBe('1:50');
    pp.click();
    later(5_000);
    expect(dockTime(app)).toBe('1:45');
  });

  it('the mini ring is the only progress: no track bar on the pill', () => {
    const app = mountApp();
    stopwatch(app).click();
    later(30_000);
    expect(sr(dock(app)).querySelector('.track')).toBeNull();
    expect(sr(dock(app)).querySelectorAll('[data-r]').length).toBe(1);
    expect(inDock<SVGElement>(app, '[data-r]').style.getPropertyValue('--r')).toBe('0.7500');
  });

  it('the dots expand -15 / +15 / x; the chevron folds them', () => {
    const app = mountApp();
    stopwatch(app).click();
    const more = inDock(app, '[data-more]');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    more.click();
    expect(more.getAttribute('aria-expanded')).toBe('true');
    expect(more.getAttribute('aria-label')).toBe('Fewer controls');
    expect(pill(app)).toEqual(['time', 'minus', 'plus', 'pp', 'clear', 'more']);
    inDock(app, '[data-adjust="15"]').click();
    expect(dockTime(app)).toBe('2:15');
    inDock(app, '[data-adjust="-15"]').click();
    inDock(app, '[data-adjust="-15"]').click();
    expect(dockTime(app)).toBe('1:45');
    more.click();
    expect(pill(app)).toEqual(['time', 'pp', 'more']);
    more.click();
    inDock(app, '[data-clear]').click();
    expect(dock(app).hidden).toBe(true);
    // A fresh Rest comes up folded.
    stopwatch(app).click();
    expect(pill(app)).toEqual(['time', 'pp', 'more']);
  });

  it('an expanded pill folds at zero into the done pill', () => {
    const app = mountApp();
    stopwatch(app).click();
    inDock(app, '[data-more]').click();
    later(121_000);
    expect(pill(app)).toEqual(['time', 'restart', 'clear']);
    inDock(app, '[data-again]').click();
    expect(pill(app)).toEqual(['time', 'pp', 'more']);
  });

  it('tapping the time opens the Ring screen', () => {
    const app = mountApp();
    stopwatch(app).click();
    inDock(app, '[data-open]').click();
    expect(screen(app).hidden).toBe(false);
  });
});

describe('the timer screen', () => {
  function opened(): HTMLElement {
    const app = mountApp();
    stopwatch(app).click();
    stopwatch(app).click();
    return app;
  }

  it('the presets are one pill toggle; a preset starts that Rest and is remembered', () => {
    const app = opened();
    const seg = inScreen<HTMLElement>(app, '.seg');
    expect([...seg.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      '1:30',
      '2:00',
      '3:00',
      '5:00',
    ]);
    inScreen(app, '[data-preset="180"]').click();
    expect(inScreen(app, '[data-preset="180"]').getAttribute('aria-pressed')).toBe('true');
    expect(inScreen<HTMLElement>(app, '[data-time]').textContent).toBe('3:00');
    expect(JSON.parse(localStorage.getItem(REST_STORAGE_KEY)!).last).toBe(180);
  });

  it('-15 and +15 move the time left; the round pause freezes it and resumes', () => {
    const app = opened();
    later(10_000);
    inScreen(app, '[data-adjust="15"]').click();
    expect(inScreen<HTMLElement>(app, '[data-time]').textContent).toBe('2:05');
    inScreen(app, '[data-adjust="-15"]').click();
    inScreen(app, '[data-adjust="-15"]').click();
    expect(inScreen<HTMLElement>(app, '[data-time]').textContent).toBe('1:35');
    const pri = inScreen(app, '[data-primary]');
    expect(pri.getAttribute('aria-label')).toBe('Pause');
    pri.click();
    expect(pri.getAttribute('aria-label')).toBe('Resume');
    later(60_000);
    expect(inScreen<HTMLElement>(app, '[data-time]').textContent).toBe('1:35');
    expect(dockTime(app)).toBe('1:35');
    pri.click();
    later(5_000);
    expect(inScreen<HTMLElement>(app, '[data-time]').textContent).toBe('1:30');
  });

  it('reset stops the Rest: the dock goes, the screen shows the remembered length to start', () => {
    const app = opened();
    inScreen(app, '[data-reset]').click();
    expect(dock(app).hidden).toBe(true);
    expect(app.hasAttribute('resting')).toBe(false);
    expect(inScreen<HTMLElement>(app, '[data-time]').textContent).toBe('2:00');
    expect(inScreen(app, '[data-primary]').getAttribute('aria-label')).toBe('Start 2:00');
  });

  it('at zero it goes quiet: a check, the overtime, and a round restart and done only', () => {
    const app = opened();
    expect(inScreen<HTMLElement>(app, '[data-check]').hidden).toBe(true);
    later(125_000);
    expect(inScreen<HTMLElement>(app, '[data-scr]').classList.contains('is-over')).toBe(true);
    expect(inScreen<HTMLElement>(app, '[data-check]').hidden).toBe(false);
    expect(inScreen<HTMLElement>(app, '[data-time]').textContent).toBe('+0:05');
    expect(inScreen<HTMLElement>(app, '[data-sub]').textContent).toBe('rest 2:00');
    const ctl = [...sr(screen(app)).querySelectorAll<HTMLButtonElement>('.ctl button')]
      .filter((b) => !b.hidden)
      .map((b) => b.getAttribute('aria-label'));
    expect(ctl).toEqual(['Restart 2:00', 'Done, clear the rest timer']);
    inScreen(app, '[data-again]').click();
    expect(inScreen<HTMLElement>(app, '[data-time]').textContent).toBe('2:00');
    expect(inScreen(app, '[data-primary]').hidden).toBe(false);
    expect(inScreen<HTMLElement>(app, '[data-check]').hidden).toBe(true);
  });

  it('focus on the pause at zero moves to the restart, not to nowhere', () => {
    const app = opened();
    inScreen(app, '[data-primary]').focus();
    later(121_000);
    expect(sr(screen(app)).activeElement).toBe(inScreen(app, '[data-again]'));
  });

  it('done clears the Rest and closes the screen', () => {
    const app = opened();
    later(125_000);
    inScreen(app, '[data-done]').click();
    expect(screen(app).hidden).toBe(true);
    expect(dock(app).hidden).toBe(true);
    expect(app.hasAttribute('resting')).toBe(false);
    expect(sr(con(app)).activeElement).toBe(stopwatch(app));
  });

  it('has a grabber at the top as a swipe hint', () => {
    const app = opened();
    const col = inScreen<HTMLElement>(app, '.col');
    expect(col.firstElementChild!.classList.contains('grab')).toBe(true);
    expect(col.firstElementChild!.getAttribute('aria-hidden')).toBe('true');
  });

  it("a tap outside the ring closes it; a tap on the ring doesn't", () => {
    const app = opened();
    const ring = inScreen<HTMLElement>(app, '.rg');
    ring.getBoundingClientRect = () =>
      ({ left: 70, top: 150, width: 248, height: 248, right: 318, bottom: 398, x: 70, y: 150 }) as DOMRect;
    const tap = (el: Element, x: number, y: number) =>
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, clientX: x, clientY: y }));
    tap(ring, 194, 274); // the center, on the digits
    expect(screen(app).hidden).toBe(false);
    tap(inScreen(app, '.mid'), 194, 274 + 124 + 10); // just below the ring
    expect(screen(app).hidden).toBe(true);
    stopwatch(app).click();
    expect(screen(app).hidden).toBe(false);
    tap(inScreen(app, '.tb .sp'), 200, 30); // the top bar's gap
    expect(screen(app).hidden).toBe(true);
  });

  it('a tap outside the ring with the settings card up closes the card, not the screen', () => {
    const app = opened();
    inScreen(app, '[data-settings]').click();
    inScreen<HTMLElement>(app, '.mid').dispatchEvent(
      new MouseEvent('click', { bubbles: true, composed: true, clientX: 5, clientY: 5 }),
    );
    expect(screen(app).hidden).toBe(false);
    inScreen(app, '[data-overlay]').click();
    expect(inScreen<HTMLElement>(app, '[data-card]').hidden).toBe(true);
    expect(screen(app).hidden).toBe(false);
  });

  it('a swipe down closes it; a short drag springs back', () => {
    const app = opened();
    const scr = inScreen<HTMLElement>(app, '[data-scr]');
    const mid = inScreen<HTMLElement>(app, '.mid');
    const drag = (dy: number) => {
      mid.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true, clientY: 200 }));
      mid.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, composed: true, clientY: 200 + dy }));
      mid.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, composed: true, clientY: 200 + dy }));
    };
    drag(40);
    expect(screen(app).hidden).toBe(false);
    expect(scr.style.transform).toBe('');
    // The click that ends a drag is not a tap outside the ring.
    mid.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, clientX: 1, clientY: 1 }));
    expect(screen(app).hidden).toBe(false);
    later(1);
    drag(120);
    expect(screen(app).hidden).toBe(true);
    expect(dock(app).hidden).toBe(false); // closing keeps the Rest
  });
});

describe('the settings card', () => {
  it('defaults: Chime at zero off, Start after Next off; the toggles persist', () => {
    const app = mountApp();
    stopwatch(app).click();
    stopwatch(app).click();
    const gear = inScreen(app, '[data-settings]');
    expect(inScreen<HTMLElement>(app, '[data-card]').hidden).toBe(true);
    gear.click();
    expect(gear.getAttribute('aria-expanded')).toBe('true');
    expect(inScreen<HTMLElement>(app, '[data-card]').hidden).toBe(false);
    expect(inScreen(app, '[data-chime]').getAttribute('aria-checked')).toBe('false');
    expect(inScreen(app, '[data-auto]').getAttribute('aria-checked')).toBe('false');
    inScreen(app, '[data-chime]').click();
    inScreen(app, '[data-auto]').click();
    expect(inScreen(app, '[data-auto]').getAttribute('aria-checked')).toBe('true');
    expect(JSON.parse(localStorage.getItem(REST_SETTINGS_STORAGE_KEY)!)).toEqual({
      chime: true,
      startAfterNext: true,
    });
    // Escape closes the card first, then the screen.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(inScreen<HTMLElement>(app, '[data-card]').hidden).toBe(true);
    expect(screen(app).hidden).toBe(false);
  });
});

describe("Warm up's Next starts the Rest (Start after Next)", () => {
  function warm(): HTMLElement {
    localStorage.setItem('rackbar.working', '140');
    const app = mountApp();
    sr(con(app)).querySelector<HTMLButtonElement>('[data-mode="warmup"]')!.click();
    return app;
  }
  const next = (app: HTMLElement) =>
    sr(sr(con(app)).querySelector('rack-warmup')!).querySelector<HTMLButtonElement>('[data-next]')!;

  it('off by default: Next leaves the timer alone, idle or counting', () => {
    const app = warm();
    next(app).click();
    expect(dock(app).hidden).toBe(true);
    stopwatch(app).click();
    later(40_000);
    next(app).click(); // no restart under a running Rest either
    expect(dockTime(app)).toBe('1:20');
  });

  it("the preview's stored autoStart: true does not turn it on", () => {
    localStorage.setItem(REST_SETTINGS_STORAGE_KEY, JSON.stringify({ chime: false, autoStart: true }));
    const app = warm();
    next(app).click();
    expect(dock(app).hidden).toBe(true);
  });

  it('on: Next starts the remembered Rest', () => {
    localStorage.setItem(REST_SETTINGS_STORAGE_KEY, JSON.stringify({ chime: false, startAfterNext: true }));
    const app = warm();
    next(app).click();
    expect(dock(app).hidden).toBe(false);
    expect(dockTime(app)).toBe('2:00');
    later(40_000);
    next(app).click(); // the next set: a fresh Rest
    expect(dockTime(app)).toBe('2:00');
  });

  it('a stair tap is not Next: it starts nothing', () => {
    const app = warm();
    sr(sr(con(app)).querySelector('rack-warmup')!).querySelectorAll<HTMLButtonElement>('.st')[2].click();
    expect(dock(app).hidden).toBe(true);
  });
});

describe('the chime seam and the wake lock', () => {
  function clockWith(chime: Chime): { app: HTMLElement; clock: RestClock } {
    const clock = new RestClock({ chime });
    const el = document.createElement('rack-rest') as HTMLElement & { clock: RestClock };
    el.clock = clock;
    document.body.append(el);
    return { app: el, clock };
  }

  it('plays once at zero only when Chime at zero is on; the preview plays on demand', () => {
    const chime = { unlock: vi.fn(), play: vi.fn() };
    const { clock } = clockWith(chime);
    clock.start(90);
    vi.advanceTimersByTime(91_000);
    expect(chime.play).not.toHaveBeenCalled();
    clock.setChime(true);
    clock.restart();
    vi.advanceTimersByTime(95_000);
    expect(chime.play).toHaveBeenCalledTimes(1);
    clock.previewChime();
    expect(chime.play).toHaveBeenCalledTimes(2);
    expect(chime.unlock).toHaveBeenCalled();
  });

  it('with the chime on, any tap in the timer unlocks Web Audio (the first user gesture)', () => {
    localStorage.setItem(REST_SETTINGS_STORAGE_KEY, JSON.stringify({ chime: true }));
    const chime = { unlock: vi.fn(), play: vi.fn() };
    const { app, clock } = clockWith(chime);
    clock.start(90);
    sr(sr(app).querySelector('rack-rest-dock')!).querySelector<HTMLButtonElement>('[data-pp]')!.click();
    expect(chime.unlock).toHaveBeenCalled();
  });

  it('with the chime off, taps never touch Web Audio; turning it on unlocks it', () => {
    const chime = { unlock: vi.fn(), play: vi.fn() };
    const { app, clock } = clockWith(chime);
    clock.start(90);
    const d = sr(sr(app).querySelector('rack-rest-dock')!);
    d.querySelector<HTMLButtonElement>('[data-pp]')!.click();
    d.querySelector<HTMLButtonElement>('[data-open]')!.click();
    expect(chime.unlock).not.toHaveBeenCalled();
    clock.setChime(true);
    expect(chime.unlock).toHaveBeenCalledTimes(1);
  });

  it('a zero noticed late (back from the background) is quiet: no flash, buzz or chime', () => {
    const chime = { unlock: vi.fn(), play: vi.fn() };
    localStorage.setItem(REST_SETTINGS_STORAGE_KEY, JSON.stringify({ chime: true }));
    const { app, clock } = clockWith(chime);
    const zero = vi.fn();
    clock.addEventListener('zero', zero);
    clock.start(120);
    vi.setSystemTime(T0 + 20 * 60_000); // 20 minutes on, no tick fired (iOS suspends it)
    document.dispatchEvent(new Event('visibilitychange'));
    expect(clock.reading()).toMatchObject({ phase: 'over', text: '+18:00' });
    expect(zero).not.toHaveBeenCalled();
    expect(chime.play).not.toHaveBeenCalled();
    expect(vibrate).not.toHaveBeenCalled();
    expect(sr(app).querySelector('[data-flash]')!.classList.contains('on')).toBe(false);
  });

  it('a zero noticed within the grace still alerts (a throttled tick)', () => {
    const { clock } = clockWith({ unlock() {}, play() {} });
    const zero = vi.fn();
    clock.addEventListener('zero', zero);
    clock.start(90);
    vi.setSystemTime(T0 + 90_000 + ALERT_GRACE_MS);
    clock.tick();
    expect(zero).toHaveBeenCalledTimes(1);
  });

  it('asks iOS for a mixing audio session where navigator.audioSession exists, never forcing one', () => {
    const nav = (session?: { type: string }) => ({ audioSession: session }) as unknown as Navigator;
    const auto = { type: 'auto' };
    preferMixingSession(nav(auto));
    expect(CHIME_SESSION_TYPE).toBe('transient');
    expect(auto.type).toBe('transient');
    const chosen = { type: 'playback' };
    preferMixingSession(nav(chosen));
    expect(chosen.type).toBe('playback'); // a type already chosen is left alone
    expect(() => preferMixingSession(nav())).not.toThrow(); // no API: nothing happens
    const strict = {
      get type() {
        return 'auto';
      },
      set type(_v: string) {
        throw new TypeError('unsupported');
      },
    };
    expect(() => preferMixingSession(nav(strict))).not.toThrow();
  });

  it('holds the screen awake while a Rest runs or is paused, not in overtime or idle', async () => {
    wake = stubWakeLock();
    const { clock } = clockWith({ unlock() {}, play() {} });
    const settle = () => vi.advanceTimersByTimeAsync(1);
    expect(wake.live).toBe(0);
    clock.start(90);
    await settle();
    expect(wake.live).toBe(1);
    clock.toggle();
    await settle();
    expect(wake.live).toBe(1);
    clock.toggle();
    await vi.advanceTimersByTimeAsync(91_000);
    expect(wake.live).toBe(0);
    clock.restart();
    await settle();
    expect(wake.live).toBe(1);
    clock.clear();
    await settle();
    expect(wake.live).toBe(0);
    // A pause left for half an hour clears, and the screen may sleep again.
    clock.start(90);
    clock.toggle();
    await settle();
    expect(wake.live).toBe(1);
    await vi.advanceTimersByTimeAsync(STALE_PAUSE_MS);
    expect(clock.state.phase).toBe('idle');
    expect(wake.live).toBe(0);
  });
});

// The fit contract as CSS text (ADR-0013, ADR-0019): happy-dom has no layout, so the
// real measurement is scripts/fit-check.js; these pin the rules it measures.
describe('the dock never covers the column (ADR-0019)', () => {
  const root = resolve(import.meta.dirname, '..');
  const appSrc = readFileSync(resolve(root, 'elements/app.ts'), 'utf8');
  const conSrc = readFileSync(resolve(root, 'elements/console.ts'), 'utf8');

  it('the app reserves the pill height while resting (66px, 54px on a short screen)', () => {
    // The 52px pill + its 10px gap + 4px of air (48 + 6 on a short screen).
    expect(DOCK_PX).toBe(66);
    expect(DOCK_SHORT_PX).toBe(54);
    expect(appSrc).toContain(':host([resting]) { padding-bottom: ${DOCK_PX}px; }');
    expect(appSrc).toContain(':host([resting]) { padding-bottom: ${DOCK_SHORT_PX}px; }');
  });

  it('the bar block may flex down to the docked floor while resting', () => {
    expect(SLEEVE_DOCKED_MIN_PX).toBeGreaterThanOrEqual(36);
    expect(conSrc).toMatch(/:host\(\[resting\]\) \.viz \{\s*min-height: \$\{VIZ_PAD_PX \+ LABEL_PX \+ VIZ_GAP_PX \+ SLEEVE_DOCKED_MIN_PX\}px;/);
  });

  it('the dock sits under every sheet and the timer screen over the fullscreen card', () => {
    const z = (file: string) =>
      Number(readFileSync(resolve(root, file), 'utf8').match(/z-index: (\d+)/)![1]);
    expect(z('elements/restdock.ts')).toBeLessThan(z('elements/entry.ts'));
    expect(z('elements/restdock.ts')).toBeLessThan(z('elements/setup.ts'));
    expect(z('elements/restscreen.ts')).toBeGreaterThan(z('elements/fullscreen.ts'));
  });
});
