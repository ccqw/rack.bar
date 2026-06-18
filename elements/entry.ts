// <rack-entry> -- the Target input, as the PRD's hybrid entry (RBAR-8). A prominent
// displayed value flanked by plus/minus steppers, where tapping the value opens a big
// on-screen keypad for exact entry (e.g. 142.5). One control unifies "nudge from the
// current weight" and "type an exact number"; it emits the Target on every change with
// no submit step, so Decode updates instantly.
//
// State is a single `draft` STRING, not a number: it can hold mid-entry forms a number
// can't ("142." while typing) and survives a trailing decimal. The numeric Target is
// derived from it -- empty or unparseable reads as null, never NaN -- which preserves
// the walking-skeleton contract (empty field -> bare Bar).
//
// The field DEFAULTS to the Bar weight, not zero: you load a bar up from its own weight,
// so starting at 0 would mean holding + just to reach the empty Bar (Caitlin). The
// steppers anchor at the Bar weight too, and an empty field falls back to it. A seeded
// default is `pristine`: the next typed digit REPLACES it (so you get "5", not "205"),
// while the steppers nudge it in place.
import { DEFAULT_BAR_KG } from '../lib/plates.ts';

// The keypad layout, row-major. 'del' deletes the last character, 'clear' empties.
const KEYPAD_ROWS: readonly (readonly string[])[] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['.', '0', 'del'],
];

// Spoken labels for the non-digit keys; digits announce as themselves.
const KEY_ARIA: Record<string, string> = { del: 'Delete', '.': 'Decimal point' };

// The achievable Total grid is whole kilos: the smallest Plate is 0.5 kg but it loads
// on both Sides (2 x 0.5 = 1 kg), so the sensible stepper nudge is 1 kg.
const STEP_KG = 1;

class RackEntry extends HTMLElement {
  private root: ShadowRoot = this.attachShadow({ mode: 'open' });
  private valueEl!: HTMLButtonElement;
  private keypad!: HTMLElement;

  // The single source of truth: the raw text the lifter has entered. '' = nothing yet,
  // which falls back to the Bar weight as the anchor.
  private draft = '';
  // True when `draft` holds an untouched seeded default (initial Bar weight or a value
  // pushed in by display()). The next typed digit replaces it rather than appending.
  private pristine = false;

  /**
   * Show `value` in the field without emitting a `target` event (null clears it). The
   * console calls this when switching back into Decode (RBAR-7, ADR-0005): it seeds the
   * box with the carried Side Load's Total so the +/- steppers move from the real
   * current weight, not from zero -- and stays silent, so the hand-built loadout is not
   * re-decoded (and never collapses to its canonical form) until the lifter acts. The
   * seeded value is `pristine`, so the next typed digit replaces it.
   */
  display(value: number | null): void {
    this.draft = value === null ? '' : String(value);
    this.pristine = true;
    this.renderValue();
  }

  connectedCallback(): void {
    const keys = KEYPAD_ROWS.flat()
      .map(
        (k) => `<button type="button" class="key" data-key="${k}"
                  aria-label="${KEY_ARIA[k] ?? k}">${k}</button>`,
      )
      .join('');

    this.root.innerHTML = `
      <style>
        :host { display: block; }
        .caption {
          display: block; text-align: center;
          color: var(--rack-muted); font-size: 13px; margin-bottom: 6px;
        }
        /* The value row: [-] prominent value [+]. The steppers are big round touch
           targets; the value itself is a button that opens the keypad. */
        .row {
          display: flex; align-items: center; justify-content: center; gap: 12px;
        }
        .step {
          flex: none; width: 52px; height: 52px; min-width: 44px; min-height: 44px;
          font-family: var(--rack-font-num); font-size: 28px; font-weight: 600;
          color: var(--rack-fg); background: transparent;
          border: 1px solid var(--rack-line); border-radius: 999px;
          cursor: pointer; line-height: 1;
        }
        .step:active { background: var(--rack-line); }
        .step:focus-visible { outline: 2px solid var(--rack-accent); }
        .value {
          flex: 1; min-width: 0; text-align: center;
          font-family: var(--rack-font-num);
          font-size: clamp(36px, 14vw, 56px); font-weight: 600;
          color: var(--rack-fg); background: transparent;
          border: none; border-bottom: 2px solid var(--rack-line);
          padding: 6px 0; cursor: pointer;
        }
        .value.empty { color: var(--rack-muted); } /* placeholder anchor */
        .value:focus-visible { outline: none; border-bottom-color: var(--rack-accent); }
        .keypad[hidden] { display: none; }
        .keypad {
          display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;
          margin-top: 16px;
        }
        .key {
          min-height: 56px; /* big touch targets */
          font-family: var(--rack-font-num); font-size: 22px; font-weight: 600;
          color: var(--rack-fg); background: transparent;
          border: 1px solid var(--rack-line); border-radius: var(--rack-radius);
          cursor: pointer;
        }
        .key[data-key="del"] { font-size: 16px; color: var(--rack-muted); }
        .key:active { background: var(--rack-line); }
        .key:focus-visible { outline: 2px solid var(--rack-accent); }
        .clear {
          grid-column: 1 / -1; min-height: 44px;
          font: inherit; font-size: 14px; color: var(--rack-muted);
          background: transparent; border: 1px solid var(--rack-line);
          border-radius: var(--rack-radius); cursor: pointer;
        }
        .clear:focus-visible { outline: 2px solid var(--rack-accent); }
      </style>
      <!-- A decorative caption; the value button carries its own live aria-label. -->
      <div class="caption">Target (kg)</div>
      <div class="row">
        <button type="button" class="step" data-step="dec" aria-label="Decrease by ${STEP_KG} kg">-</button>
        <button type="button" class="value" data-value
                aria-haspopup="true" aria-expanded="false">${DEFAULT_BAR_KG}</button>
        <button type="button" class="step" data-step="inc" aria-label="Increase by ${STEP_KG} kg">+</button>
      </div>
      <div class="keypad" data-keypad role="group" aria-label="Enter Target" hidden>
        ${keys}
        <button type="button" class="clear" data-key="clear">Clear</button>
      </div>
    `;

    this.valueEl = this.root.querySelector('[data-value]')!;
    this.keypad = this.root.querySelector('[data-keypad]')!;

    this.valueEl.addEventListener('click', () => {
      this.keypad.hidden = !this.keypad.hidden;
      this.valueEl.setAttribute('aria-expanded', String(!this.keypad.hidden));
    });
    this.root
      .querySelector('[data-step="inc"]')!
      .addEventListener('click', () => this.step(+STEP_KG));
    this.root
      .querySelector('[data-step="dec"]')!
      .addEventListener('click', () => this.step(-STEP_KG));
    this.root.querySelectorAll<HTMLButtonElement>('[data-key]').forEach((btn) =>
      btn.addEventListener('click', () => this.press(btn.dataset.key!)),
    );

    // Start at the Bar weight: a real, steppable starting point, silent (no target
    // event -- the console already renders the bare Bar). Pristine, so typing replaces it.
    this.draft = String(DEFAULT_BAR_KG);
    this.pristine = true;
    this.renderValue();
  }

  // A keypad press mutates the draft string, then emits the derived Target. A pristine
  // default is replaced by the first typed digit/decimal rather than appended to.
  private press(k: string): void {
    const fresh = this.pristine;
    this.pristine = false;
    if (k === 'clear') {
      this.draft = '';
    } else if (k === 'del') {
      this.draft = fresh ? '' : this.draft.slice(0, -1);
    } else if (k === '.') {
      if (fresh) this.draft = '';
      if (!this.draft.includes('.')) this.draft += this.draft === '' ? '0.' : '.';
    } else {
      // Drop a lone leading zero ("0" + "5" -> "5") so the shown draft matches the
      // Target it decodes to; a leading zero before a decimal is kept by the '.' branch.
      const base = fresh ? '' : this.draft;
      this.draft = base === '0' ? k : base + k;
    }
    this.renderValue();
    this.emit();
  }

  // A stepper nudge: an empty field anchors at the Bar weight (you load up from the Bar),
  // add the delta, clamp at 0 (Target is never negative), and round off float fuzz.
  private step(delta: number): void {
    this.pristine = false;
    const current = this.draft === '' ? DEFAULT_BAR_KG : Number(this.draft);
    const base = Number.isNaN(current) ? DEFAULT_BAR_KG : current;
    const next = Math.max(0, Number((base + delta).toFixed(2)));
    this.draft = String(next);
    this.renderValue();
    this.emit();
  }

  // The numeric Target the rest of the app consumes: empty or unparseable -> null.
  private currentTarget(): number | null {
    if (this.draft.trim() === '') return null;
    const n = Number(this.draft);
    return Number.isNaN(n) ? null : n;
  }

  // An empty field shows the Bar weight as a muted anchor (what the steppers move from);
  // a real value shows solid.
  private renderValue(): void {
    const empty = this.draft === '';
    const shown = empty ? String(DEFAULT_BAR_KG) : this.draft;
    this.valueEl.textContent = shown;
    this.valueEl.classList.toggle('empty', empty);
    // Announce the live value (aria-labelledby would override the text and hide it).
    this.valueEl.setAttribute('aria-label', `Target ${shown} kg`);
  }

  private emit(): void {
    this.dispatchEvent(
      new CustomEvent<{ target: number | null }>('target', {
        detail: { target: this.currentTarget() },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

customElements.define('rack-entry', RackEntry);
