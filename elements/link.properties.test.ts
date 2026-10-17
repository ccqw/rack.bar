// Property-based invariants for opening a share link (RBAR-50 slice 2, ADR-0014),
// driven through the REAL boot path -- the link's fragment in the URL, then a fresh
// <rack-app> mount -- and judged from what is on screen and in storage. The pure-core
// counterparts (round trip, canonical form, parser fuzzing) are in lib/properties.test.ts.
// Deterministic: the shared SEED; app mounts are heavy, so runs stop at the first failure.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fc from 'fast-check';
import { linkUrl } from '../lib/link.ts';
import type { LinkState } from '../lib/link.ts';
import { PLATE_SETS } from '../lib/platesets.ts';
import { draftToKg } from '../lib/units.ts';
import {
  SEED, type Console, resetPool, q, sr, modeBtn, unitBtn, sideOnScreen, linkStateArb,
  fresh, rigArb, unitArb, draftArb, type, roundUp, statusKind, totalText, entryDraft,
  tapAdd,
} from './properties.drivers.ts';
import './app.ts';

beforeEach(resetPool);

// A typed Target for the link round trips: the shared draft mix, salted with x.5
// readings -- the lb case where a Target's 2 dp kg reads a different whole lb than the
// typed text (52.5 lb reads 53; 23.81 kg reads 52), which the `d` reading exists for.
const linkDraftArb = fc.oneof(
  { weight: 1, arbitrary: draftArb },
  { weight: 1, arbitrary: fc.integer({ min: 0, max: 899 }).map((n) => `${n}.5`) },
);
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
  it('opening any link over any persisted rig shows exactly its Side, Bar, Collar, unit and mode and changes no rig key (ADR-0014)', () => {
    fc.assert(
      fc.property(linkStateArb, rigArb, unitArb, (s, own, ownUnit) => {
        localStorage.clear();
        localStorage.setItem('rackbar.plateSet', own.set);
        localStorage.setItem('rackbar.barKg', String(own.barKg));
        localStorage.setItem('rackbar.collarKg', String(own.collarKg));
        localStorage.setItem('rackbar.unit', ownUnit);
        const before = RIG_KEYS.map((k) => localStorage.getItem(k));
        const app = open(s);
        const c = appConsole(app);
        expect(sideOnScreen(c)).toEqual(s.side.map((p) => ({ kg: p.kg, color: p.color })));
        expect(c.plateSet).toBe(s.set);
        expect(c.barKg).toBe(s.barKg);
        expect(c.collarKg).toBe(s.collarKg);
        expect(pressedIn(c, '[data-unit]')).toEqual([s.unit]);
        expect(pressedIn(c, '[data-mode]')).toEqual([s.mode]);
        // The Setup sheet mirrors the linked rig, not the persisted one.
        const setup = q(sr(app), 'rack-setup');
        const tiles = (attr: string) =>
          [...sr(setup).querySelectorAll<HTMLElement>(`[${attr}]`)]
            .filter((b) => b.getAttribute('aria-pressed') === 'true')
            .map((b) => b.getAttribute(attr));
        expect(tiles('data-plateset')).toEqual([s.set]);
        expect(tiles('data-bar')).toEqual([String(s.barKg)]);
        expect(tiles('data-collar')).toEqual([String(s.collarKg)]);
        expect(location.hash).toBe('');
        expect(RIG_KEYS.map((k) => localStorage.getItem(k))).toEqual(before);
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
      fc.property(rigArb, unitArb, linkDraftArb, fc.boolean(), (rig, u, draft, takeRoundUp) => {
        const targetKg = draftToKg(draft, u);
        fc.pre(targetKg !== null && Number(targetKg.toFixed(2)) > 0);
        // The Target travels as kg at 2 dp with the sender's reading `d` (ADR-0014, slice
        // 3), so every <= 2 dp Target in either unit reads and re-solves as typed.
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
          mode: 'decode', side, targetKg: targetKg!, reading: entryDraft(sender),
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
  // RBAR-50 slice 3: the whole trip through the real paths -- the sender builds a load
  // on the console (a typed Target -- x.5 readings included -- maybe the round-up, maybe
  // a unit switch after typing, or Plates tapped on; maybe carried across a mode
  // switch), opens the share card and taps Copy link; that exact URL then boots a fresh
  // app. Whatever the sender saw, rig included, the recipient sees.
  it('Copy link from any sender screen opens to the same rig, mode, Plates, Total, Target and status (ADR-0014, ADR-0011)', () => {
    fc.assert(
      fc.property(
        rigArb, unitArb, fc.constantFrom<'decode' | 'encode'>('decode', 'encode'), linkDraftArb,
        fc.boolean(), fc.boolean(), fc.array(fc.nat(), { maxLength: 12 }), fc.boolean(),
        (rig, u, mode, draft, takeRoundUp, switchUnit, picks, switchMode) => {
          const sender = fresh(rig, u);
          if (mode === 'decode') {
            type(sender, draft);
            if (takeRoundUp && !roundUp(sender).hidden) roundUp(sender).click();
            // A kg Target shown in lb reads whole (and an lb one in kg at 2 dp).
            if (switchUnit) unitBtn(sender, u === 'kg' ? 'lb' : 'kg').click();
          } else {
            modeBtn(sender, 'encode').click();
            const inv = PLATE_SETS[rig.set].inventory;
            for (const i of picks) tapAdd(sender, inv[i % inv.length]!.kg);
          }
          const shown = switchMode ? (mode === 'decode' ? 'encode' : 'decode') : mode;
          if (switchMode) modeBtn(sender, shown).click();
          const rigOf = (c: Console) => [c.plateSet, c.barKg, c.collarKg];
          const seen = {
            rig: rigOf(sender),
            mode: pressedIn(sender, '[data-mode]'),
            unit: pressedIn(sender, '[data-unit]'),
            side: sideOnScreen(sender),
            total: totalText(sender),
            status: statusKind(sender),
            // The Target field is By Weight's editor; By Plates does not show it.
            draft: shown === 'decode' ? entryDraft(sender) : null,
          };
          q<HTMLButtonElement>(sr(sender), '[data-share]').click();
          const card = q(sr(sender), 'rack-share');
          const copyLink = q<HTMLButtonElement>(sr(card), '[data-link]');
          // Every on-menu load here has an exact link, except a By Weight Target that
          // cannot travel: 0 at 2 dp (or over MAX_TARGET_KG, which this draft range never
          // reaches; console.sharelink.test.ts covers it). The card then shows a disabled
          // "No link" with its reason -- never a lossy link.
          const t = shown === 'decode' && mode === 'decode' ? draftToKg(draft, u) : null;
          if (t !== null && Number(t.toFixed(2)) <= 0) {
            expect(copyLink.disabled).toBe(true);
            return;
          }
          expect(copyLink.disabled).toBe(false);
          const writeText = vi.fn().mockResolvedValue(undefined);
          vi.stubGlobal('navigator', { clipboard: { writeText } });
          try {
            copyLink.click();
          } finally {
            vi.unstubAllGlobals();
          }
          const url = writeText.mock.calls[0]![0] as string;
          localStorage.clear();
          history.replaceState(null, '', `/${url.slice(url.indexOf('#'))}`);
          document.body.innerHTML = '';
          const app = document.createElement('rack-app');
          document.body.append(app);
          const c = appConsole(app);
          expect({
            rig: rigOf(c),
            mode: pressedIn(c, '[data-mode]'),
            unit: pressedIn(c, '[data-unit]'),
            side: sideOnScreen(c),
            total: totalText(c),
            status: statusKind(c),
            draft: shown === 'decode' ? entryDraft(c) : null,
          }).toEqual(seen);
        },
      ),
      APP_RUNS(60),
    );
    // Two full mounts per run (a sender console and a fresh app): ~1.5 s locally, past
    // Vitest's 5 s default on a loaded CI runner, so this one test gets more room.
  }, 30_000);
});
