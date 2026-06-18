// <rack-sleeve> -- one loaded Side of the Bar, drawn as colored discs with the
// heaviest at the collar (CONTEXT.md: a Side Load is the Plates on one Side).
// WALKING SKELETON (RBAR-2): a flat row of uniform discs in the Eleiko colors.
// Real diameter-based sizing (ADR-0004) and the bar/collar graphic land in RBAR-9.
//
// In Encode (RBAR-7, ADR-0005) the sleeve is `interactive`: each disc becomes a
// button that emits `removeplate` with its Plate, so tapping a loaded Plate takes it
// off. In Decode the discs are inert -- the graphic is identical, only the affordance
// differs. The sleeve still holds no plate math; it emits intent and the console
// applies the pure removePlate() transform.
import type { Plate } from '../lib/plates.ts';

class RackSleeve extends HTMLElement {
  private root: ShadowRoot = this.attachShadow({ mode: 'open' });
  private plates: readonly Plate[] = [];
  private removable = false;

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
    this.render();
  }

  private render(): void {
    // A button in Encode (tappable to remove), an inert div in Decode. Both keep the
    // `.disc` class and data-* tags, so the display contract is unchanged.
    const tag = this.removable ? 'button' : 'div';
    const attrs = this.removable ? ' type="button"' : '';
    const discs = this.plates
      .map(
        (p) =>
          `<${tag}${attrs} class="disc" data-kg="${p.kg}" data-color="${p.color}" style="--disc: var(--rack-plate-${p.color})"${this.removable ? ` aria-label="Remove ${p.kg} kg ${p.color} Plate"` : ''}><span>${p.kg}</span></${tag}>`,
      )
      .join('');
    this.root.innerHTML = `
      <style>
        :host {
          display: flex; align-items: center; justify-content: center;
          gap: 3px; min-height: 120px;
        }
        /* The Bar stub; discs load outward from it, heaviest at the collar. */
        .bar {
          width: 32px; height: 8px;
          background: var(--rack-muted); border-radius: 2px;
        }
        .disc {
          display: flex; align-items: center; justify-content: center;
          width: 26px; height: 96px; border-radius: 5px;
          background: var(--disc);
          font-family: var(--rack-font-num); font-size: 11px; font-weight: 600;
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
