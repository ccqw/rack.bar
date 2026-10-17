// <rack-setup> -- the Setup bottom sheet (RBAR-15, ADR-0007/0010). The host for all rig
// configuration: a Bar section (tiles for the active plate set's Bars), a Collars
// section (None / Standard 2.5 kg), and a Plates section (Competition / Training).
//
// A controlled, near-stateless shell (ADR-0001): it holds no canonical config of its
// own. It reflects the current Bar / Collar / plate set onto their active tiles via the
// `barKg` / `collarKg` / `plateSet` properties and emits `barchange` / `collarchange` /
// `platesetchange` when a tile is tapped; the app shell (<rack-app>) owns the values,
// applies them, and feeds them back -- one event up, one property down per concern.
// The plate set drives which Bars the Bar section offers (each set carries its own Bars,
// ADR-0010), so changing it re-renders the Bar tiles. open()/close() drive visibility;
// a scrim tap or the Done button closes and emits `close`. A tap inside the panel does
// not dismiss.
//
// Custom Bars (RBAR-76, ADR-0017): the app also feeds `customBars` (the lifter's own
// Bars, as stamped), rendered after the set's Bars on every set. A "+" tile swaps the
// Bar row for a weight + kg|lb entry (emits `baradd` with the stamp); a long-press, a
// right-click / context-menu key, or Delete on a custom tile removes it (`barremove`),
// leaving an Undo tile in its slot for UNDO_MS (`barrestore`) -- the RBAR-73 pattern.
// The entry and the pending Undo are UI state; the list itself is the app's.
import { DEFAULT_BAR_KG, COLLAR_OPTIONS, DEFAULT_COLLAR_KG } from '../lib/plates.ts';
import { format } from '../lib/units.ts';
import {
  PLATE_SETS,
  PLATE_SET_KEYS,
  plateSetFor,
  isOfferedPlateSet,
} from '../lib/platesets.ts';
import type { Bar, PlateSetKey } from '../lib/platesets.ts';
import {
  CUSTOM_BAR_MAX,
  MAX_CUSTOM_BARS,
  addRefusal,
  barLabel,
  readStamp,
  stampBar,
  stampKg,
  stampLabel,
} from '../lib/custombars.ts';
import type { BarStamp, StampError } from '../lib/custombars.ts';
import type { Unit } from '../lib/units.ts';
import { LONG_PRESS_MS, MOVE_SLOP_PX, UNDO_MS } from './recents.ts';
import { BOX_SIZING } from './boxsizing.ts';
import { BUTTON_FX } from './buttonfx.ts';
import { SECTION_LABEL, VISUALLY_HIDDEN } from './sectionlabel.ts';

// The custom-tile remove hint, read with each custom tile (aria-describedby).
const REMOVE_HINT_ID = 'bar-remove-hint';

// The "+" glyph and the entry's cancel cross, inline SVG per the icon convention.
const PLUS_SVG = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
  <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
</svg>`;
const CROSS_SVG = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
  <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
</svg>`;

// The Competition Bar weights, heaviest-first (men's / women's / technique). The other
// sets carry their own Bars (ADR-0010, lib/platesets -- the app validates against
// offeredBarKgs there); these stay exported as a Competition reference.
export const BAR_OPTIONS = [20, 15, 5] as const;

/** A Competition Bar the lifter can pick. */
export type BarKg = (typeof BAR_OPTIONS)[number];

/** True when `kg` is one of the Competition Bars. */
export function isOfferedBar(kg: number): kg is BarKg {
  return (BAR_OPTIONS as readonly number[]).includes(kg);
}

// A one-line descriptor for each plate-set row (the family + its native Unit).
// Handoff prototype copy, middots rendered as ASCII hyphens (RBAR-22 precedent).
const PLATE_SET_SUB: Record<PlateSetKey, string> = {
  comp: 'Eleiko - color-coded - kg',
  training: 'Plain black iron - lb',
};

// The decorative swatch fills per plate-set row (RBAR-29, prototype PLATESETS cols):
// Competition previews the four bumper hues heaviest-first; Training alternates the
// two iron greys (one dark finish -- the alternation is texture, not four plates).
const PLATE_SET_SWATCHES: Record<PlateSetKey, readonly string[]> = {
  comp: [
    'var(--rack-plate-red)',
    'var(--rack-plate-blue)',
    'var(--rack-plate-yellow)',
    'var(--rack-plate-green)',
  ],
  training: [
    'var(--rack-swatch-iron)',
    'var(--rack-swatch-iron-deep)',
    'var(--rack-swatch-iron)',
    'var(--rack-swatch-iron-deep)',
  ],
};

// The selected-row check, an inline SVG per the handoff's icon convention (the
// prototype's literal check glyph is non-ASCII). Visibility is CSS, keyed on the
// row's aria-pressed, so the visual check and the accessible state cannot drift.
const CHECK_SVG = `<svg class="check" aria-hidden="true" viewBox="0 0 16 16" width="15" height="15">
  <path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor"
        stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

class RackSetup extends HTMLElement {
  private root: ShadowRoot = this.attachShadow({ mode: 'open' });
  private barTilesEl!: HTMLElement;
  private platesetTilesEl!: HTMLElement;
  private tiles!: NodeListOf<HTMLButtonElement>;
  private collarTiles!: NodeListOf<HTMLButtonElement>;
  private platesetTiles!: NodeListOf<HTMLButtonElement>;

  // The Bar reflected as the active tile. The app owns the canonical value; this only
  // mirrors it. Defaults to the 20 kg Bar (DEFAULT_BAR_KG).
  private _barKg = DEFAULT_BAR_KG;
  // The Collar reflected as the active tile, mirrored the same way. Defaults to None.
  private _collarKg = DEFAULT_COLLAR_KG;
  // The active plate set, mirrored the same way. Defaults to Competition. Drives which
  // Bars the Bar section offers (ADR-0010).
  private _plateSetKey: PlateSetKey = 'comp';
  // The lifter's custom Bars (RBAR-76), mirrored from the app like the rest.
  private _customBars: readonly BarStamp[] = [];

  // The "+" entry: open or not, and the Unit it reads the typed weight in.
  private adding = false;
  private addUnit: Unit = 'kg';
  // The pending removal: the Bar removed, its list index, whether it was the chosen Bar,
  // and the timer that ends the Undo window. One at a time; a new removal ends the last.
  private pending: { stamp: BarStamp; index: number; select: boolean } | null = null;
  private undoTimer: ReturnType<typeof setTimeout> | undefined;
  // The live long-press on a custom tile (as rack-recents) and the open Remove menu.
  private hold: {
    tile: HTMLButtonElement;
    x: number;
    y: number;
    fire: ReturnType<typeof setTimeout>;
  } | null = null;
  private suppressClick = false;
  private menuFor: number | null = null;
  private menuEl!: HTMLElement;
  private barHintEl!: HTMLElement;

  // While the Remove menu is open, a press anywhere outside it closes it.
  private onDocPointer = (e: Event): void => {
    if (!e.composedPath().includes(this.menuEl)) this.closeMenu(false);
  };

  set customBars(list: readonly BarStamp[]) {
    this._customBars = list;
    if (this.barTilesEl && !this.adding) this.renderBarTiles();
  }
  get customBars(): readonly BarStamp[] {
    return this._customBars;
  }

  set barKg(kg: number) {
    this._barKg = kg;
    if (this.tiles) this.syncTiles();
  }
  get barKg(): number {
    return this._barKg;
  }

  set collarKg(kg: number) {
    this._collarKg = kg;
    if (this.collarTiles) this.syncCollarTiles();
  }
  get collarKg(): number {
    return this._collarKg;
  }

  set plateSet(key: string) {
    this._plateSetKey = isOfferedPlateSet(key) ? key : 'comp';
    if (this.barTilesEl) {
      this.adding = false;
      this.renderBarTiles(); // the offered Bars changed with the set
      this.syncPlatesetTiles();
    }
  }
  get plateSet(): string {
    return this._plateSetKey;
  }

  /** Show the sheet. */
  open(): void {
    this.hidden = false;
  }

  /** Hide the sheet and tell the shell, so it can drop the open state / pill caret. */
  close(): void {
    this.hidden = true;
    // The entry, the Remove menu and a pending Undo are moment-to-moment UI: closing the
    // sheet ends them (the removal is final).
    this.cancelHold();
    this.closeMenu(false);
    this.clearPending();
    this.adding = false;
    if (this.barTilesEl) this.renderBarTiles();
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  connectedCallback(): void {
    this.hidden = true; // a sheet is closed until opened

    // The Collar tiles: None (no weight) or a Standard 2.5 kg-per-Side competition
    // collar, in the handoff ConfigSheet copy (RBAR-29 fold): a named headline
    // ("None" / "Standard") over a mono sub ("bare sleeve" / the both-unit weight).
    // The visible sub dropped the old "per side" note, so the accessible name keeps
    // that fact -- the Total still adds the Collar twice (ADR-0008).
    const collarTiles = COLLAR_OPTIONS.map((kg) =>
      kg === 0
        ? `
        <button type="button" class="tile" data-collar="0" aria-pressed="false"
                aria-label="No collars, bare sleeve">
          <span class="word">None</span>
          <span class="csub">bare sleeve</span>
        </button>`
        : `
        <button type="button" class="tile" data-collar="${kg}" aria-pressed="false"
                aria-label="Standard ${format(kg, 'kg')} collars (${format(kg, 'lb')}), per Side">
          <span class="word">Standard</span>
          <span class="csub">${format(kg, 'kg')} / ${format(kg, 'lb')}</span>
        </button>`,
    ).join('');

    this.root.innerHTML = `
      <style>
        ${BOX_SIZING}${BUTTON_FX}
        :host { display: block; }
        :host([hidden]) { display: none; }
        @keyframes rack-fade { from { opacity: 0; } to { opacity: 1; } }
        /* sheetIn (prototype L21): the rise fades in too (RBAR-74). */
        @keyframes rack-rise {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        /* The dim backdrop: covers the viewport, taps through to close. */
        .scrim {
          position: fixed; inset: 0; z-index: 50;
          background: var(--rack-scrim);
          display: flex; align-items: flex-end; justify-content: center;
          animation: rack-fade .16s ease-out;
        }
        /* The sheet itself rises from the bottom edge; safe-area pad keeps the Done
           button and tiles clear of the home indicator (RBAR-15 mobile fit). Metrics,
           shadow and entrance per prototype L252 (RBAR-74): sheetIn .26s on the spring
           curve. Split like the keypad sheet for reduced motion: everyone gets the
           fade (opacity is not motion), only a no-preference lifter gets the rise. */
        .panel {
          width: 100%; max-width: 520px;
          background: var(--rack-overlay);
          border-top: 1px solid var(--rack-border-strong);
          border-radius: var(--rack-radius-sheet) var(--rack-radius-sheet) 0 0;
          padding: 18px 20px calc(26px + env(safe-area-inset-bottom));
          box-shadow: var(--rack-shadow-setup);
          animation: rack-fade .26s cubic-bezier(.2, .85, .25, 1);
        }
        @media (prefers-reduced-motion: no-preference) {
          .panel { animation: rack-rise .26s cubic-bezier(.2, .85, .25, 1); }
        }
        .head {
          display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 18px;
        }
        /* An h2 since RBAR-53 (heading navigation); as a flex item its display was
           already blockified, margin pinned over the UA heading default. Hanken 800
           17px -.01em (prototype L254). */
        .head .title {
          font-size: 17px; font-weight: 800; letter-spacing: -.01em;
          color: var(--rack-fg); margin: 0;
        }
        /* Done: Hanken 700 12px on a 7px 17px pad (prototype L255). The 36px floor
           keeps the touch target the header's Setup pill has. */
        .done {
          font: inherit; font-size: 12px; font-weight: 700;
          color: var(--rack-bg); background: var(--rack-accent);
          border: none; border-radius: 999px; padding: 7px 17px;
          min-height: 36px; cursor: pointer;
        }
        .done:focus-visible { outline: 2px solid var(--rack-accent); outline-offset: 2px; }
        /* h3s under the sheet's h2 title since RBAR-53; margin pinned over the UA
           heading default. */
        .section-label {
          display: block; ${SECTION_LABEL} margin: 0 0 9px;
        }
        /* Each selector row; the trailing margin separates a section from the next
           section-label (the last section -- the plate rows -- sits flush on the
           panel's bottom pad). */
        .tiles { display: flex; gap: 8px; margin-bottom: 20px; }
        /* A selector tile: kg/lb headline + subtitle. Active = a raised, outlined fill;
           inactive = transparent with a hairline. 44px+ tall touch target. */
        .tile {
          flex: 1; min-height: 56px;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 2px; padding: 9px 4px; cursor: pointer;
          background: transparent; color: var(--rack-fg);
          border: 1px solid var(--rack-line); border-radius: var(--rack-radius-tile);
        }
        .tile[aria-pressed="true"] {
          background: var(--rack-selected); border-color: var(--rack-border-active);
        }
        .tile:focus-visible { outline: 2px solid var(--rack-accent); outline-offset: 2px; }
        /* The tile labels (handoff ConfigSheet; RBAR-29 fold, RBAR-39): a named
           headline over a mono sub; the ink brightens on the selected tile (the
           prototype dims an unselected tile's whole label). Bar and Collar tiles
           share the pattern -- prototype L863 sets the Bar headline in the same
           Hanken 700 14px the Collar words carry. The font-family is explicit:
           buttons do not inherit the document font. */
        .tile .word {
          font-family: var(--rack-font); font-size: 14px; font-weight: 700;
          line-height: 1; color: var(--rack-text-dim);
        }
        .tile .csub {
          font-family: var(--rack-font-num); font-size: 11px; font-weight: 600;
          letter-spacing: .04em; margin-top: 1px; color: var(--rack-text-dim);
        }
        .tile[aria-pressed="true"] .word { color: var(--rack-text); }
        .tile[aria-pressed="true"] .csub { color: var(--rack-text-muted); }
        .sr { ${VISUALLY_HIDDEN} }
        /* RBAR-76 (ADR-0017): the Bar label row carries the entry's hint at its right,
           so the "+" entry adds no height (ADR-0013). */
        .label-row {
          display: flex; align-items: baseline; justify-content: space-between;
          gap: 8px; margin: 0 0 9px;
        }
        .label-row .section-label { margin: 0; }
        .hint {
          font-family: var(--rack-font-num); font-size: 11px; font-weight: 600;
          letter-spacing: .04em; color: var(--rack-text-dim);
          min-width: 0; text-align: right;
        }
        .hint.bad { color: var(--rack-danger); }
        /* The Bar row: custom Bars and "+" join the set's own, so the row scrolls
           sideways inside the sheet rather than wrap into a taller sheet (ADR-0013).
           The pad + negative margin keep the 2px focus ring clear of the clip. The
           Remove menu anchors to this wrapper, outside the scroller. */
        .bar-row { position: relative; margin-bottom: 20px; }
        .bar-tiles {
          margin: -4px; padding: 4px; overflow-x: auto;
          scrollbar-width: none; -webkit-overflow-scrolling: touch;
        }
        .bar-tiles::-webkit-scrollbar { display: none; }
        .bar-tiles .tile {
          flex: 1 0 72px; position: relative; isolation: isolate; overflow: hidden;
          white-space: nowrap;
          -webkit-touch-callout: none; -webkit-user-select: none; user-select: none;
        }
        /* "+": a narrow dashed tile at the row's end. */
        .bar-tiles .tile.add {
          flex: 0 0 48px; border-style: dashed; color: var(--rack-text-dim);
        }
        .tile.add svg { display: block; }
        /* The press-and-hold wash on a custom tile (the RBAR-73 chip fill). */
        .tile[data-custom]::before {
          content: ''; position: absolute; inset: 0; z-index: -1;
          background: color-mix(in srgb, var(--rack-accent) 22%, transparent);
          transform: scaleX(0); transform-origin: left center;
        }
        .tile[data-custom].holding { border-color: var(--rack-border-active); }
        .tile[data-custom].holding::before {
          transform: scaleX(1); transition: transform ${LONG_PRESS_MS}ms linear;
        }
        @media (prefers-reduced-motion: reduce) {
          .tile[data-custom]::before { transform: none; opacity: 0; }
          .tile[data-custom].holding::before {
            opacity: 1; transition: opacity ${LONG_PRESS_MS}ms linear;
          }
        }
        /* The Undo tile holds the removed Bar's slot, in the accent (RBAR-73). */
        .tile.undo {
          font-family: var(--rack-font); font-size: 13px; font-weight: 700;
          color: var(--rack-accent);
          border-color: color-mix(in srgb, var(--rack-accent) 55%, transparent);
          background: color-mix(in srgb, var(--rack-accent) 10%, transparent);
        }
        /* The "+" entry: weight, kg|lb, Add, cancel -- one row, the tiles' height. */
        .bar-form {
          flex: 1; min-width: 0;
          display: flex; align-items: center; gap: 8px; min-height: 56px; margin: 0;
        }
        .bar-input {
          flex: 1; min-width: 0; height: 44px; padding: 0 12px;
          font-family: var(--rack-font-num); font-size: 16px; font-weight: 600;
          color: var(--rack-text); background: transparent;
          border: 1px solid var(--rack-line); border-radius: var(--rack-radius-tile);
        }
        .bar-input:focus { outline: 2px solid var(--rack-accent); outline-offset: 1px; }
        .bar-input[aria-invalid="true"] { border-color: var(--rack-danger); }
        .seg {
          display: flex; flex: none; padding: 2px;
          border: 1px solid var(--rack-line); border-radius: 999px;
        }
        .seg button {
          min-width: 40px; min-height: 40px; padding: 0 8px; cursor: pointer;
          font-family: var(--rack-font-num); font-size: 12px; font-weight: 600;
          color: var(--rack-text-dim); background: transparent;
          border: none; border-radius: 999px;
        }
        .seg button[aria-pressed="true"] { background: var(--rack-selected); color: var(--rack-text); }
        .seg button:focus-visible { outline: 2px solid var(--rack-accent); outline-offset: 1px; }
        .add-go {
          flex: none; min-height: 44px; padding: 0 16px; cursor: pointer;
          font-family: var(--rack-font); font-size: 13px; font-weight: 700;
          color: var(--rack-bg); background: var(--rack-accent);
          border: none; border-radius: 999px;
        }
        .add-cancel {
          flex: none; display: flex; align-items: center; justify-content: center;
          width: 44px; height: 44px; padding: 0; cursor: pointer;
          color: var(--rack-text-dim); background: transparent; border: none;
          border-radius: 999px;
        }
        .add-go:focus-visible, .add-cancel:focus-visible {
          outline: 2px solid var(--rack-accent); outline-offset: 2px;
        }
        /* The Remove menu: the Recents popover's card (RBAR-73), above the pressed tile. */
        .menu {
          position: absolute; bottom: calc(100% + 2px); left: 50%; z-index: 30;
          transform: translateX(-50%); padding: 4px;
          background: var(--rack-overlay);
          border: 1px solid var(--rack-popover-border);
          border-radius: var(--rack-radius-sheet-control);
          box-shadow: var(--rack-shadow-modal);
        }
        .menu[hidden] { display: none; }
        .menu button {
          display: flex; align-items: center; gap: 8px;
          min-height: 44px; padding: 0 16px; cursor: pointer;
          font-family: var(--rack-font); font-size: 13px; font-weight: 600;
          color: var(--rack-danger); background: transparent; border: none;
          border-radius: calc(var(--rack-radius-sheet-control) - 4px);
          white-space: nowrap;
        }
        .menu button:hover { background: var(--rack-active); }
        .menu button:focus-visible { outline: 2px solid var(--rack-accent); outline-offset: -2px; }
        .menu svg { display: block; }
        /* The plate-set rows (RBAR-29, handoff section 6): stacked full-width rows,
           each swatch cluster + name/sub + check, unlike the side-by-side tiles above.
           Selected = the active-row fill + active border ring (prototype tiers). */
        .rows { display: flex; flex-direction: column; gap: 8px; }
        .row {
          display: flex; align-items: center; width: 100%; min-height: 56px;
          padding: 11px 13px; cursor: pointer;
          background: transparent; color: var(--rack-text);
          border: 1px solid var(--rack-border); border-radius: var(--rack-radius-card);
        }
        .row[aria-pressed="true"] {
          background: var(--rack-active); border-color: var(--rack-border-active);
        }
        .row:focus-visible { outline: 2px solid var(--rack-accent); outline-offset: 2px; }
        .swatches { display: flex; align-items: center; gap: 4px; }
        .swatch {
          display: block; width: 14px; height: 14px; border-radius: 4px;
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .14);
        }
        .names {
          display: flex; flex-direction: column; align-items: flex-start;
          flex: 1; margin-left: 12px; gap: 1px;
        }
        .name { font-size: 14px; font-weight: 700; color: var(--rack-text); }
        .row .sub { font-size: 12px; font-weight: 500; color: var(--rack-text-dim); }
        .check { color: var(--rack-accent); opacity: 0; }
        .row[aria-pressed="true"] .check { opacity: 1; }
      </style>
      <div class="scrim" data-scrim>
        <div class="panel" data-panel role="dialog" aria-modal="true" aria-labelledby="setup-heading">
          <div class="head">
            <h2 class="title" id="setup-heading">Setup</h2>
            <button type="button" class="done" data-done>Done</button>
          </div>
          <div class="label-row">
            <h3 class="section-label">Bar</h3>
            <span class="hint" id="bar-hint" data-bar-hint aria-live="polite"></span>
          </div>
          <div class="bar-row">
            <div class="tiles bar-tiles" data-bar-tiles></div>
            <div class="menu" data-bar-menu role="menu" hidden>
              <button type="button" role="menuitem" data-bar-menu-remove
                ><svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"
                        stroke="currentColor" stroke-width="1.5"
                        stroke-linecap="round" stroke-linejoin="round"></path>
                </svg>Remove</button>
            </div>
          </div>
          <span class="sr" id="${REMOVE_HINT_ID}">Press and hold, or press Delete, to remove.</span>
          <div class="sr" data-bar-announce role="status"></div>
          <h3 class="section-label">Collars</h3>
          <div class="tiles">${collarTiles}</div>
          <h3 class="section-label">Plates</h3>
          <div class="rows" data-plateset-tiles></div>
        </div>
      </div>
    `;

    this.barTilesEl = this.root.querySelector('[data-bar-tiles]')!;
    this.platesetTilesEl = this.root.querySelector('[data-plateset-tiles]')!;
    this.collarTiles = this.root.querySelectorAll<HTMLButtonElement>('[data-collar]');
    this.menuEl = this.root.querySelector('[data-bar-menu]')!;
    this.barHintEl = this.root.querySelector('[data-bar-hint]')!;
    this.wireBarRow();

    // A scrim tap dismisses; a tap inside the panel must not (it would bubble to the
    // scrim otherwise), so the panel stops it.
    this.root.querySelector('[data-scrim]')!.addEventListener('click', () => this.close());
    this.root
      .querySelector('[data-panel]')!
      .addEventListener('click', (e) => e.stopPropagation());
    this.root.querySelector('[data-done]')!.addEventListener('click', () => this.close());
    this.collarTiles.forEach((t) =>
      t.addEventListener('click', () => this.chooseCollar(Number(t.dataset.collar))),
    );

    this.renderBarTiles();
    this.renderPlatesetTiles();
    this.syncCollarTiles();
  }

  // Render the Bar tiles for the active plate set's Bars (ADR-0010). The headline reads
  // in the Bar's own stamped Unit (RBAR-63: "45 lb", "20 kg" on Training), the subtitle
  // in the other Unit. data-bar carries the canonical kg, so the app validates and
  // reflects against the same value. The labels reuse the Collar tiles' word/csub
  // treatment (RBAR-39, prototype L863): Hanken 700 14px headline, dimming with the
  // tile like the Collars do.
  //
  // RBAR-76: the custom Bars follow the set's own (barsFor drops one that weighs what a
  // set Bar weighs), each labelled by its stamp as typed and carrying `data-custom` (its
  // list index); a pending removal's Undo tile sits in the removed Bar's slot; "+" ends
  // the row while there is room and no Undo is pending. While the entry is open the row
  // holds the entry form instead. Clicks and the long-press are delegated (wireBarRow).
  private renderBarTiles(): void {
    this.closeMenu(false);
    this.barHintEl.textContent = '';
    this.barHintEl.classList.remove('bad');
    if (this.adding) {
      this.renderAddForm();
      return;
    }
    const set = plateSetFor(this._plateSetKey);
    const own = set.bars.map((b) => b.kg);
    const items = set.bars.map((b) => this.barTile(b, -1));
    const undo = this.pending
      ? `
        <button type="button" class="tile undo" data-bar-undo
                aria-label="Undo remove ${stampLabel(this.pending.stamp)} Bar">Undo</button>`
      : '';
    this._customBars.forEach((s, i) => {
      if (this.pending?.index === i) items.push(undo);
      // A custom Bar weighing what a set Bar weighs is that tile already (as barsFor).
      const bar = stampBar(s);
      if (!own.includes(bar.kg)) items.push(this.barTile(bar, i));
    });
    if (this.pending && this.pending.index >= this._customBars.length) items.push(undo);
    // "+" counts the custom tiles THIS set shows: a custom Bar weighing what a set Bar
    // weighs has no tile here, so it takes no slot here (ADR-0017).
    const shownCustoms = this._customBars.filter((s) => !own.includes(stampKg(s))).length;
    if (!this.pending && shownCustoms < MAX_CUSTOM_BARS) {
      items.push(`
        <button type="button" class="tile add" data-bar-add aria-label="Add a Bar">${PLUS_SVG}</button>`);
    }
    // An echoed list (the app's answer to a removal) rebuilds the row; keyboard focus on
    // the Undo tile must survive that rebuild.
    const undoFocused =
      this.pending !== null &&
      (this.root.activeElement as HTMLElement | null)?.hasAttribute('data-bar-undo');
    this.barTilesEl.innerHTML = items.join('');
    this.tiles = this.barTilesEl.querySelectorAll<HTMLButtonElement>('[data-bar]');
    this.syncTiles();
    if (undoFocused) this.barTilesEl.querySelector<HTMLButtonElement>('[data-bar-undo]')?.focus();
  }

  // One Bar tile: the headline in the Bar's stamp (a custom Bar's as typed), the
  // subtitle in the other Unit. `custom` is the custom list index, or -1 for a set Bar.
  private barTile(bar: Bar, custom: number): string {
    const other: Unit = bar.unit === 'kg' ? 'lb' : 'kg';
    const name = barLabel(bar);
    const mine =
      custom >= 0
        ? ` data-custom="${custom}" aria-describedby="${REMOVE_HINT_ID}" aria-keyshortcuts="Delete"`
        : '';
    return `
        <button type="button" class="tile" data-bar="${bar.kg}"${mine} aria-pressed="false"
                aria-label="${name} Bar (${format(bar.kg, other)})${custom >= 0 ? ', custom' : ''}">
          <span class="word">${name}</span>
          <span class="csub">${format(bar.kg, other)}</span>
        </button>`;
  }

  // The "+" entry, in place of the tiles: the weight as stamped, its Unit, Add, cancel.
  // A form, so Enter (or the keyboard's Done) submits.
  private renderAddForm(): void {
    this.barTilesEl.innerHTML = `
        <form class="bar-form" data-bar-form novalidate>
          <input class="bar-input" data-bar-input type="text" inputmode="decimal"
                 autocomplete="off" enterkeyhint="done" maxlength="6"
                 aria-label="Bar weight, as stamped" aria-describedby="bar-hint">
          <div class="seg" role="group" aria-label="Stamped in">
            <button type="button" data-bar-unit="kg">kg</button>
            <button type="button" data-bar-unit="lb">lb</button>
          </div>
          <button type="submit" class="add-go" data-bar-save>Add</button>
          <button type="button" class="add-cancel" data-bar-cancel aria-label="Cancel">${CROSS_SVG}</button>
        </form>`;
    this.tiles = this.barTilesEl.querySelectorAll<HTMLButtonElement>('[data-bar]');
    this.syncAddUnit();
    const form = this.barTilesEl.querySelector('form')!;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submitAdd();
    });
    this.barTilesEl.querySelector<HTMLInputElement>('[data-bar-input]')!.focus();
  }

  // Reflect the entry's Unit on the kg|lb buttons and the hint (clearing a stale error).
  private syncAddUnit(): void {
    this.barTilesEl.querySelectorAll<HTMLButtonElement>('[data-bar-unit]').forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.barUnit === this.addUnit)),
    );
    this.barTilesEl.querySelector('[data-bar-input]')?.removeAttribute('aria-invalid');
    this.barHintEl.classList.remove('bad');
    this.barHintEl.textContent = `Up to ${CUSTOM_BAR_MAX[this.addUnit]} ${this.addUnit}`;
  }

  private openAdd(): void {
    this.cancelHold();
    this.clearPending();
    this.adding = true;
    this.addUnit = plateSetFor(this._plateSetKey).unit;
    this.renderBarTiles();
  }

  // Leave the entry without adding; focus returns to "+".
  private cancelAdd(): void {
    this.adding = false;
    this.renderBarTiles();
    this.barTilesEl.querySelector<HTMLButtonElement>('[data-bar-add]')?.focus();
  }

  // Read the typed weight in the chosen Unit. A valid stamp goes up as `baradd` (the app
  // adds and selects it, echoing the list and Bar back) and the tiles return, focused on
  // the chosen one; anything else flags the field and says the range.
  private submitAdd(): void {
    const field = this.barTilesEl.querySelector<HTMLInputElement>('[data-bar-input]')!;
    const read = readStamp(field.value, this.addUnit);
    if ('error' in read) return this.refuseAdd(field, this.stampErrorText(read.error));
    const stamp = read.stamp;
    // A Bar the set offers, or a custom Bar of that weight, is simply selected (the app
    // decides). A new one must leave every set at 3 custom tiles or fewer; if it would
    // not, say which set is full -- its tiles are only removable there.
    const kg = stampKg(stamp);
    const known =
      plateSetFor(this._plateSetKey).bars.some((b) => b.kg === kg) ||
      this._customBars.some((b) => stampKg(b) === kg);
    const full = known ? null : addRefusal(this._customBars, stamp);
    if (full !== null) {
      return this.refuseAdd(
        field,
        `${PLATE_SETS[full].shortLabel} has ${MAX_CUSTOM_BARS} custom Bars: remove one there`,
      );
    }
    this.adding = false;
    this.renderBarTiles();
    this.emit('baradd', { value: stamp.value, unit: stamp.unit });
    this.barTilesEl.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
  }

  // Flag the entry and say why it was not added; focus stays in the field.
  private refuseAdd(field: HTMLInputElement, why: string): void {
    field.setAttribute('aria-invalid', 'true');
    this.barHintEl.classList.add('bad');
    this.barHintEl.textContent = why;
    field.focus();
  }

  // The hint for each way typed text fails to be a stamp (lib/custombars readStamp).
  private stampErrorText(error: StampError): string {
    if (error === 'decimals') return 'Up to 2 decimals';
    if (error === 'range') return `Enter 0.01 to ${CUSTOM_BAR_MAX[this.addUnit]} ${this.addUnit}`;
    return 'Enter a number, like 15 or 15.5';
  }

  // The Bar row's delegated listeners (the row outlives every re-render): tile taps,
  // "+", Undo, the entry's buttons and keys, and the custom tiles' long-press, context
  // menu and Delete -- the RBAR-73 gesture set, with the same timings.
  private wireBarRow(): void {
    const el = this.barTilesEl;
    const at = (e: Event, sel: string) =>
      (e.target as Element | null)?.closest?.<HTMLElement>(sel) ?? null;

    el.addEventListener('click', (e) => {
      if (at(e, '[data-bar-add]')) return this.openAdd();
      if (at(e, '[data-bar-undo]')) return this.restoreCustom();
      if (at(e, '[data-bar-cancel]')) return this.cancelAdd();
      const unit = at(e, '[data-bar-unit]');
      if (unit) {
        this.addUnit = unit.dataset.barUnit === 'lb' ? 'lb' : 'kg';
        this.syncAddUnit();
        return;
      }
      const t = at(e, '[data-bar]');
      if (!t) return;
      if (this.suppressClick) {
        this.suppressClick = false; // the release of a long-press, not a tap
        return;
      }
      this.choose(Number(t.dataset.bar));
    });

    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.adding) {
        e.preventDefault();
        e.stopPropagation();
        this.cancelAdd();
        return;
      }
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = at(e, '[data-custom]');
      if (!t) return;
      e.preventDefault();
      if (!e.repeat) this.removeCustom(Number(t.dataset.custom));
    });

    el.addEventListener('pointerdown', (e) => {
      this.suppressClick = false;
      const t = at(e, '[data-custom]') as HTMLButtonElement | null;
      if (!t || e.button !== 0) return;
      this.cancelHold();
      t.classList.add('holding');
      this.hold = {
        tile: t,
        x: e.clientX,
        y: e.clientY,
        fire: setTimeout(() => {
          this.cancelHold();
          this.suppressClick = true;
          this.openMenu(t);
        }, LONG_PRESS_MS),
      };
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.hold) return;
      const { x, y } = this.hold;
      if (Math.abs(e.clientX - x) > MOVE_SLOP_PX || Math.abs(e.clientY - y) > MOVE_SLOP_PX) {
        this.cancelHold();
      }
    });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
      el.addEventListener(type, () => this.cancelHold());
    }
    // iOS may send no click after a long hold; drop the swallow flag after this task so
    // it cannot eat the next keyboard activation (as rack-recents).
    el.addEventListener('pointerup', () => {
      if (this.suppressClick) setTimeout(() => (this.suppressClick = false), 0);
    });
    el.addEventListener('scroll', () => this.cancelHold(), { passive: true });
    el.addEventListener('contextmenu', (e) => {
      const t = at(e, '[data-custom]') as HTMLButtonElement | null;
      if (!t) return;
      e.preventDefault();
      if (this.hold) {
        this.cancelHold();
        this.suppressClick = true;
      }
      this.openMenu(t);
    });

    this.root.querySelector('[data-bar-menu-remove]')!.addEventListener('click', () => {
      const i = this.menuFor;
      if (i === null) return;
      this.closeMenu(false);
      this.removeCustom(i);
    });
    this.menuEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.closeMenu(true);
      }
    });
    this.menuEl.addEventListener('focusout', (e) => {
      const next = (e as FocusEvent).relatedTarget;
      if (next instanceof Node && !this.menuEl.contains(next)) this.closeMenu(false);
    });
  }

  private cancelHold(): void {
    if (!this.hold) return;
    clearTimeout(this.hold.fire);
    this.hold.tile.classList.remove('holding');
    this.hold = null;
  }

  // Open the Remove menu over a custom tile (centred on it, kept inside the row) and
  // focus Remove.
  private openMenu(t: HTMLButtonElement): void {
    const i = Number(t.dataset.custom);
    const stamp = this._customBars[i];
    if (!stamp) return;
    this.menuFor = i;
    this.menuEl.setAttribute('aria-label', `${stampLabel(stamp)} Bar`);
    this.menuEl.hidden = false;
    const host = this.menuEl.parentElement!.getBoundingClientRect();
    const c = t.getBoundingClientRect();
    const half = this.menuEl.offsetWidth / 2;
    const centre = c.left + c.width / 2 - host.left;
    const left = Math.min(Math.max(centre, half), Math.max(half, host.width - half));
    this.menuEl.style.left = `${left}px`;
    this.root.querySelector<HTMLButtonElement>('[data-bar-menu-remove]')!.focus();
    document.addEventListener('pointerdown', this.onDocPointer, true);
  }

  private closeMenu(refocus: boolean): void {
    if (this.menuFor === null) return;
    const i = this.menuFor;
    this.menuFor = null;
    this.suppressClick = false;
    this.menuEl.hidden = true;
    document.removeEventListener('pointerdown', this.onDocPointer, true);
    if (refocus) {
      this.barTilesEl.querySelector<HTMLButtonElement>(`[data-custom="${i}"]`)?.focus();
    }
  }

  // Remove custom Bar `i`: an earlier pending Undo ends (that removal is final), the
  // intent goes up as `barremove` (the app drops it, falls back to the set's default
  // Bar if it was chosen, and echoes the list), and the slot shows Undo, focused, for
  // UNDO_MS.
  private removeCustom(i: number): void {
    const stamp = this._customBars[i];
    if (!stamp) return;
    this.clearPending();
    this.pending = { stamp, index: i, select: this._barKg === stampKg(stamp) };
    // When the window lapses the Undo tile goes; if it had focus, focus moves to the
    // custom tile now in that slot, else "+" -- never out of the dialog (WCAG 2.4.3; as
    // rack-recents' finishCollapse).
    this.undoTimer = setTimeout(() => {
      const onUndo = (this.root.activeElement as HTMLElement | null)?.hasAttribute(
        'data-bar-undo',
      );
      this.clearPending();
      this.renderBarTiles();
      if (!onUndo) return;
      const customs = this.barTilesEl.querySelectorAll<HTMLButtonElement>('[data-custom]');
      const next =
        [...customs].find((t) => Number(t.dataset.custom) >= i) ??
        this.barTilesEl.querySelector<HTMLButtonElement>('[data-bar-add]') ??
        customs[customs.length - 1] ??
        this.barTilesEl.querySelector<HTMLButtonElement>('[data-bar]');
      next?.focus();
    }, UNDO_MS);
    this.emit('barremove', { index: i });
    this.renderBarTiles();
    this.barTilesEl.querySelector<HTMLButtonElement>('[data-bar-undo]')?.focus();
    this.announce(`Removed ${stampLabel(stamp)} Bar`);
  }

  // Undo the pending removal: the Bar goes back at its index (and is chosen again if it
  // was the chosen Bar); the app echoes the list.
  private restoreCustom(): void {
    const p = this.pending;
    if (!p) return;
    this.clearPending();
    this.emit('barrestore', { ...p.stamp, index: p.index, select: p.select });
    this.renderBarTiles();
    this.barTilesEl.querySelector<HTMLButtonElement>(`[data-custom="${p.index}"]`)?.focus();
    this.announce(`Restored ${stampLabel(p.stamp)} Bar`);
  }

  private clearPending(): void {
    clearTimeout(this.undoTimer);
    this.undoTimer = undefined;
    this.pending = null;
  }

  private announce(text: string): void {
    this.root.querySelector('[data-bar-announce]')!.textContent = text;
  }

  private emit(type: string, detail: object): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  // Render the plate-set rows (Competition / Training): swatch cluster + name +
  // family/Unit sub + selected check (RBAR-29, handoff section 6). The swatches and
  // check are decorative (aria-hidden); the row's aria-label announces the set + Unit
  // and aria-pressed carries the selected state.
  private renderPlatesetTiles(): void {
    this.platesetTilesEl.innerHTML = PLATE_SET_KEYS.map(
      (key) => `
        <button type="button" class="row" data-plateset="${key}" aria-pressed="false"
                aria-label="${PLATE_SETS[key].label} plates (${PLATE_SET_SUB[key]})">
          <span class="swatches" aria-hidden="true">${PLATE_SET_SWATCHES[key]
            .map((fill) => `<span class="swatch" style="background:${fill}"></span>`)
            .join('')}</span>
          <span class="names">
            <span class="name">${PLATE_SETS[key].label}</span>
            <span class="sub">${PLATE_SET_SUB[key]}</span>
          </span>
          ${CHECK_SVG}
        </button>`,
    ).join('');
    this.platesetTiles =
      this.platesetTilesEl.querySelectorAll<HTMLButtonElement>('[data-plateset]');
    this.platesetTiles.forEach((t) =>
      t.addEventListener('click', () => this.choosePlateset(t.dataset.plateset!)),
    );
    this.syncPlatesetTiles();
  }

  // A tile tap names the chosen Bar to the shell; the shell owns the value and sets
  // `barKg` back, which re-syncs the active tile.
  private choose(kg: number): void {
    this.dispatchEvent(
      new CustomEvent<{ barKg: number }>('barchange', {
        detail: { barKg: kg },
        bubbles: true,
        composed: true,
      }),
    );
  }

  // A Collar tile tap names the chosen Collar to the shell -- same one-event-up contract
  // as the Bar (ADR-0007); the shell owns the value and feeds `collarKg` back.
  private chooseCollar(kg: number): void {
    this.dispatchEvent(
      new CustomEvent<{ collarKg: number }>('collarchange', {
        detail: { collarKg: kg },
        bubbles: true,
        composed: true,
      }),
    );
  }

  // A plate-set tile tap names the chosen set to the shell -- same contract (ADR-0010);
  // the shell owns the value, swaps the Bar to the set's default, and feeds it all back.
  private choosePlateset(key: string): void {
    this.dispatchEvent(
      new CustomEvent<{ plateSet: string }>('platesetchange', {
        detail: { plateSet: key },
        bubbles: true,
        composed: true,
      }),
    );
  }

  // Mark the tile matching the current Bar as pressed; the rest released.
  private syncTiles(): void {
    this.tiles.forEach((t) =>
      t.setAttribute('aria-pressed', String(Number(t.dataset.bar) === this._barKg)),
    );
  }

  // Mark the tile matching the current Collar as pressed; the rest released.
  private syncCollarTiles(): void {
    this.collarTiles.forEach((t) =>
      t.setAttribute(
        'aria-pressed',
        String(Number(t.dataset.collar) === this._collarKg),
      ),
    );
  }

  // Mark the row matching the current plate set as pressed; the rest released.
  private syncPlatesetTiles(): void {
    this.platesetTiles.forEach((t) =>
      t.setAttribute('aria-pressed', String(t.dataset.plateset === this._plateSetKey)),
    );
  }
}

customElements.define('rack-setup', RackSetup);
