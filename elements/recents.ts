// <rack-recents> -- the Recent Targets chip row (RBAR-20, fidelity RBAR-37). In
// By-Weight (Decode) mode it shows the lifter's recent Targets as a horizontally
// scrolling row of chips; tapping one re-applies it. A controlled, stateless shell
// (ADR-0001): it owns no history of its own, it renders the `targets` list the
// console feeds it and emits `recentapply` when a chip is tapped -- one property
// down, one event up, the same shape as the Setup tiles (ADR-0007). The console owns
// the list, its persistence, and its dedupe/cap (lib/recents, ADR-0009).
//
// Targets are kilograms (the canonical store, ADR-0006/0009); the chip faces render
// as the bare number in the console's active display Unit (RBAR-17, ADR-0010;
// handoff sRecentChip -- the Unit lives in the entry readout, not on every chip).
// The `data-target` stays canonical kg, so re-apply is Unit-agnostic; only the
// visible face and aria change Unit. The chip naming the current Target (the
// `target` property, near-equal within the prototype's epsilon) reads selected;
// tapping a chip moves the highlight there at once -- the tapped Target IS the new
// current one -- and the console's round-trip confirms it. The rail wears the shared
// overflow nudge arrows (elements/nudge.ts), the same affordance as the loaded-chips
// rail.
import { format, shownIn } from '../lib/units.ts';
import type { Unit } from '../lib/units.ts';
import { BOX_SIZING } from './boxsizing.ts';
import { BUTTON_FX } from './buttonfx.ts';
import { NUDGE_BUTTONS, NUDGE_STYLE, wireNudges } from './nudge.ts';
import type { NudgeRail } from './nudge.ts';
import { SECTION_LABEL } from './sectionlabel.ts';

// A chip reads selected when it names the current Target to within the prototype's
// near-equality (engine L851: |target - chip| < 0.05 kg) -- floats from lb<->kg
// round-trips are the same Target, a real 0.5 kg step is not.
const ACTIVE_EPS = 0.05;

class RackRecents extends HTMLElement {
  private root: ShadowRoot = this.attachShadow({ mode: 'open' });
  private rail!: HTMLElement;
  private nudges?: NudgeRail;

  private _targets: readonly number[] = [];
  private _unit: Unit = 'kg';
  private _target: number | null = null;

  /** The recent Targets to show, most-recent-first (kg). Assigning re-renders the row
   * and hides the element entirely when the history is empty (no stray empty rail). */
  set targets(list: readonly number[]) {
    this._targets = list;
    if (this.rail) this.renderChips();
  }
  get targets(): readonly number[] {
    return this._targets;
  }

  /** The display Unit the chip faces read in (the store stays kg). Re-renders.
   * Unchanged values return early: the console re-feeds every property on each of
   * its renders, and an echoed write must not rebuild (and re-scroll) the rail. */
  set unit(u: Unit) {
    if (u === this._unit) return;
    this._unit = u;
    if (this.rail) this.renderChips();
  }
  get unit(): Unit {
    return this._unit;
  }

  /** The current Target (kg) or null. The chip naming it (within ACTIVE_EPS) gets the
   * selected treatment; a tap moves it locally, this property is the console's say. */
  set target(kg: number | null) {
    if (kg === this._target) return;
    this._target = kg;
    if (this.rail) this.renderChips();
  }
  get target(): number | null {
    return this._target;
  }

  connectedCallback(): void {
    this.root.innerHTML = `
      <style>
        ${BOX_SIZING}${BUTTON_FX}
        /* The row (handoff L162): the Recent label sits inline at the LEFT of the
           scroll viewport -- flex, gap 9px -- not stacked above it. */
        :host { display: flex; align-items: center; gap: 9px; }
        :host([hidden]) { display: none; }
        /* An h2 since RBAR-53 (heading navigation); margin pinned over the UA default. */
        .label { flex: none; ${SECTION_LABEL} margin: 0; }
        /* The scroll viewport: the relative anchor the nudge arrows overlay. */
        .viewport { position: relative; flex: 1; min-width: 0; }
        .rail {
          display: flex; gap: 6px; overflow-x: auto;
          padding: 1px 0; scrollbar-width: none; -webkit-overflow-scrolling: touch;
        }
        .rail::-webkit-scrollbar { display: none; }
        /* A chip: a tappable recent Target. The visible pill is the inner .face
           (prototype sRecentChip L410: mono 600 12px, .04em, pad 7px 13px, hairline,
           inactive ink text-dim); the button around it is a transparent >=44px hit
           area, keeping the RBAR-20 touch floor without inflating the pill. */
        .chip {
          flex: none; display: inline-flex; align-items: center; justify-content: center;
          min-height: 44px; min-width: 44px; padding: 0; cursor: pointer;
          background: transparent; border: none;
        }
        .face {
          display: flex; align-items: center; white-space: nowrap; padding: 7px 13px;
          font-family: var(--rack-font-num); font-size: 12px; font-weight: 600;
          letter-spacing: .04em; color: var(--rack-text-dim); background: transparent;
          border: 1px solid var(--rack-border); border-radius: var(--rack-radius-pill);
          transition: background-color .16s ease, border-color .16s ease, color .16s ease;
        }
        .chip:hover .face { border-color: var(--rack-border-active); }
        .chip:focus-visible { outline: none; }
        .chip:focus-visible .face { outline: 2px solid var(--rack-accent); outline-offset: 2px; }
        /* The chip naming the current Target (prototype sRecentChip(on)): selected
           fill, active ring, full-bright ink. */
        .chip.selected .face {
          background: var(--rack-selected); border-color: var(--rack-border-active);
          color: var(--rack-text);
        }
        ${NUDGE_STYLE}
      </style>
      <h2 class="label">Recent</h2>
      <div class="viewport">
        <div class="rail" data-rail role="list" aria-label="Recent Targets"></div>
        ${NUDGE_BUTTONS}
      </div>
    `;
    this.rail = this.root.querySelector('[data-rail]')!;
    this.nudges = wireNudges(this.rail, this.root);
    this.renderChips();
  }

  disconnectedCallback(): void {
    this.nudges?.disconnect();
    this.nudges = undefined;
  }

  // Render one chip per Target. Empty history -> hide the whole element so no bare
  // "Recent" label or empty rail shows. The face is the bare number in the display
  // Unit; the accessible name keeps the full "<n> <unit>" reading.
  private renderChips(): void {
    this.hidden = this._targets.length === 0;
    // Preserve the horizontal scroll position across the re-render (as loaded.ts
    // does): replacing innerHTML resets scrollLeft to 0, which would yank a
    // nudged-along rail back to the newest end whenever the console re-renders.
    const scrollLeft = this.rail.scrollLeft;
    this.rail.innerHTML = this._targets
      .map((kg) => {
        const on = this._target !== null && Math.abs(kg - this._target) < ACTIVE_EPS;
        return `
        <button type="button" class="chip${on ? ' selected' : ''}" role="listitem"
                data-target="${kg}"${on ? ' aria-current="true"' : ''}
                aria-label="Set Target to ${format(kg, this._unit)}"><span
                class="face">${shownIn(kg, this._unit)}</span></button>`;
      })
      .join('');
    this.rail.scrollLeft = scrollLeft;
    this.rail.querySelectorAll<HTMLButtonElement>('[data-target]').forEach((chip) =>
      chip.addEventListener('click', () => this.apply(Number(chip.dataset.target))),
    );
    this.nudges?.measure();
  }

  // A chip tap names the chosen Target to the console; the console re-applies it (and
  // re-remembers it, moving it to the front) -- one event up (ADR-0009). The highlight
  // moves first: the tapped chip is the current Target by definition, so the selected
  // state must not wait on (or drift from) the console's round-trip.
  private apply(target: number): void {
    this._target = target;
    this.renderChips();
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
