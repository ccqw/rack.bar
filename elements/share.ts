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
import { groupSide, loadingSummary } from '../lib/summary.ts';
import type { LoadSummary } from '../lib/summary.ts';
import { format } from '../lib/units.ts';
import type { Unit } from '../lib/units.ts';

// How long the Copy button reads "Copied" before reverting (ADR-0011, handoff 1.6s).
const COPIED_MS = 1600;

class RackShare extends HTMLElement {
  private root: ShadowRoot = this.attachShadow({ mode: 'open' });
  private totalEl!: HTMLElement;
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
    totalKg: 0,
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
        :host { display: block; }
        :host([hidden]) { display: none; }
        @keyframes rack-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes rack-card { from { opacity: 0; transform: scale(.96); } to { opacity: 1; transform: scale(1); } }
        /* The dim backdrop: covers the viewport, taps through to close. */
        .scrim {
          position: fixed; inset: 0; z-index: 60;
          background: var(--rack-scrim);
          display: flex; align-items: center; justify-content: center;
          padding: 24px;
          animation: rack-fade .16s ease-out;
        }
        /* The card itself: a raised, rounded panel, centered. */
        .card {
          width: 100%; max-width: 300px;
          display: flex; flex-direction: column; align-items: stretch; gap: 14px;
          background: var(--rack-overlay);
          border: 1px solid var(--rack-line-strong);
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
        .label {
          font-family: var(--rack-font-num); font-size: 11px; font-weight: 600;
          letter-spacing: .12em; text-transform: uppercase; color: var(--rack-muted);
        }
        .total {
          font-family: var(--rack-font-num); font-size: 40px; font-weight: 700;
          color: var(--rack-fg); line-height: 1.05;
        }
        .secondary {
          font-family: var(--rack-font-num); font-size: 14px; color: var(--rack-muted);
        }
        /* The per-Side chips wrap; each is a colour-coded pill of N x face. */
        .chips {
          display: flex; flex-wrap: wrap; gap: 6px; justify-content: center;
        }
        .chip {
          font-family: var(--rack-font-num); font-size: 13px; font-weight: 600;
          color: #fff; background: var(--disc);
          border-radius: 999px; padding: 5px 11px; white-space: nowrap;
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
          <span class="total" data-total></span>
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
    const { totalKg, side, barKg, collarKg, unit } = this._load;
    const other: Unit = unit === 'kg' ? 'lb' : 'kg';
    this.totalEl.textContent = format(totalKg, unit);
    this.secondaryEl.textContent = format(totalKg, other);

    const groups = groupSide(side);
    this.chipsEl.innerHTML = groups
      .map(
        (g) => `
        <span class="chip" data-chip data-color="${g.color}"
              style="--disc: var(--rack-plate-${g.color})">${
          g.count > 1 ? `${g.count}x ${g.face}` : g.face
        }</span>`,
      )
      .join('');
    // The bare-bar line stands in for the chips when nothing is loaded.
    if (groups.length === 0) {
      this.chipsEl.innerHTML = `<span class="bare" data-bare>Bare bar - no plates</span>`;
    }

    this.captionEl.textContent =
      collarKg > 0
        ? `Bar ${format(barKg, unit)}, collars ${format(collarKg, unit)} - per side`
        : `Bar ${format(barKg, unit)} - per side`;
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
  // is cleared first so a rapid re-tap restarts the window cleanly.
  private confirmCopied(): void {
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
