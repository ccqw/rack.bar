// <rack-loaded> -- the "On the bar" loaded-chips row + Clear control (RBAR-27,
// handoff section 4b). In By-Plates (Encode) mode it shows the current Side Load as a
// horizontally scrolling row of per-Plate colour chips, grouped `N x face`. Tapping a
// chip removes one of that Plate; the Clear pill empties the Side; an empty Side reads
// "Tap to add a pair". Both states share one fixed-geometry slot (RBAR-52): the hint
// and the chip row occupy the same reserved block height, so the Add palette below
// never shifts when the first Plate lands.
// A controlled, stateless shell (ADR-0001): the console owns the
// Side Load, this renders the `side` it is fed and emits `removeplate` (the Plate to
// drop) / `clearbar` up -- one property down, events up, the same shape as
// <rack-recents> and <rack-palette>.
//
// The chips reuse lib/summary's `groupSide` (RBAR-19, ADR-0011) so the chips, the share
// card, and the fullscreen card fold the Side Load identically and cannot drift. Plate
// faces are the Plate's own stamp (the kg number on Eleiko, the lb `label` on iron) --
// the same convention the share card, sleeve, and palette use -- so the row is
// unit-correct per plate set (ADR-0010) with no separate display-Unit transform: the
// iron set shows lb labels, the Eleiko set shows kg.
import { groupSide } from '../lib/summary.ts';
import type { Plate } from '../lib/plates.ts';
import { BOX_SIZING } from './boxsizing.ts';
import { BUTTON_FX } from './buttonfx.ts';
import { DISC_FILL } from './discfill.ts';
import { NUDGE_BUTTONS, NUDGE_STYLE, wireNudges } from './nudge.ts';
import type { NudgeRail } from './nudge.ts';
import { SECTION_LABEL } from './sectionlabel.ts';

class RackLoaded extends HTMLElement {
  private root: ShadowRoot = this.attachShadow({ mode: 'open' });
  private rail!: HTMLElement;
  private onbar!: HTMLElement;
  private emptyHint!: HTMLElement;
  private nudges?: NudgeRail;

  private _side: readonly Plate[] = [];

  /** The current Side Load, heaviest-first (the console always supplies that order).
   * Assigning re-renders the chips and the empty/loaded heads. */
  set side(plates: readonly Plate[]) {
    this._side = plates;
    if (this.rail) this.renderChips();
  }
  get side(): readonly Plate[] {
    return this._side;
  }

  connectedCallback(): void {
    this.root.innerHTML = `
      <style>
        ${BOX_SIZING}${BUTTON_FX}
        :host { display: block; --chip-h: 30px; }
        :host([hidden]) { display: none; }
        /* The stable-geometry slot (RBAR-52): the loaded row and the empty hint share
           one grid cell, so the slot's block height is the taller (loaded) state's in
           BOTH states and the Add palette below never moves when the first Plate
           lands. The empty state keeps the loaded row IN FLOW and swaps it out by
           visibility -- reserving its height -- while the hint overlays it, centered
           in the reserved space. --chip-h (on :host above) is the one height the chip
           and the bare rail share, so the reservation tracks the chip by definition. */
        .slot { display: grid; }
        .slot > * { grid-area: 1 / 1; min-width: 0; }
        .onbar.reserving { visibility: hidden; }
        /* The On the bar / Clear head: visible only when something is loaded (its
           .onbar wrapper reserves it invisibly on a bare Bar). */
        .head {
          display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 8px;
        }
        /* The head label is an h2 since RBAR-53 (heading navigation); the empty hint
           shares the recipe but stays a span. margin: 0 pins the UA heading margin
           (no-op on the span). */
        .label { ${SECTION_LABEL} margin: 0; }
        /* The Clear pill: a quiet uppercase mono control that empties the Side. Its
           hover/active goes danger-red per the handoff -- a destructive affordance, so it
           stays grey until reached for. */
        .clear {
          display: inline-flex; align-items: center; gap: 5px;
          font-family: var(--rack-font-num); font-size: 10px; font-weight: 600;
          letter-spacing: .12em; text-transform: uppercase;
          color: var(--rack-muted); background: var(--rack-raised);
          border: 1px solid var(--rack-line); border-radius: 999px;
          padding: 5px 11px; cursor: pointer;
        }
        .clear:hover, .clear:active {
          color: var(--rack-danger); border-color: var(--rack-danger);
        }
        .clear:focus-visible { outline: 2px solid var(--rack-accent); outline-offset: 2px; }
        .clear svg { display: block; }
        /* The chip rail: a horizontal scroller with edge nudge arrows that surface only
           when the chips overflow (measured on resize / scroll). On a bare Bar the rail
           is empty but its row height stays reserved (min-height: --chip-h, RBAR-52)
           inside the invisible .onbar, so the hint-to-chips swap never moves the
           palette below. */
        .viewport { position: relative; }
        .rail {
          display: flex; gap: 6px; overflow-x: auto;
          /* chip height + the rail's own 2px padding twice (border-box): the empty
             rail's height lands exactly where the loaded rail's does. */
          min-height: calc(var(--chip-h) + 4px);
          padding: 2px; scrollbar-width: none; -webkit-overflow-scrolling: touch;
        }
        .rail::-webkit-scrollbar { display: none; }
        /* A loaded chip: a tappable Plate group in the shared top-lit disc fill, lifted
           by its own chip shadow (prototype L843 -- softer than the sleeve's disc lift).
           Tap removes one of that Plate. The face reads in Hanken; the xN count is a
           quiet mono suffix. Light plates take dark ink, dark plates white (mirrors the
           palette). */
        .chip {
          flex: none; display: inline-flex; align-items: center; gap: 4px;
          min-height: var(--chip-h); padding: 0 13px; cursor: pointer;
          font-family: var(--rack-font); font-size: 13px; font-weight: 700;
          color: var(--rack-bg); ${DISC_FILL}
          border: none; border-radius: 999px; white-space: nowrap;
          box-shadow: inset 0 0 0 1px rgba(255,255,255,.12), 0 1px 2px rgba(0,0,0,.2);
        }
        .chip[data-color="red"],
        .chip[data-color="blue"],
        .chip[data-color="green"],
        .chip[data-color="iron"] { color: #fff; }
        .chip .mult { font-family: var(--rack-font-num); font-size: 11px; opacity: .55; }
        .chip:focus-visible { outline: 2px solid var(--rack-accent); outline-offset: 2px; }
        /* The overflow nudge arrows: a fade-gradient button each side, hidden until
           the rail can scroll that way. They tap-scroll the rail (handoff 4b). The
           shared pattern (elements/nudge.ts, RBAR-37) -- <rack-recents> wears the
           same arrows. */
        ${NUDGE_STYLE}
        /* The empty hint: what shows on a bare Bar, centered in the reserved slot. */
        .empty { align-self: center; text-align: center; }
        .empty[hidden] { display: none; }
      </style>
      <div class="slot" data-slot>
        <div class="onbar" data-onbar>
          <div class="head" data-head>
            <h2 class="label">On the bar</h2>
            <button type="button" class="clear" data-clear aria-label="Clear the bar">
              <svg width="9" height="9" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor"
                      stroke-width="2" stroke-linecap="round"></path>
              </svg>Clear
            </button>
          </div>
          <div class="viewport" data-viewport>
            <div class="rail" data-rail role="list" aria-label="Plates on the bar"></div>
            ${NUDGE_BUTTONS}
          </div>
        </div>
        <div class="empty" data-empty>
          <span class="label">Tap to add a pair</span>
        </div>
      </div>
    `;
    this.rail = this.root.querySelector('[data-rail]')!;
    this.onbar = this.root.querySelector('[data-onbar]')!;
    this.emptyHint = this.root.querySelector('[data-empty]')!;

    this.root.querySelector('[data-clear]')!.addEventListener('click', () => this.clear());
    this.nudges = wireNudges(this.rail, this.root);

    this.renderChips();
  }

  disconnectedCallback(): void {
    this.nudges?.disconnect();
    this.nudges = undefined;
  }

  // Render the chip row from the Side Load: one chip per `groupSide` run, plus the
  // empty/loaded head toggle. Each group keeps its representative Plate (the first of its
  // run -- groups are contiguous heaviest-first, so a running offset pairs them without
  // re-folding), so a tap can emit the exact Plate `removePlate` will drop.
  //
  // The chip LABEL is rendered here as a Hanken face plus a quiet mono `xN` suffix
  // ("25" + "x2") -- a DELIBERATE divergence from lib/summary's `groupText` ("2x 25",
  // count-first, flat), which the share card uses. The handoff (section 4b) styles the
  // face and the count differently, which a single flat string cannot express. The FOLD
  // is still the shared `groupSide`, so the faces/counts cannot drift from the share and
  // fullscreen cards (ADR-0011); only the label's visual format differs by design. See
  // the dated note on `groupText` in lib/summary.ts.
  private renderChips(): void {
    const groups = groupSide(this._side);
    const loaded = this._side.length > 0;
    // RBAR-52: on a bare Bar the loaded row is RESERVED, not removed -- .reserving
    // swaps it out by visibility, keeping its block height in flow so the Add palette
    // below never moves when the first Plate lands (it also drops the head's Clear and
    // the rail from the a11y tree while invisible). The hint overlays the same slot.
    this.onbar.classList.toggle('reserving', !loaded);
    this.emptyHint.hidden = loaded;

    let offset = 0;
    const items = groups.map((g) => {
      const rep = this._side[offset];
      offset += g.count;
      return { g, rep };
    });
    // Preserve the horizontal scroll position across the re-render: replacing innerHTML
    // resets scrollLeft to 0, which would yank a scrolled rail back to the heaviest end
    // when the lifter taps a chip off. The browser clamps a too-large value to the new
    // content width, so this is safe even as the row shrinks.
    const scrollLeft = this.rail.scrollLeft;
    this.rail.innerHTML = items
      .map(({ g, rep }) => {
        const name =
          rep.label !== undefined ? `${rep.label} lb iron` : `${rep.kg} kg ${rep.color}`;
        const mult = g.count > 1 ? `<span class="mult">x${g.count}</span>` : '';
        return `<button type="button" class="chip" role="listitem"
                 data-kg="${rep.kg}" data-color="${g.color}"
                 style="--disc: var(--rack-plate-${g.color})"
                 aria-label="Remove one ${name} Plate"><span>${g.face}</span>${mult}</button>`;
      })
      .join('');
    this.rail.querySelectorAll<HTMLButtonElement>('.chip').forEach((chip, i) =>
      chip.addEventListener('click', () => this.emitRemove(items[i].rep)),
    );
    this.rail.scrollLeft = scrollLeft;

    this.nudges?.measure();
  }

  // Tap a chip: name the Plate to drop to the console; it applies the pure removePlate
  // transform (ADR-0005) and feeds the new Side Load back down.
  private emitRemove(plate: Plate): void {
    this.dispatchEvent(
      new CustomEvent<{ plate: Plate }>('removeplate', {
        detail: { plate },
        bubbles: true,
        composed: true,
      }),
    );
  }

  // Clear: ask the console to empty the Side. It owns the Side Load, so it does the reset
  // and re-renders us with an empty list (which flips us to the "Tap to add a pair" hint).
  private clear(): void {
    this.dispatchEvent(new CustomEvent('clearbar', { bubbles: true, composed: true }));
  }
}

customElements.define('rack-loaded', RackLoaded);
