// <rack-fullscreen> -- the immersive fullscreen rack card (RBAR-18). Tapping the
// fullscreen control on the bar visualizer blows the loaded Bar up to fill the screen:
// the wordmark, a huge Total, a config caption, and the Side Load rendered LANDSCAPE
// (rotated 90 degrees) and much larger on a dark radial background. A glanceable view
// you can read from a few feet away at the rack. Tap anywhere -- or the close button --
// to exit.
//
// A controlled, stateless shell (ADR-0001), the same shape as <rack-share> (ADR-0011):
// one property down (`load`, a snapshot of the current load), one event up (`close`). It
// owns no calculator state; the console snapshots its load and feeds it. The blow-up
// REUSES the real visualizer -- it embeds <rack-sleeve> (inert here) and rotates it,
// rather than carrying a second plate-sizing system; the Total and caption come from the
// same lib/summary the share card and main readout use, so they cannot drift (no separate
// Total field). The sleeve fits via ResizeObserver, not requestAnimationFrame, so the
// blow-up paints even in a backgrounded tab.
import './sleeve.ts';
import { configText, loadTotalKg } from '../lib/summary.ts';
import type { LoadSummary } from '../lib/summary.ts';
import { format } from '../lib/units.ts';
import type { Plate } from '../lib/plates.ts';

type Sleeve = HTMLElement & { sideLoad: readonly Plate[]; interactive: boolean };

class RackFullscreen extends HTMLElement {
  private root: ShadowRoot = this.attachShadow({ mode: 'open' });
  private overlay!: HTMLElement;
  private totalEl!: HTMLElement;
  private captionEl!: HTMLElement;
  private sleeve!: Sleeve;

  // The load to blow up. The console sets this before open(); a bare default keeps a
  // pre-seed render harmless. Assigning re-renders while open so a live change shows.
  private _load: LoadSummary = {
    side: [],
    barKg: 0,
    collarKg: 0,
    unit: 'kg',
  };

  /** The current load snapshot to blow up (ADR-0011 shape). Assigning re-renders. */
  set load(value: LoadSummary) {
    this._load = value;
    if (this.overlay) this.render();
  }
  get load(): LoadSummary {
    return this._load;
  }

  /** Show the immersive view. The console snapshots the load and sets `load` first. */
  open(): void {
    this.render();
    this.hidden = false;
  }

  /** Hide the view and tell the console, so it can drop any open state. */
  close(): void {
    this.hidden = true;
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  connectedCallback(): void {
    this.hidden = true; // an overlay is closed until opened

    this.root.innerHTML = `
      <style>
        :host { display: block; }
        :host([hidden]) { display: none; }
        @keyframes rack-fade { from { opacity: 0; } to { opacity: 1; } }
        /* The immersive backdrop: a dark radial wash filling the viewport. Tap ANYWHERE
           on it to exit -- the whole surface is the dismiss target (handoff section 8). */
        .overlay {
          position: fixed; inset: 0; z-index: 70;
          background: radial-gradient(120% 90% at 50% 30%, #16181c, #0a0b0d);
          display: flex; flex-direction: column; align-items: center;
          padding: calc(48px + env(safe-area-inset-top)) 24px
                   calc(32px + env(safe-area-inset-bottom));
          cursor: pointer; overflow: hidden;
          animation: rack-fade .16s ease-out;
        }
        /* The exit affordance: a quiet icon button, top-right. Taps still bubble to the
           overlay (everything exits), it just gives the obvious explicit control. */
        .close {
          position: absolute; top: calc(16px + env(safe-area-inset-top)); right: 16px;
          width: 42px; height: 42px; display: flex; align-items: center;
          justify-content: center; padding: 0;
          color: var(--rack-muted); background: var(--rack-overlay);
          border: 1px solid var(--rack-line); border-radius: 12px; cursor: pointer;
        }
        .close:hover { color: var(--rack-fg); }
        .close:focus-visible { outline: 2px solid var(--rack-accent); outline-offset: 2px; }
        /* The head: wordmark, huge Total, config caption -- centered above the bar. */
        .head { flex: none; display: flex; flex-direction: column; align-items: center; text-align: center; }
        .wordmark {
          font-family: var(--rack-font); font-weight: 800; font-size: 19px;
          letter-spacing: -.02em; color: var(--rack-fg);
        }
        .wordmark .dot { color: var(--rack-accent); }
        .total {
          margin-top: 12px; font-family: var(--rack-font-num); font-weight: 700;
          font-size: clamp(40px, 16vw, 58px); line-height: 1;
          letter-spacing: -.02em; color: var(--rack-fg);
        }
        .caption {
          margin-top: 14px; font-family: var(--rack-font-num); font-size: 11px;
          font-weight: 600; letter-spacing: .12em; text-transform: uppercase;
          color: var(--rack-muted);
        }
        /* The stage: the leftover space the blown-up bar fills. The bar lays out
           horizontally inside .rot, then .rot is rotated 90deg so the bar runs along the
           screen's LONG axis -- the landscape blow-up (handoff section 8). The sleeve caps
           its own disc size (ADR-0004 MAX_SCALE, shared with the inline strip), so a final
           CSS scale() blows the whole rotated graphic up "much larger" for a glanceable
           read. The fit-width budget is sized so budget x scale stays within the viewport
           for the fullest realistic Side Load -- a heavy bar shrinks-to-fit, never clips.
           The exact blow-up magnitude is a look-and-feel knob (fold from RBAR-10). */
        .stage {
          flex: 1; min-height: 0; align-self: stretch;
          display: flex; align-items: center; justify-content: center;
        }
        .rot {
          width: min(360px, 62vh);
          transform: rotate(90deg) scale(1.5);
          display: flex; align-items: center; justify-content: center;
        }
        .rot rack-sleeve { width: 100%; }
      </style>
      <div class="overlay" data-overlay role="dialog" aria-modal="true"
           aria-label="Full screen rack card">
        <button type="button" class="close" data-close aria-label="Exit full screen">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M5.5 2V5.5H2M14 5.5H10.5V2M10.5 14V10.5H14M2 10.5H5.5V14"
                  stroke="currentColor" stroke-width="1.6"
                  stroke-linecap="round" stroke-linejoin="round"></path>
          </svg>
        </button>
        <div class="head">
          <span class="wordmark" data-wordmark>rack<span class="dot">.</span>bar</span>
          <span class="total" data-total></span>
          <span class="caption" data-caption></span>
        </div>
        <div class="stage">
          <div class="rot">
            <rack-sleeve></rack-sleeve>
          </div>
        </div>
      </div>
    `;

    this.overlay = this.root.querySelector('[data-overlay]')!;
    this.totalEl = this.root.querySelector('[data-total]')!;
    this.captionEl = this.root.querySelector('[data-caption]')!;
    this.sleeve = this.root.querySelector('rack-sleeve') as Sleeve;

    // Tap anywhere exits. The close button's click bubbles here too, so a single
    // listener on the overlay covers both -- the whole view is the dismiss target.
    this.overlay.addEventListener('click', () => this.close());

    this.render();
  }

  // Render every surface from the current load. The Total derives from the rig + Side
  // Load (loadTotalKg) and reads in the load's Unit; the caption reuses the shared config
  // wording (so it can't drift from the share card), plus a "per side" note. The sleeve
  // draws the Side Load inert -- in the immersive view a disc tap exits, it never edits.
  private render(): void {
    const { side, barKg, collarKg, unit } = this._load;
    this.totalEl.textContent = format(loadTotalKg(this._load), unit);
    this.captionEl.textContent = `${configText(barKg, collarKg, unit)} - per side`;
    this.sleeve.interactive = false;
    this.sleeve.sideLoad = side;
  }
}

customElements.define('rack-fullscreen', RackFullscreen);
