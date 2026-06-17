// <rack-console> -- the Decode surface. Wires the Target entry through decode() to
// the sleeve graphic and the achieved Total (CONTEXT.md). It replaces the scaffold
// <rack-app> placeholder: this is the app from RBAR-2 on. Encode mode and the
// Decode/Encode toggle land in RBAR-7.
import './entry.ts';
import './sleeve.ts';
import { decode } from '../lib/decode.ts';
import { totalKg, DEFAULT_BAR_KG } from '../lib/plates.ts';
import type { Plate } from '../lib/plates.ts';

type Sleeve = HTMLElement & { sideLoad: readonly Plate[] };

class RackConsole extends HTMLElement {
  private root: ShadowRoot = this.attachShadow({ mode: 'open' });
  private sleeve!: Sleeve;
  private total!: HTMLElement;

  connectedCallback(): void {
    this.root.innerHTML = `
      <style>
        :host { display: block; width: 100%; max-width: 520px; }
        .stack {
          display: flex; flex-direction: column; gap: 24px; align-items: stretch;
        }
        .readout { text-align: center; }
        .readout .label { color: var(--rack-muted); font-size: 13px; }
        .readout output {
          display: block; font-family: var(--rack-font-num);
          font-size: clamp(28px, 9vw, 40px); font-weight: 600;
          color: var(--rack-fg);
        }
        /* The off-grid "can't build it exactly" note reads as a quiet aside. */
        .readout output[data-loadable="no"] {
          font-size: 16px; font-weight: 400; color: var(--rack-muted);
        }
      </style>
      <div class="stack">
        <rack-entry></rack-entry>
        <rack-sleeve></rack-sleeve>
        <div class="readout">
          <span class="label">Total</span>
          <output data-total data-loadable="yes">${DEFAULT_BAR_KG} kg</output>
        </div>
      </div>
    `;
    const entry = this.root.querySelector('rack-entry')!;
    this.sleeve = this.root.querySelector('rack-sleeve') as Sleeve;
    this.total = this.root.querySelector('[data-total]')!;

    entry.addEventListener('target', (e) => {
      this.update((e as CustomEvent<{ target: number | null }>).detail.target);
    });
    this.update(null); // initial state: a bare Bar, no Target typed yet
  }

  private update(target: number | null): void {
    if (target === null) {
      this.sleeve.sideLoad = [];
      this.setTotal(`${DEFAULT_BAR_KG} kg`, true);
      return;
    }
    const side = decode(target);
    if (side === null) {
      this.sleeve.sideLoad = [];
      this.setTotal('not exactly loadable', false);
      return;
    }
    this.sleeve.sideLoad = side;
    this.setTotal(`${totalKg(side)} kg`, true);
  }

  private setTotal(text: string, loadable: boolean): void {
    this.total.textContent = text;
    this.total.dataset.loadable = loadable ? 'yes' : 'no';
  }
}

customElements.define('rack-console', RackConsole);
