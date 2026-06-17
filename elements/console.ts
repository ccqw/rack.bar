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
import type { Decoded } from '../lib/decode.ts';

type Sleeve = HTMLElement & { sideLoad: readonly Plate[] };

class RackConsole extends HTMLElement {
  private root: ShadowRoot = this.attachShadow({ mode: 'open' });
  private sleeve!: Sleeve;
  private total!: HTMLElement;
  private delta!: HTMLElement;
  private over!: HTMLButtonElement;
  // The current decode result and which Loadout is on screen. `showingOver` is the
  // explicit opt-in (ADR-0003): it only ever flips on a click, never on a new
  // Target, so Decode never auto-puts the lifter over Target.
  private decoded: Decoded | null = null;
  private showingOver = false;

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
        /* The "a few kg short" / "below the Bar" / "over target" note reads as a
           quiet aside. */
        .readout .delta {
          display: block; margin-top: 2px;
          font-size: 13px; color: var(--rack-muted);
        }
        .readout .delta[hidden] { display: none; }
        /* The over-target opt-in: a quiet, deliberately un-pushy round-up control
           (ADR-0003 -- never auto-selected). */
        .over {
          align-self: center;
          font: inherit; font-size: 14px; color: var(--rack-accent);
          background: transparent; border: 1px solid var(--rack-line);
          border-radius: 999px; padding: 8px 16px; cursor: pointer;
        }
        .over[hidden] { display: none; }
        .over:focus-visible { outline: 2px solid var(--rack-accent); }
      </style>
      <div class="stack">
        <rack-entry></rack-entry>
        <rack-sleeve></rack-sleeve>
        <div class="readout">
          <span class="label">Total</span>
          <output data-total>${DEFAULT_BAR_KG} kg</output>
          <span class="delta" data-delta hidden></span>
        </div>
        <button type="button" class="over" data-over hidden></button>
      </div>
    `;
    const entry = this.root.querySelector('rack-entry')!;
    this.sleeve = this.root.querySelector('rack-sleeve') as Sleeve;
    this.total = this.root.querySelector('[data-total]')!;
    this.delta = this.root.querySelector('[data-delta]')!;
    this.over = this.root.querySelector('[data-over]')!;

    entry.addEventListener('target', (e) => {
      this.update((e as CustomEvent<{ target: number | null }>).detail.target);
    });
    // The opt-in toggles between the at-or-under primary and the over-target option.
    this.over.addEventListener('click', () => {
      this.showingOver = !this.showingOver;
      this.render();
    });
    this.update(null); // initial state: a bare Bar, no Target typed yet
  }

  // A new Target always lands on the at-or-under primary -- any prior over choice is
  // cleared, so the lifter is never silently left over Target (ADR-0003).
  private update(target: number | null): void {
    this.showingOver = false;
    this.decoded = target === null ? null : decode(target);
    this.render();
  }

  private render(): void {
    if (this.decoded === null) {
      this.sleeve.sideLoad = [];
      this.total.textContent = `${DEFAULT_BAR_KG} kg`;
      this.setDelta(null, false);
      this.setOver(null);
      return;
    }
    const { primary, over } = this.decoded;
    const shown = this.showingOver && over ? over : primary;
    this.sleeve.sideLoad = shown.side;
    this.total.textContent = `${shown.total} kg`;
    this.setDelta(shown.delta, this.showingOver && over !== undefined);
    this.setOver(over ?? null);
  }

  // The delta note. Negative: the grid landed a few kg under the Target. Positive
  // means either the chosen over-target option (`isOver`) or -- for the primary -- a
  // Target below the bare Bar (the floor). Exact (0) or no Target: hidden.
  private setDelta(delta: number | null, isOver: boolean): void {
    if (delta === null || delta === 0) {
      this.delta.hidden = true;
      this.delta.textContent = '';
      return;
    }
    this.delta.hidden = false;
    if (delta < 0) {
      this.delta.textContent = `${fmtKg(-delta)} kg under target`;
    } else {
      this.delta.textContent = isOver
        ? `${fmtKg(delta)} kg over target`
        : `below the ${DEFAULT_BAR_KG} kg Bar`;
    }
  }

  // The over-target opt-in control. Absent when there is no over option. Otherwise it
  // offers the *other* Loadout: round up to over while on primary, or drop back to
  // primary while on over -- so the lifter can always step either way.
  private setOver(over: { total: number; delta: number } | null): void {
    if (over === null) {
      this.over.hidden = true;
      this.over.textContent = '';
      return;
    }
    this.over.hidden = false;
    this.over.textContent = this.showingOver
      ? `Back to ${this.decoded!.primary.total} kg (under target)`
      : `Round up to ${over.total} kg (+${fmtKg(over.delta)})`;
  }
}

// Strip floating-point fuzz and trailing zeros so a 0.5 kg miss reads "0.5", not
// "0.5000000001" or "0.50".
function fmtKg(kg: number): string {
  return String(Number(kg.toFixed(2)));
}

customElements.define('rack-console', RackConsole);
