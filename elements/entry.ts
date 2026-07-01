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
//
// The field works in the lifter's display Unit (RBAR-17, ADR-0010): the draft, the
// shown value, the caption, and the steppers are all in `unit` (kg or lb), while the
// numeric Target it emits is always canonical kg. Switching Unit reformats the SAME
// canonical weight into the new Unit (it never re-parses the rounded draft, so kg ->
// lb -> kg round-trips without drift). The Bar (anchor) is given in kg and shown
// converted. Defaults to kg, so the kg behavior is unchanged.
import { DEFAULT_BAR_KG } from '../lib/plates.ts';
import { shownIn, draftToKg, stepFor } from '../lib/units.ts';
import type { Unit } from '../lib/units.ts';
import { BUTTON_FX } from './buttonfx.ts';
import { ROLL_CSS, rollText } from './numroll.ts';

// The keypad layout, row-major. 'del' deletes the last character, 'clear' empties.
const KEYPAD_ROWS: readonly (readonly string[])[] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['.', '0', 'del'],
];

// Spoken labels for the non-digit keys; digits announce as themselves.
const KEY_ARIA: Record<string, string> = { del: 'Delete', '.': 'Decimal point' };

class RackEntry extends HTMLElement {
  private root: ShadowRoot = this.attachShadow({ mode: 'open' });
  private valueEl!: HTMLButtonElement;
  private captionEl!: HTMLElement;
  private decBtn!: HTMLButtonElement;
  private incBtn!: HTMLButtonElement;
  // The keypad bottom sheet (RBAR-22): the fixed scrim overlay whose visibility IS the
  // open/closed state, and the live value readout the sheet carries (the field behind it
  // is dimmed by the scrim, so the sheet shows what's being typed).
  private scrim!: HTMLElement;
  private liveEl!: HTMLElement;
  private liveUEl!: HTMLElement;

  // The Bar weight the field anchors to (RBAR-15, ADR-0002/0007), canonical kg. The
  // lifter loads a bar UP from its own weight, so the seeded default, the empty-field
  // placeholder, and the stepper origin are all the Bar weight, shown in the display
  // Unit. Defaults to the 20 kg Bar; the app shell sets this when the lifter picks
  // another Bar. See the setter for how a change moves an untouched anchor without
  // stomping a typed Target.
  private _barKg = DEFAULT_BAR_KG;
  // The display Unit (RBAR-17, ADR-0010). The draft and steppers work in it; the
  // emitted Target is always kg. Defaults to kg (the kg-only behavior pre-RBAR-17).
  private _unit: Unit = 'kg';

  /**
   * The Bar weight to anchor on (canonical kg). Moving the Bar re-seeds the anchor only
   * when the field still holds the untouched seeded default (so picking a 15 kg Bar
   * shows 15, not 20); a Target the lifter has typed -- or an emptied field, which
   * already falls back to the live Bar via renderValue -- is left alone. Silent: never
   * emits a target.
   */
  set barKg(kg: number) {
    const seededDefault = this.pristine && this.draft === this.barShown();
    this._barKg = kg;
    if (seededDefault) this.draft = this.barShown();
    if (this.valueEl) this.renderValue(); // no-op before connect; connectedCallback renders
  }
  get barKg(): number {
    return this._barKg;
  }

  /**
   * The display Unit. Switching reformats the field's canonical weight (`shownKg`) into
   * the new Unit rather than re-parsing the rounded draft, so kg <-> lb round-trips do
   * not drift. A seeded default re-seeds to the Bar in the new Unit; an empty field
   * stays empty. Silent (never emits): the canonical Target is unchanged, only its
   * presentation. The caption and steppers follow via renderValue.
   */
  set unit(u: Unit) {
    if (u === this._unit) return;
    const wasSeededDefault = this.pristine && this.draft === this.barShown();
    this._unit = u;
    if (this.draft === '') {
      // stays empty; the muted anchor re-derives in renderValue
    } else if (wasSeededDefault) {
      this.draft = this.barShown(); // the Bar in the new Unit, still pristine
    } else {
      this.draft = this.shownKg === null ? '' : String(shownIn(this.shownKg, u));
    }
    if (this.valueEl) this.renderValue();
  }
  get unit(): Unit {
    return this._unit;
  }

  // The single source of truth for what is shown: the raw text the lifter has entered,
  // in the display Unit. '' = nothing yet, which falls back to the Bar weight as the
  // anchor.
  private draft = '';
  // The canonical kg the current draft represents, captured on every real edit
  // (keypad/stepper/display). The Unit setter reformats FROM this so a Unit round-trip
  // is exact; it is not recomputed from the rounded draft on a Unit switch.
  private shownKg: number | null = null;
  // True when `draft` holds an untouched seeded default (initial Bar weight or a value
  // pushed in by display()). The next typed digit replaces it rather than appending.
  private pristine = false;

  /**
   * Show `value` (canonical kg) in the field without emitting a `target` event (null
   * clears it). The console calls this when switching back into Decode (RBAR-7,
   * ADR-0005): it seeds the box with the carried Side Load's Total so the +/- steppers
   * move from the real current weight, not from zero -- and stays silent, so the
   * hand-built loadout is not re-decoded until the lifter acts. The seeded value is
   * `pristine`, so the next typed digit replaces it. Shown in the display Unit.
   */
  display(value: number | null): void {
    this.draft = value === null ? '' : String(shownIn(value, this._unit));
    this.shownKg = value;
    this.pristine = true;
    this.renderValue();
  }

  // The Bar weight as shown in the display Unit -- the seeded default and empty-field
  // anchor. A string so it compares directly against the draft.
  private barShown(): string {
    return String(shownIn(this._barKg, this._unit));
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
        ${BUTTON_FX}${ROLL_CSS}
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

        /* The keypad is a bottom sheet (RBAR-22, handoff 5), not an inline grid: it is
           fixed to the viewport bottom behind a dim scrim, so opening it never displaces
           the bar / Total / Recents behind it. Same overlay family as the Setup sheet
           (ADR-0007) -- reusing its rack-fade / rack-rise keyframes -- but the handoff
           gives the keypad its own SUNKEN fill (#101216) distinct from the sheets' overlay
           tier. */
        @keyframes rack-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes rack-rise {
          from { transform: translateY(100%); } to { transform: translateY(0); }
        }
        .scrim[hidden] { display: none; }
        .scrim {
          position: fixed; inset: 0; z-index: 50;
          background: var(--rack-scrim);
          display: flex; align-items: flex-end; justify-content: center;
          animation: rack-fade .16s ease-out;
        }
        /* The sheet rises from the bottom edge; safe-area pad clears the home indicator. */
        .sheet {
          width: 100%; max-width: 520px;
          background: var(--rack-sunken);
          border-top: 1px solid var(--rack-border);
          border-radius: var(--rack-radius-sheet) var(--rack-radius-sheet) 0 0;
          padding: 16px 16px calc(16px + env(safe-area-inset-bottom));
          box-shadow: 0 -20px 50px -20px rgba(0, 0, 0, .7);
          animation: rack-rise .2s cubic-bezier(.2, .85, .25, 1);
        }
        /* The sheet's own live entry readout (the field behind the scrim is dimmed). */
        .live { text-align: center; margin-bottom: 14px; }
        .live-num {
          font-family: var(--rack-font-num); font-size: 40px; font-weight: 700;
          color: var(--rack-fg);
        }
        .live-num.empty { color: var(--rack-muted); }
        .live-u { font-size: 15px; color: var(--rack-muted); margin-left: 4px; }
        .keypad {
          display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;
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
        /* Footer: Clear (ghost, an edit) + Done (accent, the dismiss). */
        .foot { display: flex; gap: 8px; margin-top: 14px; }
        .clear, .done {
          flex: 1; min-height: 48px; font: inherit; font-size: 15px;
          border-radius: var(--rack-radius); cursor: pointer;
        }
        .clear {
          font-weight: 600; color: var(--rack-muted);
          background: transparent; border: 1px solid var(--rack-line);
        }
        .done {
          font-weight: 700; color: var(--rack-bg);
          background: var(--rack-accent); border: none;
        }
        .clear:focus-visible, .done:focus-visible {
          outline: 2px solid var(--rack-accent); outline-offset: 2px;
        }
      </style>
      <!-- A decorative caption; the value button carries its own live aria-label. -->
      <div class="caption" data-caption>Target (kg)</div>
      <div class="row">
        <button type="button" class="step" data-step="dec" aria-label="Decrease">-</button>
        <button type="button" class="value" data-value
                aria-haspopup="true" aria-expanded="false">${DEFAULT_BAR_KG}</button>
        <button type="button" class="step" data-step="inc" aria-label="Increase">+</button>
      </div>
      <div class="scrim" data-scrim hidden>
        <div class="sheet" data-panel role="dialog" aria-modal="true" aria-label="Enter Target">
          <div class="live">
            <span class="live-num" data-live>${DEFAULT_BAR_KG}</span><span
              class="live-u" data-live-u>kg</span>
          </div>
          <div class="keypad" data-keypad role="group" aria-label="Enter Target">
            ${keys}
          </div>
          <div class="foot">
            <button type="button" class="clear" data-key="clear">Clear</button>
            <button type="button" class="done" data-done>Done</button>
          </div>
        </div>
      </div>
    `;

    this.valueEl = this.root.querySelector('[data-value]')!;
    this.captionEl = this.root.querySelector('[data-caption]')!;
    this.decBtn = this.root.querySelector('[data-step="dec"]')!;
    this.incBtn = this.root.querySelector('[data-step="inc"]')!;
    this.scrim = this.root.querySelector('[data-scrim]')!;
    this.liveEl = this.root.querySelector('[data-live]')!;
    this.liveUEl = this.root.querySelector('[data-live-u]')!;

    // Tapping the value toggles the sheet. A scrim tap or the Done button also close it;
    // a tap inside the panel must not (it would bubble to the scrim), so the panel stops
    // it -- the same dismissal contract as <rack-setup>.
    this.valueEl.addEventListener('click', () =>
      this.scrim.hidden ? this.openKeypad() : this.closeKeypad(),
    );
    this.scrim.addEventListener('click', () => this.closeKeypad());
    this.root
      .querySelector('[data-panel]')!
      .addEventListener('click', (e) => e.stopPropagation());
    this.root.querySelector('[data-done]')!.addEventListener('click', () => this.closeKeypad());
    this.incBtn.addEventListener('click', () => this.step(+stepFor(this._unit)));
    this.decBtn.addEventListener('click', () => this.step(-stepFor(this._unit)));
    this.root.querySelectorAll<HTMLButtonElement>('[data-key]').forEach((btn) =>
      btn.addEventListener('click', () => this.press(btn.dataset.key!)),
    );

    // Start at the Bar weight: a real, steppable starting point, silent (no target
    // event -- the console already renders the bare Bar). Pristine, so typing replaces it.
    this.draft = this.barShown();
    this.pristine = true;
    this.renderValue();
  }

  // Show the keypad sheet. Reflect the open state on the value button so assistive tech
  // announces the expanded pad.
  private openKeypad(): void {
    this.scrim.hidden = false;
    this.valueEl.setAttribute('aria-expanded', 'true');
  }

  // Hide the keypad sheet and commit the Target: the console pushes it onto the Recent
  // row (RBAR-20, ADR-0009). Guarded on the open->closed edge so only a real dismissal
  // (scrim tap, Done, or a value re-tap) commits -- an already-closed call is a no-op, so
  // no path double-commits.
  private closeKeypad(): void {
    if (this.scrim.hidden) return;
    this.scrim.hidden = true;
    this.valueEl.setAttribute('aria-expanded', 'false');
    this.emitKeypadClose();
  }

  // A keypad press mutates the draft string (in the display Unit), then emits the
  // derived kg Target. A pristine default is replaced by the first typed digit/decimal
  // rather than appended to.
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

  // A stepper nudge in the display Unit: an empty field anchors at the Bar (you load up
  // from the Bar), add the delta, clamp at 0 (Target is never negative), and round off
  // float fuzz. The shown value moves by stepFor(unit) -- 5 lb or 1 kg.
  private step(delta: number): void {
    this.pristine = false;
    const shownBar = shownIn(this._barKg, this._unit);
    const current = this.draft === '' ? shownBar : Number(this.draft);
    const base = Number.isNaN(current) ? shownBar : current;
    const next = Math.max(0, Number((base + delta).toFixed(2)));
    this.draft = String(next);
    this.renderValue();
    this.emit();
  }

  // The numeric Target the rest of the app consumes: the draft parsed from the display
  // Unit to canonical kg. Empty or unparseable -> null.
  private currentTarget(): number | null {
    return draftToKg(this.draft, this._unit);
  }

  // An empty field shows the Bar weight as a muted anchor (what the steppers move from);
  // a real value shows solid. The caption names the active Unit.
  private renderValue(): void {
    const empty = this.draft === '';
    const shown = empty ? this.barShown() : this.draft;
    rollText(this.valueEl, shown); // the Target value rolls up on change (numRoll, RBAR-30)
    this.valueEl.classList.toggle('empty', empty);
    // The sheet's own live readout mirrors the same shown value + Unit (the field behind
    // the scrim is dimmed while the pad is open).
    this.liveEl.textContent = shown;
    this.liveEl.classList.toggle('empty', empty);
    this.liveUEl.textContent = this._unit;
    this.captionEl.textContent = `Target (${this._unit})`;
    const step = stepFor(this._unit);
    this.decBtn.setAttribute('aria-label', `Decrease by ${step} ${this._unit}`);
    this.incBtn.setAttribute('aria-label', `Increase by ${step} ${this._unit}`);
    // Announce the live value (aria-labelledby would override the text and hide it).
    this.valueEl.setAttribute('aria-label', `Target ${shown} ${this._unit}`);
  }

  private emit(): void {
    this.shownKg = this.currentTarget(); // canonical, for a drift-free Unit switch
    this.dispatchEvent(
      new CustomEvent<{ target: number | null }>('target', {
        detail: { target: this.shownKg },
        bubbles: true,
        composed: true,
      }),
    );
  }

  // Announce that the keypad just closed on the Target currently shown -- the console's
  // cue to remember it (RBAR-20). Distinct from `target` (which fires on every keystroke):
  // this is the deliberate commit, so only it feeds Recents, not every mid-entry digit.
  // A pristine field carries null: closing the pad on an untouched seeded default (the
  // bare Bar on first open, or a value display() pushed in) is an idle peek, not a Target
  // the lifter entered -- so it must not litter the history with a weight they never chose.
  private emitKeypadClose(): void {
    this.dispatchEvent(
      new CustomEvent<{ target: number | null }>('keypadclose', {
        detail: { target: this.pristine ? null : this.currentTarget() },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

customElements.define('rack-entry', RackEntry);
