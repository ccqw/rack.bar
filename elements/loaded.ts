// <rack-loaded> -- the "On the bar" loaded-chips row + Clear control (RBAR-27,
// handoff section 4b). In By-Plates (Encode) mode it shows the current Side Load as a
// horizontally scrolling row of per-Plate colour chips, grouped `N x face`. Tapping a
// chip removes one of that Plate; the Clear pill empties the Side; an empty Side reads
// "Tap to add a pair". A controlled, stateless shell (ADR-0001): the console owns the
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
import { BUTTON_FX } from './buttonfx.ts';

class RackLoaded extends HTMLElement {
  private root: ShadowRoot = this.attachShadow({ mode: 'open' });
  private rail!: HTMLElement;
  private viewport!: HTMLElement;
  private headRow!: HTMLElement;
  private emptyHint!: HTMLElement;
  private nudgeL!: HTMLButtonElement;
  private nudgeR!: HTMLButtonElement;
  private resize?: ResizeObserver;

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
        ${BUTTON_FX}
        :host { display: block; }
        :host([hidden]) { display: none; }
        /* The On the bar / Clear head: shown only when something is loaded. */
        .head {
          display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 8px;
        }
        .head[hidden] { display: none; }
        .label {
          font-family: var(--rack-font-num); font-size: 11px; font-weight: 600;
          letter-spacing: .12em; text-transform: uppercase; color: var(--rack-muted);
        }
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
           when the chips overflow (measured on resize / scroll). Hidden on a bare Bar so
           only the "Tap to add a pair" hint shows -- no empty strip above it. */
        .viewport { position: relative; }
        .viewport[hidden] { display: none; }
        .rail {
          display: flex; gap: 6px; overflow-x: auto;
          padding: 2px; scrollbar-width: none; -webkit-overflow-scrolling: touch;
        }
        .rail::-webkit-scrollbar { display: none; }
        /* A loaded chip: a tappable Plate group, filled in its plate colour. Tap removes
           one of that Plate. The face reads in Hanken; the xN count is a quiet mono
           suffix. Light plates take dark ink, dark plates white (mirrors the palette). */
        .chip {
          flex: none; display: inline-flex; align-items: center; gap: 4px;
          min-height: 30px; padding: 0 13px; cursor: pointer;
          font-family: var(--rack-font); font-size: 13px; font-weight: 700;
          color: var(--rack-bg); background: var(--disc);
          border: none; border-radius: 999px; white-space: nowrap;
          box-shadow: var(--rack-shadow-disc);
        }
        .chip[data-color="red"],
        .chip[data-color="blue"],
        .chip[data-color="green"],
        .chip[data-color="iron"] { color: #fff; }
        .chip .mult { font-family: var(--rack-font-num); font-size: 11px; opacity: .55; }
        .chip:focus-visible { outline: 2px solid var(--rack-accent); outline-offset: 2px; }
        /* The overflow nudge arrows: a fade-gradient button each side, hidden until the
           rail can scroll that way. They tap-scroll the rail (handoff 4b). */
        .nudge {
          position: absolute; top: 0; bottom: 0; width: 42px; padding: 0;
          display: none; align-items: center; border: none; cursor: pointer; z-index: 1;
          color: var(--rack-muted);
        }
        .nudge.show { display: flex; }
        .nudge.left {
          left: 0; justify-content: flex-start; padding-left: 3px;
          background: linear-gradient(90deg, var(--rack-bg) 34%, transparent);
        }
        .nudge.right {
          right: 0; justify-content: flex-end; padding-right: 3px;
          background: linear-gradient(270deg, var(--rack-bg) 34%, transparent);
        }
        .nudge:focus-visible { outline: 2px solid var(--rack-accent); }
        /* The empty hint: the only thing shown on a bare Bar. */
        .empty { text-align: center; }
        .empty[hidden] { display: none; }
      </style>
      <div class="head" data-head>
        <span class="label">On the bar</span>
        <button type="button" class="clear" data-clear aria-label="Clear the bar">
          <svg width="9" height="9" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor"
                  stroke-width="2" stroke-linecap="round"></path>
          </svg>Clear
        </button>
      </div>
      <div class="viewport" data-viewport>
        <div class="rail" data-rail role="list" aria-label="Plates on the bar"></div>
        <button type="button" class="nudge left" data-nudge="left" aria-label="Scroll left">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M11.5 3L7 8l4.5 5M7 3L2.5 8 7 13" stroke="currentColor"
                  stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path>
          </svg>
        </button>
        <button type="button" class="nudge right" data-nudge="right" aria-label="Scroll right">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4.5 3L9 8l-4.5 5M9 3l4.5 5L9 13" stroke="currentColor"
                  stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path>
          </svg>
        </button>
      </div>
      <div class="empty" data-empty>
        <span class="label">Tap to add a pair</span>
      </div>
    `;
    this.rail = this.root.querySelector('[data-rail]')!;
    this.viewport = this.root.querySelector('[data-viewport]')!;
    this.headRow = this.root.querySelector('[data-head]')!;
    this.emptyHint = this.root.querySelector('[data-empty]')!;
    this.nudgeL = this.root.querySelector('[data-nudge="left"]')!;
    this.nudgeR = this.root.querySelector('[data-nudge="right"]')!;

    this.root.querySelector('[data-clear]')!.addEventListener('click', () => this.clear());
    this.nudgeL.addEventListener('click', () => this.nudge(-1));
    this.nudgeR.addEventListener('click', () => this.nudge(1));
    // Re-measure the overflow when the rail scrolls or its width changes. ResizeObserver,
    // not requestAnimationFrame, so it keeps working in a backgrounded tab.
    this.rail.addEventListener('scroll', () => this.measureOverflow());
    this.resize = new ResizeObserver(() => this.measureOverflow());
    this.resize.observe(this.rail);

    this.renderChips();
  }

  disconnectedCallback(): void {
    this.resize?.disconnect();
    this.resize = undefined;
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
    this.headRow.hidden = !loaded;
    this.viewport.hidden = !loaded;
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

    this.measureOverflow();
  }

  // Show a nudge arrow only when the rail can scroll that way. In a non-overflowing rail
  // (or a zero-width test DOM) both stay hidden -- the chips just sit inline.
  private measureOverflow(): void {
    const max = this.rail.scrollWidth - this.rail.clientWidth;
    const x = this.rail.scrollLeft;
    this.nudgeL.classList.toggle('show', x > 1);
    this.nudgeR.classList.toggle('show', x < max - 1);
  }

  // Tap-scroll the rail by most of a viewport (a generous minimum on a narrow column).
  private nudge(dir: number): void {
    this.rail.scrollBy({
      left: dir * Math.max(120, this.rail.clientWidth * 0.6),
      behavior: 'smooth',
    });
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
