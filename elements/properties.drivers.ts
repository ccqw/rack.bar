// TEST-ONLY drivers for the shell property suites (RBAR-62): the real input paths
// (keypad, steppers, toggles, palette, round-up) and the on-screen readings the
// properties judge, plus the shared generators. Never imported by app code.
import fc from 'fast-check';
import './console.ts';
import { draftToKg, displayCeilingKg, shownIn } from '../lib/units.ts';
import type { Unit } from '../lib/units.ts';
import {
  RIGS,
  achievableTotals,
  greatestAtOrUnder,
  leastAbove,
  maxTotal,
} from '../lib/properties.oracle.ts';
import type { Rig } from '../lib/properties.oracle.ts';
import { addPlate } from '../lib/encode.ts';
import { COLLAR_OPTIONS } from '../lib/plates.ts';
import type { Plate } from '../lib/plates.ts';
import { PLATE_SETS, PLATE_SET_KEYS } from '../lib/platesets.ts';
import { MAX_TARGET_KG } from '../lib/link.ts';
import type { LinkState } from '../lib/link.ts';

export const SEED = 62;
export const EPS = 1e-9;
export const UNITS: readonly Unit[] = ['kg', 'lb'];
export const other = (u: Unit): Unit => (u === 'kg' ? 'lb' : 'kg');

export type Console = HTMLElement & { barKg: number; collarKg: number; plateSet: string };

// ---- DOM drivers (the same real paths elements/console.test.ts uses) ----------------

// A fresh console on `rig` in `unit`. Storage is cleared first: the unit choice persists
// (rackbar.unit), so a stale one would otherwise leak into the mount.
export function mount(rig: Rig, unit: Unit): Console {
  localStorage.clear();
  const el = document.createElement('rack-console') as Console;
  document.body.append(el);
  // The app's order: Bar first, then the set, so the re-solve sees both (app.ts).
  el.barKg = rig.barKg;
  el.collarKg = rig.collarKg;
  el.plateSet = rig.set;
  unitBtn(el, unit).click();
  return el;
}

// NOTE the pool lives for a whole FILE (it is not reset between tests), so a failure is
// reproduced by re-running the file, not one `-t` test in isolation. Mounting is the
// dominant cost (and thousands of mounts exhaust happy-dom's heap), so
// the typing-only properties reuse ONE console per rig x unit within a test. Each
// checkout presses Clear, which drops the Target and any chosen round-up (decodeTo(null))
// and leaves the field empty -- the same state a fresh mount reaches -- so every run, and
// every shrunk counterexample, starts from a clean entry. Mode and unit are re-asserted.
const pool = new Map<string, Console>();
export function on(rig: Rig, unit: Unit): Console {
  const key = `${rig.name}|${unit}`;
  let el = pool.get(key);
  if (!el) {
    el = mount(rig, unit);
    pool.set(key, el);
  }
  modeBtn(el, 'decode').click();
  unitBtn(el, unit).click();
  press(el, 'clear');
  // The reset contract every pooled run relies on: a cleared entry means no Target and
  // a bare rig. If a future change breaks it, fail loudly here rather than let state
  // leak between runs (and make counterexamples non-replayable).
  if (entryDraft(el) !== '' || sideOnScreen(el).length !== 0) {
    throw new Error(`pool reset failed for ${key}: Clear left a Target or Plates`);
  }
  return el;
}
// A one-off console for the properties that reconfigure the rig mid-run (not poolable):
// the page is emptied first so detached mounts do not pile up across runs.
export function fresh(rig: Rig, unit: Unit): Console {
  pool.clear();
  document.body.innerHTML = '';
  return mount(rig, unit);
}
/** Drop the pool and empty the page -- every property file runs this beforeEach. */
export function resetPool(): void {
  pool.clear();
  document.body.innerHTML = '';
}
export const q = <T extends HTMLElement>(root: ParentNode, sel: string): T =>
  root.querySelector<T>(sel)!;
export const sr = (el: HTMLElement) => el.shadowRoot!;
export const entryRoot = (el: HTMLElement) => sr(q(sr(el), 'rack-entry'));
export const unitBtn = (el: HTMLElement, u: Unit) =>
  q<HTMLButtonElement>(sr(el), `[data-unit="${u}"]`);
export const modeBtn = (el: HTMLElement, m: 'decode' | 'encode') =>
  q<HTMLButtonElement>(sr(el), `[data-mode="${m}"]`);
export const press = (el: HTMLElement, k: string) =>
  q<HTMLButtonElement>(entryRoot(el), `[data-key="${CSS.escape(k)}"]`).click();
export const step = (el: HTMLElement, dir: 'inc' | 'dec') =>
  q<HTMLButtonElement>(entryRoot(el), `[data-step="${dir}"]`).click();
export function type(el: HTMLElement, value: string): void {
  press(el, 'clear');
  for (const ch of value) press(el, ch);
}
export const roundUp = (el: HTMLElement) => q<HTMLButtonElement>(sr(el), '[data-over]');
export const tapAdd = (el: HTMLElement, plateKg: number) =>
  [...sr(q(sr(el), 'rack-palette')).querySelectorAll<HTMLButtonElement>('.key')]
    .find((k) => Number(k.dataset.kg) === plateKg)!
    .click();

// ---- On-screen readings ------------------------------------------------------------

export const totalText = (el: HTMLElement) => q(sr(el), '[data-total]').textContent ?? '';
export const secondaryText = (el: HTMLElement) => q(sr(el), '[data-secondary]').textContent ?? '';
export const statusEl = (el: HTMLElement) => q(sr(el), '[data-status]');
export const statusKind = (el: HTMLElement) =>
  [...statusEl(el).classList].filter((c) => c !== 'status').join(' ');
export const statusLabel = (el: HTMLElement) =>
  q(statusEl(el), '[data-status-label]').textContent ?? '';
export const atcapShown = (el: HTMLElement) => !q(sr(el), '[data-atcap]').hidden;
export const barnoteShown = (el: HTMLElement) => !q(sr(el), '[data-barnote]').hidden;
export const loadLine = (el: HTMLElement) => q(entryRoot(el), '[data-live-load]').textContent ?? '';
// The Target field's raw draft ('' when it shows the muted Bar anchor).
export function entryDraft(el: HTMLElement): string {
  const v = q(entryRoot(el), '[data-value]');
  return v.classList.contains('empty') ? '' : (q(v, '[data-value-num]').textContent ?? '');
}
// The loaded Side, as the sleeve draws it: one record per disc.
export function sideOnScreen(el: HTMLElement): { kg: number; color: string }[] {
  return [...sr(q(sr(el), 'rack-sleeve')).querySelectorAll<HTMLElement>('.disc')].map(
    (d) => ({ kg: Number(d.dataset.kg), color: d.dataset.color ?? '' }),
  );
}
// The Total the sleeve's discs actually add up to on `rig` (CONTEXT: Bar + 2 x Collar
// + 2 x Side Load) -- the ground truth every readout must agree with.
export const drawnTotalKg = (el: HTMLElement, rig: Rig) =>
  rig.baselineKg + 2 * sideOnScreen(el).reduce((s, p) => s + p.kg, 0);
// The Target as the lifter reads it: the draft, parsed and shown in the active unit.
export const shownTarget = (el: HTMLElement, u: Unit) => shownIn(draftToKg(entryDraft(el), u)!, u);

// ---- Generators --------------------------------------------------------------------

export const rigArb = fc.constantFrom(...RIGS);
export const unitArb = fc.constantFrom(...UNITS);
// A typed Target: <= 2 dp, from 0 to past the Sleeve's reach on any rig (in either unit).
export const draftArb = fc.oneof(
  fc.integer({ min: 0, max: 900 }).map(String),
  fc.integer({ min: 0, max: 90_000 }).map((c) => String(c / 100)),
);
// Every load a share link can carry (ADR-0014), built only through the real core paths
// -- an offered set, one of its Bars, an offered Collar, a Side Load grown by addPlate
// so the Sleeve caps it, an optional 2 dp Target in By Weight -- the same shape as the
// core's own round-trip generator (lib/properties.test.ts "Share link properties").
export const linkStateArb: fc.Arbitrary<LinkState> = fc
  .record({
    key: fc.constantFrom(...PLATE_SET_KEYS),
    barIx: fc.nat(),
    collarKg: fc.constantFrom(...COLLAR_OPTIONS),
    unit: unitArb,
    mode: fc.constantFrom<'decode' | 'encode'>('decode', 'encode'),
    picks: fc.array(fc.nat(), { maxLength: 40 }),
    cents: fc.option(fc.integer({ min: 1, max: MAX_TARGET_KG * 100 }), { nil: undefined }),
  })
  .map(({ key, barIx, collarKg, unit, mode, picks, cents }): LinkState => {
    const set = PLATE_SETS[key];
    const side = picks.reduce<readonly Plate[]>(
      (acc, i) => addPlate(acc, set.inventory[i % set.inventory.length]!),
      [],
    );
    const barKg = set.bars[barIx % set.bars.length]!.kg;
    const base = { set: key, barKg, collarKg, unit, side };
    if (mode === 'encode') return { ...base, mode };
    return cents === undefined ? { ...base, mode } : { ...base, mode, targetKg: cents / 100 };
  });
// The achievable-grid read-back case: a rig, a unit, and one of that rig's Totals.
export const gridCaseArb = rigArb.chain((rig) =>
  fc.tuple(fc.constant(rig), unitArb, fc.constantFrom(...achievableTotals(rig))),
);

// A typed Target that falls BETWEEN two neighbouring achievable Totals, as the lifter
// would type it (its reading in the unit): the case that is short and offers a round-up.
// Drawing it from the grid (rather than filtering random drafts) keeps the round-up
// properties from wasting most runs -- and renders -- on Exact Targets.
export const offGridCaseArb = rigArb.chain((rig) => {
  const totals = achievableTotals(rig);
  return fc
    .tuple(
      unitArb,
      fc.integer({ min: 0, max: totals.length - 2 }),
      fc.double({ min: 0.25, max: 0.75, noNaN: true }),
    )
    .map(([u, i, f]) => {
      const kg = totals[i] + f * (totals[i + 1] - totals[i]);
      return [rig, u, String(shownIn(kg, u))] as const;
    });
});

// A typed Target sized to its rig and unit (the review finding: a flat 0-900 draft put
// ~60% of runs past the Sleeve's reach, so Exact / short / kg-Exact barely ran). A mix
// of: a Total's own reading (Exact), a reading between two Totals (short + round-up),
// any <= 2 dp value up to just past the rig's heaviest Total, and a minority past the
// cap (capacity) or under the Bar (the floor).
export const rigDraftCaseArb = rigArb.chain((rig) =>
  unitArb.chain((u) => {
    const totals = achievableTotals(rig);
    const top = shownIn(maxTotal(rig) + 20, u);
    const reading = (kg: number) => String(shownIn(kg, u));
    const draft = fc.oneof(
      { weight: 3, arbitrary: fc.constantFrom(...totals).map(reading) },
      {
        weight: 3,
        arbitrary: fc
          .tuple(
            fc.integer({ min: 0, max: totals.length - 2 }),
            fc.double({ min: 0.25, max: 0.75, noNaN: true }),
          )
          .map(([i, f]) => reading(totals[i] + f * (totals[i + 1] - totals[i]))),
      },
      {
        weight: 3,
        arbitrary: fc.integer({ min: 0, max: Math.round(top * 100) }).map((c) => String(c / 100)),
      },
      { weight: 1, arbitrary: fc.integer({ min: Math.ceil(top), max: 900 }).map(String) },
    );
    return draft.map((d) => [rig, u, d] as const);
  }),
);

/** What the ADRs say the console should show for `draft` typed on `rig` in `u`: the
 * loaded Total (ADR-0003 at or under the reading, ADR-0010 RBAR-60), whether it reads
 * short, and whether a physical round-up exists (ADR-0003 RBAR-11, ADR-0012). */
export function expectedFor(rig: Rig, u: Unit, draft: string) {
  const t = draftToKg(draft, u)!;
  const ceiling = displayCeilingKg(t, u);
  const totalKg = greatestAtOrUnder(rig, ceiling);
  const short = shownIn(totalKg, u) < shownIn(t, u);
  const roundUpKg = short ? leastAbove(rig, ceiling) : null;
  return { totalKg, short, roundUpKg, atCapacity: short && roundUpKg === null };
}

