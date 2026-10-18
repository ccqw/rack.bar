// Property-based invariants for the Rest timer's shell (RBAR-94, ADR-0019), driven
// through the REAL input paths -- the stopwatch, the pill (pause, the dots, -15 / +15,
// restart, x), the timer screen (presets, -15/+15, pause, reset, restart, done,
// settings), Warm up's Next, time passing and a reload -- on a fake clock, and judged
// from what is on screen. The core rules (time
// from timestamps, pause holds time, the round trip) are in lib/properties.test.ts.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import './app.ts';
import { SEED } from './properties.drivers.ts';
import { pillControls } from '../lib/rest.ts';
import { REST_SETTINGS_STORAGE_KEY } from './restclock.ts';

const T0 = Date.UTC(2026, 9, 17, 18, 0, 0);
beforeEach(() => {
  vi.useFakeTimers({
    now: T0,
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
});
afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  vi.useRealTimers();
});

const sr = (el: Element): ShadowRoot => el.shadowRoot!;
type App = { el: HTMLElement };
const con = (a: App) => sr(a.el).querySelector('rack-console')!;
const restRoot = (a: App) => sr(sr(a.el).querySelector('rack-rest')!);
const dock = (a: App) => restRoot(a).querySelector('rack-rest-dock') as HTMLElement;
const screen = (a: App) => restRoot(a).querySelector('rack-rest-screen') as HTMLElement;
const btn = (root: ShadowRoot, sel: string) => root.querySelector<HTMLButtonElement>(sel);
const mount = (): App => {
  const el = document.createElement('rack-app');
  document.body.append(el);
  return { el };
};
// What the dock shows: its visible row's clock text, or null when the dock is down.
function dockText(a: App): string | null {
  if (dock(a).hidden) return null;
  return sr(dock(a)).querySelector('[data-time]')!.textContent;
}
const secs = (t: string) => {
  const [m, s] = t.replace('+', '').split(':').map(Number);
  return m * 60 + s;
};

type Act =
  | { k: 'stopwatch' }
  | { k: 'pill'; b: string }
  | { k: 'screen'; b: string }
  | { k: 'next' }
  | { k: 'wait'; ms: number }
  | { k: 'reload' };

const actArb: fc.Arbitrary<Act> = fc.oneof(
  fc.constant<Act>({ k: 'stopwatch' }),
  fc
    .constantFrom(
      '[data-pp]',
      '[data-more]',
      '[data-adjust="15"]',
      '[data-adjust="-15"]',
      '[data-again]',
      '[data-clear]',
      '[data-open]',
    )
    .map<Act>((b) => ({ k: 'pill', b })),
  fc
    .constantFrom(
      '[data-primary]',
      '[data-adjust="15"]',
      '[data-adjust="-15"]',
      '[data-reset]',
      '[data-preset="90"]',
      '[data-preset="300"]',
      '[data-close]',
      '[data-again]',
      '[data-done]',
      '[data-settings]',
      '[data-auto]',
    )
    .map<Act>((b) => ({ k: 'screen', b })),
  fc.constant<Act>({ k: 'next' }),
  fc.integer({ min: 0, max: 200_000 }).map<Act>((ms) => ({ k: 'wait', ms })),
  fc.constant<Act>({ k: 'reload' }),
);

function run(a: App, act: Act): App {
  switch (act.k) {
    case 'stopwatch':
      btn(sr(con(a)), '[data-rest]')!.click();
      return a;
    case 'pill': {
      // Only what is on the pill can be tapped: a hidden button is not there.
      const b = dock(a).hidden ? null : btn(sr(dock(a)), act.b);
      if (b && !b.hidden) b.click();
      return a;
    }
    case 'screen':
      if (!screen(a).hidden) {
        const b = btn(sr(screen(a)), act.b);
        // A hidden control (the settings card closed, the zero row) is not there.
        if (b && !b.hidden && !b.closest('[hidden]')) b.click();
      }
      return a;
    case 'next': {
      const wu = sr(con(a)).querySelector('rack-warmup')!;
      if (!(wu as HTMLElement).hidden) btn(sr(wu), '[data-next]')!.click();
      return a;
    }
    case 'wait':
      vi.advanceTimersByTime(act.ms);
      return a;
    case 'reload': {
      a.el.remove();
      return mount();
    }
  }
}

describe('Rest timer shell properties (RBAR-94, ADR-0019)', () => {
  it('the dock is up exactly while a Rest shows, and the app reserves its height exactly then (ADR-0019, ADR-0013)', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.array(actArb, { minLength: 1, maxLength: 14 }), (warm, acts) => {
        document.body.innerHTML = '';
        localStorage.clear();
        vi.setSystemTime(T0);
        localStorage.setItem('rackbar.working', '140');
        let a = mount();
        if (warm) btn(sr(con(a)), '[data-mode="warmup"]')!.click();
        for (const act of acts) {
          a = run(a, act);
          const up = !dock(a).hidden;
          expect(a.el.hasAttribute('resting')).toBe(up);
          expect(con(a).hasAttribute('resting')).toBe(up);
          const t = dockText(a);
          if (t !== null) {
            expect(t).toMatch(/^\+?\d+:[0-5]\d$/);
            if (!screen(a).hidden && screen(a).shadowRoot) {
              expect(sr(screen(a)).querySelector('[data-time]')!.textContent).toBe(t);
            }
          }
        }
      }),
      { seed: SEED, numRuns: 40 },
    );
  });

  it('a reload never changes the reading: the Rest resumes from its stored end time (ADR-0019)', () => {
    fc.assert(
      fc.property(fc.array(actArb, { minLength: 1, maxLength: 10 }), (acts) => {
        document.body.innerHTML = '';
        localStorage.clear();
        vi.setSystemTime(T0);
        let a = mount();
        for (const act of acts) a = run(a, act);
        const before = dockText(a);
        a = run(a, { k: 'reload' });
        expect(dockText(a)).toBe(before);
      }),
      { seed: SEED, numRuns: 40 },
    );
  });

  it('time only moves the clock one way: a countdown falls, an overtime rises (ADR-0019)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(90, 120, 180, 300),
        fc.array(fc.integer({ min: 1, max: 90_000 }), { minLength: 1, maxLength: 8 }),
        (preset, waits) => {
          document.body.innerHTML = '';
          localStorage.clear();
          vi.setSystemTime(T0);
          const a = mount();
          btn(sr(con(a)), '[data-rest]')!.click();
          btn(sr(con(a)), '[data-rest]')!.click();
          btn(sr(screen(a)), `[data-preset="${preset}"]`)!.click();
          btn(sr(screen(a)), '[data-close]')!.click();
          let prev = dockText(a)!;
          for (const ms of waits) {
            vi.advanceTimersByTime(ms);
            const t = dockText(a);
            if (t === null) break;
            if (!prev.startsWith('+') && !t.startsWith('+')) expect(secs(t)).toBeLessThanOrEqual(secs(prev));
            if (prev.startsWith('+')) {
              expect(t.startsWith('+')).toBe(true);
              expect(secs(t)).toBeGreaterThanOrEqual(secs(prev));
            }
            prev = t;
          }
        },
      ),
      { seed: SEED, numRuns: 40 },
    );
  });

  it('the pill shows exactly the controls pillControls names for its phase and the dots (ADR-0019)', () => {
    fc.assert(
      fc.property(fc.array(actArb, { minLength: 1, maxLength: 14 }), (acts) => {
        document.body.innerHTML = '';
        localStorage.clear();
        vi.setSystemTime(T0);
        let a = mount();
        for (const act of acts) {
          a = run(a, act);
          if (dock(a).hidden) continue;
          const d = sr(dock(a));
          const cls = d.querySelector<HTMLElement>('[data-dock]')!.classList;
          const phase = (['run', 'pause', 'over'] as const).find((p) => cls.contains(`is-${p}`))!;
          const expanded = d.querySelector('[data-more]')!.getAttribute('aria-expanded') === 'true';
          const names = { pp: phase === 'pause' ? 'resume' : 'pause', more: expanded ? 'less' : 'more' };
          const shown = [...d.querySelectorAll<HTMLButtonElement>('[data-open], [data-pill]')]
            .filter((b) => !b.hidden)
            .map((b) => {
              const k = b.dataset.pill ?? 'time';
              return k === 'pp' || k === 'more' ? names[k] : k;
            });
          expect(shown).toEqual(pillControls(phase, expanded));
        }
      }),
      { seed: SEED, numRuns: 40 },
    );
  });

  it('Next starts or restarts a Rest only when Start after Next is on (ADR-0019)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<boolean | undefined>(true, false, undefined),
        fc.array(actArb, { maxLength: 10 }),
        (stored, acts) => {
          document.body.innerHTML = '';
          localStorage.clear();
          vi.setSystemTime(T0);
          localStorage.setItem('rackbar.working', '140');
          if (stored !== undefined) {
            localStorage.setItem(REST_SETTINGS_STORAGE_KEY, JSON.stringify({ startAfterNext: stored }));
          }
          let a = mount();
          btn(sr(con(a)), '[data-mode="warmup"]')!.click();
          for (const act of acts) if (act.k !== 'reload' && act.k !== 'next') a = run(a, act);
          // The setting may have been flipped on the screen; read what is stored now.
          const on = JSON.parse(localStorage.getItem(REST_SETTINGS_STORAGE_KEY) ?? '{}').startAfterNext === true;
          vi.advanceTimersByTime(1_000);
          const before = dockText(a);
          const wu = sr(con(a)).querySelector('rack-warmup')!;
          const next = btn(sr(wu), '[data-next]');
          fc.pre(next !== null && !next.disabled);
          next!.click();
          const after = dockText(a);
          // On, Next starts the remembered Rest afresh: the full length, counting.
          if (on) expect(after).toMatch(/^\d+:\d\d$/);
          if (on) expect(sr(dock(a)).querySelector('[data-dock]')!.classList.contains('is-run')).toBe(true);
          else expect(after).toBe(before);
        },
      ),
      { seed: SEED, numRuns: 40 },
    );
  });
});
