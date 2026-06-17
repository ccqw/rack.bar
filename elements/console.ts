// <rack-console> -- the Decode surface. Wires the Target entry through decode() to
// the sleeve graphic, the achieved Total, and the delta (CONTEXT.md). It replaces
// the scaffold <rack-app> placeholder: this is the app from RBAR-2 on. Encode mode
// and the Decode/Encode toggle land in RBAR-7.
//
// ADR-0003: decode() returns a `primary` Loadout that never overshoots; this shell
// only reads primary.side / primary.total / primary.delta -- all the loading logic
// lives in the pure core.
import './entry.ts';
import './sleeve.ts';
import { decode } from '../lib/decode.ts';
import { DEFAULT_BAR_KG } from '../lib/plates.ts';
import type { Plate } from '../lib/plates.ts';

type Sleeve = HTMLElement & { sideLoad: readonly Plate[] };

class RackConsole extends HTMLElement {
  private root: ShadowRoot = this.attachShadow({ mode: 'open' });
  private sleeve!: Sleeve;
  private total!: HTMLElement;
  private delta!: HTMLElement;

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
        /* The "a few kg short" / "below the Bar" note reads as a quiet aside. */
        .readout .delta {
          display: block; margin-top: 2px;
          font-size: 13px; color: var(--rack-muted);
        }
        .readout .delta[hidden] { display: none; }
      </style>
      <div class="stack">
        <rack-entry></rack-entry>
        <rack-sleeve></rack-sleeve>
        <div class="readout">
          <span class="label">Total</span>
          <output data-total>${DEFAULT_BAR_KG} kg</output>
          <span class="delta" data-delta hidden></span>
        </div>
      </div>
    `;
    const entry = this.root.querySelector('rack-entry')!;
    this.sleeve = this.root.querySelector('rack-sleeve') as Sleeve;
    this.total = this.root.querySelector('[data-total]')!;
    this.delta = this.root.querySelector('[data-delta]')!;

    entry.addEventListener('target', (e) => {
      this.update((e as CustomEvent<{ target: number | null }>).detail.target);
    });
    this.update(null); // initial state: a bare Bar, no Target typed yet
  }

  private update(target: number | null): void {
    if (target === null) {
      this.sleeve.sideLoad = [];
      this.total.textContent = `${DEFAULT_BAR_KG} kg`;
      this.setDelta(null);
      return;
    }
    const { primary } = decode(target);
    this.sleeve.sideLoad = primary.side;
    this.total.textContent = `${primary.total} kg`;
    this.setDelta(primary.delta);
  }

  // Negative delta: the grid landed a few kg under the Target. Positive delta: the
  // Target is lighter than the bare Bar (the floor). Exact (0) or no Target: hidden.
  private setDelta(delta: number | null): void {
    if (delta === null || delta === 0) {
      this.delta.hidden = true;
      this.delta.textContent = '';
      return;
    }
    this.delta.hidden = false;
    this.delta.textContent =
      delta < 0
        ? `${fmtKg(-delta)} kg under target`
        : `below the ${DEFAULT_BAR_KG} kg Bar`;
  }
}

// Strip floating-point fuzz and trailing zeros so a 0.5 kg miss reads "0.5", not
// "0.5000000001" or "0.50".
function fmtKg(kg: number): string {
  return String(Number(kg.toFixed(2)));
}

customElements.define('rack-console', RackConsole);
