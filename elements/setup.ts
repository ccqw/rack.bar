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
import { DEFAULT_BAR_KG } from '../lib/plates.ts';
import { shownIn, format } from '../lib/units.ts';
import {
  PLATE_SETS,
  PLATE_SET_KEYS,
  plateSetFor,
  isOfferedPlateSet,
} from '../lib/platesets.ts';
import type { PlateSetKey } from '../lib/platesets.ts';
import { BUTTON_FX } from './buttonfx.ts';

// The Competition Bar weights, heaviest-first (men's / women's / technique). The other
// sets carry their own Bars (ADR-0010, lib/platesets); these stay exported as the
// Competition source of truth and for the existing app validation path.
export const BAR_OPTIONS = [20, 15, 5] as const;

/** A Competition Bar the lifter can pick. */
export type BarKg = (typeof BAR_OPTIONS)[number];

/** True when `kg` is one of the Competition Bars. */
export function isOfferedBar(kg: number): kg is BarKg {
  return (BAR_OPTIONS as readonly number[]).includes(kg);
}

// The Collars offered: None (0 kg) or a Standard competition collar (2.5 kg per Side,
// CONTEXT.md). The per-Side weight is the value here; the Total adds it twice (ADR-0008,
// barWithCollars). Exported as the source of truth for "a valid Collar", validated the
// same way as the Bar at both shell boundaries (ADR-0007). Default is None.
export const COLLAR_OPTIONS = [0, 2.5] as const;

/** The default Collar: None. The bare Bar with no clamp weight. (Left as a bare literal to
 * mirror DEFAULT_BAR_KG, which can't be CollarKg-typed without the core importing the
 * shell -- ADR-0001; the offered-set guard runs at the shell boundary instead.) */
export const DEFAULT_COLLAR_KG = 0;

/** A Collar the lifter can actually pick: one of the offered Collars. */
export type CollarKg = (typeof COLLAR_OPTIONS)[number];

/** True when `kg` is one of the offered Collars -- the guard both boundaries share. */
export function isOfferedCollar(kg: number): kg is CollarKg {
  return (COLLAR_OPTIONS as readonly number[]).includes(kg);
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
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  connectedCallback(): void {
    this.hidden = true; // a sheet is closed until opened

    // The Collar tiles: None (no weight) or a Standard 2.5 kg-per-Side competition
    // collar. None shows a plain label; the Standard tile reads its per-Side weight with
    // a "per side" subtitle (the Total adds it twice -- ADR-0008).
    const collarTiles = COLLAR_OPTIONS.map((kg) =>
      kg === 0
        ? `
        <button type="button" class="tile" data-collar="0" aria-pressed="false"
                aria-label="No collars">
          <span class="kg">None</span>
        </button>`
        : `
        <button type="button" class="tile" data-collar="${kg}" aria-pressed="false"
                aria-label="Standard ${kg} kg collars, per Side">
          <span class="kg">${kg}<span class="u">kg</span></span>
          <span class="sub">per side</span>
        </button>`,
    ).join('');

    this.root.innerHTML = `
      <style>
        ${BUTTON_FX}
        :host { display: block; }
        :host([hidden]) { display: none; }
        @keyframes rack-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes rack-rise {
          from { transform: translateY(100%); } to { transform: translateY(0); }
        }
        /* The dim backdrop: covers the viewport, taps through to close. */
        .scrim {
          position: fixed; inset: 0; z-index: 50;
          background: var(--rack-scrim);
          display: flex; align-items: flex-end; justify-content: center;
          animation: rack-fade .16s ease-out;
        }
        /* The sheet itself rises from the bottom edge; safe-area pad keeps the Done
           button and tiles clear of the home indicator (RBAR-15 mobile fit). */
        .panel {
          width: 100%; max-width: 520px;
          background: var(--rack-overlay);
          border-top: 1px solid var(--rack-line-strong);
          border-radius: var(--rack-radius-sheet) var(--rack-radius-sheet) 0 0;
          padding: 18px 20px calc(20px + env(safe-area-inset-bottom));
          box-shadow: 0 -20px 50px -20px rgba(0, 0, 0, .7);
          animation: rack-rise .2s cubic-bezier(.2, .85, .25, 1);
        }
        .head {
          display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 16px;
        }
        .head .title { font-size: 17px; font-weight: 700; color: var(--rack-fg); }
        .done {
          font: inherit; font-size: 14px; font-weight: 700;
          color: var(--rack-bg); background: var(--rack-accent);
          border: none; border-radius: 999px; padding: 8px 18px;
          min-height: 36px; cursor: pointer;
        }
        .done:focus-visible { outline: 2px solid var(--rack-accent); outline-offset: 2px; }
        .section-label {
          display: block;
          font-family: var(--rack-font-num); font-size: 11px; font-weight: 600;
          letter-spacing: .12em; text-transform: uppercase; color: var(--rack-muted);
          margin-bottom: 8px;
        }
        /* Each selector row; the trailing margin separates a section from the next
           section-label (the last section -- the plate rows -- sits flush on the
           panel's bottom pad). */
        .tiles { display: flex; gap: 8px; margin-bottom: 18px; }
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
          background: var(--rack-selected); border-color: var(--rack-line-strong);
        }
        .tile:focus-visible { outline: 2px solid var(--rack-accent); outline-offset: 2px; }
        .tile .kg {
          font-family: var(--rack-font-num); font-size: 20px; font-weight: 700;
          display: inline-flex; align-items: baseline; gap: 2px;
        }
        .tile .u { font-size: 11px; font-weight: 600; color: var(--rack-muted); }
        .tile .sub {
          font-family: var(--rack-font-num); font-size: 12px; color: var(--rack-muted);
        }
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
        <div class="panel" data-panel role="dialog" aria-modal="true" aria-label="Setup">
          <div class="head">
            <span class="title">Setup</span>
            <button type="button" class="done" data-done>Done</button>
          </div>
          <span class="section-label">Bar</span>
          <div class="tiles" data-bar-tiles></div>
          <span class="section-label">Collars</span>
          <div class="tiles">${collarTiles}</div>
          <span class="section-label">Plates</span>
          <div class="rows" data-plateset-tiles></div>
        </div>
      </div>
    `;

    this.barTilesEl = this.root.querySelector('[data-bar-tiles]')!;
    this.platesetTilesEl = this.root.querySelector('[data-plateset-tiles]')!;
    this.collarTiles = this.root.querySelectorAll<HTMLButtonElement>('[data-collar]');

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
  // in the set's native Unit, the subtitle in the other Unit. data-bar carries the
  // canonical kg, so the app validates and reflects against the same value.
  private renderBarTiles(): void {
    const set = plateSetFor(this._plateSetKey);
    const other = set.unit === 'kg' ? 'lb' : 'kg';
    this.barTilesEl.innerHTML = set.bars
      .map(
        (kg) => `
        <button type="button" class="tile" data-bar="${kg}" aria-pressed="false"
                aria-label="${format(kg, set.unit)} Bar (${format(kg, other)})">
          <span class="kg">${shownIn(kg, set.unit)}<span class="u">${set.unit}</span></span>
          <span class="sub">${format(kg, other)}</span>
        </button>`,
      )
      .join('');
    this.tiles = this.barTilesEl.querySelectorAll<HTMLButtonElement>('[data-bar]');
    this.tiles.forEach((t) =>
      t.addEventListener('click', () => this.choose(Number(t.dataset.bar))),
    );
    this.syncTiles();
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

  // Mark the tile matching the current plate set as pressed; the rest released.
  private syncPlatesetTiles(): void {
    this.platesetTiles.forEach((t) =>
      t.setAttribute('aria-pressed', String(t.dataset.plateset === this._plateSetKey)),
    );
  }
}

customElements.define('rack-setup', RackSetup);
