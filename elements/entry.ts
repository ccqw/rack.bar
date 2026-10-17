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
import { shownIn, draftToKg, stepFor, format } from '../lib/units.ts';
import type { Unit } from '../lib/units.ts';
import { BOX_SIZING } from './boxsizing.ts';
import { BUTTON_FX } from './buttonfx.ts';
import { SHORT_SCREEN } from './fit.ts';
import { SECTION_LABEL } from './sectionlabel.ts';
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

// The delete key's face (RBAR-46): the handoff renders a backspace glyph, drawn here as
// an inline SVG so the source stays ASCII. Decorative -- the button's aria-label
// ("Delete") is the announcement, so the drawing is hidden from assistive tech.
const DEL_ICON = `<svg width="22" height="16" viewBox="0 0 22 16" fill="none"
    aria-hidden="true"><path d="M8 1.25h10.25a2.5 2.5 0 0 1 2.5 2.5v8.5a2.5 2.5 0 0
    1-2.5 2.5H8a2.5 2.5 0 0 1-1.84-.81L1.9 9.35a2 2 0 0 1 0-2.7l4.26-4.59A2.5 2.5 0 0
    1 8 1.25Z" stroke="currentColor" stroke-width="1.6"
    stroke-linejoin="round"/><path d="M10.75 5.6l4.3 4.8m0-4.8l-4.3 4.8"
    stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;

// The dedicated exact line's checkmark (RBAR-46, prototype L235 "[check] exact"): the
// prototype's literal checkmark character, drawn as an inline SVG for the same
// ASCII-only reason. Decorative; the line's text ("exact") carries the announcement.
const CHECK_ICON = `<svg width="10" height="10" viewBox="0 0 10 10" fill="none"
    aria-hidden="true"><path d="M1.5 5.5L4 8l4.5-6" stroke="currentColor"
    stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// The stepper faces (RBAR-74): a matched pair of SVG glyphs, not text characters
// (Caitlin, 2026-10-16) -- the same 14px box, the same stroke and caps, so plus is
// exactly minus with a vertical bar. Sized to the prototype's 22px mono glyph
// (L149/L151). Decorative: each button's aria-label is the announcement.
const STEP_GLYPH = (d: string): string => `<svg width="14" height="14" viewBox="0 0 14 14"
    fill="none" aria-hidden="true"><path d="${d}" stroke="currentColor" stroke-width="2"
    stroke-linecap="round"/></svg>`;
const MINUS_D = 'M2 7h10';
const MINUS_ICON = STEP_GLYPH(MINUS_D);
const PLUS_ICON = STEP_GLYPH(`${MINUS_D}M7 2v10`);

// Keydown origins the physical-keyboard handler defers to (RBAR-49): a text field owns
// every key typed into it; an activatable control outside the entry owns its Enter.
const TEXT_FIELD = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
const ACTIVATABLE = 'button, a[href], summary';

// True while an aria-modal dialog is showing anywhere in the composed tree (RBAR-49). The
// app's modals (Share, Fullscreen, Setup) close by hiding their host element, so a dialog
// counts as showing when neither it nor any ancestor, across shadow boundaries, is hidden.
function modalOpen(root: Document | ShadowRoot): boolean {
  for (const el of root.querySelectorAll<HTMLElement>('*')) {
    if (el.matches('[aria-modal="true"]') && !hiddenUp(el)) return true;
    if (el.shadowRoot && modalOpen(el.shadowRoot)) return true;
  }
  return false;
}

function hiddenUp(el: Element): boolean {
  for (let n: Element | null = el; n; ) {
    if ((n as HTMLElement).hidden) return true;
    const root = n.getRootNode();
    n = n.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
  }
  return false;
}

class RackEntry extends HTMLElement {
  private root: ShadowRoot = this.attachShadow({ mode: 'open' });
  private valueEl!: HTMLButtonElement;
  private valueNumEl!: HTMLElement;
  private valueUnitEl!: HTMLElement;
  private decBtn!: HTMLButtonElement;
  private incBtn!: HTMLButtonElement;
  // The keypad bottom sheet (RBAR-22, handoff 5): a fixed bottom-docked sheet whose
  // visibility IS the open/closed state. Deliberately NO dim scrim (the prototype keeps
  // the bar/Total above bright and interactive -- Caitlin's fidelity call, overriding the
  // ticket's "dim scrim" AC); it dismisses via Done or a value re-tap, not an outside tap.
  // The sheet carries its own readout -- the field behind it is covered, so it shows the
  // big live value, its secondary unit, and the live "on the bar" load line (fed down by
  // the console, which owns decode).
  private sheet!: HTMLElement;
  // What this field enters (RBAR-65 slice 2): the By Weight Target (the default), or --
  // with variant="working" -- the Warm up mode's Working set Target, labelled "Working
  // weight" in plain language (CONTEXT.md). One element, one keypad sheet, one keyboard
  // path: the variant only changes the labels and lays the row out compactly.
  private noun = 'Target';
  private liveEl!: HTMLElement;
  private liveUEl!: HTMLElement;
  private liveSecEl!: HTMLElement;
  private liveLoadEl!: HTMLElement;

  // The "on the bar" load line the sheet shows under the live value, e.g.
  // "On the bar: 142 kg <middot> 0.5 under" -- the actual loadable Total + how far it lands from
  // the Target. The console owns decode (ADR-0005), so it computes this and pushes it down;
  // null hides the line (an untouched default or empty field has nothing decoded yet).
  private _loadLine: string | null = null;

  /** The console's decode status for the sheet's "on the bar" line (null hides it). */
  set loadLine(text: string | null) {
    this._loadLine = text;
    if (this.liveLoadEl) this.renderLoadLine();
  }
  get loadLine(): string | null {
    return this._loadLine;
  }

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
    // `!reformatted` (RBAR-38): a Unit-reformatted TYPED Target whose converted text
    // happens to equal the Bar anchor (typed 20 kg on the 20 kg Bar, toggled to "44")
    // must not read as a seed here, or a Bar change would stomp it.
    const seededDefault =
      this.pristine && !this.reformatted && this.draft === this.barShown();
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
    // A switch re-pristines the draft (RBAR-38, prototype setUnit L561-567): the
    // converted number is a REFORMAT, not a fresh entry -- so the next digit replaces it
    // (not "2203" from typing 3 over 220) and del discards it whole. Whether the close
    // still commits depends on what was reformatted: a real lifter-chosen value stays
    // committable (`reformatted` -- the prototype's close pushes srcKg regardless of
    // pristine), while a genuine seed keeps committing null. `wasReal` is read BEFORE
    // the flags mutate; once reformatted, further toggles keep the value committable.
    const wasReal = !this.pristine && this.draft !== '';
    this.markPristine(this.draft !== '' && (wasReal || this.reformatted));
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
  // True when `draft` holds a value the lifter has not edited: a seeded default they
  // never chose (the initial Bar weight, a display() push) OR a Unit-reformat of a value
  // (RBAR-38 -- see `reformatted` for which). Drives the keypadclose COMMIT contract:
  // a pristine SEED carries null so an idle peek never litters Recents, while a pristine
  // REFORMAT of a lifter-chosen weight still commits its canonical kg. Cleared by the
  // first real edit (a keypress or a stepper nudge).
  private pristine = false;
  // True when the pristine draft is a Unit-reformat of a weight the lifter DID choose
  // (RBAR-38): it replaces-on-type like a seed, but closing the pad still commits its
  // canonical `shownKg` (the prototype's close pushes srcKg regardless of pristine), and
  // a Bar change must not mistake it for a seeded default even when the converted text
  // happens to equal the Bar anchor. False for genuine seeds; cleared by any real edit.
  private reformatted = false;
  // True when the next keypress should REPLACE the shown value rather than append to it.
  // Set on a seed AND every time the sheet OPENS (handoff 5: "first keypress after opening
  // replaces"), so reopening the pad on an existing Target and typing starts fresh (100 ->
  // "5", not "1005"). Distinct from `pristine`: a reopened REAL value replaces-on-type but
  // still commits on close, so this flag must not gate the commit.
  private replaceNext = false;

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
    this.markPristine(false); // a genuine seed: an idle peek-and-close commits null
    this.renderValue();
  }

  // Re-express the lifter's own Target as `kg` (RBAR-60): a unit toggle on an Exact load
  // makes the load itself the Target (55 lb typed = 24.95 kg; the 25 kg load is what was
  // meant). A REFORMAT, not a seed -- the pristine/commit flags are left to the Unit
  // setter's RBAR-38 rules, so a lifter-chosen weight still commits on close. A no-op on
  // an empty field (no Target to re-express).
  retarget(kg: number): void {
    if (this.shownKg === null) return;
    this.shownKg = kg;
    this.draft = String(shownIn(kg, this._unit));
    if (this.valueEl) this.renderValue();
  }

  // Mark the draft pristine (unedited by the lifter), keeping the flag trio in lockstep
  // -- the RBAR-38 bug was one seeding site setting `pristine` without `replaceNext`'s
  // semantics, so the pairing lives in one place now. `reformatted` says whether this
  // pristine value is a Unit-reformat of a lifter-chosen weight (commits on close) or a
  // genuine seed (commits null).
  private markPristine(reformatted: boolean): void {
    this.pristine = true;
    this.replaceNext = true;
    this.reformatted = reformatted;
  }

  // The Bar weight as shown in the display Unit -- the seeded default and empty-field
  // anchor. A string so it compares directly against the draft.
  private barShown(): string {
    return String(shownIn(this._barKg, this._unit));
  }

  connectedCallback(): void {
    this.noun = this.getAttribute('variant') === 'working' ? 'Working weight' : 'Target';
    const enter = `Enter ${this.noun === 'Target' ? 'Target' : 'working weight'}`;
    const keys = KEYPAD_ROWS.flat()
      .map(
        (k) => `<button type="button" class="key" data-key="${k}"
                  aria-label="${KEY_ARIA[k] ?? k}">${k === 'del' ? DEL_ICON : k}</button>`,
      )
      .join('');

    this.root.innerHTML = `
      <style>
        ${BOX_SIZING}${BUTTON_FX}${ROLL_CSS}
        /* The Target section opener (prototype L146): a hairline divider + 15px pad on
           the host, so the section boundary travels with the element. The 15px above
           is the console stack's 12px gap + this 3px (RBAR-74). */
        :host {
          display: block; margin-top: 3px;
          border-top: 1px solid var(--rack-divider); padding-top: 15px;
        }
        /* The Target section label (RBAR-40): the shared recipe, left-aligned like the
           prototype (L147) -- no longer a centered 13px caption. An h2 since RBAR-53
           (heading navigation), so the UA heading margins/font must be overridden --
           the recipe already pins the font, margin is pinned here. */
        .caption {
          display: block; ${SECTION_LABEL} margin: 0 0 9px;
        }
        /* The value row: [-] prominent value [+], 10px apart (prototype L148). The
           steppers are 44px round touch targets (L149/L151; RBAR-74) faced with SVG
           glyphs; the value itself is a button that opens the keypad. */
        .row {
          display: flex; align-items: center; justify-content: center; gap: 10px;
        }
        .step {
          flex: none; width: 44px; height: 44px; padding: 0;
          display: flex; align-items: center; justify-content: center;
          color: var(--rack-fg); background: transparent;
          border: 1px solid var(--rack-line); border-radius: 999px;
          cursor: pointer;
        }
        .step svg { display: block; }
        .step:active { background: var(--rack-line); }
        .step:focus-visible { outline: 2px solid var(--rack-accent); }
        /* The Target value (RBAR-39, prototype L150): Hanken 700 30px with explicit
           tabular figures (Hanken is proportional -- without tnum the digits jitter as
           the value changes). Mono is reserved for labels/plate numerals/unit toggles.
           Its ink sits a step under --rack-text, on a 3px pad (L150; RBAR-74). */
        .value {
          flex: 1; min-width: 0; text-align: center;
          font-family: var(--rack-font);
          font-size: 30px; font-weight: 700; line-height: 1.2;
          font-variant-numeric: tabular-nums;
          color: var(--rack-text-target); background: transparent;
          border: none; border-bottom: 2px solid var(--rack-line);
          padding: 3px 0; cursor: pointer;
        }
        .value.empty { color: var(--rack-text-dim); } /* placeholder anchor */
        .value:focus-visible { outline: none; border-bottom-color: var(--rack-accent); }
        /* The unit rides the value as a small dim suffix (15px/600, text-dim) -- it
           moved out of the caption (RBAR-39), so the caption reads just "Target". */
        .value .vu { font-size: 15px; font-weight: 600; color: var(--rack-text-dim); }

        /* The keypad is a bottom sheet (RBAR-22, handoff 5), not an inline grid: it is
           fixed to the viewport bottom and slides up (sheetIn .2s), so opening it never
           displaces the bar / Total / Recents behind it. Unlike the Setup/Share overlays
           there is NO dim scrim -- the prototype keeps the bar bright above the sheet, so
           the lifter watches the plates resolve live while typing (Caitlin's fidelity call,
           overriding the ticket's "dim scrim" AC). Handoff SUNKEN fill (#101216), 1px top
           border, 24px top corners; safe-area pad clears the home indicator.

           Entrance motion (RBAR-46, prototype L229 "sheetIn .2s ease-out"): the keypad's
           sheetIn is ease-out WITH an opacity fade -- deliberately softer than the setup
           sheet's springier cubic-bezier, so the two sheets no longer share one easing.
           Split BUTTON_FX-style for reduced motion: everyone gets the fade (opacity is
           not motion), only a no-preference lifter gets the translate rise. */
        @keyframes rack-sheet-fade {
          from { opacity: 0; } to { opacity: 1; }
        }
        @keyframes rack-sheet-rise {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .sheet[hidden] { display: none; }
        .sheet {
          position: fixed; left: 0; right: 0; bottom: 0; z-index: 50;
          margin: 0 auto; width: 100%; max-width: 520px;
          background: var(--rack-sunken);
          border-top: 1px solid var(--rack-border);
          border-radius: var(--rack-radius-sheet) var(--rack-radius-sheet) 0 0;
          padding: 16px 16px calc(16px + env(safe-area-inset-bottom));
          box-shadow: var(--rack-shadow-sheet);
          animation: rack-sheet-fade .2s ease-out;
        }
        @media (prefers-reduced-motion: no-preference) {
          .sheet { animation: rack-sheet-rise .2s ease-out; }
        }
        /* The sheet's own readout: the big live value, its secondary unit, and the live
           "on the bar" load line (the field behind the sheet is covered). */
        .live { text-align: center; margin-bottom: 0; }
        /* The sheet's live number (RBAR-39, prototype L231): Hanken 800 46px -.02em,
           tnum for the same no-jitter reason as the Target value above. Rolls on
           change (numRoll) like every display number. */
        .live-num {
          font-family: var(--rack-font); font-size: 46px; font-weight: 800;
          line-height: 1; font-variant-numeric: tabular-nums;
          color: var(--rack-text); letter-spacing: -.02em;
        }
        .live-num.empty { color: var(--rack-text-dim); }
        .live-u {
          font-size: 18px; font-weight: 700;
          color: var(--rack-text-dim); margin-left: 4px;
        }
        /* Secondary unit, then the "on the bar" status, stacked under the value (handoff 5):
           the secondary in the other unit (muted), the load line in accent below it.
           Both in Hanken, 6px under the number, 3px apart, 15px above the keys
           (prototype L230-L234; RBAR-74): the secondary 500 13px, the load line
           600 11px. */
        .sub {
          display: flex; flex-direction: column; align-items: center; gap: 3px;
          min-height: 18px; margin-top: 6px; margin-bottom: 15px;
          font-family: var(--rack-font); font-weight: 500; font-size: 13px;
          color: var(--rack-muted);
        }
        .sub .load {
          font-family: var(--rack-font); font-weight: 600; font-size: 11px;
          color: var(--rack-accent);
        }
        .sub .load[hidden] { display: none; }
        /* The dedicated exact line (RBAR-46, prototype L235 "[check] exact"): when the
           decoded Total lands exactly on the Target, the accent delta line gives way to
           this quiet mono confirmation. The prototype's type spec is character-for-
           character the section-label recipe (600 11px mono, .14em, uppercase,
           text-muted), so it borrows SECTION_LABEL rather than restating the numbers. */
        .sub .load.exact:not([hidden]) {
          display: inline-flex; align-items: center; gap: 5px;
          ${SECTION_LABEL}
        }
        .keypad {
          display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;
        }
        /* A key (RBAR-46, prototype L240): a RAISED fill (#15171a) lifted off the sunken
           sheet -- not transparent -- on the sheet-control 13px radius. 44px is both the
           prototype's min-height and the touch-target floor. */
        .key {
          min-height: 44px;
          font-family: var(--rack-font-num); font-size: 20px; font-weight: 600;
          color: var(--rack-fg); background: var(--rack-raised);
          border: 1px solid var(--rack-line);
          border-radius: var(--rack-radius-sheet-control);
          cursor: pointer;
        }
        .key svg { display: block; margin: 0 auto; }
        .key:active { background: var(--rack-line); }
        .key:focus-visible { outline: 2px solid var(--rack-accent); }
        /* Footer (RBAR-46, prototype L244-245): Clear (ghost, an edit) + Done (accent,
           the dismiss), 42px on the sheet-control radius, Hanken 600 13px / 700 14px. */
        .foot { display: flex; gap: 8px; margin-top: 8px; }
        .clear, .done {
          flex: 1; min-height: 42px; font: inherit;
          border-radius: var(--rack-radius-sheet-control); cursor: pointer;
        }
        .clear {
          font-size: 13px; font-weight: 600; color: var(--rack-muted);
          background: transparent; border: 1px solid var(--rack-line);
        }
        .done {
          font-size: 14px; font-weight: 700; color: var(--rack-bg);
          background: var(--rack-accent); border: none;
        }
        .clear:focus-visible, .done:focus-visible {
          outline: 2px solid var(--rack-accent); outline-offset: 2px;
        }
        /* The short-screen tier (RBAR-67, fit.ts): a closer Target section opener;
           the steppers and the value keep their size. */
        @media ${SHORT_SCREEN} {
          :host { padding-top: 10px; }
          .caption { margin-bottom: 6px; }
        }
        /* The Warm up working-weight row (RBAR-65 slice 2): one compact line -- the
           label at the left edge, the steppers and value at the right -- so the stairs
           below keep the room the Target block + Recents had. The steppers drop to the
           44px touch floor and the value to the mock's 20px underlined reading; the
           sheet is fixed-position, so it never takes part in this row's layout. */
        :host([variant="working"]) {
          display: flex; align-items: center; justify-content: space-between; gap: 10px;
        }
        :host([variant="working"]) .caption { margin: 0; flex: 0 1 auto; min-width: 0; }
        :host([variant="working"]) .row { flex: none; gap: 8px; }
        :host([variant="working"]) .step { width: 44px; height: 44px; font-size: 22px; }
        :host([variant="working"]) .value {
          flex: none; min-width: 84px; font-size: 20px; padding: 2px 2px 3px;
          border-bottom-width: 1px;
        }
        :host([variant="working"]) .value .vu { font-size: 12px; }
      </style>
      <!-- The Target section heading (RBAR-53): an h2 under the app's h1, styled by the
           section-label recipe. Static "Target" ("Working weight" in the Warm up variant,
           RBAR-65) -- the unit rides the value's suffix
           span (RBAR-39); the value button still carries its own live aria-label. -->
      <h2 class="caption" data-caption>${this.noun}</h2>
      <div class="row">
        <button type="button" class="step" data-step="dec" aria-label="Decrease">${MINUS_ICON}</button>
        <button type="button" class="value" data-value
                aria-haspopup="true" aria-expanded="false"><span
            data-value-num>${DEFAULT_BAR_KG}</span><span
            class="vu" data-value-unit> kg</span></button>
        <button type="button" class="step" data-step="inc" aria-label="Increase">${PLUS_ICON}</button>
      </div>
      <div class="sheet" data-sheet role="dialog" aria-modal="false" aria-label="${enter}" hidden>
        <div class="live">
          <span class="live-num" data-live>${DEFAULT_BAR_KG}</span><span
            class="live-u" data-live-u>kg</span>
        </div>
        <div class="sub">
          <span data-live-sec></span>
          <!-- A polite live region while the sheet shows (RBAR-53): the sheet covers the
               console's Total, so this line is THE announcement source while typing. The
               sheet's display:none removes it from the a11y tree on close, handing the
               single active source back to the console's status region. -->
          <span class="load" data-live-load role="status" hidden></span>
        </div>
        <div class="keypad" data-keypad role="group" aria-label="${enter}">
          ${keys}
        </div>
        <div class="foot">
          <button type="button" class="clear" data-key="clear">Clear</button>
          <button type="button" class="done" data-done>Done</button>
        </div>
      </div>
    `;

    this.valueEl = this.root.querySelector('[data-value]')!;
    this.valueNumEl = this.root.querySelector('[data-value-num]')!;
    this.valueUnitEl = this.root.querySelector('[data-value-unit]')!;
    this.decBtn = this.root.querySelector('[data-step="dec"]')!;
    this.incBtn = this.root.querySelector('[data-step="inc"]')!;
    this.sheet = this.root.querySelector('[data-sheet]')!;
    this.liveEl = this.root.querySelector('[data-live]')!;
    this.liveUEl = this.root.querySelector('[data-live-u]')!;
    this.liveSecEl = this.root.querySelector('[data-live-sec]')!;
    this.liveLoadEl = this.root.querySelector('[data-live-load]')!;

    // Tapping the value toggles the sheet; the Done button closes it. There is no scrim,
    // so no outside-tap dismissal (the prototype keeps the bar above bright + interactive).
    this.valueEl.addEventListener('click', () =>
      this.sheet.hidden ? this.openKeypad() : this.closeKeypad(),
    );
    this.root.querySelector('[data-done]')!.addEventListener('click', () => this.closeKeypad());
    this.incBtn.addEventListener('click', () => this.step(1));
    this.decBtn.addEventListener('click', () => this.step(-1));
    this.root.querySelectorAll<HTMLButtonElement>('[data-key]').forEach((btn) =>
      btn.addEventListener('click', () => this.press(btn.dataset.key!)),
    );

    // Start at the Bar weight: a real, steppable starting point, silent (no target
    // event -- the console already renders the bare Bar). Pristine, so typing replaces it.
    this.draft = this.barShown();
    this.markPristine(false);
    this.renderValue();
  }

  // Drop the physical-keyboard listener if the element leaves the DOM with the sheet open
  // (RBAR-49): a reconnect rebuilds the markup with the sheet closed, so nothing re-adds it.
  disconnectedCallback(): void {
    document.removeEventListener('keydown', this.onKeydown);
  }

  // Physical keyboard input (RBAR-49): while the sheet is open, keys drive the SAME
  // press()/step()/closeKeypad() paths as taps (ArrowUp/ArrowDown are the +/- steppers),
  // so they inherit every tap semantic (replace-on-open, pristine del-discard, the RBAR-38
  // re-pristine and grid snap, the commit-on-close contract).
  // Listening only while open (added in openKeypad, removed in closeKeypad) means a closed
  // sheet never swallows a key. A Cmd/Ctrl/Alt-held key is a browser shortcut and passes
  // through untouched; so does any key typed into a text field elsewhere. Enter and Escape
  // are both Done (there is no cancel: every keystroke already emitted). A mapped key is
  // claimed with preventDefault, which also cancels a focused on-screen key's native Enter
  // activation -- otherwise Enter would close the pad AND re-press the focused key (or
  // re-toggle the value button open). Space is not mapped, so a focused key keeps its own
  // Space activation and enters exactly once. This holds for EVERY control inside the
  // entry (keys, value, steppers, Clear): a mouse tap leaves focus on it in Chrome, so
  // Enter must mean Done there too, not a repeat of the last tap; a keyboard user still
  // activates a focused control with Space. Enter on a focused control OUTSIDE this
  // element is left to that control.
  private onKeydown = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
    // The console hides the whole entry in By Plates (Encode) without closing the sheet,
    // so a pad left open across a mode switch must not take keys it cannot show. (Only
    // the host's own flag: that is how the console hides it.) Likewise, the pad has no
    // scrim, so Share / Fullscreen / Setup can open OVER it -- content behind an
    // aria-modal dialog is inert, so keys must not edit or commit the Target back there.
    if (this.hidden || modalOpen(document)) return;
    const origin = e.composedPath()[0];
    if (origin instanceof Element && origin.matches(TEXT_FIELD)) return;
    const k = e.key;
    if (k === 'Enter' || k === 'Escape') {
      const foreign =
        origin instanceof Element && !this.root.contains(origin) && origin.matches(ACTIVATABLE);
      if (k === 'Enter' && foreign) return;
      e.preventDefault();
      this.closeKeypad();
    } else if (k === 'Backspace') {
      e.preventDefault();
      this.press('del');
    } else if ((k === 'ArrowUp' || k === 'ArrowDown') && !e.shiftKey) {
      // A stepper nudge, exactly as a +/- tap (grid snap, RBAR-38); claimed so the page
      // does not scroll. Shift+Arrow passes through: there is no big-step variant.
      e.preventDefault();
      this.step(k === 'ArrowUp' ? 1 : -1);
    } else if (k === '.' || k === ',') {
      // Comma is the decimal on comma-locale keyboards and numpads: the same decimal key.
      e.preventDefault();
      this.press('.');
    } else if (/^[0-9]$/.test(k)) {
      e.preventDefault();
      this.press(k);
    }
  };

  /** Open the keypad sheet if closed. The console's Total-tap affordance (RBAR-57):
   * an edit entry point, not a toggle, so an already-open sheet stays open. */
  open(): void {
    if (this.sheet && this.sheet.hidden) this.openKeypad();
  }

  // Show the keypad sheet. Reflect the open state on the value button so assistive tech
  // announces the expanded pad, and tell the console (RBAR-53): while the sheet is open
  // its load line is the single live announcement source, so the console mutes its own.
  private openKeypad(): void {
    this.sheet.hidden = false;
    this.valueEl.setAttribute('aria-expanded', 'true');
    // Handoff 5: the first keypress after opening replaces the shown value, so reopening
    // the pad on an existing Target and typing starts fresh (does NOT touch `pristine`, so
    // a real value peeked and closed still commits).
    this.replaceNext = true;
    document.addEventListener('keydown', this.onKeydown);
    this.dispatchEvent(new CustomEvent('keypadopen', { bubbles: true, composed: true }));
  }

  // Hide the keypad sheet and commit the Target: the console pushes it onto the Recent
  // row (RBAR-20, ADR-0009). Guarded on the open->closed edge so only a real dismissal
  // (Done or a value re-tap) commits -- an already-closed call is a no-op, so no path
  // double-commits.
  private closeKeypad(): void {
    if (this.sheet.hidden) return;
    this.sheet.hidden = true;
    this.valueEl.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', this.onKeydown);
    this.emitKeypadClose();
  }

  // The load line as last rendered (the raw console string, pre-exact-split), so an
  // idempotent re-push is detected against what was actually fed -- the rendered DOM no
  // longer mirrors the string verbatim in the exact case, so textContent can't be the
  // comparison key anymore.
  private renderedLoadLine = '';

  // The sheet's "on the bar" load line: the console's decoded status, or hidden when
  // there is nothing decoded (an untouched default / empty field). The line is a live
  // region (RBAR-53), so only a REAL change touches the DOM -- re-pushing the same line
  // (an idempotent console re-render) must not re-announce it.
  //
  // The EXACT state (RBAR-46, prototype L235): when the Total lands exactly on the
  // Target the prototype swaps the accent delta line for a dedicated quiet
  // "[check] exact" mono line -- the big live number already IS the exact Total, so
  // repeating it would say nothing. The console's onBarLine marks that state with its
  // "<middot> exact" tail (elements/console.ts), so the sheet keys off that suffix; the
  // announcement becomes just "exact" (the check drawing is aria-hidden).
  private renderLoadLine(): void {
    const text = this._loadLine ?? '';
    if (this.renderedLoadLine === text) return;
    this.renderedLoadLine = text;
    if (text.endsWith('\u00B7 exact')) {
      this.liveLoadEl.classList.add('exact');
      this.liveLoadEl.innerHTML = `${CHECK_ICON}exact`;
    } else {
      this.liveLoadEl.classList.remove('exact');
      this.liveLoadEl.textContent = text;
    }
    this.liveLoadEl.hidden = text === '';
  }

  // A keypad press mutates the draft string (in the display Unit), then emits the
  // derived kg Target. A `replaceNext` value (a seeded default, or the value shown when
  // the pad was reopened -- handoff 5) is replaced by the first typed digit/decimal rather
  // than appended to. Any press also clears `pristine`: once the lifter types, the value
  // is one they chose, so closing commits it.
  private press(k: string): void {
    const replace = this.replaceNext;
    // `del` discards a whole value only when it is a genuine placeholder default (the bare
    // Bar seed / a display() seed); on a real value -- including one the pad just reopened
    // -- del edits a single character. So del keys off `pristine`, while typing a digit or
    // a decimal keys off `replaceNext` (replace-on-open, handoff 5).
    const discardOnDel = this.pristine;
    this.replaceNext = false;
    this.pristine = false;
    this.reformatted = false; // a real edit: the value is now the lifter's own
    if (k === 'clear') {
      this.draft = '';
    } else if (k === 'del') {
      this.draft = discardOnDel ? '' : this.draft.slice(0, -1);
    } else if (k === '.') {
      if (replace) this.draft = '';
      if (!this.draft.includes('.')) this.draft += this.draft === '' ? '0.' : '.';
    } else {
      // Drop a lone leading zero ("0" + "5" -> "5") so the shown draft matches the
      // Target it decodes to; a leading zero before a decimal is kept by the '.' branch.
      const base = replace ? '' : this.draft;
      this.draft = base === '0' ? k : base + k;
    }
    this.renderValue();
    this.emit();
  }

  // A stepper nudge in the display Unit: an empty field anchors at the Bar (you load up
  // from the Bar), snap to the step grid, clamp at 0 (Target is never negative), and
  // round off float fuzz. The grid is stepFor(unit) -- 5 lb or 1 kg (RBAR-38, prototype
  // step() L574-591): a nudge lands on the NEXT multiple of the grid rather than carrying
  // an off-grid fraction along, so 142.5 steps to 143 / 142 and re-aligns for good. An
  // on-grid value moves a whole step. The epsilon absorbs float fuzz in the quotient so
  // a nominally-on-grid value is not treated as off-grid and half-stepped -- defensive:
  // real drafts are keypad literals or shownIn output (both fuzz-free at these grids),
  // so only a hand-pasted many-decimal draft can exercise it.
  private step(dir: 1 | -1): void {
    this.pristine = false;
    this.reformatted = false;
    // A nudge is an explicit edit of the current value, so a following digit appends to
    // the stepped number rather than replacing it.
    this.replaceNext = false;
    const grid = stepFor(this._unit);
    const shownBar = shownIn(this._barKg, this._unit);
    const current = this.draft === '' ? shownBar : Number(this.draft);
    const base = Number.isNaN(current) ? shownBar : current;
    const q = base / grid;
    const onGrid = Math.abs(q - Math.round(q)) < 1e-9;
    const steps =
      dir === 1
        ? onGrid
          ? Math.round(q) + 1
          : Math.ceil(q - 1e-9)
        : onGrid
          ? Math.round(q) - 1
          : Math.floor(q + 1e-9);
    const next = Math.max(0, Number((steps * grid).toFixed(2)));
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
    // The value rolls up on change (numRoll, RBAR-30); the unit is a small dim suffix
    // beside it (RBAR-39) that just tracks the active Unit -- it never rolls.
    rollText(this.valueNumEl, shown);
    this.valueUnitEl.textContent = ` ${this._unit}`;
    this.valueEl.classList.toggle('empty', empty);
    // The sheet's own live readout mirrors the same shown value + Unit (the field behind
    // the sheet is covered while the pad is open), plus a secondary line in the OTHER unit
    // (handoff 5). The secondary reads off the SAME canonical kg the value shows (the typed
    // Target, or the Bar anchor when empty), so it never drifts from the big number.
    // The live number rolls too (RBAR-39 -- the prototype animates both via one binding).
    rollText(this.liveEl, shown);
    this.liveEl.classList.toggle('empty', empty);
    this.liveUEl.textContent = this._unit;
    const other: Unit = this._unit === 'kg' ? 'lb' : 'kg';
    this.liveSecEl.textContent = format(this.currentTarget() ?? this._barKg, other);
    const step = stepFor(this._unit);
    this.decBtn.setAttribute('aria-label', `Decrease by ${step} ${this._unit}`);
    this.incBtn.setAttribute('aria-label', `Increase by ${step} ${this._unit}`);
    // Announce the live value (aria-labelledby would override the text and hide it).
    this.valueEl.setAttribute('aria-label', `${this.noun} ${shown} ${this._unit}`);
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
  // A pristine SEED carries null: closing the pad on an untouched seeded default (the
  // bare Bar on first open, or a value display() pushed in) is an idle peek, not a Target
  // the lifter entered -- so it must not litter the history with a weight they never
  // chose. A pristine REFORMAT (RBAR-38) still carries its canonical `shownKg`: the
  // lifter DID choose that weight, a Unit toggle only re-dressed it (and the prototype's
  // close pushes srcKg regardless of pristine). Canonical, not the re-parsed draft, so
  // 100 kg toggled to "220" commits 100, never draftToKg("220", lb) ~ 99.79.
  private emitKeypadClose(): void {
    const committed = this.pristine
      ? this.reformatted
        ? this.shownKg
        : null
      : this.currentTarget();
    this.dispatchEvent(
      new CustomEvent<{ target: number | null }>('keypadclose', {
        detail: { target: committed },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

customElements.define('rack-entry', RackEntry);
