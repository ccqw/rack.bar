// <rack-sleeve> -- one loaded Side of the Bar, drawn side-on as a centered barbell
// (handoff section 3 "Bar visualizer"): a sleeve shaft running toward the bar's center,
// an inner collar, the loaded discs heaviest-first from the inside out, then a bare
// sleeve stub to a plain rounded end (RBAR-96) -- a complete sleeve, not a one-sided
// strip. The chrome is fixed grey furniture (--rack-sleeve-*); only the discs carry
// weight. When Setup's collars are on (`collars`) and the Bar has Plates, a flat Collar
// clamps the outer disc; a bare Bar never gets one. A bare Bar shows a dashed empty box
// with a + where the discs would load, still framed by the chrome.
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
import {
  BARE_END_H_PX,
  BARE_END_PX,
  COLLAR_GAP_PX,
  COLLAR_INNER_H_PX,
  COLLAR_INNER_PX,
  COLLAR_MM,
  COLLAR_PX,
  DISC_GAP_PX,
  DISC_INK,
  EMPTY_INSET_PX,
  EMPTY_MM,
  EMPTY_W_PX,
  COLLAR_EDGE_PX,
  LATCH_LEFT_PX,
  LATCH_PX,
  LATCH_TOP_PX,
  MAX_SCALE,
  MIN_DISC_PX,
  SHAFT_H_PX,
  collarDrawn,
  grownMaxScale,
  SHAFT_PX,
  SLEEVE_BLOCK_PX,
  numeralFits,
  numeralPx,
  plateLabel,
  sleeveFit,
} from '../lib/sleevefit.ts';

// The sizing rules (fit-to-width scale, chrome, gaps, the disc floor, the numeral
// buckets) live in lib/sleevefit.ts since RBAR-70, so the shared loadout picture draws
// by the same rules. A bumper is 450 mm; MAX_SCALE caps the zoom so a normal load
// renders at a comfortable fixed size and only a genuinely huge bar zooms below it.
//
// The visualizer block's heights live in lib/sleevefit.ts too (RBAR-70): the handoff's
// fixed 204px block (README section 3) is the standalone default (the fullscreen card),
// and the console flexes the sleeve between SLEEVE_MIN_PX and it (RBAR-67), so a short
// phone gets a shorter Bar picture instead of a page that scrolls. Re-exported here for
// the console, which sizes its bar block from them.
export { SLEEVE_BLOCK_PX, SLEEVE_MIN_PX, SLEEVE_PAD_PX } from '../lib/sleevefit.ts';
const FALLBACK_SCALE = MAX_SCALE; // used when the host has no measured width yet

class RackSleeve extends HTMLElement {
  private root: ShadowRoot = this.attachShadow({ mode: 'open' });
  private plates: readonly Plate[] = [];
  private removable = false;
  private collarsOn = false;
  private numeralsOn = true;
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

  /** Whether Setup's collars are on (RBAR-96): a Collar is drawn on the outer disc when
   * they are and the Bar has Plates. Setting a new value re-renders. */
  set collars(on: boolean) {
    if (on === this.collarsOn) return;
    this.collarsOn = on;
    this.render();
  }
  get collars(): boolean {
    return this.collarsOn;
  }

  /** Whether the discs show their engraved numbers (default on). The Loadout quiz
   * (RBAR-92) turns them off to drill colours; an iron Plate keeps its stamp either way,
   * since iron has no colour to read. Setting it re-tags the discs, no re-render. */
  set numerals(on: boolean) {
    if (on === this.numeralsOn) return;
    this.numeralsOn = on;
    this.fit();
  }
  get numerals(): boolean {
    return this.numeralsOn;
  }

  connectedCallback(): void {
    // Re-fit when the host's width or height changes (rotation, resize, the console's
    // flex column growing or shrinking the sleeve -- RBAR-67). ResizeObserver, not
    // requestAnimationFrame, so it is not paused in a backgrounded tab; both host
    // dimensions are set by the parent (not by disc size -- see fit()), so setting the
    // scale can't feed back into a resize loop -- and fit() skips re-setting unchanged
    // scale/shrink values.
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
    // way the chrome (shaft + inner collar + bare end) frames it, so a bare Bar still
    // reads as a barbell (handoff section 3). The Collar, when drawn, clamps the outer
    // disc (RBAR-96); it is decoration -- the Total already counts it.
    const middle =
      this.plates.length === 0 ? '<span class="empty" aria-hidden="true">+</span>' : discs;
    const collar = collarDrawn(this.plates, this.collarsOn)
      ? '<span class="collar collar-on" aria-hidden="true"></span>'
      : '';
    this.root.innerHTML = `
      <style>
        ${BOX_SIZING}${BUTTON_FX}
        :host {
          display: flex; align-items: center; justify-content: center;
          min-height: ${SLEEVE_BLOCK_PX}px;
        }
        /* The sleeve chrome (handoff section 3; end redrawn by RBAR-96): a centered shaft
           running toward the bar's center, an inner collar, then (after the discs) a bare
           sleeve stub to a plain rounded end. Fixed-px grey furniture; the pieces touch so
           the shaft + collar read as one continuous bar. */
        .shaft {
          flex: none; width: ${SHAFT_PX}px; height: ${SHAFT_H_PX}px;
          border-radius: 4px 0 0 4px; background: var(--rack-sleeve-shaft);
        }
        .collar { flex: none; background: var(--rack-sleeve-collar); }
        .collar-inner { width: ${COLLAR_INNER_PX}px; height: ${COLLAR_INNER_H_PX}px; border-radius: 3px; }
        .bare-end {
          flex: none; width: ${BARE_END_PX}px; height: ${BARE_END_H_PX}px;
          border-radius: 0 5px 5px 0; background: var(--rack-sleeve-shaft);
        }
        /* The Collar on the outer disc (RBAR-96, "look 2 flat"): a solid collar-grey
           block with one 1px edge, 92 mm tall on the disc scale (so it shrinks with the
           discs), and a flat red latch standing on top. No gradient, no number. */
        .collar-on {
          position: relative;
          width: ${COLLAR_PX}px; margin-left: ${COLLAR_GAP_PX}px; border-radius: 3px;
          height: calc(var(--rack-mm-scale, ${FALLBACK_SCALE}) * ${COLLAR_MM}px * var(--rack-fit-shrink, 1));
          border: ${COLLAR_EDGE_PX}px solid var(--rack-sleeve-end);
        }
        .collar-on::after {
          content: ""; position: absolute;
          top: ${LATCH_TOP_PX - COLLAR_EDGE_PX}px; left: ${LATCH_LEFT_PX - COLLAR_EDGE_PX}px;
          width: ${LATCH_PX}px; height: ${LATCH_PX}px;
          border-radius: 2px 2px 0 0; background: var(--rack-plate-red);
        }
        /* A bare Bar: a dashed outline box with a + where the discs would load. Its
           120px height (prototype L104) rides the same --rack-mm-scale as the discs --
           EMPTY_MM is 120px at full zoom -- so a height-fitted short sleeve (RBAR-67)
           shrinks the box with the bumpers it stands in for. */
        .empty {
          flex: none; width: ${EMPTY_W_PX}px; margin-left: ${EMPTY_INSET_PX}px;
          height: calc(var(--rack-mm-scale, ${FALLBACK_SCALE}) * ${EMPTY_MM}px);
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
          color: ${DISC_INK.dark};
          text-shadow: ${DISC_INK.darkEngrave};
        }
        .disc[data-numeral="11"] .label { display: block; font-size: 11px; }
        .disc[data-numeral="9"] .label { display: block; font-size: 9px; }
        .disc[data-numeral="8"] .label { display: block; font-size: 8px; }
        .disc[data-color="red"] .label,
        .disc[data-color="blue"] .label,
        .disc[data-color="green"] .label,
        .disc[data-color="iron"] .label {
          color: ${DISC_INK.light};
          text-shadow: ${DISC_INK.lightEngrave};
        }
        /* When interactive the disc is a <button>: strip the button chrome so it looks
           identical to the inert <div> disc, but keep it tappable. */
        button.disc {
          padding: 0; border: none; cursor: pointer;
        }
        button.disc:focus-visible { outline: 2px solid var(--rack-accent); }
      </style>
      <span class="shaft" aria-hidden="true"></span>
      <span class="collar collar-inner" aria-hidden="true"></span>${middle}${collar}<span class="bare-end" aria-hidden="true"></span>
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
  //
  // The zoom cap is ALSO bounded by the host's height (RBAR-67): the console flexes the
  // sleeve with the viewport, so a short host lowers the cap until a bumper (the tallest
  // Plate) stands SLEEVE_PAD_PX shorter than the host. A tall host never zooms past
  // MAX_SCALE (in the Home Screen app, past grownMaxScale: RBAR-99); an unmeasured height
  // (0) leaves the width fit alone.
  private fit(): void {
    const hostWidth = this.clientWidth;
    if (hostWidth <= 0) {
      this.styleNumerals(FALLBACK_SCALE, 1);
      return;
    }
    // The height-bounded zoom cap and the width fit are lib/sleevefit's sleeveFit, the
    // same fit the share picture draws with (RBAR-70). A drawn Collar takes its width
    // from the discs (RBAR-96).
    const { scale, shrink } = sleeveFit(
      this.plates,
      hostWidth,
      this.clientHeight,
      this.collarsOn,
      // RBAR-99: where the embedder opts in (--rack-sleeve-grow: the console maps the
      // Home Screen app's --rack-bar-grow onto its sleeve) a tall host may zoom past the
      // handoff's 168px bumper, up to a share of the host's width. Unset: NaN, no grow.
      grownMaxScale(
        hostWidth,
        parseFloat(getComputedStyle(this).getPropertyValue('--rack-sleeve-grow')),
      ),
    );
    // Set each property only when it changed -- a new Side Load re-fits at the same
    // width without churning the host's inline style. (Layout can't feed back into a
    // resize loop regardless: the host width is parent-bounded, and its height is either
    // the SLEEVE_BLOCK_PX min-height or set by the console's flex column -- never by the
    // discs, which the cap above keeps shorter than the host -- so neither property
    // moves the host size.)
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
      const shown = this.numeralsOn || p.color === 'iron';
      if (shown && numeralFits(w, h, plateLabel(p))) disc.dataset.numeral = String(numeralPx(w));
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
