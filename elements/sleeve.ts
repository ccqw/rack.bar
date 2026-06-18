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
const TARGET_BUMPER_PX = 150;
const MAX_SCALE = TARGET_BUMPER_PX / BUMPER_MM; // px per mm at full zoom
const GAP_PX = 2;
const BAR_STUB_PX = 32;
const FALLBACK_SCALE = MAX_SCALE; // used when the host has no measured width yet

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
    // carries its real mm as --mm-d (diameter -> height) and --mm-w (thickness ->
    // width); CSS multiplies them by the shared --rack-mm-scale (px per mm) that fit()
    // sets, so the whole row scales together (ADR-0004).
    const tag = this.removable ? 'button' : 'div';
    const attrs = this.removable ? ' type="button"' : '';
    const discs = this.plates
      .map((p) => {
        const style = `--disc: var(--rack-plate-${p.color}); --mm-d: ${p.diameterMm}; --mm-w: ${p.widthMm}`;
        // Both modes expose the kg + color to assistive tech; only Encode adds the
        // "Remove" verb (the disc is a button there).
        const label = this.removable
          ? ` aria-label="Remove ${p.kg} kg ${p.color} Plate"`
          : ` aria-label="${p.kg} kg ${p.color} Plate"`;
        return `<${tag}${attrs} class="disc" data-kg="${p.kg}" data-color="${p.color}" style="${style}"${label}><span>${p.kg}</span></${tag}>`;
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
          width: ${BAR_STUB_PX}px; height: 8px;
          background: var(--rack-muted); border-radius: 2px;
        }
        /* Real side-on sizing: height from diameter, width from thickness, both under
           one --rack-mm-scale (px per mm). The fallback keeps discs sane before fit()
           has measured (e.g. in a no-layout test environment). */
        .disc {
          display: flex; align-items: center; justify-content: center;
          flex: none;
          width: calc(var(--mm-w) * var(--rack-mm-scale, ${FALLBACK_SCALE}) * 1px);
          height: calc(var(--mm-d) * var(--rack-mm-scale, ${FALLBACK_SCALE}) * 1px);
          border-radius: 4px;
          background: var(--disc);
          font-family: var(--rack-font-num); font-size: 10px; font-weight: 600;
          line-height: 1; overflow: hidden;
          /* Discs are tall and thin at real proportions; read the kg down the disc so
             it fits a bumper rather than spilling out the sides. */
          writing-mode: vertical-rl;
          color: #0f1113; /* white Plate needs dark ink */
        }
        .disc[data-color="red"],
        .disc[data-color="blue"],
        .disc[data-color="green"] { color: #fff; }
        /* When interactive the disc is a <button>: strip the button chrome so it
           looks identical to the inert <div> disc, but keep it tappable. Note: do not
           set font:inherit here -- that pulls in the host font and defeats the .disc
           rule's monospace, making Encode discs look different from Decode. */
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

  // Pick the px-per-mm scale so the row fits the host width: full zoom (MAX_SCALE)
  // until the plates would overflow, then shrink to fit (heavy bars zoom out, no
  // horizontal scroll -- ADR-0004). No measured width yet (e.g. a no-layout test) ->
  // leave the CSS fallback in place.
  private fit(): void {
    const hostWidth = this.clientWidth;
    if (hostWidth <= 0) return; // no layout yet (e.g. a no-layout test) -> CSS fallback stands
    const totalThicknessMm = this.plates.reduce((mm, p) => mm + p.widthMm, 0);
    const avail = hostWidth - BAR_STUB_PX - GAP_PX * (this.plates.length + 1);
    const fitScale = totalThicknessMm > 0 ? avail / totalThicknessMm : MAX_SCALE;
    const scale = Math.min(MAX_SCALE, Math.max(0, fitScale));
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
