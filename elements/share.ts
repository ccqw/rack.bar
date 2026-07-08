// <rack-share> -- the share card (RBAR-19, ADR-0011). A centered modal that shows the
// current load as a clean summary -- wordmark, big Total, secondary unit, the per-Side
// Plates as wrapped colour chips (or a bare-bar state), and a config caption -- plus a
// Copy summary button (writes the plain-text version to the clipboard) and a Close
// button.
//
// A controlled, stateless shell (ADR-0001), the same shape as <rack-setup> / <rack-recents>:
// one property down (`load`, a snapshot of the current load), one event up (`close`). It
// owns no calculator state; the console snapshots its load and feeds it (ADR-0011). The
// visible chips and the copied text both derive from lib/summary, so they cannot drift.
import {
  BARE_BAR,
  configText,
  groupSide,
  groupText,
  loadingSummary,
  loadTotalKg,
} from '../lib/summary.ts';
import type { LoadSummary } from '../lib/summary.ts';
import { format, shownIn } from '../lib/units.ts';
import type { Unit } from '../lib/units.ts';
import { BOX_SIZING } from './boxsizing.ts';
import { BUTTON_FX } from './buttonfx.ts';
import { SECTION_LABEL } from './sectionlabel.ts';

// How long the Copy button reads "Copied" before reverting (ADR-0011, handoff 1.6s).
const COPIED_MS = 1600;

class RackShare extends HTMLElement {
  private root: ShadowRoot = this.attachShadow({ mode: 'open' });
  private totalEl!: HTMLElement;
  private totalNumEl!: HTMLElement;
  private totalUnitEl!: HTMLElement;
  private secondaryEl!: HTMLElement;
  private chipsEl!: HTMLElement;
  private captionEl!: HTMLElement;
  private copyBtn!: HTMLButtonElement;
  // The pending "Copied" -> "Copy summary" revert, so a rapid re-tap or a close can
  // cancel it rather than letting a stale timer overwrite a fresh label.
  private copiedTimer: ReturnType<typeof setTimeout> | null = null;

  // The load to summarise. The console sets this before open(); a bare default keeps a
  // pre-seed render harmless. Assigning re-renders while open so a live change shows.
  private _load: LoadSummary = {
    side: [],
    barKg: 0,
    collarKg: 0,
    unit: 'kg',
  };

  /** The current load snapshot to summarise (ADR-0011). Assigning re-renders the card. */
  set load(value: LoadSummary) {
    this._load = value;
    if (this.totalEl) this.render();
  }
  get load(): LoadSummary {
    return this._load;
  }

  /** Show the card. The console snapshots the load and sets `load` first. */
  open(): void {
    this.render();
    this.hidden = false;
  }

  /** Hide the card and tell the console, so it can drop any open state. */
  close(): void {
    this.resetCopy();
    this.hidden = true;
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  connectedCallback(): void {
    this.hidden = true; // a modal is closed until opened

    this.root.innerHTML = `
      <style>
        ${BOX_SIZING}${BUTTON_FX}
        :host { display: block; }
        :host([hidden]) { display: none; }
        @keyframes rack-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes rack-card { from { opacity: 0; transform: scale(.96); } to { opacity: 1; transform: scale(1); } }
        /* The dim backdrop: covers the viewport, taps through to close. */
        .scrim {
          position: fixed; inset: 0; z-index: 60;
          /* The share card is a centered modal -- it dims harder than a bottom
             sheet (handoff "Share card" rgba(5,6,7,.72) vs the sheet's .55). */
          background: var(--rack-scrim-modal);
          display: flex; align-items: center; justify-content: center;
          padding: 24px;
          animation: rack-fade .16s ease-out;
        }
        /* The card itself: a raised, rounded panel, centered. */
        .card {
          width: 100%; max-width: 300px;
          display: flex; flex-direction: column; align-items: stretch; gap: 14px;
          background: var(--rack-overlay);
          border: 1px solid var(--rack-border-strong);
          border-radius: 26px;
          padding: 22px 22px calc(22px + env(safe-area-inset-bottom));
          box-shadow: 0 30px 60px -20px rgba(0, 0, 0, .7);
          animation: rack-card .24s cubic-bezier(.2, .85, .25, 1);
          text-align: center;
        }
        .wordmark {
          font-family: var(--rack-font); font-weight: 800; font-size: 16px;
          letter-spacing: -.01em; color: var(--rack-fg);
        }
        .wordmark .dot { color: var(--rack-accent); }
        .label { ${SECTION_LABEL} }
        /* The card total (RBAR-39, prototype L291): Hanken 800 52px -.03em with
           explicit tabular figures -- the display-number treatment, not mono. */
        .total {
          font-family: var(--rack-font); font-size: 52px; font-weight: 800;
          letter-spacing: -.03em; font-variant-numeric: tabular-nums;
          color: var(--rack-text); line-height: 1;
        }
        /* The unit rides the total as a small dim suffix (18px/700, text-dim). */
        .total .tu { font-size: 18px; font-weight: 700; color: var(--rack-text-dim); }
        .secondary {
          font-family: var(--rack-font-num); font-size: 14px; color: var(--rack-muted);
        }
        /* The per-Side chips wrap; each is a colour-coded pill of N x face. The fill
           stays FLAT with an inset ring (prototype L889) -- the one plate-colored
           surface that does NOT take the shared top-lit gradient (RBAR-42). */
        .chips {
          display: flex; flex-wrap: wrap; gap: 6px; justify-content: center;
        }
        .chip {
          font-family: var(--rack-font); font-size: 12px; font-weight: 700;
          color: #fff; background: var(--disc);
          border-radius: 999px; padding: 6px 12px; white-space: nowrap;
          box-shadow: inset 0 0 0 1.5px rgba(255,255,255,.14);
        }
        /* Light Plates need dark ink; iron and the dark colours keep white. */
        .chip[data-color="white"],
        .chip[data-color="yellow"] { color: var(--rack-bg); }
        .bare {
          font-family: var(--rack-font-num); font-size: 13px; color: var(--rack-muted);
        }
        .caption {
          font-family: var(--rack-font-num); font-size: 12px; color: var(--rack-muted);
        }
        .actions { display: flex; flex-direction: column; gap: 8px; margin-top: 2px; }
        .copy {
          font: inherit; font-size: 14px; font-weight: 700;
          color: var(--rack-bg); background: var(--rack-accent);
          border: none; border-radius: 999px; padding: 10px 16px;
          min-height: 44px; cursor: pointer;
        }
        .close {
          font: inherit; font-size: 14px; font-weight: 600;
          color: var(--rack-muted); background: transparent;
          border: 1px solid var(--rack-line); border-radius: 999px;
          padding: 10px 16px; min-height: 44px; cursor: pointer;
        }
        .copy:focus-visible, .close:focus-visible { outline: 2px solid var(--rack-accent); outline-offset: 2px; }
        .close:hover { color: var(--rack-fg); }
      </style>
      <div class="scrim" data-scrim>
        <div class="card" data-card role="dialog" aria-modal="true" aria-label="Loading card">
          <span class="wordmark">rack<span class="dot">.</span>bar</span>
          <span class="label">Loading card</span>
          <span class="total" data-total><span data-total-num></span><span
            class="tu" data-total-unit></span></span>
          <span class="secondary" data-secondary></span>
          <div class="chips" data-chips></div>
          <span class="caption" data-caption></span>
          <div class="actions">
            <button type="button" class="copy" data-copy>Copy summary</button>
            <button type="button" class="close" data-close>Close</button>
          </div>
        </div>
      </div>
    `;

    this.totalEl = this.root.querySelector('[data-total]')!;
    this.totalNumEl = this.root.querySelector('[data-total-num]')!;
    this.totalUnitEl = this.root.querySelector('[data-total-unit]')!;
    this.secondaryEl = this.root.querySelector('[data-secondary]')!;
    this.chipsEl = this.root.querySelector('[data-chips]')!;
    this.captionEl = this.root.querySelector('[data-caption]')!;
    this.copyBtn = this.root.querySelector('[data-copy]')!;

    // A scrim tap dismisses; a tap inside the card must not (it would bubble to the
    // scrim), so the card stops it -- the same guard as <rack-setup>.
    this.root.querySelector('[data-scrim]')!.addEventListener('click', () => this.close());
    this.root
      .querySelector('[data-card]')!
      .addEventListener('click', (e) => e.stopPropagation());
    this.root.querySelector('[data-close]')!.addEventListener('click', () => this.close());
    this.copyBtn.addEventListener('click', () => this.copy());

    this.render();
  }

  // Render every surface from the current load. The Total and config read in the load's
  // Unit; the secondary reads the other. The Side Load folds into colour chips (or a
  // bare-bar line) via the same lib/summary the copied text uses (ADR-0011).
  private render(): void {
    const { side, barKg, collarKg, unit } = this._load;
    const other: Unit = unit === 'kg' ? 'lb' : 'kg';
    const total = loadTotalKg(this._load);
    // Value + small dim unit suffix (RBAR-39); together they still read "155 kg".
    this.totalNumEl.textContent = String(shownIn(total, unit));
    this.totalUnitEl.textContent = ` ${unit}`;
    this.secondaryEl.textContent = format(total, other);

    // Chips (loaded) or the bare-bar line (empty) -- one assignment, no dead markup.
    // The chip label comes from the shared `groupText`, so it can't drift from the
    // copied text (ADR-0011); `data-chip`/`data-bare` are the test hooks.
    const groups = groupSide(side);
    this.chipsEl.innerHTML =
      groups.length === 0
        ? `<span class="bare" data-bare>${BARE_BAR}</span>`
        : groups
            .map(
              (g) => `
        <span class="chip" data-chip data-color="${g.color}"
              style="--disc: var(--rack-plate-${g.color})">${groupText(g)}</span>`,
            )
            .join('');

    // The config caption reuses the shared config wording, plus a "per side" note.
    this.captionEl.textContent = `${configText(barKg, collarKg, unit)} - per side`;
  }

  // Write the plain-text summary to the clipboard and confirm with a transient "Copied"
  // (ADR-0011). The confirmation flips ONLY on a successful write -- a missing or denied
  // clipboard leaves the label unchanged rather than claiming a copy that did not happen.
  private copy(): void {
    const text = loadingSummary(this._load);
    const clip = navigator.clipboard;
    if (!clip || typeof clip.writeText !== 'function') return; // no clipboard: say nothing
    clip.writeText(text).then(
      () => this.confirmCopied(),
      () => {
        /* write denied/blocked: leave the label, never falsely confirm */
      },
    );
  }

  // Flash "Copied" on the Copy button, then revert after a short delay. A pending revert
  // is cleared first so a rapid re-tap restarts the window cleanly. Bails if the card was
  // closed before this (async) clipboard write resolved -- otherwise a late confirm would
  // re-label a hidden card and arm a stale timer, surfacing "Copied" on the next open for
  // a copy the lifter never made in that session (the ADR-0011 no-false-confirm contract).
  private confirmCopied(): void {
    if (this.hidden) return;
    if (this.copiedTimer !== null) clearTimeout(this.copiedTimer);
    this.copyBtn.textContent = 'Copied';
    this.copiedTimer = setTimeout(() => {
      this.copyBtn.textContent = 'Copy summary';
      this.copiedTimer = null;
    }, COPIED_MS);
  }

  // Cancel a pending "Copied" revert and restore the resting label -- run on close so the
  // card never reopens mid-confirmation.
  private resetCopy(): void {
    if (this.copiedTimer !== null) {
      clearTimeout(this.copiedTimer);
      this.copiedTimer = null;
    }
    if (this.copyBtn) this.copyBtn.textContent = 'Copy summary';
  }
}

customElements.define('rack-share', RackShare);
