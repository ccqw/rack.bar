// Property-based invariants for Pairs of Plates on Hand in the shell (RBAR-72 slice 2,
// ADR-0016), driven through the REAL input paths -- the Setup pill, the plate-set row,
// the size tiles, the None..All row and "All plates", the keypad, the mode toggle and
// the palette -- and judged from what is on screen and in storage. Expected values come
// from a model of the taps and the ADR-derived capped oracle (lib/fewest.oracle.ts),
// never from the solver under test. The core counterparts are in lib/properties.test.ts.
import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { PLATE_SETS, PLATE_SET_KEYS } from '../lib/platesets.ts';
import type { PlateSetKey } from '../lib/platesets.ts';
import { plateFace, withLimits } from '../lib/plates.ts';
import { GRID_KG, cappedFewestOracle, greatestSumAtOrUnder } from '../lib/fewest.oracle.ts';
import { displayCeilingKg } from '../lib/units.ts';
import {
  SEED, EPS, type Console, resetPool, q, sr, entryRoot, unitBtn, type, modeBtn, sideOnScreen,
} from './properties.drivers.ts';
import './app.ts';

beforeEach(resetPool);

// <rack-app> mounts are heavy; stop at the first failure (see app.properties.test.ts).
const APP_RUNS = (numRuns: number) => ({ seed: SEED, numRuns, endOnFailure: true });

describe('<rack-app> Pairs of Plates on Hand properties (ADR-0016, ADR-0007)', () => {
  type App = HTMLElement;
  const mountApp = (): App => {
    document.body.innerHTML = '';
    const el = document.createElement('rack-app');
    document.body.append(el);
    return el;
  };
  const appConsole = (app: App) => q<Console>(sr(app), 'rack-console');
  const setupRoot = (app: App) => sr(q(sr(app), 'rack-setup'));
  const openSetup = (app: App) => q<HTMLButtonElement>(sr(app), '[data-setup-pill]').click();
  const chooseSet = (app: App, set: PlateSetKey) =>
    q<HTMLButtonElement>(setupRoot(app), `[data-plateset="${set}"]`).click();
  const sizeTile = (app: App, face: string) =>
    q<HTMLButtonElement>(setupRoot(app), `[data-face="${CSS.escape(face)}"]`);
  const pairsBtn = (app: App, n: number | null) =>
    q<HTMLButtonElement>(setupRoot(app), `[data-pairs="${n === null ? 'all' : n}"]`);
  const commitTarget = (app: App, kg: number) => {
    const c = appConsole(app);
    const valueBtn = q<HTMLButtonElement>(entryRoot(c), '[data-value]');
    valueBtn.click(); // open the keypad
    type(c, String(kg));
    valueBtn.click(); // close
  };

  // A Setup script: tap a size and pick a count (null = All), or tap "All plates".
  type Op = { op: 'set'; i: number; pairs: number | null } | { op: 'reset' };
  const opArb: fc.Arbitrary<Op> = fc.oneof(
    { weight: 6, arbitrary: fc.record({ op: fc.constant('set' as const), i: fc.nat(), pairs: fc.constantFrom<number | null>(0, 1, 2, 3, 4, null) }) },
    { weight: 1, arbitrary: fc.constant({ op: 'reset' as const }) },
  );
  // Half the scripts start by limiting EVERY size to 0..2 pairs (a small home gym), so
  // running out of plates on hand below the Target -- no round-up, Sleeve not full --
  // is a common case, not a rare one.
  const scarceArb = fc.array(fc.integer({ min: 0, max: 2 }), { minLength: 10, maxLength: 10 });
  const caseArb = fc
    .record({
      set: fc.constantFrom(...PLATE_SET_KEYS),
      scarce: fc.option(scarceArb, { nil: undefined }),
      ops: fc.array(opArb, { minLength: 1, maxLength: 8 }),
      // A kg Target from the bare Bar to past a full Sleeve (about 370 kg on either set).
      t: fc.integer({ min: 20, max: 420 }),
    })
    .map(({ set, scarce, ops, t }) => ({
      set,
      t,
      ops: [
        ...(scarce ?? []).slice(0, PLATE_SETS[set].inventory.length).map(
          (pairs, i): Op => ({ op: 'set', i, pairs }),
        ),
        ...ops,
      ],
    }));

  // Replay the taps on a model: the pairs per face, last write wins, reset clears.
  function model(set: PlateSetKey, ops: readonly Op[]): Record<string, number> {
    const faces = PLATE_SETS[set].inventory.map(plateFace);
    let caps: Record<string, number> = {};
    for (const o of ops) {
      if (o.op === 'reset') caps = {};
      else {
        const face = faces[o.i % faces.length];
        const { [face]: _was, ...rest } = caps;
        caps = o.pairs === null ? rest : { ...rest, [face]: o.pairs };
      }
    }
    return caps;
  }
  function tapScript(app: App, set: PlateSetKey, ops: readonly Op[]): void {
    const faces = PLATE_SETS[set].inventory.map(plateFace);
    for (const o of ops) {
      if (o.op === 'reset') {
        q<HTMLButtonElement>(setupRoot(app), '[data-pairs-reset]').click();
        continue;
      }
      const face = faces[o.i % faces.length];
      if (sizeTile(app, face).getAttribute('aria-expanded') !== 'true') sizeTile(app, face).click();
      pairsBtn(app, o.pairs).click();
    }
  }
  const countsOnScreen = (app: App, set: PlateSetKey) => {
    const side = sideOnScreen(appConsole(app));
    return PLATE_SETS[set].inventory.map(
      (p) => side.filter((d) => d.kg === p.kg && d.color === p.color).length,
    );
  };

  it('limits set through Setup re-solve the standing Target at once, honour every cap, call the Bar at capacity only when the Sleeve is full, and survive a reload with the same load (ADR-0016, ADR-0003, ADR-0012, ADR-0007)', () => {
    fc.assert(
      fc.property(caseArb, ({ set, ops, t }) => {
        localStorage.clear();
        const app = mountApp();
        openSetup(app);
        chooseSet(app, set);
        unitBtn(appConsole(app), 'kg').click();
        commitTarget(app, t); // a standing Target BEFORE any limit
        tapScript(app, set, ops); // each tap must re-solve it
        const caps = model(set, ops);
        const inv = PLATE_SETS[set].inventory;

        // Every cap honoured, a none size never drawn.
        const counts = countsOnScreen(app, set);
        inv.forEach((p, j) => expect(counts[j]).toBeLessThanOrEqual(caps[plateFace(p)] ?? Infinity));

        // The load is the capped oracle's at-or-under best (ADR-0003 on the plates on hand).
        const bar = PLATE_SETS[set].defaultBarKg;
        const o = cappedFewestOracle(withLimits(inv, caps), GRID_KG[set]);
        const budget = (displayCeilingKg(t, 'kg') - bar) / 2;
        const best = budget < 0 ? 0 : greatestSumAtOrUnder(o, Math.floor((budget + EPS) / o.gridKg));
        const drawn = sideOnScreen(appConsole(app)).reduce((s, d) => s + d.kg, 0);
        expect(drawn).toBeCloseTo(best * o.gridKg, 9);

        // "Bar at capacity" only when the Sleeve is full -- the full set has nothing
        // loadable above the Target either (ADR-0012); out of plates on hand is plain
        // short (ADR-0003, ADR-0016).
        const full = cappedFewestOracle(inv, GRID_KG[set]);
        const short = Number((bar + 2 * drawn).toFixed(2)) < t;
        const sleeveFull = !full.sums.some((sum) => sum * full.gridKg > budget + EPS);
        expect(!q(sr(appConsole(app)), '[data-atcap]').hidden).toBe(short && sleeveFull);

        // Stored as the model, and a reload solves the same Target to the same load.
        const stored = JSON.parse(localStorage.getItem('rackbar.platesOnHand') ?? '{}');
        expect(stored[set] ?? {}).toEqual(caps);
        const before = sideOnScreen(appConsole(app));
        const reloaded = mountApp();
        commitTarget(reloaded, t);
        expect(sideOnScreen(appConsole(reloaded))).toEqual(before);
        // And Setup reads the same limits back.
        openSetup(reloaded);
        for (const p of inv) {
          const n = caps[plateFace(p)];
          const want = n === undefined ? 'all' : n === 0 ? 'none' : 'limited';
          expect(sizeTile(reloaded, plateFace(p)).dataset.state).toBe(want);
        }
      }),
      APP_RUNS(16),
    );
    // Several full app mounts per run: well under 5 s locally, but given the link
    // properties' room so a loaded CI runner cannot time it out.
  }, 30_000);

  it('a limit on one Plate set never changes a load on the other (ADR-0016)', () => {
    fc.assert(
      fc.property(caseArb, ({ set, ops, t }) => {
        localStorage.clear();
        const other: PlateSetKey = set === 'comp' ? 'training' : 'comp';
        const app = mountApp();
        openSetup(app);
        chooseSet(app, other);
        unitBtn(appConsole(app), 'kg').click();
        commitTarget(app, t);
        const free = sideOnScreen(appConsole(app));
        chooseSet(app, set);
        tapScript(app, set, ops);
        chooseSet(app, other);
        commitTarget(app, t);
        expect(sideOnScreen(appConsole(app))).toEqual(free);
      }),
      APP_RUNS(6),
    );
  }, 30_000);

  it('By Plates never blocks a tap on a none or limited size; only the sleeve refuses (ADR-0016, ADR-0005, ADR-0012)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PLATE_SET_KEYS),
        fc.nat(),
        fc.constantFrom(0, 1),
        (set, i, pairs) => {
          localStorage.clear();
          const p = PLATE_SETS[set].inventory[i % PLATE_SETS[set].inventory.length];
          localStorage.setItem('rackbar.plateSet', set);
          localStorage.setItem('rackbar.platesOnHand', JSON.stringify({ [set]: { [plateFace(p)]: pairs } }));
          const app = mountApp();
          const c = appConsole(app);
          modeBtn(c, 'encode').click();
          const key = [...sr(q(sr(c), 'rack-palette')).querySelectorAll<HTMLButtonElement>('.key')].find(
            (k) => Number(k.dataset.kg) === p.kg,
          )!;
          expect(key.disabled).toBe(false);
          expect(key.classList.contains('none')).toBe(pairs === 0);
          key.click();
          key.click(); // past the cap
          expect(sideOnScreen(c).filter((d) => d.kg === p.kg)).toHaveLength(2);
        },
      ),
      APP_RUNS(8),
    );
  }, 30_000);
});
