// <rack-palette> -- the Encode add-affordance (RBAR-7, ADR-0005). A grid of tappable
// Plate keys, one per denomination, heaviest-first (the load order CONTEXT.md fixes).
// Tapping a key emits `addplate` with that Plate; the console applies the pure addPlate()
// transform. The palette holds no math -- it surfaces the active Inventory's
// denominations as taps (ADR-0001 shell). Its head row carries the handoff-4b "Add"
// section label, with a "Sleeve full" warning surfacing beside it when NO remaining
// Plate fits (RBAR-54) -- real text, so a full sleeve is never signalled by dimming
// alone.
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
import { SHORT_SCREEN } from './fit.ts';
import { DISC_FILL } from './discfill.ts';
import { SECTION_LABEL } from './sectionlabel.ts';

class RackPalette extends HTMLElement {
  private root: ShadowRoot = this.attachShadow({ mode: 'open' });
  private warn!: HTMLElement;
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
        /* The Add head row (handoff 4b): section label left, the conditional "Sleeve
           full" warning right. Same 360px rail as the key grid so they stay aligned. */
        .head {
          display: flex; align-items: center; justify-content: space-between;
          max-width: 360px; margin: 0 auto 8px;
        }
        /* The label doubles as the section's heading (RBAR-53): h2 for SR
           navigation, margins pinned so the head row's flex geometry is unchanged. */
        .label { ${SECTION_LABEL} margin: 0; }
        /* The "Sleeve full" warning (RBAR-54): the status pill's uppercase-mono
           state-dot vocabulary in the ACCENT ink, per the handoff (L210 -- #f5c518 is
           --rb-accent there) and matching By Weight's "Bar at capacity" twin (accent
           dot, L142). Accent = attention in this world; danger red is reserved for
           destructive Clear. Accent also reads at ~11:1 on Platform Black where the
           red sat near 4:1, and does not clash with the lit red discs beside it.
           Real text beside the label, not color/opacity alone. */
        .full {
          display: inline-flex; align-items: center; gap: 5px;
          font-family: var(--rack-font-num); font-size: 10px; font-weight: 600;
          letter-spacing: .1em; text-transform: uppercase; line-height: 1;
          color: var(--rack-accent);
        }
        .full[hidden] { display: none; }
        .full .dot {
          width: 5px; height: 5px; border-radius: 999px; flex: none;
          background: var(--rack-accent);
        }
        .keys {
          display: grid; grid-template-columns: repeat(${columns}, 1fr);
          gap: 7px; justify-items: stretch; max-width: 360px; margin: 0 auto;
        }
        /* A key is a borderless slab of its Plate's color -- the shared top-lit disc
           fill with its own soft lift (prototype L831). */
        .key {
          height: 44px; padding: 0;
          border: none; border-radius: 12px;
          ${DISC_FILL}
          box-shadow: inset 0 0 0 1px rgba(255,255,255,.1), 0 1px 3px rgba(0,0,0,.2);
          font-family: var(--rack-font); font-size: 15px; font-weight: 700;
          color: var(--rack-bg); /* light Plates need dark ink */
          cursor: pointer;
        }
        .key[data-color="red"],
        .key[data-color="blue"],
        .key[data-color="green"],
        .key[data-color="iron"] { color: #fff; }
        .key:focus-visible { outline: 2px solid var(--rack-accent); }
        /* A key whose Plate no longer fits the sleeve (ADR-0012): visibly out of
           play, not tappable (handoff 4b: 30%, not-allowed). */
        .key:disabled { opacity: .3; cursor: not-allowed; }
        /* The short-screen tier (RBAR-67, fit.ts): a closer head row; the 44px keys
           keep their height. */
        @media ${SHORT_SCREEN} {
          .head { margin-bottom: 4px; }
        }
      </style>
      <div class="head">
        <h2 class="label">Add</h2>
        <span class="full" data-sleeve-full hidden
          ><span class="dot" aria-hidden="true"></span>Sleeve full</span>
      </div>
      <div class="keys">${keys}</div>
    `;
    this.warn = this.root.querySelector('[data-sleeve-full]')!;
    this.root.querySelectorAll<HTMLButtonElement>('.key').forEach((key, i) => {
      const plate = this._inventory[i];
      key.addEventListener('click', () => this.emit(plate));
    });
    this.syncFit();
  }

  // Disable the keys whose Plate would overrun the sleeve (ADR-0012). Same key order
  // as the Inventory (the render just mapped it), mirroring the click wiring above.
  // The "Sleeve full" warning (RBAR-54) derives from these SAME per-key fit checks:
  // it shows exactly when every key is out of play, so the warning and the dimming
  // cannot disagree. An empty Inventory has no Plate to add at all, which is not a
  // sleeve-room problem (the guard lib/plates' atSleeveCapacity also keeps).
  private syncFit(): void {
    let anyFits = false;
    this.root.querySelectorAll<HTMLButtonElement>('.key').forEach((key, i) => {
      const fits = plateFitsMm(this._sideMm, this._inventory[i]);
      key.disabled = !fits;
      anyFits ||= fits;
    });
    this.warn.hidden = anyFits || this._inventory.length === 0;
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
