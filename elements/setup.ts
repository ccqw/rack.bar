// <rack-setup> -- the Setup bottom sheet (RBAR-15, ADR-0007). The host for all rig
// configuration: RBAR-15 fills its Bar section (three tiles, 20/15/5 kg), and later
// slices add Collars (RBAR-16) and the plate set (RBAR-17) as further sections.
//
// A controlled, near-stateless shell (ADR-0001): it holds no canonical config of its
// own. It reflects the current Bar onto the active tile via the `barKg` property and
// emits `barchange` when a tile is tapped; the app shell (<rack-app>) owns the value,
// applies it, and feeds it back. open()/close() drive visibility; a scrim tap or the
// Done button closes and emits `close`. A tap inside the panel does not dismiss.
import { DEFAULT_BAR_KG } from '../lib/plates.ts';

// The Bar weights offered, heaviest-first (men's / women's / technique). A fixed enum
// of competition bars; the lb subtitle is a display convenience for a lifter who reads
// in pounds (the value the bar is stamped with in a US gym). Exported as the single
// source of truth for "a valid Bar", so the shell (<rack-app>) validates a chosen or
// persisted Bar against the same set the tiles render (ADR-0007).
export const BAR_OPTIONS = [20, 15, 5] as const;

/** A weight the lifter can actually pick: one of the offered Bars. */
export type BarKg = (typeof BAR_OPTIONS)[number];

/** True when `kg` is one of the offered Bars -- the guard both boundaries share. */
export function isOfferedBar(kg: number): kg is BarKg {
  return (BAR_OPTIONS as readonly number[]).includes(kg);
}

// kg -> whole lb for the tile subtitle. The exact factor matches the design handoff's
// engine (engine.js `LB`), so the labels won't drift when the pounds slice (RBAR-17)
// lands a real conversion in the core; here it is a shell-side display string only.
const KG_TO_LB = 2.2046226218;
function lbWhole(kg: number): number {
  return Math.round(kg * KG_TO_LB);
}

class RackSetup extends HTMLElement {
  private root: ShadowRoot = this.attachShadow({ mode: 'open' });
  private tiles!: NodeListOf<HTMLButtonElement>;

  // The Bar reflected as the active tile. The app owns the canonical value; this only
  // mirrors it. Defaults to the 20 kg Bar (DEFAULT_BAR_KG).
  private _barKg = DEFAULT_BAR_KG;

  set barKg(kg: number) {
    this._barKg = kg;
    if (this.tiles) this.syncTiles();
  }
  get barKg(): number {
    return this._barKg;
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
    const tiles = BAR_OPTIONS.map(
      (kg) => `
        <button type="button" class="tile" data-bar="${kg}" aria-pressed="false"
                aria-label="${kg} kg Bar (${lbWhole(kg)} lb)">
          <span class="kg">${kg}<span class="u">kg</span></span>
          <span class="sub">${lbWhole(kg)} lb</span>
        </button>`,
    ).join('');

    this.root.innerHTML = `
      <style>
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
        .tiles { display: flex; gap: 8px; }
        /* A selector tile: kg headline + lb subtitle. Active = a raised, outlined fill;
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
      </style>
      <div class="scrim" data-scrim>
        <div class="panel" data-panel role="dialog" aria-modal="true" aria-label="Setup">
          <div class="head">
            <span class="title">Setup</span>
            <button type="button" class="done" data-done>Done</button>
          </div>
          <span class="section-label">Bar</span>
          <div class="tiles">${tiles}</div>
        </div>
      </div>
    `;

    this.tiles = this.root.querySelectorAll<HTMLButtonElement>('[data-bar]');

    // A scrim tap dismisses; a tap inside the panel must not (it would bubble to the
    // scrim otherwise), so the panel stops it.
    this.root.querySelector('[data-scrim]')!.addEventListener('click', () => this.close());
    this.root
      .querySelector('[data-panel]')!
      .addEventListener('click', (e) => e.stopPropagation());
    this.root.querySelector('[data-done]')!.addEventListener('click', () => this.close());
    this.tiles.forEach((t) =>
      t.addEventListener('click', () => this.choose(Number(t.dataset.bar))),
    );

    this.syncTiles();
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

  // Mark the tile matching the current Bar as pressed; the rest released.
  private syncTiles(): void {
    this.tiles.forEach((t) =>
      t.setAttribute('aria-pressed', String(Number(t.dataset.bar) === this._barKg)),
    );
  }
}

customElements.define('rack-setup', RackSetup);
