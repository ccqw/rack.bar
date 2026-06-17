// <rack-sleeve> -- one loaded end of the Bar (a Side), drawn as colored discs with
// the heaviest at the collar (CONTEXT.md: a Side Load is the Plates on one Side).
// WALKING SKELETON (RBAR-2): a flat row of uniform discs in the Eleiko colors.
// Real diameter-based sizing (ADR-0004) and the bar/collar graphic land in RBAR-9.
import type { Plate } from '../lib/plates.ts';

class RackSleeve extends HTMLElement {
  private root: ShadowRoot = this.attachShadow({ mode: 'open' });
  private plates: readonly Plate[] = [];

  /** The Side Load to draw, heaviest-first. Setting it re-renders. */
  set sideLoad(plates: readonly Plate[]) {
    this.plates = plates;
    this.render();
  }
  get sideLoad(): readonly Plate[] {
    return this.plates;
  }

  connectedCallback(): void {
    this.render();
  }

  private render(): void {
    const discs = this.plates
      .map(
        (p) =>
          `<div class="disc" data-kg="${p.kg}" data-color="${p.color}" style="--disc: var(--rack-plate-${p.color})"><span>${p.kg}</span></div>`,
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
      </style>
      <div class="bar" aria-hidden="true"></div>${discs}
    `;
  }
}

customElements.define('rack-sleeve', RackSleeve);
