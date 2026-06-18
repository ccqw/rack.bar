// <rack-sleeve> -- one loaded Side of the Bar, drawn side-on as colored discs with
// the heaviest at the collar (CONTEXT.md: a Side Load is the Plates on one Side).
// Each disc is sized from its Plate's REAL dimensions (ADR-0004): height tracks the
// plate's diameter, width its thickness, so the four 450 mm competition bumpers read
// as equal-height and differ only in fatness, while the 5 kg and change plates nest
// down. The whole row scales under one fit-to-width factor so a heavy bar zooms out
// rather than overflowing. The element stays purely presentational (ADR-0001): given
// a Side Load it draws it, holding no plate math.
//
// In Encode (RBAR-7, ADR-0005) the sleeve is `interactive`: each disc becomes a
// button that emits `removeplate` with its Plate, so tapping a loaded Plate takes it
// off. In Decode the discs are inert -- the graphic is identical, only the affordance
// differs. The sleeve still holds no plate math; it emits intent and the console
// applies the pure removePlate() transform.
import type { Plate } from '../lib/plates.ts';

// Fit-to-width scale (ADR-0004). A bumper is 450 mm; cap the zoom so a normal load
// renders at a comfortable fixed size and only a genuinely huge bar (whose plates
// would overflow the host width) zooms below this. px-per-mm = MAX_SCALE until the
// row no longer fits, then it shrinks to fit. Gaps between discs are fixed px.
const BUMPER_MM = 450;
const TARGET_BUMPER_PX = 188; // a touch jumbo so the discs read clearly and the labels breathe
const MAX_SCALE = TARGET_BUMPER_PX / BUMPER_MM; // px per mm at full zoom
const GAP_PX = 3;
const BAR_STUB_PX = 32;
// Floor each disc at one upright digit's width so its kg label still fits ON the plate. A
// thin change plate stays far narrower than a bumper (so the size cue holds), just wide
// enough for a digit; its multi-character label (e.g. 2.5) stacks one digit per line
// rather than rotating, which keeps the digits upright (no head-tilt).
const MIN_DISC_PX = 10;
// Below this real thickness a horizontal multi-digit label can't fit the disc, so its
// digits stack one per line (upright, not rotated). Cleanly splits the change tier
// (<=22 mm) from the bumpers (>=35 mm); single-digit labels never stack.
const STACK_BELOW_MM = 30;
const FALLBACK_SCALE = MAX_SCALE; // used when the host has no measured width yet

// The visible disc caption. Lifters read "point five", so drop the leading zero on the
// sub-1 change plates (0.5 -> .5) -- narrower and natural -- while 1.5 / 2.5 keep theirs.
// The full "0.5 kg" still goes to assistive tech via the disc's aria-label.
function plateLabel(kg: number): string {
  return kg < 1 ? String(kg).replace(/^0/, '') : String(kg);
}

class RackSleeve extends HTMLElement {
  private root: ShadowRoot = this.attachShadow({ mode: 'open' });
  private plates: readonly Plate[] = [];
  private removable = false;
  private resize?: ResizeObserver;
  private lastScale = NaN;

  /** The Side Load to draw, heaviest-first. Setting it re-renders. */
  set sideLoad(plates: readonly Plate[]) {
    this.plates = plates;
    this.render();
  }
  get sideLoad(): readonly Plate[] {
    return this.plates;
  }

  /** Whether tapping a disc removes its Plate (Encode). Setting it re-renders. */
  set interactive(on: boolean) {
    this.removable = on;
    this.render();
  }
  get interactive(): boolean {
    return this.removable;
  }

  connectedCallback(): void {
    // Re-fit when the host's width changes (rotation, resize). ResizeObserver, not
    // requestAnimationFrame, so it is not paused in a backgrounded tab; the host width
    // is bounded by its parent (not by disc size), so setting the scale can't feed back
    // into a resize loop -- and fit() early-returns on an unchanged width regardless.
    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(this);
    this.render();
  }

  disconnectedCallback(): void {
    this.resize?.disconnect();
  }

  private render(): void {
    // A button in Encode (tappable to remove), an inert div in Decode. Both keep the
    // `.disc` class and data-* tags, so the display contract is unchanged. Each disc
    // carries its real mm as --mm-d (diameter -> height) and --mm-w (thickness -> width);
    // CSS multiplies them by the shared --rack-mm-scale (px per mm) that fit() sets, so
    // the whole row scales together (ADR-0004). The kg label sits ON the disc and wraps
    // one digit per line, so it reads horizontally on a wide bumper and stacks upright on
    // a thin change plate -- the geometry self-selects, no per-plate branching.
    const tag = this.removable ? 'button' : 'div';
    const attrs = this.removable ? ' type="button"' : '';
    const discs = this.plates
      .map((p) => {
        const style = `--disc: var(--rack-plate-${p.color}); --mm-d: ${p.diameterMm}; --mm-w: ${p.widthMm}`;
        // Both modes expose the kg + color to assistive tech; only Encode adds the
        // "Remove" verb. The on-disc digits are decorative (aria-label carries the name).
        const aria = this.removable
          ? ` aria-label="Remove ${p.kg} kg ${p.color} Plate"`
          : ` aria-label="${p.kg} kg ${p.color} Plate"`;
        // On a thin change plate a horizontal number won't fit, so stack the digits one
        // per line; the bumpers keep their number horizontal. textContent is unchanged
        // (the <br>s drop out), so the label still reads as the plain kg to tests + AT.
        const text = plateLabel(p.kg);
        const labelHtml =
          p.widthMm < STACK_BELOW_MM && text.length > 1 ? [...text].join('<br>') : text;
        return `<${tag}${attrs} class="disc" data-kg="${p.kg}" data-color="${p.color}" style="${style}"${aria}><span class="label" aria-hidden="true">${labelHtml}</span></${tag}>`;
      })
      .join('');
    this.root.innerHTML = `
      <style>
        :host {
          display: flex; align-items: center; justify-content: center;
          gap: ${GAP_PX}px; min-height: ${TARGET_BUMPER_PX}px;
        }
        /* The Bar stub; discs load outward from it, heaviest at the collar. */
        .bar {
          flex: none; width: ${BAR_STUB_PX}px; height: 8px;
          background: var(--rack-muted); border-radius: 2px;
        }
        /* Real side-on sizing: height from diameter, width from thickness, both under one
           --rack-mm-scale (px per mm), floored at MIN_DISC_PX so a digit still fits. The
           fallback keeps discs sane before fit() has measured (e.g. a no-layout test). */
        .disc {
          display: flex; align-items: center; justify-content: center;
          flex: none;
          width: max(${MIN_DISC_PX}px, calc(var(--mm-w) * var(--rack-mm-scale, ${FALLBACK_SCALE}) * 1px));
          height: calc(var(--mm-d) * var(--rack-mm-scale, ${FALLBACK_SCALE}) * 1px);
          border-radius: 4px;
          background: var(--disc);
        }
        /* The kg digits, ON the plate. break-all wraps them one-per-line when the disc is
           too narrow for a horizontal number, so 2.5 stacks as 2 / . / 5 -- upright, not
           rotated. Dark ink on the light plates (white, yellow), light ink on the rest. */
        .label {
          font-family: var(--rack-font-num); font-size: 10px; font-weight: 700;
          line-height: 1.15; text-align: center; white-space: nowrap;
          color: #0f1113;
        }
        .disc[data-color="red"] .label,
        .disc[data-color="blue"] .label,
        .disc[data-color="green"] .label { color: #fff; }
        /* When interactive the disc is a <button>: strip the button chrome so it looks
           identical to the inert <div> disc, but keep it tappable. */
        button.disc {
          padding: 0; border: none; cursor: pointer;
        }
        button.disc:focus-visible { outline: 2px solid var(--rack-accent); }
      </style>
      <div class="bar" aria-hidden="true"></div>${discs}
    `;
    if (this.removable) {
      this.root.querySelectorAll<HTMLElement>('.disc').forEach((disc, i) => {
        const plate = this.plates[i];
        disc.addEventListener('click', () => this.emitRemove(plate));
      });
    }
    this.fit();
  }

  // Pick the px-per-mm scale so the row fits the host width: full zoom (MAX_SCALE) until
  // the plates would overflow, then shrink to fit (heavy bars zoom out, no horizontal
  // scroll -- ADR-0004). Each disc is floored at MIN_DISC_PX (a digit's width), so the
  // row width is a max() per plate, not a plain sum -- monotonic in the scale, so a short
  // binary search finds the largest scale that fits. No measured width yet (e.g. a
  // no-layout test) -> leave the CSS fallback in place.
  private fit(): void {
    const hostWidth = this.clientWidth;
    if (hostWidth <= 0) return; // no layout yet (e.g. a no-layout test) -> CSS fallback stands
    const avail = hostWidth - BAR_STUB_PX - GAP_PX * (this.plates.length + 1);
    const rowWidthAt = (s: number): number =>
      this.plates.reduce((px, p) => px + Math.max(p.widthMm * s, MIN_DISC_PX), 0);
    let scale: number;
    if (rowWidthAt(MAX_SCALE) <= avail) {
      scale = MAX_SCALE; // full zoom fits -> no shrink needed
    } else {
      let lo = 0;
      let hi = MAX_SCALE;
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (rowWidthAt(mid) <= avail) lo = mid;
        else hi = mid;
      }
      scale = lo;
    }
    // Guard on the resulting scale, not the width: a new Side Load re-fits at the same
    // width, while setting an unchanged scale is skipped so the ResizeObserver this
    // triggers (disc heights shift the host height) can't loop.
    if (scale === this.lastScale) return;
    this.lastScale = scale;
    this.style.setProperty('--rack-mm-scale', String(scale));
  }

  private emitRemove(plate: Plate): void {
    this.dispatchEvent(
      new CustomEvent<{ plate: Plate }>('removeplate', {
        detail: { plate },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

customElements.define('rack-sleeve', RackSleeve);
