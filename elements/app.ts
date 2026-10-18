// <rack-app> -- the app shell and composition root (RBAR-15, ADR-0007). It owns the
// rig configuration (the Bar, the Collars, and the plate set) and feeds it down: it
// renders the header (wordmark + a Setup pill), the <rack-console> calculator, and the
// <rack-setup> sheet, and wires the three together.
//
//   pill tap                -> open the Setup sheet
//   console `opensetup`     -> open the Setup sheet too (Another way's "Set Plate
//                              Inventory", RBAR-66)
//   sheet `barchange`       -> adopt the Bar: persist it, push it to the console, relabel
//                              the pill, reflect the active tile
//   sheet `collarchange`    -> adopt the Collar: persist it, push it to the console,
//                              reflect the active tile (RBAR-16, ADR-0008)
//   sheet `platesetchange`  -> adopt the plate set: persist it, swap the Bar to the set's
//                              default, push set + Bar to the console and sheet (RBAR-17,
//                              ADR-0010)
//   sheet `baradd`          -> add a custom Bar (RBAR-76, ADR-0017): persist the list,
//                              select it (or the set Bar / custom Bar of that weight)
//   sheet `barremove`       -> drop a custom Bar; the chosen one falls back to the set's
//                              default Bar
//   sheet `barrestore`      -> Undo a removal, re-selecting the Bar if it was chosen
//   sheet `pairschange`     -> set one size's Pairs of Plates on Hand on the active set
//                              (RBAR-72, ADR-0016): persist, push to console and sheet
//   sheet `pairsreset`      -> "All plates": clear the active set's limits, same path
//   sheet `close`           -> drop the pill's open state
//   a share link (#v=1&...) -> on boot or `hashchange`: apply its rig and load for this
//                              view only, persisting nothing (RBAR-50, ADR-0014)
//
// Each config concern persists shell-side under its own localStorage key (ADR-0007);
// the core stays pure and only ever sees these as function arguments (ADR-0001/0002).
import { persistedPrimaryUnit } from './console.ts';
import type { LinkLoad } from './console.ts';
import './setup.ts';
import { SLIDERS_GLYPH } from './sliders.ts';
import { GRAD_CAP_GLYPH } from './quizglyphs.ts';
import { isOfferedCollar, DEFAULT_COLLAR_KG } from '../lib/plates.ts';
import { writePersisted } from './persist.ts';
import {
  BAR_KEY,
  COLLAR_KEY,
  CUSTOM_BARS_KEY,
  PLATESET_KEY,
  PLATES_ON_HAND_KEY,
  loadBar,
  loadCollar,
  loadCustomBars,
  loadPlateSet,
  loadPlatesOnHand,
  wantsSetup,
} from './rig.ts';
import { BOX_SIZING } from './boxsizing.ts';
import { BUTTON_FX } from './buttonfx.ts';
import { SHORT_SCREEN } from './fit.ts';
import { plateSetFor, isOfferedPlateSet } from '../lib/platesets.ts';
import type { PlateSetKey } from '../lib/platesets.ts';
import {
  addCustomBar,
  barLabel,
  barsFor,
  isValidStamp,
  removeCustomBar,
  restoreCustomBar,
  serializeCustomBars,
  stampKg,
} from '../lib/custombars.ts';
import type { BarStamp } from '../lib/custombars.ts';
import { format, isUnit } from '../lib/units.ts';
import { parseLink } from '../lib/link.ts';
import type { LinkState } from '../lib/link.ts';
import { ALL_PLATES, clearSet, serializePlatesOnHand, setPairs } from '../lib/platesonhand.ts';
import type { PlatesOnHand } from '../lib/platesonhand.ts';

type Console = HTMLElement & {
  barKg: number;
  collarKg: number;
  plateSet: string;
  platesOnHand: PlatesOnHand;
  applyLink(link: LinkLoad): void;
};
type Setup = HTMLElement & {
  barKg: number;
  customBars: readonly BarStamp[];
  collarKg: number;
  plateSet: string;
  platesOnHand: PlatesOnHand;
  open(): void;
  close(): void;
};

// One persisted config key per concern (ADR-0007), read through elements/rig.ts (which
// the Loadout quiz page shares) and written through the best-effort helpers
// (persist.ts). Recents persists shell-side too but console-owned, under its own key
// (ADR-0009); the unit preference is console-owned too (ADR-0010).

// A stamp from an event payload, or null: the sheet is trusted to send one, but the
// list only ever takes a valid stamp (the ADR-0007 validate-at-the-boundary rule).
function stampOf(detail: unknown): BarStamp | null {
  if (typeof detail !== 'object' || detail === null) return null;
  const { value, unit } = detail as { value?: unknown; unit?: unknown };
  if (typeof value !== 'number' || typeof unit !== 'string' || !isUnit(unit)) return null;
  const s = { value, unit };
  return isValidStamp(s) ? s : null;
}

class RackApp extends HTMLElement {
  private root: ShadowRoot = this.attachShadow({ mode: 'open' });
  private console!: Console;
  private setup!: Setup;
  private pill!: HTMLButtonElement;
  private pillLabel!: HTMLElement;

  // The active plate set drives the offered Bars and the native Unit (ADR-0010); load it
  // first, since the Bar validates against its Bars.
  private plateSetKey: PlateSetKey = 'comp';
  private barKg = plateSetFor('comp').defaultBarKg;
  private collarKg = DEFAULT_COLLAR_KG;
  // The lifter's custom Bars (RBAR-76, ADR-0017), offered on every set after its own.
  private customBars: readonly BarStamp[] = [];
  // Pairs of Plates on Hand, every set's (RBAR-72, ADR-0016). One setting, saved;
  // a share link never touches it.
  private platesOnHand: PlatesOnHand = ALL_PLATES;

  connectedCallback(): void {
    // A share link in the URL (RBAR-50, ADR-0014) is read FIRST and the fragment cleared,
    // so a reload returns to the lifter's own rig. The persisted rig still loads and seeds
    // as usual; the link then overrides it for this view (applyLink), writing no rig key
    // (its Target and Recents chip are the lifter's, RBAR-87 -- see applyLink).
    const link = this.takeLink();
    this.plateSetKey = loadPlateSet();
    this.customBars = loadCustomBars();
    this.barKg = loadBar(this.plateSetKey, this.customBars);
    this.collarKg = loadCollar();
    this.platesOnHand = loadPlatesOnHand();
    // Children are defined before this runs (imports at top + rack-app's own define is
    // last), so assigning innerHTML upgrades <rack-console>/<rack-setup> synchronously
    // and their connectedCallbacks finish here -- which is why the seeding below (after
    // the queries) lands on already-connected elements, not inert ones.
    this.root.innerHTML = `
      <style>
        ${BOX_SIZING}${BUTTON_FX}
        :host {
          display: flex; flex-direction: column; flex: 1; width: 100%; min-height: 0;
        }
        /* The header and the console column share one 22px side inset, the
           prototype's column padding (L75; RBAR-74), so the wordmark and the Setup
           pill line up with the mode toggle's edges. */
        header {
          display: flex; align-items: center; justify-content: space-between;
          gap: 12px; padding: 14px 22px;
        }
        /* The single h1 (RBAR-53): the page title heading navigation starts from. As a
           flex item its display was already blockified; margin pinned so the UA heading
           margin cannot move the header row. */
        .wordmark {
          font-family: var(--rack-font); font-weight: 800; font-size: 20px;
          letter-spacing: -.025em; color: var(--rack-fg); margin: 0;
        }
        .wordmark .dot { color: var(--rack-accent); }
        /* The right side of the header: the Loadout quiz door, then the Setup pill. */
        .hdr { display: flex; align-items: center; gap: 8px; min-width: 0; }
        /* The Loadout quiz door (RBAR-92): a graduation cap in the head icon-button
           style (the console's Share / fullscreen buttons: a 30px raised box, 9px
           radius), left of Setup. Not a stopwatch: that glyph is the rest timer's. The
           drawn box keeps a 44x44 tap target through an invisible layer that stops
           1px short of the pill (the row's 8px gap): 8px out from the padding box,
           inside the 1px border, so 28 + 16 = 44 each way. */
        .quizlink {
          position: relative; flex: none;
          width: 30px; height: 30px; display: flex; align-items: center; justify-content: center;
          color: var(--rack-text-secondary); background: var(--rack-raised);
          border: 1px solid var(--rack-border); border-radius: 9px;
          -webkit-tap-highlight-color: transparent;
        }
        .quizlink::after { content: ""; position: absolute; inset: -8px; }
        .quizlink:hover { color: var(--rack-text); border-color: var(--rack-border-hover); }
        .quizlink:focus-visible { outline: 2px solid var(--rack-accent); outline-offset: 2px; }
        .quizlink svg { display: block; }
        /* The Setup pill: the rig's current Bar, tappable to open the sheet. A raised
           fill over secondary ink (prototype L82), one line: Bar + middot + set. */
        .pill {
          display: inline-flex; align-items: center; gap: 7px;
          font-family: var(--rack-font-num); font-size: 11px; font-weight: 600;
          letter-spacing: .04em; color: var(--rack-text-secondary);
          background: var(--rack-raised); border: 1px solid var(--rack-border);
          border-radius: 999px; padding: 8px 14px; min-height: 36px; min-width: 0;
          cursor: pointer;
        }
        .pill:hover { color: var(--rack-fg); }
        .pill:focus-visible { outline: 2px solid var(--rack-accent); outline-offset: 2px; }
        /* One line at every width (RBAR-103): the pill may shrink (its min-width: 0) and
           its label ellipsizes rather than wrapping, so the header row never grows a
           second line. The glyphs never shrink. */
        .pill [data-pill-label] {
          min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .pill .sliders { display: block; flex: none; }
        .pill .chev { display: block; flex: none; }
        /* The narrow tiers (RBAR-103): since the quiz door joined the header (RBAR-92)
           the handoff's spacing leaves the pill too little room on a narrow phone. Up
           to 389px the row and the pill tighten their gaps and side padding (the pill
           keeps its 36px height and tap target), which keeps "45 lb bar - Training"
           whole at 375px; up to 359px the sliders glyph also goes (the chevron still
           marks it tappable), which keeps "20 kg bar - Comp" whole at 320px. A longer
           label than the room ellipsizes. */
        @media (max-width: 389px) {
          header { gap: 8px; }
          .pill { gap: 5px; padding-left: 10px; padding-right: 10px; }
        }
        @media (max-width: 359px) {
          .pill .sliders { display: none; }
        }
        /* The rotate eases only for lifters who have not asked motion off; the
           end states themselves are instant either way (BUTTON_FX convention). */
        @media (prefers-reduced-motion: no-preference) {
          .pill .chev { transition: transform .15s; }
        }
        .pill[aria-expanded="true"] .chev { transform: rotate(180deg); }
        /* Top-anchored, never vertically centered (prototype L75 is a plain
           column): centering re-floats the whole console whenever the mode
           swap changes its height, so the toggle and bar jump on every switch.
           RBAR-67: main STRETCHES the console to its full height (the console's bar
           block flexes into the leftover), min-height: 0 lets it shrink to the
           viewport instead of growing the page, and the old 6vh bottom pad (~40px of
           nothing on a phone) is gone -- body keeps the safe-area inset below. */
        main {
          flex: 1; display: flex; align-items: stretch; justify-content: center;
          min-height: 0; padding: 2vh 22px 0;
        }
        /* The short-screen tier (RBAR-67, fit.ts): less air above and below the header
           row and above the console; the pill keeps its 36px height. */
        @media ${SHORT_SCREEN} {
          header { padding-top: 6px; padding-bottom: 6px; }
          main { padding-top: 4px; }
        }
      </style>
      <header>
        <h1 class="wordmark">rack<span class="dot">.</span>bar</h1>
        <div class="hdr">
        <a class="quizlink" data-quiz-link href="/game.html" aria-label="Loadout quiz">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor"
               stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"
               aria-hidden="true">${GRAD_CAP_GLYPH}</svg>
        </a>
        <button type="button" class="pill" data-setup-pill
                aria-haspopup="dialog" aria-expanded="false">
          <svg class="sliders" data-pill-icon width="13" height="13" viewBox="0 0 16 16"
               fill="none" aria-hidden="true">${SLIDERS_GLYPH}</svg>
          <span data-pill-label></span>
          <svg class="chev" width="11" height="11" viewBox="0 0 16 16" fill="none"
               aria-hidden="true">
            <path d="M3.5 6L8 10.5 12.5 6" stroke="var(--rack-text-secondary)"
                  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
          </svg>
        </button>
        </div>
      </header>
      <main><rack-console></rack-console></main>
      <rack-setup></rack-setup>
    `;

    this.console = this.root.querySelector('rack-console') as Console;
    this.setup = this.root.querySelector('rack-setup') as Setup;
    this.pill = this.root.querySelector('[data-setup-pill]')!;
    this.pillLabel = this.root.querySelector('[data-pill-label]')!;

    // Seed every surface from the (possibly persisted) plate set, Bar, and Collar. Push
    // the Bar before the plate set, matching adoptPlateSet's invariant ("set barKg first
    // so a re-decode sees it") -- harmless at init (no standing Target yet), but keeping
    // one ordering rule everywhere avoids a stale-Bar transient if that ever changes.
    this.console.barKg = this.barKg;
    this.console.collarKg = this.collarKg;
    this.console.plateSet = this.plateSetKey;
    this.console.platesOnHand = this.platesOnHand;
    this.setup.platesOnHand = this.platesOnHand;
    this.setup.customBars = this.customBars;
    this.setup.barKg = this.barKg;
    this.setup.collarKg = this.collarKg;
    this.setup.plateSet = this.plateSetKey;
    this.relabel();

    this.pill.addEventListener('click', () => this.openSetup());
    // The Another way sheet's "Set Plate Inventory" door (RBAR-66) opens the same sheet.
    // Focus follows into Setup (its Done), since the sheet it came from has closed.
    this.console.addEventListener('opensetup', () => {
      this.openSetup();
      this.setup.shadowRoot?.querySelector<HTMLButtonElement>('[data-done]')?.focus();
    });
    this.setup.addEventListener('barchange', (e) =>
      this.adopt((e as CustomEvent<{ barKg: number }>).detail.barKg),
    );
    this.setup.addEventListener('collarchange', (e) =>
      this.adoptCollar((e as CustomEvent<{ collarKg: number }>).detail.collarKg),
    );
    this.setup.addEventListener('platesetchange', (e) =>
      this.adoptPlateSet((e as CustomEvent<{ plateSet: string }>).detail.plateSet),
    );
    this.setup.addEventListener('baradd', (e) => this.addBar((e as CustomEvent).detail));
    this.setup.addEventListener('barremove', (e) =>
      this.removeBar((e as CustomEvent<{ index?: unknown }>).detail?.index),
    );
    this.setup.addEventListener('barrestore', (e) => this.restoreBar((e as CustomEvent).detail));
    this.setup.addEventListener('pairschange', (e) => {
      const { face, pairs } = ((e as CustomEvent).detail ?? {}) as { face?: unknown; pairs?: unknown };
      if (typeof face !== 'string' || !(pairs === null || typeof pairs === 'number')) return;
      this.setPlatesOnHand(setPairs(this.platesOnHand, this.plateSetKey, face, pairs));
    });
    this.setup.addEventListener('pairsreset', () =>
      this.setPlatesOnHand(clearSet(this.platesOnHand, this.plateSetKey)),
    );
    this.setup.addEventListener('close', () =>
      this.pill.setAttribute('aria-expanded', 'false'),
    );

    // A link pasted into an already-open tab changes only the hash (no reload). Listen
    // before applying, so a throw in the boot-time apply cannot also cost the listener.
    window.addEventListener('hashchange', this.onHashChange);
    if (link) this.applyLink(link);
    // The quiz's door into Setup (SETUP_LINK, RBAR-92): open the sheet once and strip
    // the query, so a reload lands on the calculator as usual.
    if (wantsSetup(location.search)) {
      const params = new URLSearchParams(location.search);
      params.delete('setup');
      const rest = params.toString();
      history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
      this.openSetup();
    }
  }

  // Open the Setup sheet, from the header pill or another door into it (RBAR-66).
  private openSetup(): void {
    this.setup.open();
    this.pill.setAttribute('aria-expanded', 'true');
  }

  disconnectedCallback(): void {
    window.removeEventListener('hashchange', this.onHashChange);
  }

  private onHashChange = (): void => {
    const link = this.takeLink();
    if (link) this.applyLink(link);
  };

  // Parse a share link out of the URL fragment against the lifter's own persisted
  // Primary unit (a link without `u` reads in it), then clear the fragment either way:
  // a malformed link is a silent normal boot (ADR-0014), and a reload or a later share
  // never re-applies a stale one. replaceState fires no hashchange, so this cannot loop.
  private takeLink(): LinkState | null {
    if (location.hash === '') return null;
    const link = parseLink(location.hash, persistedPrimaryUnit());
    history.replaceState(null, '', location.pathname + location.search);
    return link;
  }

  // Apply an opened share link (RBAR-50, ADR-0014): the rig half here, the load half in
  // the console. Transient -- the set, Bar and Collar override the persisted rig for this
  // view and no rig key is saved (a later Setup tap persists that one key, as today).
  // The load half is the lifter's own state: the console stores the link's Target
  // (rackbar.target, RBAR-87) and adds it to Recents (ADR-0014 as amended). Pushed in
  // adoptPlateSet's order (Bar before set) so a re-solve never sees a stale Bar, then
  // the console shows the linked Plates (plates win over a re-solve).
  private applyLink(link: LinkState): void {
    this.plateSetKey = link.set;
    this.barKg = link.barKg;
    this.collarKg = link.collarKg;
    this.console.barKg = link.barKg;
    this.setup.barKg = link.barKg;
    this.console.plateSet = link.set;
    this.setup.plateSet = link.set;
    this.console.collarKg = link.collarKg;
    this.setup.collarKg = link.collarKg;
    this.relabel();
    this.console.applyLink(
      link.mode === 'decode'
        ? {
            mode: 'decode',
            side: link.side,
            targetKg: link.targetKg,
            reading: link.reading,
            unit: link.unit,
          }
        : { mode: 'encode', side: link.side, unit: link.unit },
    );
  }

  // The Bars the active plate set offers -- the set the persisted/chosen Bar validates
  // against (ADR-0010): the set's own (comp 20/15/5 kg, training 45 lb + 20 kg), then the
  // lifter's custom Bars (RBAR-76, ADR-0017).
  private offeredBars(): readonly number[] {
    return barsFor(plateSetFor(this.plateSetKey), this.customBars).map((b) => b.kg);
  }

  // Add a custom Bar typed in Setup (RBAR-76) and select it. A weight the set already
  // offers selects that Bar; one a custom Bar already has selects it; neither is stored
  // twice. An invalid payload, or a full list, changes nothing.
  private addBar(detail: unknown): void {
    const s = stampOf(detail);
    if (!s) return;
    const kg = stampKg(s);
    if (!this.offeredBars().includes(kg)) {
      const next = addCustomBar(this.customBars, s);
      if (next === this.customBars) return; // full
      this.setCustomBars(next);
    }
    this.adopt(kg);
  }

  // Drop custom Bar `index`. If it was the chosen Bar, fall back to the set's default --
  // a removed Bar must never stay on the rig.
  private removeBar(index: unknown): void {
    if (typeof index !== 'number') return;
    const next = removeCustomBar(this.customBars, index);
    if (next === this.customBars) return;
    this.setCustomBars(next);
    if (!this.offeredBars().includes(this.barKg)) {
      this.adopt(plateSetFor(this.plateSetKey).defaultBarKg);
    }
  }

  // Undo a removal: the Bar goes back at its index, and is chosen again if it was.
  private restoreBar(detail: unknown): void {
    const s = stampOf(detail);
    if (!s) return;
    const { index, select } = detail as { index?: unknown; select?: unknown };
    if (typeof index !== 'number') return;
    const next = restoreCustomBar(this.customBars, s, index);
    if (next === this.customBars) return;
    this.setCustomBars(next);
    if (select === true) this.adopt(stampKg(s));
  }

  // Adopt new Pairs of Plates on Hand (RBAR-72): persist and push to the console (which
  // re-solves) and the sheet (which re-reads its tiles). setPairs/clearSet return the
  // same object for a no-op or invalid edit, so nothing is written for one.
  private setPlatesOnHand(next: PlatesOnHand): void {
    if (next === this.platesOnHand) return;
    this.platesOnHand = next;
    writePersisted(PLATES_ON_HAND_KEY, serializePlatesOnHand(next));
    this.console.platesOnHand = next;
    this.setup.platesOnHand = next;
  }

  // Persist the custom list and feed it to the sheet (which re-renders its Bar row).
  private setCustomBars(list: readonly BarStamp[]): void {
    this.customBars = list;
    writePersisted(CUSTOM_BARS_KEY, serializeCustomBars(list));
    this.setup.customBars = list;
  }

  // Adopt a Bar chosen in Setup: persist it, thread it into the calculator, relabel the
  // pill, and reflect the active tile. The sheet stays open so the lifter sees the choice.
  // An off-menu Bar (one the active set does not offer) is an invariant breach, not a
  // value to persist and feed the core -- ignore it rather than stranding the readout.
  private adopt(kg: number): void {
    if (!this.offeredBars().includes(kg)) return;
    this.barKg = kg;
    // A Bar only exists within its set (ADR-0010). After a share link put another set on
    // screen (ADR-0014), picking a Bar adopts that set too, or the next boot would reject
    // the saved Bar against the old saved set and silently fall back to its default.
    if (loadPlateSet() !== this.plateSetKey) this.savePlateSet(this.plateSetKey);
    this.saveBar(kg);
    this.console.barKg = kg;
    this.setup.barKg = kg;
    this.relabel();
  }

  // Adopt a Collar chosen in Setup: same shape as adopt() (ADR-0007/0008). An off-menu
  // value is an invariant breach, ignored rather than fed to the core.
  private adoptCollar(kg: number): void {
    if (!isOfferedCollar(kg)) return;
    this.collarKg = kg;
    this.saveCollar(kg);
    this.console.collarKg = kg;
    this.setup.collarKg = kg;
  }

  // Adopt a plate set chosen in Setup (RBAR-17, ADR-0010): persist it, swap the Bar to
  // the set's default (a Bar does not cross sets), persist that too, then push the Bar
  // FIRST and the set second so the console re-solves against the right Bar AND Inventory.
  // An off-menu key is ignored. The sheet stays open so the lifter sees the switch land.
  private adoptPlateSet(key: string): void {
    if (!isOfferedPlateSet(key)) return;
    this.plateSetKey = key;
    this.savePlateSet(key);
    this.barKg = plateSetFor(key).defaultBarKg;
    this.saveBar(this.barKg);
    this.console.barKg = this.barKg;
    this.setup.barKg = this.barKg;
    this.console.plateSet = key;
    this.setup.plateSet = key;
    this.relabel();
  }

  // The pill names the current Bar in its own stamped Unit (e.g. "20 kg bar",
  // "45 lb bar"; RBAR-63 -- never the display Unit, a Bar weighs what it weighs) on
  // ONE line with the plate-set short name after a middot ("20 kg bar <middot> Comp")
  // -- the handoff's header pill (prototype L82/L912, screenshot 01).
  // The middot is emitted as an escape so the source stays ASCII. Both facts follow a
  // set or Bar change, so adopt()/adoptPlateSet() call relabel() and the pill stays in
  // sync.
  // A custom Bar reads by its stamp as typed (RBAR-76: "35 lb bar", never "15.88 kg").
  private relabel(): void {
    const set = plateSetFor(this.plateSetKey);
    const bar = barsFor(set, this.customBars).find((b) => b.kg === this.barKg);
    const name = bar ? barLabel(bar) : format(this.barKg, set.unit);
    this.pillLabel.textContent = `${name} bar \u00B7 ${set.shortLabel}`;
  }

  // Persist the Bar, best-effort (writePersisted swallows a failed write). The stored
  // rig is read back through elements/rig.ts, which validates each key (ADR-0007).
  private saveBar(kg: number): void {
    writePersisted(BAR_KEY, String(kg));
  }

  // Persist the Collar, best-effort -- same swallow-on-failure contract as the Bar.
  private saveCollar(kg: number): void {
    writePersisted(COLLAR_KEY, String(kg));
  }

  // Persist the plate set, best-effort.
  private savePlateSet(key: PlateSetKey): void {
    writePersisted(PLATESET_KEY, key);
  }
}

customElements.define('rack-app', RackApp);
