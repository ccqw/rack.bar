// Property-based invariants for opening a share link (RBAR-50 slice 2, ADR-0014),
// driven through the REAL boot path -- the link's fragment in the URL, then a fresh
// <rack-app> mount -- and judged from what is on screen and in storage. The pure-core
// counterparts (round trip, canonical form, parser fuzzing) are in lib/properties.test.ts.
// Deterministic: the shared SEED; app mounts are heavy, so runs stop at the first failure.
// RBAR-90: each run boots a whole app, so the run counts are kept small and the cases
// the random draw might miss are pinned as fixed `examples` (run first, every time).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fc from 'fast-check';
import { linkUrl } from '../lib/link.ts';
import type { LinkState } from '../lib/link.ts';
import { PLATE_SETS } from '../lib/platesets.ts';
import { draftToKg, shownIn } from '../lib/units.ts';
import { parseLink } from '../lib/link.ts';
import { plateFace } from '../lib/plates.ts';
import type { PlateSetKey } from '../lib/platesets.ts';
import type { Rig } from '../lib/properties.oracle.ts';
import {
  SEED, type Console, resetPool, q, sr, modeBtn, unitBtn, sideOnScreen, linkStateArb,
  fresh, on, rigArb, unitArb, draftArb, type, roundUp, statusKind, totalText, entryDraft,
  tapAdd, nextRun, rigDraftCaseArb, commitWorking, stairs,
} from './properties.drivers.ts';
import { RIGS } from '../lib/properties.oracle.ts';
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
// Only the previous app is removed, so a pooled sender console (on()) stays mounted.
function open(state: LinkState): HTMLElement {
  const url = linkUrl(state);
  if (url === null) throw new Error('generator produced an unserializable load');
  history.replaceState(null, '', `/${url.slice(url.indexOf('#'))}`);
  for (const old of document.querySelectorAll('rack-app')) old.remove();
  const app = document.createElement('rack-app');
  document.body.append(app);
  return app;
}
const appConsole = (app: HTMLElement) => q<Console>(sr(app), 'rack-console');
// Tap Copy link on an open share card and return the URL it wrote to the clipboard. A
// card with "No link" fails here, by name.
function copyLinkUrl(card: HTMLElement): string {
  const button = q<HTMLButtonElement>(sr(card), '[data-link]');
  expect(button.disabled, 'the card offers a link').toBe(false);
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  try {
    button.click();
  } finally {
    vi.unstubAllGlobals();
  }
  expect(writeText).toHaveBeenCalledTimes(1);
  return writeText.mock.calls[0]![0] as string;
}
// Boot a fresh app from a copied share URL, with no persisted state.
function openUrl(url: string): Console {
  localStorage.clear();
  history.replaceState(null, '', `/${url.slice(url.indexOf('#'))}`);
  document.body.innerHTML = '';
  const app = document.createElement('rack-app');
  document.body.append(app);
  return appConsole(app);
}
// The Total the sleeve's discs add up to on Warm up row `i`: the bare-Bar row (row 0)
// carries no Collars (ADR-0015 Q5), every other row sits on the effective Bar.
const rowTotalKg = (el: HTMLElement, rig: Rig, i: number) =>
  (i === 0 ? rig.barKg : rig.baselineKg) + 2 * sideOnScreen(el).reduce((t, p) => t + p.kg, 0);
// A Plates on Hand limit map for `set` (RBAR-72, ADR-0016): each size maybe limited to
// 0..4 pairs. The solver and the Ramp then stack `withLimits` copies of those sizes.
const limitsArb = (set: PlateSetKey) =>
  fc
    .array(fc.option(fc.integer({ min: 0, max: 4 }), { nil: undefined }), {
      minLength: PLATE_SETS[set].inventory.length,
      maxLength: PLATE_SETS[set].inventory.length,
    })
    .map((ns) =>
      Object.fromEntries(
        PLATE_SETS[set].inventory.flatMap((p, i) =>
          ns[i] === undefined ? [] : [[plateFace(p), ns[i]] as const],
        ),
      ),
    );
// What a share card shows: its Total and its caption (Bar, Collar, set). Its chips
// name the Side, which is judged off the sleeve.
const cardFace = (card: HTMLElement) => ({
  total: q(sr(card), '[data-total]').textContent ?? '',
  caption: q(sr(card), '[data-caption]').textContent ?? '',
});
// A Side's Plates heaviest-first: the order a link carries them in (ADR-0014).
const restacked = (side: { kg: number; color: string }[]) =>
  [...side].sort((a, b) => b.kg - a.kg || a.color.localeCompare(b.color));
const pressedIn = (el: HTMLElement, sel: string) =>
  [...sr(el).querySelectorAll<HTMLElement>(sel)]
    .filter((b) => b.getAttribute('aria-pressed') === 'true')
    .map((b) => b.dataset.mode ?? b.dataset.unit);

describe('opening a share link, properties (ADR-0014)', () => {
  it('opening any link over any persisted rig shows exactly its Side, Bar, Collar, unit and mode and changes no rig key (ADR-0014)', async () => {
    await fc.assert(
      fc.asyncProperty(linkStateArb, rigArb, unitArb, async (s, own, ownUnit) => {
        await nextRun();
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
      APP_RUNS(30),
    );
  });

  it('a By Weight link made from a sender\'s screen opens to the same Total, Target and status (ADR-0014, ADR-0003)', async () => {
    await fc.assert(
      fc.asyncProperty(rigArb, unitArb, linkDraftArb, fc.boolean(), async (rig, u, draft, takeRoundUp) => {
        await nextRun();
        const targetKg = draftToKg(draft, u);
        fc.pre(targetKg !== null && Number(targetKg.toFixed(2)) > 0);
        // The Target travels as kg at 2 dp with the sender's reading `d` (ADR-0014, slice
        // 3), so every <= 2 dp Target in either unit reads and re-solves as typed.
        // The sender types the Target (and maybe takes the round-up) on the real console.
        // The sender is a pooled console (one per rig x unit, reset by Clear): typing and
        // the round-up are all it does, so it need not be a fresh mount every run.
        const sender = on(rig, u);
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
      {
        ...APP_RUNS(25),
        // Pinned: the x.5 lb reading that reads a different whole lb than its 2 dp kg
        // (on the lb Bar and the 20 kg Bar), a kg Target with the round-up taken, and
        // a Target under the bare rig.
        examples: [
          [RIGS[6]!, 'lb', '52.5', false],
          [RIGS[9]!, 'lb', '200.5', true],
          [RIGS[1]!, 'kg', '142.3', true],
          [RIGS[2]!, 'kg', '7.5', false],
        ],
      },
    );
  });
  // RBAR-50 slice 3: the whole trip through the real paths -- the sender builds a load
  // on the console (a typed Target -- x.5 readings included -- maybe the round-up, maybe
  // a unit switch after typing, or Plates tapped on; maybe carried across a mode
  // switch), opens the share card and taps Copy link; that exact URL then boots a fresh
  // app. Whatever the sender saw, rig included, the recipient sees.
  it('Copy link from any sender screen opens to the same rig, mode, Plates, Total, Target and status (ADR-0014, ADR-0011)', async () => {
    await fc.assert(
      fc.asyncProperty(
        rigArb, unitArb, fc.constantFrom<'decode' | 'encode'>('decode', 'encode'), linkDraftArb,
        fc.boolean(), fc.boolean(), fc.array(fc.nat(), { maxLength: 12 }), fc.boolean(),
        async (rig, u, mode, draft, takeRoundUp, switchUnit, picks, switchMode) => {
          await nextRun();
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
      {
        // Two full mounts per run (a sender console and a fresh app).
        ...APP_RUNS(25),
        // Pinned, one per branch: an x.5 lb Target with the round-up taken; a kg Target
        // then read in lb; Plates tapped in By Plates then carried to By Weight; Plates
        // tapped and kept in By Plates; a 0 Target ("No link").
        examples: [
          [RIGS[6]!, 'lb', 'decode', '52.5', true, false, [], false],
          [RIGS[1]!, 'kg', 'decode', '142.3', false, true, [], false],
          [RIGS[8]!, 'kg', 'encode', '0', false, false, [0, 3, 3, 5], true],
          [RIGS[3]!, 'lb', 'encode', '0', false, false, [1, 2, 7], false],
          [RIGS[0]!, 'kg', 'decode', '0', false, false, [], false],
        ],
      },
    );
  });

  // RBAR-78: a Warm up share opens in By Weight on the selected row's load, and the link
  // describes exactly what the sender's card shows -- the bare-Bar row carries no
  // Collars (ADR-0015 Q5), so its link sends none. Judged by the recipient's own screen
  // and its own share card against the sender's card. The Plates are the same; a
  // Warm-up stack with a big Plate outside a lighter one (ADR-0015 as amended) opens
  // restacked heaviest-first, the link's one Side order.
  it('sharing from any Ramp row on any rig opens By Weight on the card\'s Total, Side and Collars (ADR-0014, ADR-0015)', () => {
    // A working weight the lifter could type (a reading in its unit, above 0).
    const workCaseArb = rigDraftCaseArb.filter(([, u, d]) => {
      const kg = draftToKg(d, u) ?? 0;
      return kg > 0 && String(shownIn(kg, u)) === d;
    });
    fc.assert(
      fc.property(workCaseArb, fc.nat({ max: 9 }), ([rig, u, draft], pick) => {
        const sender = fresh(rig, u);
        modeBtn(sender, 'warmup').click();
        commitWorking(sender, draft);
        const rows = stairs(sender);
        const i = pick % rows.length;
        rows[i]!.click();
        const side = sideOnScreen(sender);
        const rowKg = rowTotalKg(sender, rig, i);
        q<HTMLButtonElement>(sr(sender), '[data-share]').click();
        const sent = q(sr(sender), 'rack-share');
        const seen = cardFace(sent);
        const url = copyLinkUrl(sent);
        // The link carries the row's Total as the Target, read as the readout shows it.
        const reading = String(shownIn(rowKg, u));
        const linked = parseLink(url.slice(url.indexOf('#')), u);
        expect(linked).toMatchObject({
          mode: 'decode', targetKg: Number(rowKg.toFixed(2)), reading,
        });
        const c = openUrl(url);
        expect(pressedIn(c, '[data-mode]')).toEqual(['decode']);
        expect([c.plateSet, c.barKg]).toEqual([rig.set, rig.barKg]);
        // The bare-Bar row (always row 0) draws no Collars; every other row does.
        expect(c.collarKg).toBe(i === 0 ? 0 : rig.collarKg);
        expect(restacked(sideOnScreen(c))).toEqual(restacked(side));
        expect(totalText(c)).toBe(totalText(sender));
        // The recipient's Target is the row's Total: its field reads it, and it is the
        // one Recent remembered (a link with no Target remembers nothing).
        expect(entryDraft(c)).toBe(reading);
        expect(JSON.parse(localStorage.getItem('rackbar.recents') ?? '[]')).toContain(
          Number(rowKg.toFixed(2)),
        );
        q<HTMLButtonElement>(sr(c), '[data-share]').click();
        expect(cardFace(q(sr(c), 'rack-share'))).toEqual(seen);
      }),
      APP_RUNS(30),
    );
  }, 30_000);

  // RBAR-78 review S1: a Plates on Hand limit (RBAR-72) loads `withLimits` copies of its
  // size, which an identity match against the set's Inventory used to drop -- "No link"
  // whenever a limited size was on the Bar. With any limits, a By Weight or Warm up
  // share has a link, and it opens to the same Plates, Total and Collars.
  it('with any Plates on Hand limits, a By Weight or Warm up share has a link that opens to the same Plates, Total and Collars (ADR-0014, ADR-0016)', () => {
    const caseArb = rigDraftCaseArb
      .filter(([, u, d]) => {
        const kg = draftToKg(d, u) ?? 0;
        return Number(kg.toFixed(2)) > 0 && String(shownIn(kg, u)) === d;
      })
      .chain(([rig, u, d]) =>
        fc.tuple(
          fc.constant(rig), fc.constant(u), fc.constant(d), limitsArb(rig.set),
          fc.constantFrom<'decode' | 'warmup'>('decode', 'warmup'), fc.nat({ max: 9 }),
        ),
      );
    fc.assert(
      fc.property(caseArb, ([rig, u, draft, limits, mode, pick]) => {
        const sender = fresh(rig, u) as Console & { platesOnHand: unknown };
        sender.platesOnHand = { [rig.set]: limits };
        let collarKg = rig.collarKg;
        if (mode === 'decode') {
          type(sender, draft);
        } else {
          modeBtn(sender, 'warmup').click();
          commitWorking(sender, draft);
          const rows = stairs(sender);
          const i = pick % rows.length;
          rows[i]!.click();
          if (i === 0) collarKg = 0;
        }
        const side = sideOnScreen(sender);
        q<HTMLButtonElement>(sr(sender), '[data-share]').click();
        const url = copyLinkUrl(q(sr(sender), 'rack-share'));
        expect(parseLink(url.slice(url.indexOf('#')), u)).not.toBeNull();
        const c = openUrl(url);
        expect([c.plateSet, c.barKg, c.collarKg]).toEqual([rig.set, rig.barKg, collarKg]);
        expect(restacked(sideOnScreen(c))).toEqual(restacked(side));
        expect(totalText(c)).toBe(totalText(sender));
      }),
      APP_RUNS(30),
    );
  }, 30_000);
});
