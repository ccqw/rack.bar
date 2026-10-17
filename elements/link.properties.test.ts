// Property-based invariants for opening a share link (RBAR-50 slice 2, ADR-0014),
// driven through the REAL boot path -- the link's fragment in the URL, then a fresh
// <rack-app> mount -- and judged from what is on screen and in storage. The pure-core
// counterparts (round trip, canonical form, parser fuzzing) are in lib/properties.test.ts.
// Deterministic: the shared SEED; app mounts are heavy, so runs stop at the first failure.
import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { linkUrl } from '../lib/link.ts';
import type { LinkState } from '../lib/link.ts';
import { PLATE_SETS } from '../lib/platesets.ts';
import { draftToKg } from '../lib/units.ts';
import {
  SEED, type Console, resetPool, q, sr, modeBtn, unitBtn, sideOnScreen, linkStateArb,
  fresh, rigArb, unitArb, draftArb, type, roundUp, statusKind, totalText, entryDraft,
} from './properties.drivers.ts';
import './app.ts';

beforeEach(resetPool);

const APP_RUNS = (numRuns: number) => ({ seed: SEED, numRuns, endOnFailure: true });
const RIG_KEYS = ['rackbar.plateSet', 'rackbar.barKg', 'rackbar.collarKg', 'rackbar.unit'];

// Open `state`'s share URL the way a tapped link arrives: fragment in the URL, then boot.
function open(state: LinkState): HTMLElement {
  const url = linkUrl(state);
  if (url === null) throw new Error('generator produced an unserializable load');
  history.replaceState(null, '', `/${url.slice(url.indexOf('#'))}`);
  document.body.innerHTML = '';
  const app = document.createElement('rack-app');
  document.body.append(app);
  return app;
}
const appConsole = (app: HTMLElement) => q<Console>(sr(app), 'rack-console');
const pressedIn = (el: HTMLElement, sel: string) =>
  [...sr(el).querySelectorAll<HTMLElement>(sel)]
    .filter((b) => b.getAttribute('aria-pressed') === 'true')
    .map((b) => b.dataset.mode ?? b.dataset.unit);

describe('opening a share link, properties (ADR-0014)', () => {
  it('opening any link shows exactly its Side, Bar, Collar, unit and mode and persists no rig key (ADR-0014)', () => {
    fc.assert(
      fc.property(linkStateArb, (s) => {
        localStorage.clear();
        const app = open(s);
        const c = appConsole(app);
        expect(sideOnScreen(c)).toEqual(s.side.map((p) => ({ kg: p.kg, color: p.color })));
        expect(c.plateSet).toBe(s.set);
        expect(c.barKg).toBe(s.barKg);
        expect(c.collarKg).toBe(s.collarKg);
        expect(pressedIn(c, '[data-unit]')).toEqual([s.unit]);
        expect(pressedIn(c, '[data-mode]')).toEqual([s.mode]);
        expect(location.hash).toBe('');
        expect(RIG_KEYS.map((k) => localStorage.getItem(k))).toEqual([null, null, null, null]);
        // Only a By Weight link with a Target is remembered (Caitlin, 2026-10-16).
        const t = s.mode === 'decode' ? s.targetKg : undefined;
        expect(localStorage.getItem('rackbar.recents')).toBe(
          t === undefined ? null : JSON.stringify([t]),
        );
      }),
      APP_RUNS(60),
    );
  });

  it('a By Weight link made from a sender\'s screen opens to the same Total, Target and status (ADR-0014, ADR-0003)', () => {
    fc.assert(
      fc.property(rigArb, unitArb, draftArb, fc.boolean(), (rig, u, draft, takeRoundUp) => {
        const targetKg = draftToKg(draft, u);
        fc.pre(targetKg !== null && targetKg > 0);
        // The Target travels as kg at 2 dp (ADR-0014), which reads back exactly for a kg
        // Target and for an lb one to 1 dp (the rounding is <= 0.011 lb). A 2 dp lb Target
        // (677.51 lb -> 307.31 kg -> 677.5 lb) can re-solve differently; the Plates still
        // win there (the first property), via the carry.
        fc.pre(u === 'kg' || /^[0-9]+(\.[0-9])?$/.test(draft));
        // The sender types the Target (and maybe takes the round-up) on the real console.
        const sender = fresh(rig, u);
        type(sender, draft);
        if (takeRoundUp && !roundUp(sender).hidden) roundUp(sender).click();
        const inventory = PLATE_SETS[rig.set].inventory;
        const side = sideOnScreen(sender).map((d) => inventory.find((p) => p.kg === d.kg)!);
        const seen = {
          side: sideOnScreen(sender),
          total: totalText(sender),
          status: statusKind(sender),
          draft: entryDraft(sender),
        };
        localStorage.clear();
        const app = open({
          set: rig.set, barKg: rig.barKg, collarKg: rig.collarKg as 0 | 2.5, unit: u,
          mode: 'decode', side, targetKg: targetKg!,
        });
        const c = appConsole(app);
        expect(modeBtn(c, 'decode').getAttribute('aria-pressed')).toBe('true');
        expect(unitBtn(c, u).getAttribute('aria-pressed')).toBe('true');
        expect({
          side: sideOnScreen(c),
          total: totalText(c),
          status: statusKind(c),
          draft: entryDraft(c),
        }).toEqual(seen);
      }),
      APP_RUNS(60),
    );
  });
});
