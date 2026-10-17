// Property-based invariants for the console shell (RBAR-62), driven through the REAL
// input paths -- keypad taps, stepper taps, the kg|lb and mode toggles, the round-up
// button, palette taps, and the Bar/Collar/plate-set setters the app uses -- and judged
// from what is on screen. Each `it` is named after the rule it guards, with its ADR.
// Expected values come from the ADR-derived oracle (lib/properties.oracle.ts), never
// from the solver under test; the pure-core counterparts are lib/properties.test.ts.
// The shell suites are split across files so they run in parallel workers (and stay
// inside happy-dom's heap); drivers + generators are in properties.drivers.ts.
// Deterministic: a fixed seed and modest run counts. A failure prints the shrunk
// script; change SEED locally to explore further. Add a property per new on-screen rule.
// This file: persistence across a reload, through <rack-app>.
import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { PLATE_SETS } from '../lib/platesets.ts';
import type { PlateSetKey } from '../lib/platesets.ts';
import { MAX_RECENTS } from '../lib/recents.ts';
import { COLLARS_KG, greatestAtOrUnder } from '../lib/properties.oracle.ts';
import type { Rig } from '../lib/properties.oracle.ts';
import { PLATE_SET_KEYS } from '../lib/platesets.ts';
import { displayCeilingKg, draftToKg, format } from '../lib/units.ts';
import type { Unit } from '../lib/units.ts';
import { sideOnScreen } from './properties.drivers.ts';
import {
  SEED, type Console, resetPool, q, sr, entryRoot, unitBtn, type, totalText, rigArb,
  unitArb, draftArb,
} from './properties.drivers.ts';
import './app.ts';

beforeEach(resetPool);

// Each <rack-app> mount is heavy, and happy-dom retains replaced shadow DOM, so a long
// shrink here can exhaust the worker heap before it reports. These runs stop at the
// FIRST failure (no shrinking) -- the printed case is still a real, replayable one.
const APP_RUNS = (numRuns: number) => ({ seed: SEED, numRuns, endOnFailure: true });

describe('<rack-app> persistence properties (ADR-0007, ADR-0009, ADR-0010)', () => {
  type App = HTMLElement;
  const mountApp = (): App => {
    document.body.innerHTML = '';
    const el = document.createElement('rack-app');
    document.body.append(el);
    return el;
  };
  const appConsole = (app: App) => q<Console>(sr(app), 'rack-console');
  const setupRoot = (app: App) => sr(q(sr(app), 'rack-setup'));
  const tile = (app: App, attr: string, value: number | string) =>
    [...setupRoot(app).querySelectorAll<HTMLButtonElement>(`[${attr}]`)].find(
      (b) => b.getAttribute(attr) === String(value),
    )!;
  // The Recent chips, by the canonical kg each one re-applies (rack-recents data-target).
  const recentChips = (app: App) =>
    [...sr(q(sr(appConsole(app)), 'rack-recents')).querySelectorAll<HTMLElement>('.chip')]
      .map((b) => b.dataset.target ?? '');
  const appUnit = (app: App): string =>
    unitBtn(appConsole(app), 'lb').getAttribute('aria-pressed') === 'true' ? 'lb' : 'kg';

  it('the plate set, Bar, Collar, unit and Recents chosen through the UI survive a reload (ADR-0007, ADR-0009, ADR-0010)', () => {
    fc.assert(
      fc.property(rigArb, unitArb, fc.array(draftArb, { maxLength: 5 }), (rig, u, commits) => {
        localStorage.clear();
        const app = mountApp();
        q<HTMLButtonElement>(sr(app), '[data-setup-pill]').click();
        tile(app, 'data-plateset', rig.set).click();
        tile(app, 'data-bar', rig.barKg).click();
        tile(app, 'data-collar', rig.collarKg).click();
        const c = appConsole(app);
        unitBtn(c, u).click();
        const valueBtn = q<HTMLButtonElement>(entryRoot(c), '[data-value]');
        for (const d of commits) {
          valueBtn.click(); // open the keypad
          type(c, d);
          valueBtn.click(); // close -> commit to Recents
        }
        const chips = recentChips(app);
        const before = { set: c.plateSet, bar: c.barKg, collar: c.collarKg, unit: appUnit(app) };
        expect(before).toMatchObject({
          set: rig.set,
          bar: rig.barKg,
          collar: rig.collarKg,
          unit: u,
        });
        expect(chips.length).toBeLessThanOrEqual(MAX_RECENTS);
        const reloaded = mountApp(); // storage kept: a reload
        const rc = appConsole(reloaded);
        const after = { set: rc.plateSet, bar: rc.barKg, collar: rc.collarKg, unit: appUnit(reloaded) };
        expect(after).toEqual(before);
        expect(recentChips(reloaded)).toEqual(chips);
      }),
      APP_RUNS(8),
    );
  });

  it('removing Recents (Delete on a chip) never moves a chip, any Undo restores in place, and it all survives a reload (ADR-0009 RBAR-73)', () => {
    // A stored row (distinct, loadable, 2 dp, capped), then a script of removals and
    // Undos through the real chip paths, inside one Undo window. The expected rail is
    // modelled from the rule, not the core: the rail is frozen into slots while removals
    // are pending -- a removal turns ITS slot into an Undo, an Undo turns its slot back
    // -- and the stored row is the live slots, in order.
    const rowArb = fc.uniqueArray(
      fc.integer({ min: 1, max: 50_000 }).map((c) => c / 100),
      { minLength: 1, maxLength: MAX_RECENTS },
    );
    const opArb = fc.oneof(
      fc.nat({ max: MAX_RECENTS - 1 }).map((i) => ({ op: 'del' as const, i })),
      fc.nat({ max: MAX_RECENTS - 1 }).map((i) => ({ op: 'undo' as const, i })),
    );
    const rail = (app: App) =>
      [...q(sr(appConsole(app)), 'rack-recents').shadowRoot!.querySelector('[data-rail]')!.children]
        .map((c) => (c.hasAttribute('data-undo') ? 'undo' : (c as HTMLElement).dataset.target));
    const recentsRoot = (app: App) => sr(q(sr(appConsole(app)), 'rack-recents'));
    fc.assert(
      fc.property(rowArb, fc.array(opArb, { maxLength: 8 }), (row, ops) => {
        localStorage.clear();
        localStorage.setItem('rackbar.recents', JSON.stringify(row));
        const app = mountApp();
        const slots = row.map((kg) => ({ kg: String(kg), removed: false }));
        for (const { op, i } of ops) {
          if (op === 'del') {
            const chips = [...recentsRoot(app).querySelectorAll<HTMLElement>('.chip')];
            if (chips.length === 0) continue;
            const chip = chips[i % chips.length];
            chip.dispatchEvent(
              new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, composed: true }),
            );
            slots.find((sl) => sl.kg === chip.dataset.target)!.removed = true;
          } else {
            const undos = [...recentsRoot(app).querySelectorAll<HTMLElement>('[data-undo]')];
            if (undos.length === 0) continue;
            const pick = i % undos.length;
            undos[pick].click();
            slots.filter((sl) => sl.removed)[pick].removed = false;
          }
          // Nothing moved: the rail is exactly the slots, each live chip where it was.
          const pending = slots.some((sl) => sl.removed);
          expect(rail(app)).toEqual(
            pending
              ? slots.map((sl) => (sl.removed ? 'undo' : sl.kg))
              : slots.map((sl) => sl.kg),
          );
        }
        const live = slots.filter((sl) => !sl.removed).map((sl) => sl.kg);
        expect(recentChips(app)).toEqual(live);
        expect(recentChips(mountApp())).toEqual(live); // the reload
      }),
      APP_RUNS(10),
    );
  });

  it('any corrupt persisted value loads as a valid default, never throws (ADR-0007 validate-at-boundary)', () => {
    const junk = fc.oneof(
      fc.string(),
      fc.json(),
      fc.constantFrom('NaN', '-1', '1e999', 'lb ', 'KG', '20.0'),
      // VALID values for every slot, from both sets, so the cross-checks run: a Bar
      // stored for one set but loaded under the other, a real Collar, a real unit.
      fc.constantFrom(
        'comp', 'training', 'kg', 'lb', '15', '5', '20', '0', '2.5',
        String(PLATE_SETS.training.defaultBarKg),
      ),
    );
    fc.assert(
      fc.property(junk, junk, junk, junk, junk, (set, bar, collar, unit, recents) => {
        localStorage.clear();
        localStorage.setItem('rackbar.plateSet', set);
        localStorage.setItem('rackbar.barKg', bar);
        localStorage.setItem('rackbar.collarKg', collar);
        localStorage.setItem('rackbar.unit', unit);
        localStorage.setItem('rackbar.recents', recents);
        const app = mountApp();
        const c = appConsole(app);
        const key = c.plateSet as PlateSetKey;
        expect(['comp', 'training']).toContain(key);
        expect(key).toBe(set === 'training' ? 'training' : 'comp');
        // The Bar validates against the ACTIVE set (ADR-0007/0010): kept when that set
        // offers it, else the set's default -- a 15 kg Bar never loads on Training.
        const offered = PLATE_SETS[key].bars.map((b) => b.kg);
        expect(c.barKg).toBe(
          offered.includes(Number(bar)) ? Number(bar) : PLATE_SETS[key].defaultBarKg,
        );
        expect(c.collarKg).toBe(COLLARS_KG.includes(Number(collar)) ? Number(collar) : 0);
        expect(appUnit(app)).toBe(unit === 'lb' ? 'lb' : 'kg');
        expect(totalText(c)).toMatch(/^\d+(\.\d{1,2})? (kg|lb)$/);
        expect(recentChips(app).length).toBeLessThanOrEqual(MAX_RECENTS);
        for (const chip of recentChips(app)) {
          const kg = Number(chip);
          expect(Number.isFinite(kg) && kg > 0).toBe(true); // a loadable weight (ADR-0009)
        }
      }),
      APP_RUNS(12),
    );
  });
});

// Custom Bars (RBAR-76, ADR-0017), through the real Setup "+" entry and the keypad. The
// oracle is the ADR arithmetic on the stamp's own kg (lb by the exact factor, ADR-0006).
describe('<rack-app> custom Bar properties (ADR-0017)', () => {
  const mountApp = (): HTMLElement => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    document.body.innerHTML = '';
    const el = document.createElement('rack-app');
    document.body.append(el);
    return el;
  };
  const appConsole = (app: HTMLElement) => q<Console>(sr(app), 'rack-console');
  const setupRoot = (app: HTMLElement) => sr(q(sr(app), 'rack-setup'));
  const stampArb = fc.constantFrom<Unit>('kg', 'lb').chain((unit) =>
    fc
      .integer({ min: 1, max: (unit === 'kg' ? 50 : 110) * 100 })
      .map((c) => ({ value: c / 100, unit })),
  );
  const oracleKg = (s: { value: number; unit: Unit }) =>
    s.unit === 'lb' ? s.value * 0.45359237 : s.value;

  it('a custom Bar added in Setup is the rig: Total = its kg + 2 x Side Load + 2 x Collar, the greatest at or under the reading, and it survives a reload labelled as typed (ADR-0017, ADR-0002, ADR-0003, ADR-0008)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PLATE_SET_KEYS),
        stampArb,
        fc.constantFrom(...COLLARS_KG),
        fc.constantFrom<Unit>('kg', 'lb'),
        draftArb,
        (set, stamp, collarKg, u, draft) => {
          localStorage.clear();
          const app = mountApp();
          const s = setupRoot(app);
          q<HTMLButtonElement>(s, `[data-plateset="${set}"]`).click();
          q<HTMLButtonElement>(s, `[data-collar="${collarKg}"]`).click();
          q<HTMLButtonElement>(s, '[data-bar-add]').click();
          q<HTMLButtonElement>(s, `[data-bar-unit="${stamp.unit}"]`).click();
          q<HTMLInputElement>(s, '[data-bar-input]').value = String(stamp.value);
          q<HTMLButtonElement>(s, '[data-bar-save]').click();
          const c = appConsole(app);
          expect(c.barKg).toBe(oracleKg(stamp));
          unitBtn(c, u).click();
          const valueBtn = q<HTMLButtonElement>(entryRoot(c), '[data-value]');
          valueBtn.click();
          type(c, draft);
          valueBtn.click();
          const rig: Rig = {
            set,
            barKg: oracleKg(stamp),
            collarKg,
            inventory: PLATE_SETS[set].inventory,
            baselineKg: oracleKg(stamp) + 2 * collarKg,
            name: `custom ${stamp.value} ${stamp.unit}`,
          };
          const drawn = rig.baselineKg + 2 * sideOnScreen(c).reduce((a, p) => a + p.kg, 0);
          const t = draftToKg(draft, u);
          const want = t === null ? rig.baselineKg : greatestAtOrUnder(rig, displayCeilingKg(t, u));
          expect(drawn).toBeCloseTo(want, 9);
          expect(totalText(c)).toBe(format(drawn, u));
          // The reload: the stamp and the choice come back, the tile reads as typed.
          const again = mountApp();
          expect(appConsole(again).barKg).toBe(oracleKg(stamp));
          const on = setupRoot(again).querySelector('[data-bar][aria-pressed="true"] .word');
          const built = PLATE_SETS[set].bars.some((b) => b.kg === oracleKg(stamp));
          if (!built) expect(on?.textContent).toBe(`${stamp.value} ${stamp.unit}`);
        },
      ),
      APP_RUNS(12),
    );
  });

  it('any stored custom Bar list loads as at most 3 valid, distinct tiles, and the stored Bar is always one of the tiles (ADR-0017, ADR-0007 validate-at-boundary)', () => {
    const junk = fc.oneof(
      fc.string(),
      fc.json(),
      fc
        .array(
          fc.oneof(
            stampArb,
            fc.record({ value: fc.double(), unit: fc.constantFrom('kg', 'lb', 'st') }),
            fc.anything(),
          ),
          { maxLength: 6 },
        )
        .map((xs) => JSON.stringify(xs)),
    );
    const barJunk = fc.oneof(
      fc.string(),
      fc.constantFrom('20', '15', '35', String(35 * 0.45359237), '7', '15.9'),
    );
    fc.assert(
      fc.property(junk, barJunk, fc.constantFrom(...PLATE_SET_KEYS), (raw, bar, set) => {
        localStorage.clear();
        localStorage.setItem('rackbar.customBars', raw);
        localStorage.setItem('rackbar.barKg', bar);
        localStorage.setItem('rackbar.plateSet', set);
        const app = mountApp();
        const tiles = [...setupRoot(app).querySelectorAll<HTMLElement>('[data-custom]')];
        expect(tiles.length).toBeLessThanOrEqual(3);
        const kgs = [...setupRoot(app).querySelectorAll<HTMLElement>('[data-bar]')].map((t) =>
          Number(t.dataset.bar),
        );
        expect(new Set(kgs).size).toBe(kgs.length);
        for (const t of tiles) {
          expect(t.querySelector('.word')!.textContent).toMatch(/^\d+(\.\d{1,2})? (kg|lb)$/);
        }
        expect(kgs).toContain(appConsole(app).barKg);
        expect(totalText(appConsole(app))).toMatch(/^\d+(\.\d{1,2})? (kg|lb)$/);
      }),
      APP_RUNS(12),
    );
  });
});
