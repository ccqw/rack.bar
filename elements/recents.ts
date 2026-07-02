// <rack-recents> -- the Recent Targets chip row (RBAR-20). In By-Weight (Decode) mode
// it shows the lifter's recent Targets as a horizontally scrolling row of chips;
// tapping one re-applies it. A controlled, stateless shell (ADR-0001): it owns no
// history of its own, it renders the `targets` list the console feeds it and emits
// `recentapply` when a chip is tapped -- one property down, one event up, the same
// shape as the Setup tiles (ADR-0007). The console owns the list, its persistence, and
// its dedupe/cap (lib/recents, ADR-0009).
//
// Targets are kilograms (the canonical store, ADR-0006/0009); the chips render in the
// console's active display Unit (RBAR-17, ADR-0010) -- this is the kg|lb format hook the
// earlier slices anticipated. The `data-target` stays canonical kg, so re-apply is
// Unit-agnostic; only the visible label and aria change Unit.
import { format } from '../lib/units.ts';
import type { Unit } from '../lib/units.ts';
import { BOX_SIZING } from './boxsizing.ts';
import { BUTTON_FX } from './buttonfx.ts';

class RackRecents extends HTMLElement {
  private root: ShadowRoot = this.attachShadow({ mode: 'open' });
  private rail!: HTMLElement;

  private _targets: readonly number[] = [];
  private _unit: Unit = 'kg';

  /** The recent Targets to show, most-recent-first (kg). Assigning re-renders the row
   * and hides the element entirely when the history is empty (no stray empty rail). */
  set targets(list: readonly number[]) {
    this._targets = list;
    if (this.rail) this.renderChips();
  }
  get targets(): readonly number[] {
    return this._targets;
  }

  /** The display Unit the chips read in (the store stays kg). Re-renders the labels. */
  set unit(u: Unit) {
    this._unit = u;
    if (this.rail) this.renderChips();
  }
  get unit(): Unit {
    return this._unit;
  }

  connectedCallback(): void {
    this.root.innerHTML = `
      <style>
        ${BOX_SIZING}${BUTTON_FX}
        :host { display: block; }
        :host([hidden]) { display: none; }
        .label {
          display: block; text-align: center;
          font-family: var(--rack-font-num); font-size: 11px; font-weight: 600;
          letter-spacing: .12em; text-transform: uppercase; color: var(--rack-muted);
          margin-bottom: 8px;
        }
        /* The scroll viewport. The edge gradients are nudge cues that more chips sit
           past the fade -- a thin overflow affordance (RBAR-20); they tint the bg so
           they read only when content runs under them. */
        .viewport { position: relative; }
        .viewport::before, .viewport::after {
          content: ''; position: absolute; top: 0; bottom: 0; width: 24px;
          pointer-events: none; z-index: 1;
        }
        .viewport::before {
          left: 0;
          background: linear-gradient(to right, var(--rack-bg), transparent);
        }
        .viewport::after {
          right: 0;
          background: linear-gradient(to left, var(--rack-bg), transparent);
        }
        .rail {
          display: flex; gap: 8px; overflow-x: auto;
          padding: 2px 4px; scrollbar-width: none;
          -webkit-overflow-scrolling: touch;
        }
        .rail::-webkit-scrollbar { display: none; }
        /* A chip: a tappable recent Target. Pill, hairline, 44px+ touch target. */
        .chip {
          flex: none; min-height: 44px; padding: 8px 16px; cursor: pointer;
          font-family: var(--rack-font-num); font-size: 15px; font-weight: 600;
          color: var(--rack-fg); background: transparent; white-space: nowrap;
          border: 1px solid var(--rack-line); border-radius: 999px;
        }
        .chip:hover { border-color: var(--rack-line-strong); }
        .chip:active { background: var(--rack-line); }
        .chip:focus-visible { outline: 2px solid var(--rack-accent); outline-offset: 2px; }
      </style>
      <span class="label">Recent</span>
      <div class="viewport">
        <div class="rail" data-rail role="list" aria-label="Recent Targets"></div>
      </div>
    `;
    this.rail = this.root.querySelector('[data-rail]')!;
    this.renderChips();
  }

  // Render one chip per Target. Empty history -> hide the whole element so no bare
  // "Recent" label or empty rail shows.
  private renderChips(): void {
    this.hidden = this._targets.length === 0;
    this.rail.innerHTML = this._targets
      .map(
        (kg) => `
        <button type="button" class="chip" role="listitem" data-target="${kg}"
                aria-label="Set Target to ${format(kg, this._unit)}">${format(kg, this._unit)}</button>`,
      )
      .join('');
    this.rail.querySelectorAll<HTMLButtonElement>('[data-target]').forEach((chip) =>
      chip.addEventListener('click', () => this.apply(Number(chip.dataset.target))),
    );
  }

  // A chip tap names the chosen Target to the console; the console re-applies it (and
  // re-remembers it, moving it to the front) -- one event up (ADR-0009).
  private apply(target: number): void {
    this.dispatchEvent(
      new CustomEvent<{ target: number }>('recentapply', {
        detail: { target },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

customElements.define('rack-recents', RackRecents);
