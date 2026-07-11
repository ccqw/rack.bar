// <rack-sleeve> -- one loaded Side of the Bar, drawn side-on as a centered barbell
// (handoff section 3 "Bar visualizer"): a sleeve shaft running toward the bar's center,
// an inner collar, the loaded discs heaviest-first from the inside out, then an end
// collar and end cap -- a complete sleeve, not a one-sided strip. The chrome is fixed
// grey furniture (--rack-sleeve-*); only the discs carry weight. A bare Bar shows a
// dashed empty box with a + where the discs would load, still framed by the chrome.
// Each disc is sized from its Plate's REAL dimensions (ADR-0004): height tracks the
// plate's diameter, width its thickness, so the four 450 mm competition bumpers read
// as equal-height and differ only in fatness, while the 5 kg and change plates nest
// down. The whole row scales under one fit-to-width factor so a heavy bar zooms out
// rather than overflowing. Discs are filled with the handoff's top-lit gradient over
// their plate hex and lifted by --rack-shadow-disc. The element stays purely
// presentational (ADR-0001): given a Side Load it draws it, holding no plate math.
//
// In Encode (RBAR-7, ADR-0005) the sleeve is `interactive`: each disc becomes a
// button that emits `removeplate` with its Plate, so tapping a loaded Plate takes it
// off. In Decode the discs are inert -- the graphic is identical, only the affordance
// differs. The sleeve still holds no plate math; it emits intent and the console
// applies the pure removePlate() transform.
import type { Plate } from '../lib/plates.ts';
import { BOX_SIZING } from './boxsizing.ts';
import { BUTTON_FX } from './buttonfx.ts';
import { DISC_FILL } from './discfill.ts';

// Fit-to-width scale (ADR-0004). A bumper is 450 mm; cap the zoom so a normal load
// renders at a comfortable fixed size and only a genuinely huge bar (whose plates
// would overflow the host width) zooms below this. px-per-mm = MAX_SCALE until the
// row no longer fits, then it shrinks to fit. Gaps between discs are fixed px.
const BUMPER_MM = 450;
const TARGET_BUMPER_PX = 168; // the prototype's cap (MAX_SCALE 168/450) so proportions match the handoff
const MAX_SCALE = TARGET_BUMPER_PX / BUMPER_MM; // px per mm at full zoom
// The visualizer block reserves the handoff's fixed height (README section 3: "204px
// tall block") so the console column doesn't jump as the load grows and shrinks.
const BLOCK_PX = 204;
// Bar chrome (handoff section 3): the fixed-px furniture framing the discs -- a sleeve
// shaft + inner collar on the loaded end, an end collar + cap on the far end. The chrome
// doesn't scale with the plates, so fit() reserves its total width. The discs sit flush to
// the inner collar; DISC_GAP_PX separates adjacent discs, END_GAP_PX sits before the end
// collar -- so the fixed budget fit() subtracts is the four pieces plus those gaps.
const SHAFT_PX = 52;
const COLLAR_INNER_PX = 11;
const COLLAR_END_PX = 8;
const CAP_PX = 13;
const CHROME_PX = SHAFT_PX + COLLAR_INNER_PX + COLLAR_END_PX + CAP_PX;
const DISC_GAP_PX = 1.5; // between adjacent discs (the first sits flush to the inner collar)
const END_GAP_PX = 3; // between the last disc (or empty box) and the end collar
// Floor each disc at the prototype's minimum so a thin change plate keeps a visible
// sliver (far narrower than a bumper -- the size cue holds). The floor puts a hard
// minimum under the row width that no scale can shrink, so fit() pairs it with the
// prototype's proportional overflow guard (see fit()).
const MIN_DISC_PX = 9;
const FALLBACK_SCALE = MAX_SCALE; // used when the host has no measured width yet

// The engraved numeral treatment (handoff section 3): the numeral runs UP the disc face
// (rotated -90deg), so in fullscreen -- where the whole bar rotates +90deg -- it reads
// upright (supersedes RBAR-24's rotate-with-bar note). Its size buckets by the disc's
// rendered width; a disc too narrow for the glyph height, or too short to seat all its
// rotated digits, shows no numeral at all (never stacked or clipped digits).
function numeralPx(discW: number): number {
  return discW >= 16 ? 11 : discW >= 11 ? 9 : 8;
}
function numeralFits(discW: number, discH: number, text: string): boolean {
  const px = numeralPx(discW);
  return discW >= px - 1 && discH >= text.length * px * 0.6 + 4;
}

// The visible disc caption. An iron Plate carries its own stamped lb `label` (e.g.
// "45", "2.5"); a kg Eleiko Plate derives it from its kg. Lifters read "point five", so
// drop the leading zero on the sub-1 change plates (0.5 -> .5) -- narrower and natural --
// while 1.5 / 2.5 keep theirs. The full name still goes to assistive tech via aria-label.
function plateLabel(plate: Plate): string {
  if (plate.label !== undefined) return plate.label;
  return plate.kg < 1 ? String(plate.kg).replace(/^0/, '') : String(plate.kg);
}

class RackSleeve extends HTMLElement {
  private root: ShadowRoot = this.attachShadow({ mode: 'open' });
  private plates: readonly Plate[] = [];
  private removable = false;
  private resize?: ResizeObserver;
  private lastScale = NaN;
  private lastShrink = NaN;

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
    // the whole row scales together (ADR-0004). The engraved kg numeral sits ON the disc;
    // its size and visibility depend on the disc's RENDERED width, so fit() styles it
    // per disc via data-numeral after picking the scale.
    const tag = this.removable ? 'button' : 'div';
    const attrs = this.removable ? ' type="button"' : '';
    const discs = this.plates
      .map((p) => {
        const style = `--disc: var(--rack-plate-${p.color}); --mm-d: ${p.diameterMm}; --mm-w: ${p.widthMm}`;
        // The accessible name: an iron Plate is named by its stamped lb face ("45 lb
        // iron"), an Eleiko Plate by its kg + color ("25 kg red"). Only Encode adds the
        // "Remove" verb; the on-disc digits are decorative (aria-label carries the name).
        const name =
          p.label !== undefined ? `${p.label} lb iron` : `${p.kg} kg ${p.color}`;
        const aria = this.removable
          ? ` aria-label="Remove ${name} Plate"`
          : ` aria-label="${name} Plate"`;
        return `<${tag}${attrs} class="disc" data-kg="${p.kg}" data-color="${p.color}" style="${style}"${aria}><span class="label" aria-hidden="true">${plateLabel(p)}</span></${tag}>`;
      })
      .join('');
    // The loaded middle: discs heaviest-first, or a dashed empty box on a bare Bar. Either
    // way the chrome (shaft + collars + cap) frames it, so a bare Bar still reads as a
    // barbell, not a stub (handoff section 3).
    const middle =
      this.plates.length === 0 ? '<span class="empty" aria-hidden="true">+</span>' : discs;
    this.root.innerHTML = `
      <style>
        ${BOX_SIZING}${BUTTON_FX}
        :host {
          display: flex; align-items: center; justify-content: center;
          min-height: ${BLOCK_PX}px;
        }
        /* The sleeve chrome (handoff section 3): a centered shaft running toward the bar's
           center, an inner collar, then (after the discs) an end collar + cap. Fixed-px grey
           furniture; the pieces touch so the shaft + collar read as one continuous bar. */
        .shaft {
          flex: none; width: ${SHAFT_PX}px; height: 9px;
          border-radius: 4px 0 0 4px; background: var(--rack-sleeve-shaft);
        }
        .collar { flex: none; background: var(--rack-sleeve-collar); }
        .collar-inner { width: ${COLLAR_INNER_PX}px; height: 34px; border-radius: 3px; }
        .collar-end {
          width: ${COLLAR_END_PX}px; height: 20px; border-radius: 2px;
          margin-left: ${END_GAP_PX}px; background: var(--rack-sleeve-end);
        }
        .cap {
          flex: none; width: ${CAP_PX}px; height: 11px;
          border-radius: 1px 5px 5px 1px; background: var(--rack-sleeve-shaft);
        }
        /* A bare Bar: a dashed outline box with a + where the discs would load. */
        .empty {
          flex: none; width: 34px; height: 120px; margin-left: 5px;
          display: flex; align-items: center; justify-content: center;
          border: 1.5px dashed var(--rack-sleeve-empty); border-radius: 6px;
          color: var(--rack-sleeve-empty-glyph);
          font-family: var(--rack-font-num); font-size: 20px; font-weight: 600;
        }
        /* Real side-on sizing: height from diameter, width from thickness, both under one
           --rack-mm-scale (px per mm), floored at MIN_DISC_PX so a thin plate keeps a
           sliver. --rack-fit-shrink is fit()'s overflow guard: normally 1, it shrinks
           every disc proportionally (width AND height) when even the floored row would
           overflow. The fallbacks keep discs sane before fit() has measured (e.g. a
           no-layout test). The fill is the shared top-lit disc recipe (RBAR-42,
           elements/discfill.ts), lifted by the shared disc shadow; the first disc sits
           flush to the inner collar, later ones are spaced by DISC_GAP_PX. overflow:
           hidden clips a rotated numeral that outgrows its disc mid-resize. */
        .disc {
          display: flex; align-items: center; justify-content: center;
          flex: none;
          width: calc(max(${MIN_DISC_PX}px, var(--mm-w) * var(--rack-mm-scale, ${FALLBACK_SCALE}) * 1px) * var(--rack-fit-shrink, 1));
          height: calc(var(--mm-d) * var(--rack-mm-scale, ${FALLBACK_SCALE}) * 1px * var(--rack-fit-shrink, 1));
          border-radius: 4px;
          overflow: hidden;
          ${DISC_FILL}
          box-shadow: var(--rack-shadow-disc);
        }
        .disc + .disc { margin-left: ${DISC_GAP_PX}px; }
        /* The engraved kg numeral, rotated -90deg to run UP the disc face (handoff
           section 3) -- so the fullscreen card's +90deg bar rotation lands it upright.
           fit() sets data-numeral to the width bucket (11/9/8) or withholds it when the
           digits can't fit, so a too-thin disc shows no numeral. Dark ink on the light
           plates (white, yellow) with a light engrave lip; light ink on the rest with a
           dark engrave seat. */
        .label {
          font-family: var(--rack-font-num); font-weight: 800; line-height: 1;
          letter-spacing: .04em; white-space: nowrap;
          transform: rotate(-90deg);
          display: none;
          color: #0f1113;
          text-shadow: 0 1px 0 rgba(255,255,255,.3);
        }
        .disc[data-numeral="11"] .label { display: block; font-size: 11px; }
        .disc[data-numeral="9"] .label { display: block; font-size: 9px; }
        .disc[data-numeral="8"] .label { display: block; font-size: 8px; }
        .disc[data-color="red"] .label,
        .disc[data-color="blue"] .label,
        .disc[data-color="green"] .label,
        .disc[data-color="iron"] .label {
          color: #fff;
          text-shadow: 0 1px 1px rgba(0,0,0,.4);
        }
        /* When interactive the disc is a <button>: strip the button chrome so it looks
           identical to the inert <div> disc, but keep it tappable. */
        button.disc {
          padding: 0; border: none; cursor: pointer;
        }
        button.disc:focus-visible { outline: 2px solid var(--rack-accent); }
      </style>
      <span class="shaft" aria-hidden="true"></span>
      <span class="collar collar-inner" aria-hidden="true"></span>${middle}<span class="collar collar-end" aria-hidden="true"></span>
      <span class="cap" aria-hidden="true"></span>
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
  // scroll -- ADR-0004). Each disc is floored at MIN_DISC_PX, so the row width is a
  // max() per plate, not a plain sum -- monotonic in the scale, so a short binary search
  // finds the largest scale that fits. The floor also puts a hard minimum under the row
  // that no scale can shrink, so a wall of floored thin plates can still overflow: the
  // prototype's overflow guard then shrinks every disc proportionally (width AND height,
  // preserving aspect) below the floor. No measured width yet (e.g. a no-layout test) ->
  // leave the CSS fallbacks in place but still style the numerals for full zoom.
  private fit(): void {
    const hostWidth = this.clientWidth;
    if (hostWidth <= 0) {
      this.styleNumerals(FALLBACK_SCALE, 1);
      return;
    }
    // Reserve the fixed chrome (shaft + both collars + cap) plus the gaps the discs add:
    // END_GAP_PX before the end collar, and DISC_GAP_PX between each adjacent disc pair (the
    // first disc sits flush to the inner collar, so N discs add N-1 inter-disc gaps).
    const discGaps = DISC_GAP_PX * Math.max(0, this.plates.length - 1);
    const avail = hostWidth - CHROME_PX - END_GAP_PX - discGaps;
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
    const row = rowWidthAt(scale);
    const shrink = row > avail ? Math.max(0, avail) / row : 1;
    // Set each property only when it changed: a new Side Load re-fits at the same width,
    // while re-setting unchanged values is skipped so the ResizeObserver this triggers
    // (disc heights shift the host height) can't loop.
    if (scale !== this.lastScale) {
      this.lastScale = scale;
      this.style.setProperty('--rack-mm-scale', String(scale));
    }
    if (shrink !== this.lastShrink) {
      this.lastShrink = shrink;
      this.style.setProperty('--rack-fit-shrink', String(shrink));
    }
    this.styleNumerals(scale, shrink);
  }

  // Tag each disc with its numeral bucket -- or untag it when the digits can't fit --
  // from the same final px dims the CSS renders (floored width, guard shrink applied
  // to both axes). Runs on every fit(): after a render the discs are fresh DOM that
  // needs tagging even at an unchanged scale, and re-setting an unchanged data
  // attribute is inert (labels live inside fixed-size discs, so no resize feedback).
  private styleNumerals(scale: number, shrink: number): void {
    this.root.querySelectorAll<HTMLElement>('.disc').forEach((disc, i) => {
      const p = this.plates[i];
      const w = Math.max(p.widthMm * scale, MIN_DISC_PX) * shrink;
      const h = p.diameterMm * scale * shrink;
      if (numeralFits(w, h, plateLabel(p))) disc.dataset.numeral = String(numeralPx(w));
      else delete disc.dataset.numeral;
    });
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
