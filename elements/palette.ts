// <rack-palette> -- the Encode add-affordance (RBAR-7, ADR-0005). A grid of tappable
// Plate keys, one per denomination, heaviest-first (the load order CONTEXT.md fixes).
// Tapping a key emits `addplate` with that Plate; the console applies the pure addPlate()
// transform. The palette holds no math -- it surfaces the active Inventory's
// denominations as taps (ADR-0001 shell).
//
// The Inventory is set by the console from the active plate set (RBAR-17, ADR-0010):
// the kg Eleiko set renders 5 columns of color keys; the lb iron set renders 3 columns
// of dark keys stamped with their lb label. Defaults to Eleiko. Keys whose Plate no
// longer fits the sleeve are disabled (RBAR-31, ADR-0012): the console feeds the used
// width via `sideMm`, and the fit check is the same plateFitsMm the core refuses
// with -- so the affordance and the refusal cannot disagree.
import { ELEIKO_KG, plateFitsMm } from '../lib/plates.ts';
import type { Plate } from '../lib/plates.ts';
import { BOX_SIZING } from './boxsizing.ts';
import { BUTTON_FX } from './buttonfx.ts';

class RackPalette extends HTMLElement {
  private root: ShadowRoot = this.attachShadow({ mode: 'open' });
  private _inventory: readonly Plate[] = ELEIKO_KG;
  private _sideMm = 0;

  /** The denominations to offer (the active set's Inventory). Assigning re-renders. */
  set inventory(plates: readonly Plate[]) {
    this._inventory = plates;
    if (this.isConnected) this.render();
  }
  get inventory(): readonly Plate[] {
    return this._inventory;
  }

  /**
   * The Side's used sleeve width (mm). Assigning re-syncs which keys are enabled --
   * a sync, not a re-render, so tapping a key never rebuilds the grid under the
   * lifter's finger.
   */
  set sideMm(mm: number) {
    this._sideMm = mm;
    if (this.isConnected) this.syncFit();
  }
  get sideMm(): number {
    return this._sideMm;
  }

  connectedCallback(): void {
    this.render();
  }

  private render(): void {
    // An iron Plate shows its stamped lb label and reads "45 lb iron"; a kg Eleiko Plate
    // shows its kg and reads "25 kg red". The iron set is narrower, so it lays out in 3
    // columns against Eleiko's 5 (the handoff's Add-palette layout).
    const iron = this._inventory.some((p) => p.color === 'iron');
    const columns = iron ? 3 : 5;
    const keys = this._inventory
      .map((p) => {
        const face = p.label ?? String(p.kg);
        const name = p.label !== undefined ? `${p.label} lb iron` : `${p.kg} kg ${p.color}`;
        return `<button type="button" class="key" data-kg="${p.kg}" data-color="${p.color}"
                 style="--disc: var(--rack-plate-${p.color})"
                 aria-label="Add ${name} Plate">${face}</button>`;
      })
      .join('');
    this.root.innerHTML = `
      <style>
        ${BOX_SIZING}${BUTTON_FX}
        :host { display: block; }
        .keys {
          display: grid; grid-template-columns: repeat(${columns}, 1fr);
          gap: 6px; justify-items: stretch; max-width: 360px; margin: 0 auto;
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
        .key[data-color="green"],
        .key[data-color="iron"] { color: #fff; }
        .key:focus-visible { outline: 2px solid var(--rack-accent); }
        /* A key whose Plate no longer fits the sleeve (ADR-0012): visibly out of
           play, not tappable. */
        .key:disabled { opacity: .35; cursor: default; }
      </style>
      <div class="keys">${keys}</div>
    `;
    this.root.querySelectorAll<HTMLButtonElement>('.key').forEach((key, i) => {
      const plate = this._inventory[i];
      key.addEventListener('click', () => this.emit(plate));
    });
    this.syncFit();
  }

  // Disable the keys whose Plate would overrun the sleeve (ADR-0012). Same key order
  // as the Inventory (the render just mapped it), mirroring the click wiring above.
  private syncFit(): void {
    this.root.querySelectorAll<HTMLButtonElement>('.key').forEach((key, i) => {
      key.disabled = !plateFitsMm(this._sideMm, this._inventory[i]);
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
