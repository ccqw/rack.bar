// <rack-console> -- the calculator surface, both directions. A Decode/Encode toggle
// switches which editor drives a single shared Side Load (RBAR-7, ADR-0005):
//   Decode -- the Target entry derives the Side Load via decode() (ADR-0003: never
//             overshoots by default, with the over-target opt-in).
//   Encode -- a Plate palette taps addPlate() on; tapping a loaded disc taps
//             removePlate() off; the Total reads encode(side).
// The Side Load is one value this shell owns; the mode picks who edits it, and a
// switch never clears it -- so a loadout persists across the toggle for free. All the
// plate math lives in the pure core (lib/); the elements only wire DOM to it (ADR-0001).
import './entry.ts';
import './palette.ts';
import './sleeve.ts';
import { decode } from '../lib/decode.ts';
import { addPlate, encode, removePlate } from '../lib/encode.ts';
import { DEFAULT_BAR_KG, barWithCollars } from '../lib/plates.ts';
import { DEFAULT_COLLAR_KG } from './setup.ts';
import type { Plate } from '../lib/plates.ts';
import type { Decoded } from '../lib/decode.ts';

type Sleeve = HTMLElement & {
  sideLoad: readonly Plate[];
  interactive: boolean;
};
type Entry = HTMLElement & {
  display(value: number | null): void;
  barKg: number;
};
type Mode = 'decode' | 'encode';

class RackConsole extends HTMLElement {
  private root: ShadowRoot = this.attachShadow({ mode: 'open' });
  private entry!: Entry;
  private palette!: HTMLElement;
  private sleeve!: Sleeve;
  private total!: HTMLElement;
  private delta!: HTMLElement;
  private over!: HTMLButtonElement;
  private modeButtons!: NodeListOf<HTMLButtonElement>;

  // The single shared Side Load (ADR-0005): what the sleeve draws and what the Total
  // reads, in both modes. Decode derives it; Encode edits it; a mode switch keeps it.
  private side: readonly Plate[] = [];
  private mode: Mode = 'decode';
  // The chosen Bar and Collar, folded into the effective baseline the parameterized core
  // loads from (ADR-0002/0007/0008). Defaults: 20 kg Bar, no Collar; the app shell sets
  // them from Setup. Both setters re-decode a standing Target (see baselineKg/reconfigure).
  private _barKg = DEFAULT_BAR_KG;
  private _collarKg = DEFAULT_COLLAR_KG;
  // Decode-only: the current decode() result and whether the over-target opt-in is on
  // screen. `showingOver` only ever flips on a click, never on a new Target, so Decode
  // never auto-puts the lifter over Target (ADR-0003). Both reset on a mode switch.
  private decoded: Decoded | null = null;
  private showingOver = false;

  /**
   * The Bar the solver loads up from (RBAR-15). Setting it threads the new Bar into the
   * effective baseline and re-applies it (see `reconfigure`): a live Decode result is
   * re-decoded so the Side Load is rebuilt (a 100 kg Target needs different Plates on a
   * 15 kg Bar), a carried hand-built loadout just re-reads its Total.
   */
  set barKg(kg: number) {
    this._barKg = kg;
    this.reconfigure();
  }
  get barKg(): number {
    return this._barKg;
  }

  /**
   * The Collar fitted to each Side (RBAR-16, ADR-0008). It folds into the same effective
   * baseline the Bar does (`barWithCollars`), so setting it re-applies exactly like the
   * Bar: a standing Target re-decodes against the new baseline, an empty/hand-built state
   * just re-reads. Defaults to None.
   */
  set collarKg(kg: number) {
    this._collarKg = kg;
    this.reconfigure();
  }
  get collarKg(): number {
    return this._collarKg;
  }

  // The effective Bar baseline the core loads from: Bar + 2 x Collar (ADR-0008). Every
  // decode/encode/Total in this shell threads this, not the bare Bar, so the Collar rides
  // the parameter ADR-0002 already provides.
  private baselineKg(): number {
    return barWithCollars(this._barKg, this._collarKg);
  }

  // Re-apply a Bar or Collar change: move the entry's anchor to the new baseline, then
  // either re-decode the standing Target (rebuilding the Side Load) or, with no live
  // decode, just re-render so the Total re-reads. The Target is re-derived from the decode
  // result (`target = total - delta`), so no separate copy of it can drift.
  private reconfigure(): void {
    if (!this.entry) return; // pre-connect; connectedCallback renders from the fields
    this.entry.barKg = this.baselineKg();
    if (this.mode === 'decode' && this.decoded) {
      this.decodeTo(this.decoded.primary.total - this.decoded.primary.delta);
    } else {
      this.render();
    }
  }

  connectedCallback(): void {
    this.root.innerHTML = `
      <style>
        :host { display: block; width: 100%; max-width: 520px; }
        .stack {
          display: flex; flex-direction: column; gap: 24px; align-items: stretch;
        }
        /* The Decode/Encode toggle: a segmented control, the obvious mode switch. */
        .modes {
          display: flex; align-self: center; gap: 4px;
          border: 1px solid var(--rack-line); border-radius: 999px; padding: 4px;
        }
        .modes button {
          font: inherit; font-size: 14px; font-weight: 600;
          color: var(--rack-muted); background: transparent;
          border: none; border-radius: 999px; padding: 8px 20px; cursor: pointer;
        }
        .modes button[aria-pressed="true"] {
          color: var(--rack-bg); background: var(--rack-accent);
        }
        .modes button:focus-visible { outline: 2px solid var(--rack-accent); }
        rack-entry[hidden], rack-palette[hidden] { display: none; }
        .readout { text-align: center; }
        .readout .label { color: var(--rack-muted); font-size: 13px; }
        .readout output {
          display: block; font-family: var(--rack-font-num);
          font-size: clamp(28px, 9vw, 40px); font-weight: 600;
          color: var(--rack-fg);
        }
        /* The "a few kg short" / "below the Bar" / "over target" note reads as a
           quiet aside. Decode only. */
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
        <!-- The user-facing labels name the INPUT you work from ("By Weight" =
             type a Target; "By Plates" = tap Plates), which is more intuitive than
             the internal direction names. data-mode keeps the canonical Decode/Encode
             vocabulary (CONTEXT.md) that the rest of the code speaks. -->
        <div class="modes" role="group" aria-label="Mode">
          <button type="button" data-mode="decode" aria-pressed="true">By Weight</button>
          <button type="button" data-mode="encode" aria-pressed="false">By Plates</button>
        </div>
        <rack-entry></rack-entry>
        <rack-palette hidden></rack-palette>
        <rack-sleeve></rack-sleeve>
        <div class="readout">
          <span class="label">Total</span>
          <output data-total>${DEFAULT_BAR_KG} kg</output>
          <span class="delta" data-delta hidden></span>
        </div>
        <button type="button" class="over" data-over hidden></button>
      </div>
    `;
    this.entry = this.root.querySelector('rack-entry') as Entry;
    this.palette = this.root.querySelector('rack-palette')!;
    this.sleeve = this.root.querySelector('rack-sleeve') as Sleeve;
    this.total = this.root.querySelector('[data-total]')!;
    this.delta = this.root.querySelector('[data-delta]')!;
    this.over = this.root.querySelector('[data-over]')!;
    this.modeButtons = this.root.querySelectorAll('[data-mode]');

    // Decode: the Target entry derives the Side Load.
    this.entry.addEventListener('target', (e) => {
      if (this.mode !== 'decode') return;
      this.decodeTo((e as CustomEvent<{ target: number | null }>).detail.target);
    });
    // Encode: palette taps add, sleeve disc taps remove -- both pure transforms.
    this.palette.addEventListener('addplate', (e) => {
      if (this.mode !== 'encode') return;
      this.side = addPlate(this.side, (e as CustomEvent<{ plate: Plate }>).detail.plate);
      this.render();
    });
    this.sleeve.addEventListener('removeplate', (e) => {
      if (this.mode !== 'encode') return;
      this.side = removePlate(this.side, (e as CustomEvent<{ plate: Plate }>).detail.plate);
      this.render();
    });
    // The over-target opt-in toggles between the at-or-under primary and the over option.
    // The control is only shown with a decode result on hand (setOver), so a missing
    // `decoded` here is an invariant breach, not a state to paper over: bail before
    // flipping `showingOver` so a stray click can never strand the lifter over Target.
    this.over.addEventListener('click', () => {
      if (!this.decoded) return;
      this.showingOver = !this.showingOver;
      const { primary, over } = this.decoded;
      this.side = (this.showingOver && over ? over : primary).side;
      this.render();
    });
    this.modeButtons.forEach((b) =>
      b.addEventListener('click', () => {
        const mode = b.dataset.mode;
        if (mode === 'decode' || mode === 'encode') this.setMode(mode);
      }),
    );

    this.entry.barKg = this.baselineKg(); // anchor the entry to the bare-rig baseline
    this.render(); // initial state: Decode, a bare rig, no Target typed yet
  }

  // A new Target always lands on the at-or-under primary -- any prior over choice is
  // cleared, so the lifter is never silently left over Target (ADR-0003). A null Target
  // (empty field) clears to the bare Bar.
  private decodeTo(target: number | null): void {
    this.showingOver = false;
    this.decoded = target === null ? null : decode(target, this.baselineKg());
    this.side = this.decoded ? this.decoded.primary.side : [];
    this.render();
  }

  // Switch modes without disturbing the shared Side Load (ADR-0005). Entering Decode
  // drops the decode state and seeds the Target box with the carried loadout's Total
  // (so the +/- steppers move from the real current weight, not zero) -- silently, so
  // the loadout shows with no delta until the lifter acts; entering Encode just hands
  // editing to the taps.
  private setMode(mode: Mode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.decoded = null;
    this.showingOver = false;
    if (mode === 'decode') {
      this.entry.display(this.side.length > 0 ? encode(this.side, this.baselineKg()) : null);
    }
    this.render();
  }

  private render(): void {
    this.sleeve.sideLoad = this.side;
    this.sleeve.interactive = this.mode === 'encode';
    this.total.textContent = `${encode(this.side, this.baselineKg())} kg`;
    this.entry.hidden = this.mode !== 'decode';
    this.palette.hidden = this.mode !== 'encode';
    this.modeButtons.forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.mode === this.mode)),
    );

    // The delta note and over opt-in are Decode-only, and only once a Target is typed.
    if (this.mode === 'decode' && this.decoded) {
      const { primary, over } = this.decoded;
      const shown = this.showingOver && over ? over : primary;
      // `shown === over` is true exactly when the over option is on screen -- the one
      // signal setDelta needs to read a positive delta as "over target" not sub-Bar.
      this.setDelta(shown.delta, shown === over);
      this.setOver(over ?? null, primary.total);
    } else {
      this.setDelta(null, false);
      this.setOver(null, encode(this.side, this.baselineKg()));
    }
  }

  // The delta note. Negative: the grid landed a few kg under the Target. Positive
  // means either the chosen over-target option (`isOver`) or -- for the primary -- a
  // Target below the bare Bar (the floor). Exact (0), no Target, or Encode: hidden.
  private setDelta(delta: number | null, isOver: boolean): void {
    if (delta === null || delta === 0) {
      this.delta.hidden = true;
      this.delta.textContent = '';
      return;
    }
    this.delta.hidden = false;
    if (delta < 0) {
      this.delta.textContent = `${fmtKg(-delta)} kg under target`;
    } else if (isOver) {
      this.delta.textContent = `${fmtKg(delta)} kg over target`;
    } else {
      // The positive-delta floor: the Target sits below the bare rig. With collars on
      // the floor is Bar + 2 x collar, so name that baseline (not the bare Bar) to stay
      // truthful about what the lifter can't go under (ADR-0008).
      this.delta.textContent =
        this._collarKg > 0
          ? `below the bar + collars (${fmtKg(this.baselineKg())} kg)`
          : `below the ${this._barKg} kg Bar`;
    }
  }

  // The over-target opt-in control. Absent when there is no over option (or in Encode).
  // Otherwise it offers the *other* Loadout: round up to over while on primary, or drop
  // back to primary while on over -- so the lifter can always step either way.
  private setOver(
    over: { total: number; delta: number } | null,
    primaryTotal: number,
  ): void {
    if (over === null) {
      this.over.hidden = true;
      this.over.textContent = '';
      return;
    }
    this.over.hidden = false;
    this.over.textContent = this.showingOver
      ? `Back to ${primaryTotal} kg (under target)`
      : `Round up to ${over.total} kg (+${fmtKg(over.delta)})`;
  }
}

// Strip floating-point fuzz and trailing zeros so a 0.5 kg miss reads "0.5", not
// "0.5000000001" or "0.50".
function fmtKg(kg: number): string {
  return String(Number(kg.toFixed(2)));
}

customElements.define('rack-console', RackConsole);
