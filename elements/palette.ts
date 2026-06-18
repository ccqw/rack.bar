// <rack-palette> -- the Encode add-affordance (RBAR-7, ADR-0005). A row of tappable
// Plate keys in the Eleiko colors, one per denomination, heaviest-first (the load
// order CONTEXT.md fixes). Tapping a key emits `addplate` with that Plate; the console
// applies the pure addPlate() transform. The palette holds no state and no math -- it
// only surfaces the Inventory's denominations as taps (ADR-0001 shell).
import { ELEIKO_KG } from '../lib/plates.ts';
import type { Plate } from '../lib/plates.ts';

class RackPalette extends HTMLElement {
  private root: ShadowRoot = this.attachShadow({ mode: 'open' });

  connectedCallback(): void {
    const keys = ELEIKO_KG.map(
      (p) =>
        `<button type="button" class="key" data-kg="${p.kg}" data-color="${p.color}"
                 style="--disc: var(--rack-plate-${p.color})"
                 aria-label="Add ${p.kg} kg ${p.color} Plate">${p.kg}</button>`,
    ).join('');
    this.root.innerHTML = `
      <style>
        :host { display: block; }
        .keys {
          display: flex; flex-wrap: wrap; gap: 6px; justify-content: center;
        }
        .key {
          min-width: 44px; min-height: 44px; padding: 0 10px;
          border: 1px solid var(--rack-line); border-radius: var(--rack-radius);
          background: var(--disc);
          font-family: var(--rack-font-num); font-size: 14px; font-weight: 600;
          color: var(--rack-bg); /* light Plates need dark ink */
          cursor: pointer;
        }
        .key[data-color="red"],
        .key[data-color="blue"],
        .key[data-color="green"] { color: #fff; }
        .key:focus-visible { outline: 2px solid var(--rack-accent); }
      </style>
      <div class="keys">${keys}</div>
    `;
    this.root.querySelectorAll<HTMLButtonElement>('.key').forEach((key, i) => {
      const plate = ELEIKO_KG[i];
      key.addEventListener('click', () => this.emit(plate));
    });
  }

  private emit(plate: Plate): void {
    this.dispatchEvent(
      new CustomEvent<{ plate: Plate }>('addplate', {
        detail: { plate },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

customElements.define('rack-palette', RackPalette);
