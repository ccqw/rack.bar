// <rack-console> -- the calculator surface, both directions. A Decode/Encode toggle
// switches which editor drives a single shared Side Load (RBAR-7, ADR-0005):
//   Decode -- the Target entry derives the Side Load via decode() (ADR-0003: never
//             overshoots by default, with the over-target opt-in).
//   Encode -- a Plate palette taps addPlate() on; tapping a loaded disc taps
//             removePlate() off; the Total reads encode(side).
// The Side Load is one value this shell owns; the mode picks who edits it, and a
// switch never clears it -- so a loadout persists across the toggle for free. All the
// plate math lives in the pure core (lib/); the elements only wire DOM to it (ADR-0001).
//
// The console also owns the Target DISPLAY (RBAR-17, ADR-0010): the kg|lb Primary unit
// and whether the Secondary readout shows, persisted console-side (rackbar.unit /
// rackbar.secondary) -- the line ADR-0009 drew, putting Target-display state with the
// console. The app pushes the rig config down (barKg, collarKg, plateSet); the chosen
// plate set selects the Inventory to solve against. The unit toggle is free on every set
// (RBAR-60, ADR-0010 amendment): a kg lifter can load the iron set by kg Targets.
import './entry.ts';
import './palette.ts';
import './loaded.ts';
import { SLEEVE_BLOCK_PX, SLEEVE_MIN_PX } from './sleeve.ts';
import './recents.ts';
import './share.ts';
import './fullscreen.ts';
import './warmup.ts';
import { decodeWithin } from '../lib/decode.ts';
import { addPlate, encode, removePlate } from '../lib/encode.ts';
import { DEFAULT_BAR_KG, DEFAULT_COLLAR_KG, atSleeveCapacity, barWithCollars, sideWidthMm } from '../lib/plates.ts';
import { readPersisted, writePersisted } from './persist.ts';
import {
  parseRecents,
  pushRecent,
  removeRecent,
  restoreRecent,
  isRememberable,
} from '../lib/recents.ts';
import { BOX_SIZING } from './boxsizing.ts';
import { BUTTON_FX } from './buttonfx.ts';
import { SHORT_SCREEN } from './fit.ts';
import { SECTION_LABEL, VISUALLY_HIDDEN } from './sectionlabel.ts';
import { ROLL_CSS, rollText } from './numroll.ts';
import { plateSetFor, isOfferedPlateSet } from '../lib/platesets.ts';
import type { PlateSetKey } from '../lib/platesets.ts';
import type { LoadSummary } from '../lib/summary.ts';
import { format, shownIn, displayCeilingKg } from '../lib/units.ts';
import type { Unit } from '../lib/units.ts';
import type { Plate } from '../lib/plates.ts';
import type { Decoded, Loadout } from '../lib/decode.ts';
import { planRamp, DEFAULT_RAMP } from '../lib/plan.ts';
import type { Ramp, RampRow } from '../lib/plan.ts';
import { parseWorking, warmStatus, warmupView } from '../lib/warmup.ts';
import type { WarmupView } from '../lib/warmup.ts';

type Sleeve = HTMLElement & {
  sideLoad: readonly Plate[];
  interactive: boolean;
};
type Entry = HTMLElement & {
  display(value: number | null): void;
  retarget(kg: number): void;
  open(): void;
  barKg: number;
  unit: Unit;
  loadLine: string | null;
};
type Recents = HTMLElement & {
  targets: readonly number[];
  unit: Unit;
  target: number | null;
  readonly undoPending: boolean;
};
type Loaded = HTMLElement & { side: readonly Plate[] };
type Palette = HTMLElement & { inventory: readonly Plate[]; sideMm: number };
type Share = HTMLElement & { load: LoadSummary; plateSet: string; open(): void };
type Fullscreen = HTMLElement & { load: LoadSummary; plateSet: string; open(): void };
type Warmup = HTMLElement & { view: WarmupView | null };
// 'warmup' is the Warm up mode (RBAR-65 slice 2): the Ramp's stairs drive the Side.
type Mode = 'decode' | 'encode' | 'warmup';
const isMode = (m: string | undefined): m is Mode =>
  m === 'decode' || m === 'encode' || m === 'warmup';

// The Recent Targets history persists shell-side under its own key (ADR-0007/0009),
// canonically in kg (ADR-0006); the row renders it in the active unit (RBAR-17).
const RECENTS_KEY = 'rackbar.recents';
// The Target display state, console-owned and console-persisted (ADR-0010): the
// lifter's Primary-unit choice (one choice for every plate set, RBAR-60) and whether
// the Secondary readout shows.
const UNIT_KEY = 'rackbar.unit';
const SECONDARY_KEY = 'rackbar.secondary';
// The Warm up mode's Working set Target, canonical kg (RBAR-65 slice 2, ADR-0007/0009):
// console-owned like the By Weight display state. Absent = never set (Warm up seeds it
// from the By Weight Target on first open); '' = the lifter cleared it.
const WORKING_KEY = 'rackbar.working';

// The bar block's fixed parts (RBAR-67): the head row is one icon button tall (the
// handoff's 30px box), and the sleeve sits VIZ_GAP_PX under it. The flex range of the
// block is these plus the sleeve's own range (SLEEVE_MIN_PX..SLEEVE_BLOCK_PX).
const ICON_PX = 30;
const VIZ_GAP_PX = 10;

class RackConsole extends HTMLElement {
  private root: ShadowRoot = this.attachShadow({ mode: 'open' });
  private entry!: Entry;
  // The Warm up mode's working-weight field: a second <rack-entry> (variant="working")
  // with its own draft and the same keypad sheet + keyboard path (RBAR-65 slice 2).
  private workEntry!: Entry;
  private warmup!: Warmup;
  private vizAdd!: HTMLElement;
  private recentsRow!: Recents;
  private loadedRow!: Loaded;
  private palette!: Palette;
  private sleeve!: Sleeve;
  private share!: Share;
  private fullscreen!: Fullscreen;
  private totalNum!: HTMLElement;
  private totalTap!: HTMLButtonElement;
  private totalUnit!: HTMLElement;
  private secondary!: HTMLButtonElement;
  private status!: HTMLElement;
  private statusLabel!: HTMLElement;
  private barnote!: HTMLElement;
  private vizLabel!: HTMLElement;
  private announcer!: HTMLElement;
  private over!: HTMLButtonElement;
  private overRow!: HTMLElement;
  private atcap!: HTMLElement;
  private unitButtons!: NodeListOf<HTMLButtonElement>;
  private modeButtons!: NodeListOf<HTMLButtonElement>;

  // The lifter's recent Targets, most-recent-first (kg). Loaded from storage on connect,
  // pushed on a Target commit (keypad close) and on a chip re-apply, persisted on change.
  // Readonly: only ever reassigned to a fresh list from pushRecent/parseRecents, never
  // mutated in place -- which is what keeps the dedupe/cap/order invariants intact.
  private recents: readonly number[] = [];

  // The single shared Side Load (ADR-0005): what the sleeve draws and what the Total
  // reads, in both modes. Decode derives it; Encode edits it; a mode switch keeps it.
  private side: readonly Plate[] = [];
  private mode: Mode = 'decode';
  // The chosen Bar and Collar, folded into the effective baseline the parameterized core
  // loads from (ADR-0002/0007/0008). Defaults: 20 kg Bar, no Collar; the app shell sets
  // them from Setup. Both setters re-decode a standing Target (see baselineKg/reconfigure).
  private _barKg = DEFAULT_BAR_KG;
  private _collarKg = DEFAULT_COLLAR_KG;
  // The active plate set (RBAR-17, ADR-0010): selects the Inventory to decode/encode
  // against. Defaults to Competition (kg Eleiko); the app sets it from Setup.
  private _plateSetKey: PlateSetKey = 'comp';
  // The lifter's Primary-unit choice and Secondary-visible preference (ADR-0010).
  // unitPref holds on every plate set, and a set switch keeps it (RBAR-60). Both
  // restore from storage on connect and persist on change.
  private unitPref: Unit = 'kg';
  private showSecondary = true;
  // Decode-only: the current decode() result and whether the over-target opt-in is on
  // screen. `showingOver` only ever flips on a click, never on a new Target, so Decode
  // never auto-puts the lifter over Target (ADR-0003). Both reset on a mode switch.
  private decoded: Decoded | null = null;
  private showingOver = false;
  // Which mode's keypad sheet is open, if any (RBAR-53): By Weight's Target field or, since
  // RBAR-65, Warm up's working-weight field. While that mode is active -- so the sheet
  // actually shows -- the sheet's own "On the bar" load line is the live announcement
  // source and the console's status region stays quiet (exactly one source at a time).
  // Tracked off each entry's keypadopen/keypadclose events.
  private keypadOwner: Mode | null = null;
  // Warm up (RBAR-65 slice 2). `working` is the Working set's Target (kg, null = none
  // yet); `ramp` is its plan on the current rig (null without a Working set); `warmIdx`
  // is the selected row, whose Side is the shared Side Load while Warm up is active.
  // `byWeightTarget` is the last By Weight Target, the seed for a first Warm up open.
  private working: number | null = null;
  private ramp: Ramp | null = null;
  private warmIdx = 0;
  private byWeightTarget: number | null = null;

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

  /**
   * The active plate set (RBAR-17, ADR-0010). Switching it changes the Inventory; the
   * display unit is the lifter's and is kept (RBAR-60). The Plates do not cross sets,
   * so a hand-built Encode loadout is reset to the bare rig; a Decode Target is unit-agnostic kg, so it
   * re-solves on the new rig (the same weight on the new Plates). The app pairs this with
   * a barKg change to the set's default -- set barKg first so the re-decode sees it.
   */
  set plateSet(key: string) {
    const k = isOfferedPlateSet(key) ? key : 'comp';
    if (k === this._plateSetKey) return;
    this._plateSetKey = k;
    if (this.palette) this.palette.inventory = this.inventory(); // swap the Encode palette
    // Iron and Eleiko Plates are different objects -- no carry across sets (ADR-0010).
    // Drop the Side in EVERY mode, not just Encode: a Side carried into By Weight with
    // nothing decoded used to slip past a mode-gated clear and leak old-set Plates onto
    // the new rig (RBAR-32). A live Decode Target is unaffected -- reconfigure() below
    // re-solves it on the new rig, rebuilding the Side from the new Inventory.
    this.side = [];
    if (this.mode === 'encode') {
      this.decoded = null;
      this.showingOver = false;
    }
    this.reconfigure();
  }
  get plateSet(): string {
    return this._plateSetKey;
  }

  // The Inventory the core draws from, from the active set (ADR-0010).
  private inventory(): readonly Plate[] {
    return plateSetFor(this._plateSetKey).inventory;
  }

  // The display Unit: the lifter's choice on every plate set. The iron set used to force
  // lb (ADR-0010); RBAR-60 freed it -- a kg lifter loads iron by kg Targets too.
  private activeUnit(): Unit {
    return this.unitPref;
  }

  // The effective Bar baseline the core loads from: Bar + 2 x Collar (ADR-0008). Every
  // decode/encode/Total in this shell threads this, not the bare Bar, so the Collar rides
  // the parameter ADR-0002 already provides.
  private baselineKg(): number {
    return barWithCollars(this._barKg, this._collarKg);
  }

  // Re-apply a Bar/Collar/plate-set change: move the entry's anchor to the new baseline,
  // then either re-decode the standing Target (rebuilding the Side Load) or, with no live
  // decode, just re-render so the Total re-reads. The Target is re-derived from the decode
  // result (`target = total - delta`), so no separate copy of it can drift.
  private reconfigure(): void {
    if (!this.entry) return; // pre-connect; connectedCallback renders from the fields
    this.entry.barKg = this.baselineKg();
    this.workEntry.barKg = this.baselineKg();
    if (this.mode === 'decode' && this.decoded) {
      this.decodeTo(this.decoded.primary.total - this.decoded.primary.delta);
    } else if (this.mode === 'warmup') {
      // The entry's Bar setter re-seeds an untouched field that reads the Bar; a
      // Working set equal to the old Bar must keep reading itself, not the new Bar.
      if (this.working !== null) this.workEntry.display(this.working);
      this.planWarmup();
      this.render();
    } else {
      this.render();
    }
  }

  connectedCallback(): void {
    this.root.innerHTML = `
      <style>
        ${BOX_SIZING}${BUTTON_FX}${ROLL_CSS}
        /* RBAR-67: one phone screen, no scroll. The console is a full-height column
           (main stretches it) and every level may shrink below its content
           (min-height: 0), so the height left over after the fixed blocks is what the
           bar block (.viz, below) gets -- not a taller page. The column spacing is the
           handoff's 12px (prototype L77; it was 24px). */
        :host {
          display: flex; flex-direction: column; width: 100%; max-width: 520px;
          min-height: 0;
        }
        .stack {
          display: flex; flex-direction: column; gap: 12px; align-items: stretch;
          flex: 1; min-height: 0;
        }
        /* Only the bar flexes: every other block keeps its natural height. */
        .stack > :not(.viz) { flex: none; }
        /* The Decode/Encode toggle: a segmented control, the obvious mode switch.
           A full-width raised track (prototype L92) -- the .stack's stretch spreads
           it; the segments split the track as equal halves (sModeBtn, L404). */
        .modes {
          display: flex; padding: 4px;
          background: var(--rack-raised);
          border: 1px solid var(--rack-border);
          border-radius: var(--rack-radius-pill);
        }
        .modes button {
          flex: 1; font: inherit; font-size: 14px; font-weight: 600;
          color: var(--rack-text-dim); background: transparent;
          border: none; border-radius: var(--rack-radius-pill);
          padding: 11px 0; cursor: pointer;
        }
        .modes button[aria-pressed="true"] {
          font-weight: 700;
          color: var(--rack-accent-ink); background: var(--rack-accent);
        }
        .modes button:focus-visible { outline: 2px solid var(--rack-accent); }
        rack-entry[hidden], rack-palette[hidden], rack-warmup[hidden] { display: none; }
        /* The bar visualizer block (handoff section 3, prototype L98): a head row --
           the contextual label top-left, the Share and fullscreen controls top-right
           (RBAR-18/35/61) -- then the sleeve, 10px apart (the prototype column's gap). */
        /* RBAR-67: the bar block is the column's one flexible piece. It takes the
           leftover height between a floor (head row + gap + SLEEVE_MIN_PX, so the Plates
           stay readable) and a cap (head row + gap + the handoff's SLEEVE_BLOCK_PX), and
           the sleeve fills it under the head row; the sleeve fits its discs to that
           height. A short phone gets a shorter Bar picture; a tall one gets the full
           handoff block, never more -- spare height falls below the column. */
        .viz {
          display: flex; flex-direction: column; gap: ${VIZ_GAP_PX}px;
          flex: 1 1 0;
          min-height: ${ICON_PX + VIZ_GAP_PX + SLEEVE_MIN_PX}px;
          max-height: ${ICON_PX + VIZ_GAP_PX + SLEEVE_BLOCK_PX}px;
        }
        .viz rack-sleeve { flex: 1 1 0; min-height: 0; }
        .vizhead {
          display: flex; align-items: center; justify-content: space-between;
        }
        /* The contextual label (RBAR-35, prototype L101): what the bar block shows
           right now -- "per side" once loaded, else the mode's empty-state prompt.
           The shared section-label recipe; uppercase comes from it, so the copy stays
           plain-cased in the DOM exactly like the prototype's vm. */
        .vizlabel { ${SECTION_LABEL} }
        /* Warm up's add caption beside "per side" (RBAR-65 slice 2, mock option D):
           what the selected set adds, in accent mono, unit included ("+15 kg"). */
        .vizhl { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
        .vizadd {
          font-family: var(--rack-font-num); font-size: 11px; font-weight: 700;
          letter-spacing: .06em; color: var(--rack-accent); white-space: nowrap;
        }
        .vizadd[hidden] { display: none; }
        /* The head's icon buttons: Share then fullscreen (RBAR-61). One shared box rule
           so the two can never drift apart. 30px is the handoff's box (prototype L98;
           RBAR-48's respec, landed here by RBAR-67 because the head row's height is part
           of the bar block's flex budget). */
        .icons { display: flex; gap: 8px; flex: none; }
        .iconbtn {
          position: relative;
          width: ${ICON_PX}px; height: ${ICON_PX}px; display: flex; align-items: center;
          justify-content: center; padding: 0; flex: none;
          color: var(--rack-muted); background: transparent;
          border: 1px solid var(--rack-line); border-radius: 10px; cursor: pointer;
        }
        /* The 30px drawn box keeps a 44px-tall tap target (RBAR-67): an invisible
           layer that reaches 7px past the border above and below, and 4px each side --
           half the .icons gap, so the two neighbours' hit areas meet without
           overlapping. (inset is measured from the padding box, inside the 1px border,
           hence 8px / 5px.) */
        .iconbtn::after { content: ""; position: absolute; inset: -8px -5px; }
        .iconbtn:hover { color: var(--rack-fg); }
        .iconbtn:focus-visible { outline: 2px solid var(--rack-accent); outline-offset: 2px; }
        .readout { text-align: center; }
        /* The readout head (prototype L131): the Total section label at the left edge,
           the kg|lb unit toggle at the right -- space-between, not a centered cluster. */
        .readhead {
          display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 8px;
        }
        /* An h2 since RBAR-53 (heading navigation); margin pinned so the UA heading
           margin cannot move the row. */
        .readout .label { ${SECTION_LABEL} margin: 0; }
        /* The screen-reader announcement region (RBAR-53): visually hidden by the clip
           recipe (display:none would drop it from the a11y tree and silence it). */
        .sr { ${VISUALLY_HIDDEN} }
        /* The kg|lb Primary unit toggle: a small segmented control on the same raised
           track (prototype L122). Its active is the SELECTED GREY, not the accent --
           the accent-active belongs to the mode toggle alone (sUnitBtn, L406).
           Free on every plate set (RBAR-60). */
        .units {
          display: inline-flex; padding: 2px;
          background: var(--rack-raised);
          border: 1px solid var(--rack-border);
          border-radius: var(--rack-radius-pill);
        }
        .units button {
          font-family: var(--rack-font-num); font-size: 12px; font-weight: 600;
          letter-spacing: .04em;
          color: var(--rack-text-dim); background: transparent;
          border: none; border-radius: var(--rack-radius-pill);
          padding: 7px 15px; cursor: pointer;
        }
        .units button[aria-pressed="true"] {
          font-weight: 700;
          color: var(--rack-text); background: var(--rack-selected);
        }
        .units button:focus-visible { outline: 2px solid var(--rack-accent); }
        /* The big Total (handoff 4a): Hanken 800 / 54px / -.025em with tabular figures.
           Hanken is proportional, so tnum must be explicit -- it "stayed on" only while
           the Total was monospace JetBrains Mono; now that it is Hanken the digits would
           jitter on change without it. 54/384 = 14.0625vw hits the spec 54px exactly at
           the 384px design frame (RBAR-39; 13vw fell ~4px short there), the floor still
           covers narrower phones. Rolls up on change (numRoll, via rollText). */
        .readout output {
          display: block; font-family: var(--rack-font); font-weight: 800;
          font-size: clamp(40px, 14.0625vw, 54px); letter-spacing: -.025em;
          line-height: 1; font-variant-numeric: tabular-nums;
          color: var(--rack-fg);
        }
        /* The unit rides the Total as a small dim suffix (prototype L135: 21px/600
           text-dim), not full-size in the 54px ink -- so "142 kg" reads value-first.
           Only the value span rolls; the suffix would flicker pointlessly. */
        .readout output .tu {
          font-size: 21px; font-weight: 600; color: var(--rack-text-dim);
        }
        /* The Total is the page's biggest number and reads as tappable -- so it is
           (RBAR-57): tapping it opens the keypad, the same edit the small Target
           value button offers. A bare wrapper: every visual belongs to the output
           inside, and the By-Plates disabled state (no keypad there) must not dim
           the Total, so no :disabled restyle beyond the cursor. */
        .totaltap {
          display: block; width: 100%; padding: 0; margin: 0; border: 0;
          background: none; color: inherit; text-align: inherit; font: inherit;
          cursor: pointer;
        }
        .totaltap:disabled { cursor: default; }
        .totaltap:focus-visible { outline: 2px solid var(--rack-accent); outline-offset: 4px; }
        /* The Secondary readout: the same Total in the other unit, tap to hide/show
           (ADR-0006/0010). A quiet line under the prominent Total. */
        .secondary {
          font-family: var(--rack-font-num); font-size: 13px; color: var(--rack-muted);
          background: transparent; border: none; cursor: pointer; padding: 2px 6px;
        }
        .secondary.off { opacity: .7; font-style: italic; }
        .secondary:focus-visible { outline: 2px solid var(--rack-accent); }
        /* The status line: the Secondary readout with the status pill beside it, on one
           centered row (handoff 4a, screenshot 01). Decode only. */
        .statusline {
          display: flex; align-items: center; justify-content: center;
          gap: 9px; margin-top: 2px; min-height: 22px;
        }
        /* The status pill (RBAR-28): the Total's Exact / N over / N short indicator
           (at capacity the pill keeps the shortfall; the .atcap caption below names
           the capacity fact -- RBAR-47). A quiet uppercase mono pill with a state
           dot. Over is the one solid variant (accent fill, ink text) -- the
           handoff's emphasis on going over Target; the rest are outline pills. This
           recipe (10px / 4px 10px) must hold in EVERY state, including "status
           over" -- see the RBAR-56 note on the round-up row rules. */
        .status {
          display: inline-flex; align-items: center; gap: 6px;
          font-family: var(--rack-font-num); font-size: 10px; font-weight: 600;
          letter-spacing: .1em; text-transform: uppercase; white-space: nowrap;
          line-height: 1; border-radius: 999px; padding: 4px 10px;
          color: var(--rack-text-secondary);
          background: transparent; border: 1px solid var(--rack-border-muted);
        }
        .status[hidden] { display: none; }
        .status .dot {
          width: 5px; height: 5px; border-radius: 999px; flex: none;
          background: var(--rack-accent);
        }
        .status.exact .dot { background: var(--rack-success); }
        .status.bare .dot { background: var(--rack-text-dim); }
        .status.over {
          color: var(--rack-accent-ink);
          background: var(--rack-accent); border-color: var(--rack-accent);
        }
        .status.over .dot { display: none; }
        /* The below-Bar explanation (RBAR-55): when the Target sits under the empty
           bar's own weight, the OVER pill alone reads as "is it broken?" -- this quiet
           line under the status row names the plain fact. Decode-only. RBAR-67 seats it
           in the round-up row below instead of a reserved line of its own (~20px back
           for the Bar): the row's fixed height already keeps the Target steppers still
           when the note toggles on a stepper tap, and the row's other occupants never
           show alongside it (a sub-Bar Target has no round-up and is never short). */
        .barnote {
          display: block;
          font-family: var(--rack-font-num); font-size: 12px; color: var(--rack-muted);
        }
        .barnote[hidden] { display: none; }
        /* The round-up row (RBAR-47, prototype L140): one fixed 36px flex row shared
           by the round-up opt-in and the at-capacity caption (they are mutually
           exclusive -- the core carries no over exactly when the sleeve is full,
           ADR-0012), and since RBAR-67 the below-Bar note (exclusive with both).
           The explicit min-height pins the row in EVERY state, on top of
           RBAR-52's in-flow reservation below. The row collapses out of the column
           in By Plates (no round-up row there). NOTE: the button's own class is
           "roundup", NOT "over" -- the status pill carries "status over" as its
           state classes, and an unscoped over-class button rule used to inflate the
           pill on every exact->over crossing (RBAR-56). No selector in this sheet
           may start with a bare over class (text-locked in console.test.ts). */
        .rounduprow {
          display: flex; align-items: center; justify-content: center;
          min-height: 36px;
        }
        /* The row's own [hidden] is plain hidden semantics (fully out of the
           column in By Plates) -- the explicit display:none is needed because the
           flex display above would otherwise beat the UA sheet's [hidden] rule. */
        .rounduprow[hidden] { display: none; }
        /* The over-target opt-in: a quiet, deliberately un-pushy round-up control
           (ADR-0003 -- never auto-selected). Metrics per the handoff (prototype
           L140-141): Hanken 600 12px, muted border, 8px 15px pad. */
        .roundup {
          font-family: var(--rack-font); font-size: 12px; font-weight: 600;
          color: var(--rack-accent);
          background: transparent; border: 1px solid var(--rack-border-muted);
          border-radius: 999px; padding: 8px 15px; cursor: pointer;
        }
        /* Round-up reservation (RBAR-52): the geometry guarantee -- the Target row
           + steppers below never move when the offer appears/disappears -- is
           carried by the ROW's min-height above (RBAR-47), so the hidden button
           simply leaves the layout. It must not stay a zero-content flex item:
           the row centers its children, and an invisible-but-in-flow button would
           shove the at-capacity caption off center. */
        .roundup[hidden] { display: none; }
        .roundup:focus-visible { outline: 2px solid var(--rack-accent); }
        /* The at-capacity caption (RBAR-47, prototype L142): "Bar at capacity" as a
           borderless accent caption in the round-up row -- the same uppercase-mono
           accent-dot vocabulary as the palette's "Sleeve full" warning (RBAR-54).
           The pill above keeps the shortfall; this names the capacity fact. */
        .atcap {
          display: inline-flex; align-items: center; gap: 6px;
          font-family: var(--rack-font-num); font-size: 10px; font-weight: 600;
          letter-spacing: .1em; text-transform: uppercase; line-height: 1;
          color: var(--rack-accent);
        }
        .atcap[hidden] { display: none; }
        .atcap .dot {
          width: 5px; height: 5px; border-radius: 999px; flex: none;
          background: var(--rack-accent);
        }
        /* The short-screen tier (RBAR-67, fit.ts): a tighter column gap, a thinner
           inset around the mode segments (the track's padding only -- the tappable
           segments keep their size), and a closer Total head. */
        @media ${SHORT_SCREEN} {
          .stack { gap: 8px; }
          .modes { padding: 1px; }
          .readhead { margin-bottom: 4px; }
        }
      </style>
      <div class="stack">
        <!-- The user-facing labels name the INPUT you work from ("By Weight" =
             type a Target; "By Plates" = tap Plates), which is more intuitive than
             the internal direction names. data-mode keeps the canonical Decode/Encode
             vocabulary (CONTEXT.md) that the rest of the code speaks. -->
        <div class="modes" role="group" aria-label="Mode">
          <button type="button" data-mode="decode" aria-pressed="true">By Weight</button>
          <button type="button" data-mode="encode" aria-pressed="false">By Plates</button>
          <button type="button" data-mode="warmup" aria-pressed="false">Warm up</button>
        </div>
        <!-- The bar is the hero (RBAR-25, handoff section 3 + 4a/4b): the sleeve sits
             directly under the mode toggle, with the Total readout and the round-up
             immediately below it, THEN the editors (Target entry / Recents in By Weight,
             the Add palette in By Plates). One DOM order serves both modes -- the editors
             toggle by the hidden attribute, so the visible column reads right either way. -->
        <div class="viz">
          <!-- The head row (RBAR-35): the contextual label at the left edge, the icon
               controls right-aligned on the same row. The label's text is state-driven
               (see render). Share sits immediately left of fullscreen as a glyph-only
               button (RBAR-61) -- a deliberate divergence from the handoff's full-width
               bottom Share row, which cost a phone screen its vertical room. Always
               available: the card reflects whatever is on the Bar, bare or loaded. -->
          <div class="vizhead">
            <span class="vizhl"
              ><span class="vizlabel" data-viz-label></span
              ><span class="vizadd" data-viz-add hidden></span
            ></span>
            <div class="icons">
              <button type="button" class="iconbtn" data-share aria-label="Share">
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M8 10V2M8 2L5 5M8 2l3 3M3 9v3a2 2 0 002 2h6a2 2 0 002-2V9"
                        stroke="currentColor" stroke-width="1.6"
                        stroke-linecap="round" stroke-linejoin="round"></path>
                </svg>
              </button>
              <button type="button" class="iconbtn" data-fullscreen aria-label="Full screen">
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M5.5 2V5.5H2M14 5.5H10.5V2M10.5 14V10.5H14M2 10.5H5.5V14"
                        stroke="currentColor" stroke-width="1.6"
                        stroke-linecap="round" stroke-linejoin="round"></path>
                </svg>
              </button>
            </div>
          </div>
          <rack-sleeve></rack-sleeve>
        </div>
        <div class="readout">
          <div class="readhead">
            <h2 class="label">Total</h2>
            <div class="units" role="group" aria-label="Display unit">
              <button type="button" data-unit="kg" aria-pressed="true">kg</button>
              <button type="button" data-unit="lb" aria-pressed="false">lb</button>
            </div>
          </div>
          <button type="button" class="totaltap" data-total-tap
            ><output data-total><span data-total-num>${DEFAULT_BAR_KG}</span><span
              class="tu" data-total-unit> kg</span></output
          ></button>
          <div class="statusline">
            <button type="button" class="secondary" data-secondary></button>
            <span class="status" data-status hidden
              ><span class="dot" aria-hidden="true"></span
              ><span data-status-label></span></span>
          </div>
          <!-- The decode outcome for screen readers (RBAR-53): a polite status region
               that speaks the Total + status once per user action. Visually hidden --
               the sighted readout above IS this information. -->
          <div class="sr" data-announce role="status"></div>
        </div>
        <!-- The round-up row sits under the Total (handoff 4a), above the Target block:
             the round-up opt-in OR the at-capacity caption (never both -- ADR-0012)
             OR the below-Bar note (RBAR-67; exclusive with both).
             The wrapper's "over" class is the block-order token only (blockToken in
             console.test.ts); every style rule is scoped to .rounduprow/.roundup/.atcap
             so the "status over" pill can never match a round-up rule (RBAR-56). -->
        <div class="over rounduprow" data-roundup-row>
          <button type="button" class="roundup" data-over hidden></button>
          <span class="atcap" data-atcap hidden
            ><span class="dot" aria-hidden="true"></span>Bar at capacity</span>
          <!-- The below-Bar note (RBAR-55), seated here by RBAR-67: never shown with
               the offer or the caption, so the row's fixed height holds all three. -->
          <span class="barnote" data-barnote hidden></span>
        </div>
        <rack-entry></rack-entry>
        <!-- Warm up (RBAR-65 slice 2): the working-weight row, then the Ramp's stairs +
             Next -- in the editor slot the Target block and Recents hold in By Weight. -->
        <rack-entry variant="working" data-working hidden></rack-entry>
        <rack-warmup hidden></rack-warmup>
        <!-- Recent Targets: a quick-pick row under the entry, By-Weight mode only
             (RBAR-20). Hidden until the lifter has committed a Target. -->
        <rack-recents hidden></rack-recents>
        <!-- "On the bar": the loaded-chips row + Clear, By-Plates mode only (RBAR-27,
             handoff 4b). Sits directly above the Add palette; both share the editor slot
             with the By-Weight Target/Recent blocks, toggled by hidden. -->
        <rack-loaded hidden></rack-loaded>
        <rack-palette hidden></rack-palette>
      </div>
      <rack-share></rack-share>
      <rack-fullscreen></rack-fullscreen>
    `;
    this.entry = this.root.querySelector('rack-entry:not([data-working])') as Entry;
    this.workEntry = this.root.querySelector('rack-entry[data-working]') as Entry;
    this.warmup = this.root.querySelector('rack-warmup') as Warmup;
    this.vizAdd = this.root.querySelector('[data-viz-add]')!;
    this.recentsRow = this.root.querySelector('rack-recents') as Recents;
    this.loadedRow = this.root.querySelector('rack-loaded') as Loaded;
    this.palette = this.root.querySelector('rack-palette') as Palette;
    this.sleeve = this.root.querySelector('rack-sleeve') as Sleeve;
    this.share = this.root.querySelector('rack-share') as Share;
    this.fullscreen = this.root.querySelector('rack-fullscreen') as Fullscreen;
    this.totalNum = this.root.querySelector('[data-total-num]')!;
    this.totalUnit = this.root.querySelector('[data-total-unit]')!;
    this.totalTap = this.root.querySelector('[data-total-tap]')!;
    this.secondary = this.root.querySelector('[data-secondary]')!;
    this.status = this.root.querySelector('[data-status]')!;
    this.statusLabel = this.root.querySelector('[data-status-label]')!;
    this.barnote = this.root.querySelector('[data-barnote]')!;
    this.vizLabel = this.root.querySelector('[data-viz-label]')!;
    this.announcer = this.root.querySelector('[data-announce]')!;
    this.over = this.root.querySelector('[data-over]')!;
    this.overRow = this.root.querySelector('[data-roundup-row]')!;
    this.atcap = this.root.querySelector('[data-atcap]')!;
    this.unitButtons = this.root.querySelectorAll('[data-unit]');
    this.modeButtons = this.root.querySelectorAll('[data-mode]');

    // Decode: the Target entry derives the Side Load.
    this.entry.addEventListener('target', (e) => {
      if (this.mode !== 'decode') return;
      this.decodeTo((e as CustomEvent<{ target: number | null }>).detail.target);
    });
    // The keypad sheet's open/closed edges hand the single announcement source back and
    // forth (RBAR-53): open -> the sheet's load line speaks, the console region mutes;
    // close -> re-render so the console region settles on the final decoded value.
    this.entry.addEventListener('keypadopen', () => {
      this.keypadOwner = 'decode';
    });
    // A Target commit (the keypad closing) is remembered in the Recent row (RBAR-20).
    // Distinct from `target`, which fires on every keystroke -- only the commit is kept,
    // so mid-entry digits never litter the history. A null Target (empty field) is a
    // no-op (rememberTarget guards it). The trailing render() unmutes the announcement
    // region even on a null commit (rememberTarget only renders on a real Target).
    this.entry.addEventListener('keypadclose', (e) => {
      this.keypadOwner = null;
      this.rememberTarget((e as CustomEvent<{ target: number | null }>).detail.target);
      this.render();
    });
    // Warm up's working-weight field (RBAR-65 slice 2): every edit re-plans the Ramp
    // live (the stairs and the sleeve follow the keypad, as By Weight's Target does) and
    // persists it; the keypad commit -- and only that -- pushes the Working set's Target
    // onto Recents, like a By Weight Target commit (ADR-0009). Warm-up rows never do.
    this.workEntry.addEventListener('target', (e) => {
      if (this.mode !== 'warmup') return;
      this.setWorking((e as CustomEvent<{ target: number | null }>).detail.target);
    });
    this.workEntry.addEventListener('keypadopen', () => {
      this.keypadOwner = 'warmup';
    });
    this.workEntry.addEventListener('keypadclose', (e) => {
      this.keypadOwner = null;
      this.rememberTarget((e as CustomEvent<{ target: number | null }>).detail.target);
      this.render();
    });
    // A stair tap, Next, or an arrow key picks a Ramp row: its Side becomes the shared
    // Side Load (ADR-0005), so the sleeve, Total and pill all read that row.
    this.warmup.addEventListener('warmupselect', (e) => {
      if (this.mode !== 'warmup' || !this.ramp) return;
      const { index } = (e as CustomEvent<{ index: number }>).detail;
      const rows = this.ramp.rows;
      this.warmIdx = Math.min(Math.max(0, Math.trunc(index) || 0), rows.length - 1);
      this.side = rows[this.warmIdx].side;
      this.render();
    });
    // The big Total opens the keypad too (RBAR-57): it reads as tappable, so it is.
    // Open-only -- closing (the commit) stays with Done / the value re-tap.
    this.totalTap.addEventListener('click', () => this.entry.open());
    // A recent chip tap re-applies that Target: seed the field, decode it, and move it
    // back to the front of the history (a re-use is a fresh commit).
    this.recentsRow.addEventListener('recentapply', (e) => {
      const { target } = (e as CustomEvent<{ target: number }>).detail;
      this.entry.display(target);
      this.decodeTo(target);
      this.rememberTarget(target);
    });
    // Removing a Recent (RBAR-73): the row emits the intent (long-press -> Remove, or
    // Delete on a focused chip) and its Undo; the console applies both with the pure
    // core and persists, so a removal survives a reload and an Undo puts it back in its
    // old slot (ADR-0009). The current Target and the Bar are untouched -- only history.
    this.recentsRow.addEventListener('recentremove', (e) => {
      const { target } = (e as CustomEvent<{ target: number }>).detail;
      this.setRecents(removeRecent(this.recents, target));
    });
    this.recentsRow.addEventListener('recentrestore', (e) => {
      const { target, index } = (e as CustomEvent<{ target: number; index: number }>).detail;
      this.setRecents(restoreRecent(this.recents, target, index));
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
    // Encode: the "On the bar" chips remove one of a Plate (mirroring a sleeve disc tap);
    // Clear empties the Side wholesale (RBAR-27). Both guard the mode and re-render.
    this.loadedRow.addEventListener('removeplate', (e) => {
      if (this.mode !== 'encode') return;
      this.side = removePlate(this.side, (e as CustomEvent<{ plate: Plate }>).detail.plate);
      this.render();
    });
    this.loadedRow.addEventListener('clearbar', () => {
      if (this.mode !== 'encode') return;
      this.side = [];
      this.render();
    });
    // The over-target opt-in toggles between the at-or-under primary and the over option.
    // The control is only shown with a decode result on hand (renderOver), so a missing
    // `decoded` here is an invariant breach, not a state to paper over: bail before
    // flipping `showingOver` so a stray click can never strand the lifter over Target.
    this.over.addEventListener('click', () => {
      if (!this.decoded) return;
      this.showingOver = !this.showingOver;
      const { primary, over } = this.decoded;
      this.side = (this.showingOver && over ? over : primary).side;
      this.render();
    });
    // The Share control opens the loading card (RBAR-19, ADR-0011); see openShare.
    this.root.querySelector('[data-share]')!.addEventListener('click', () => this.openShare());
    // The fullscreen control blows the loaded Bar up to the immersive card (RBAR-18).
    this.root
      .querySelector('[data-fullscreen]')!
      .addEventListener('click', () => this.openFullscreen());
    // The kg|lb Primary unit toggle (ADR-0010), live on every plate set (RBAR-60); the
    // chosen unit persists and the surfaces re-render in it (see chooseUnit).
    this.unitButtons.forEach((b) =>
      b.addEventListener('click', () => {
        const unit = b.dataset.unit;
        if (unit === 'kg' || unit === 'lb') this.chooseUnit(unit);
      }),
    );
    // The Secondary readout toggles its own visibility (ADR-0006/0010), persisted.
    this.secondary.addEventListener('click', () => {
      this.showSecondary = !this.showSecondary;
      writePersisted(SECONDARY_KEY, this.showSecondary ? '1' : '0');
      this.render();
    });
    this.modeButtons.forEach((b) =>
      b.addEventListener('click', () => {
        const mode = b.dataset.mode;
        if (isMode(mode)) this.setMode(mode);
      }),
    );

    this.recents = parseRecents(readPersisted(RECENTS_KEY)); // restore prior Targets
    this.unitPref = this.loadUnit(); // restore the Primary-unit choice
    this.showSecondary = this.loadSecondary();
    this.palette.inventory = this.inventory();
    this.entry.unit = this.activeUnit();
    this.recentsRow.unit = this.activeUnit();
    this.recentsRow.targets = this.recents;
    this.entry.barKg = this.baselineKg(); // anchor the entry to the bare-rig baseline
    // The Working set's Target survives a reload (rackbar.working, read-validated).
    this.working = parseWorking(readPersisted(WORKING_KEY));
    this.workEntry.unit = this.activeUnit();
    this.workEntry.barKg = this.baselineKg();
    this.workEntry.display(this.working);
    this.render(); // initial state: Decode, a bare rig, no Target typed yet
  }

  // Adopt a Primary-unit choice from the toggle: record it, persist, and re-render every
  // surface in it. With a live Target an Exact load never moves (RBAR-60, Caitlin's
  // call). Two cases --
  //  - The load read Exact in the old unit: that load IS what the lifter meant, so the
  //    Target becomes the load itself, re-read in the new unit (55 lb -> 25 kg, Exact).
  //    Re-solving the typed kg instead would read 24.95 kg and drop a Plate step.
  //  - Otherwise re-solve for the Target's reading in the new unit (its at-or-under
  //    bucket changed). A short load can only move UP -- the new reading may admit a
  //    heavier load (27.2 kg on iron reads 60 lb, which 60 lb of iron meets) -- never
  //    down: the old load is at or under the Target, so the new ceiling still covers
  //    it. A chosen round-up stays chosen only while the same load is still
  //    the round-up; if the new reading makes it the Exact primary (100.95 kg -> 223 lb,
  //    and 101 kg reads 223 lb), it is shown as the primary instead -- never a stale
  //    "over" whose "use" button would step the lifter down to a short load.
  private chooseUnit(unit: Unit): void {
    if (unit === this.unitPref) return;
    const was = this.unitPref;
    this.unitPref = unit;
    writePersisted(UNIT_KEY, unit);
    if (this.mode === 'warmup') {
      // The working weight is kept as read, by By Weight's RBAR-60 rule: when the Working
      // set read Exact in the old unit, that load IS the working weight, so it becomes
      // the weight itself (586 lb on Comp loads 266 kg; re-solving the typed 265.8 kg
      // would drop to 265). Otherwise the field re-reads the SAME canonical kg in the
      // new unit (the entry's RBAR-38 reformat). Either way the Ramp re-plans against
      // the new reading's ceiling (ADR-0015 Q7).
      const workKg = this.ramp?.working.primary.total;
      if (
        this.working !== null &&
        workKg !== undefined &&
        shownIn(workKg, was) === shownIn(this.working, was)
      ) {
        this.working = workKg;
        writePersisted(WORKING_KEY, String(workKg));
        this.workEntry.retarget(workKg);
      }
      this.planWarmup();
      this.render();
      return;
    }
    if (this.mode !== 'decode' || !this.decoded) {
      this.render();
      return;
    }
    const { primary, over } = this.decoded;
    const target = primary.total - primary.delta;
    if (!this.showingOver && shownIn(primary.total, was) === shownIn(target, was)) {
      this.entry.retarget(primary.total);
      this.decodeTo(primary.total);
      return; // decodeTo renders
    }
    const chosenOver = this.showingOver && over ? over.total : null;
    this.decodeTo(target); // clears showingOver, renders
    const next = this.decoded as Decoded | null;
    if (chosenOver !== null && next?.over && Math.abs(next.over.total - chosenOver) < 1e-9) {
      this.showingOver = true;
      this.side = next.over.side;
      this.render();
    }
  }

  // Restore the persisted Primary-unit choice; a missing/blocked/garbage value -> kg
  // (the app's default and canonical unit). Validated so a corrupt key can't strand it.
  private loadUnit(): Unit {
    return readPersisted(UNIT_KEY) === 'lb' ? 'lb' : 'kg';
  }

  // Restore whether the Secondary readout shows; default true (show it). Only an explicit
  // stored '0' hides it, so a missing/blocked key keeps the helpful default.
  private loadSecondary(): boolean {
    return readPersisted(SECONDARY_KEY) !== '0';
  }

  // Remember a committed Target in the Recent row: dedupe + cap via the pure core
  // (lib/recents), feed the row, and persist (best-effort, ADR-0009). A null or
  // non-loadable Target is ignored (pushRecent guards finite/positive), so an empty-field
  // close never litters the history. Stored canonically in kg (ADR-0006).
  private rememberTarget(target: number | null): void {
    // Skip a null (empty-field / pristine close) or non-loadable Target up front: pushRecent
    // would no-op on it anyway, and bailing here avoids a pointless re-render + storage write.
    if (target === null || !isRememberable(target)) return;
    this.setRecents(pushRecent(this.recents, target));
  }

  // Adopt a new Recent history (a push, a removal or an Undo): feed the row, re-render
  // for its mode visibility, and persist best-effort (ADR-0009).
  private setRecents(list: readonly number[]): void {
    this.recents = list;
    this.recentsRow.targets = list;
    this.render(); // keep the row's mode visibility in sync
    writePersisted(RECENTS_KEY, JSON.stringify(list));
  }

  // Open the loading card (RBAR-19, ADR-0011): snapshot the current load -- the achieved
  // Total, the Side Load, the bare Bar + per-Side Collar, and the active display Unit --
  // and hand it to the card. Opening also remembers the ACHIEVED on-Bar Total, in BOTH
  // modes (RBAR-38, prototype openCard L947; the third recents push site, ADR-0009):
  // what you are about to share is what you loaded, so that -- not the typed wish -- is
  // the weight worth a chip. On a bare Bar this records the bare rig Total, exactly as
  // the prototype does.
  private openShare(): void {
    // Warm up never pushes a warm-up row onto Recents (RBAR-65): only the Working set's
    // Target, on its keypad commit, is worth a chip there.
    if (this.mode !== 'warmup') this.rememberTarget(encode(this.side, this.baselineKg()));
    // The card derives the Total from these (loadTotalKg), so no separate Total is
    // passed -- nothing to drift from the Plates.
    this.share.load = {
      side: this.side,
      barKg: this._barKg,
      collarKg: this.loadCollarKg(),
      unit: this.activeUnit(),
    };
    // The set names the card caption (RBAR-44); the load snapshot stays
    // set-agnostic, the same split the fullscreen card uses.
    this.share.plateSet = this._plateSetKey;
    this.share.open();
  }

  // Open the fullscreen rack card (RBAR-18): snapshot the same load the share card takes
  // and blow it up. Reflects whatever is on the Bar in either mode (Decode or Encode).
  // Unlike openShare, a fullscreen glance is read-only -- it remembers no Target (it is a
  // view, not a commit), so it never touches the Recent row.
  private openFullscreen(): void {
    this.fullscreen.load = {
      side: this.side,
      barKg: this._barKg,
      collarKg: this.loadCollarKg(),
      unit: this.activeUnit(),
    };
    // The set names the caption's config line (RBAR-30/44); the load snapshot
    // (ADR-0011 shape, shared with the share card) deliberately stays set-agnostic.
    this.fullscreen.plateSet = this._plateSetKey;
    this.fullscreen.open();
  }

  // A new Target always lands on the at-or-under primary -- any prior over choice is
  // cleared, so the lifter is never silently left over Target (ADR-0003). A null Target
  // (empty field) clears to the bare Bar. Solved against the active set's Inventory, at
  // or under everything the Target's READING covers in the active unit (RBAR-60): a
  // typed-back displayed Total must land on itself, not a Plate step below it.
  private decodeTo(target: number | null): void {
    this.showingOver = false;
    this.byWeightTarget = target;
    this.decoded =
      target === null
        ? null
        : decodeWithin(
            target,
            displayCeilingKg(target, this.activeUnit()),
            this.baselineKg(),
            this.inventory(),
          );
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
    } else if (mode === 'warmup') {
      this.enterWarmup();
    }
    this.render();
  }

  // Enter Warm up (RBAR-65 slice 2). The first time, with no Working set ever saved
  // (the key is absent, not merely cleared), the By Weight Target seeds it (Q12). The
  // field shows it silently, and the Ramp is planned from it; the selected row's Side
  // becomes the shared Side Load.
  private enterWarmup(): void {
    const seed = this.byWeightTarget;
    if (this.working === null && readPersisted(WORKING_KEY) === null && seed !== null && seed > 0) {
      this.working = seed;
      writePersisted(WORKING_KEY, String(seed));
    }
    this.workEntry.display(this.working);
    this.planWarmup();
  }

  // Adopt a working-weight edit: a positive weight is the Working set's Target, anything
  // else (an emptied field, a typed 0) is "none yet". Persisted either way ('' = cleared,
  // so the next open does not re-seed), then re-planned.
  private setWorking(target: number | null): void {
    this.working = target !== null && target > 0 ? target : null;
    writePersisted(WORKING_KEY, this.working === null ? '' : String(this.working));
    this.planWarmup();
    this.render();
  }

  // Plan the Ramp for the Working set on the current rig (lib/plan.ts, ADR-0015) and
  // load the selected row. The Working set solves at or under its reading in the
  // display unit (displayCeilingKg, RBAR-60), exactly as By Weight would. The template
  // is DEFAULT_RAMP (editing it is slice 3). The selection is kept across re-plans,
  // clamped into the rows.
  private planWarmup(): void {
    if (this.working === null) {
      this.ramp = null;
      this.side = [];
      return;
    }
    this.ramp = planRamp(
      this.working,
      DEFAULT_RAMP,
      { barKg: this._barKg, collarKg: this._collarKg, inventory: this.inventory() },
      { ceilingKg: displayCeilingKg(this.working, this.activeUnit()) },
    );
    this.warmIdx = Math.min(this.warmIdx, this.ramp.rows.length - 1);
    this.side = this.ramp.rows[this.warmIdx].side;
  }

  // The selected Ramp row while Warm up shows one, else null.
  private warmRow(): RampRow | null {
    return this.mode === 'warmup' && this.ramp ? this.ramp.rows[this.warmIdx] : null;
  }

  // The Total on the Bar right now. A Ramp row carries its own (the bare-Bar row has no
  // Collars, ADR-0015 Q5); otherwise it is the Side on the effective Bar.
  private loadTotalKg(): number {
    return this.warmRow()?.total ?? encode(this.side, this.baselineKg());
  }

  // The Collar the share/fullscreen cards should draw: none on a bare-Bar Ramp row.
  private loadCollarKg(): number {
    const row = this.warmRow();
    return row && !row.collars ? 0 : this._collarKg;
  }

  private render(): void {
    const unit = this.activeUnit();
    this.sleeve.sideLoad = this.side;
    this.sleeve.interactive = this.mode === 'encode';
    // The bar block's contextual label (RBAR-35, prototype L924): "per side" whenever
    // anything is loaded (either mode -- the shared Side Load is the fact it names),
    // else the active mode's empty-state prompt. Uppercasing is the CSS's job.
    // In Warm up a planned Ramp always reads "per side" (the bare-Bar row included),
    // with the selected set's add caption beside it (RBAR-65 slice 2).
    this.vizLabel.textContent =
      this.side.length > 0 || this.warmRow() !== null
        ? 'per side'
        : this.mode === 'encode'
          ? 'Tap a plate to load'
          : 'Enter a weight';
    const view =
      this.mode === 'warmup' && this.ramp
        ? warmupView(this.ramp.rows, this.warmIdx, unit, plateSetFor(this._plateSetKey).unit)
        : null;
    this.warmup.view = view;
    this.vizAdd.hidden = view?.addCaption == null;
    this.vizAdd.textContent = view?.addCaption ?? '';
    this.entry.unit = unit;
    this.workEntry.unit = unit;
    this.recentsRow.unit = unit;
    // The Recent rail highlights the chip matching the live Target (RBAR-37): fed in
    // canonical kg, so a chip applied in lb still matches its own echo. Fed HERE, before
    // the mode-visibility writes below -- the rail re-renders on this setter and
    // recomputes its own emptiness-hidden, which would otherwise undo the Encode hide.
    this.recentsRow.target =
      this.mode === 'decode' && this.decoded
        ? this.decoded.primary.total - this.decoded.primary.delta
        : null;
    // Value and suffix split (RBAR-39): only the value rolls; the suffix just tracks
    // the active unit. Together they still read "142 kg" (format's shape).
    rollText(this.totalNum, String(shownIn(this.loadTotalKg(), unit)));
    this.totalUnit.textContent = ` ${unit}`;
    this.renderUnitToggle(unit);
    this.renderSecondary(unit);
    this.entry.hidden = this.mode !== 'decode';
    this.workEntry.hidden = this.mode !== 'warmup';
    this.warmup.hidden = this.mode !== 'warmup';
    // The Total-tap affordance is By-Weight only (RBAR-57): By Plates has no keypad,
    // so the wrapper goes inert there (its look never changes -- see .totaltap).
    this.totalTap.disabled = this.mode !== 'decode';
    // The Recent row is a By-Weight (Decode) affordance: shown only there, and only once
    // there is something to show (the row also self-hides when empty -- ADR-0009). A
    // pending Undo counts (RBAR-73): removing the last chip leaves its Undo on screen.
    this.recentsRow.hidden =
      this.mode !== 'decode' || (this.recents.length === 0 && !this.recentsRow.undoPending);
    this.palette.hidden = this.mode !== 'encode';
    // Feed the palette the Side's used sleeve width so it can disable the keys that
    // no longer fit (RBAR-31, ADR-0012) -- the visible face of addPlate's refusal.
    this.palette.sideMm = sideWidthMm(this.side);
    // The "On the bar" chips + Clear are By-Plates only; the row stays visible there even
    // when empty (it shows its own "Tap to add a pair" hint), so it toggles by mode alone.
    this.loadedRow.hidden = this.mode !== 'encode';
    this.loadedRow.side = this.side;
    // The round-up row is a By-Weight fixture (RBAR-52): reserved there even with no
    // offer on hand (the BUTTON's hidden keeps it in flow -- see the
    // .roundup[hidden] rule), dropped out of the column entirely in By Plates,
    // which has no such row. Since RBAR-47 the whole row goes (it also hosts the
    // at-capacity caption), via its own plain [hidden].
    this.overRow.hidden = this.mode !== 'decode';
    this.modeButtons.forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.mode === this.mode)),
    );

    // The status pill and over opt-in are Decode-only, and only once a Target is typed.
    // Both read off the DISPLAYED numbers in the active unit (ADR-0010 displayed-unit
    // exactness): in kg this reduces to the raw delta, in lb it keeps "exact/over/short"
    // honest to what is on screen.
    if (this.mode === 'decode' && this.decoded) {
      const { primary, over } = this.decoded;
      const shown = this.showingOver && over ? over : primary;
      const targetKg = primary.total - primary.delta;
      // "At capacity" is the CORE's own signal (ADR-0012): the capped solver omits
      // `over` exactly when no physical round-up exists, so short-with-no-over means
      // the miss cannot be closed. A per-side room check (atSleeveCapacity) would
      // contradict the offer here: a capped-short side can be full to ADDS while a
      // RESHUFFLED heavier stack still fits (Target 346.8 -> primary 346 at 414 mm,
      // over 347 at 413 mm) -- there the honest pairing is "short" + the round-up.
      const atCap = over === undefined;
      this.renderStatus(shown, targetKg, unit, atCap);
      this.renderOver(over ?? null, primary, targetKg, unit);
      // Feed the keypad sheet its "on the bar" line (RBAR-22): the loadable Total + delta,
      // so the sheet reads self-contained without the (bright, un-scrimmed) Total behind it.
      this.entry.loadLine = onBarLine(shown.total, targetKg, unit, atCap);
      // A Target under the empty bar's own weight gets the plain-fact explanation
      // (RBAR-55) -- the OVER pill stays, but is no longer the only reading.
      const note = belowBarNote(targetKg, this.baselineKg(), unit);
      this.barnote.hidden = note === null;
      this.barnote.textContent = note ?? '';
      // The spoken counterpart (RBAR-53): the Total + the pill's copy. statusPill is
      // recomputed rather than threaded out of renderStatus -- pure and cheap, and both
      // call sites keep reading exactly the DISPLAYED numbers (ADR-0010). The below-Bar
      // note rides along -- the copy-truth explanation (RBAR-55) must reach screen
      // readers too, or the "reads as a malfunction" experience survives aurally.
      const pill = statusPill(
        shownIn(shown.total, unit),
        shownIn(targetKg, unit),
        unit,
        atCap,
      );
      // The at-capacity caption (RBAR-47): the pill keeps the shortfall, the caption
      // names the capacity fact in the round-up row (which the absent offer vacated --
      // ADR-0012 ties the two). The spoken line carries BOTH facts.
      this.atcap.hidden = pill.kind !== 'capacity';
      const line = announceLine(
        shownIn(shown.total, unit),
        unit,
        pill.kind === 'capacity' ? `${pill.label}, bar at capacity` : pill.label,
      );
      this.announce(note === null ? line : `${line}. ${note}`);
    } else if (this.mode === 'warmup' && this.ramp && this.working !== null) {
      this.renderWarmStatus(this.ramp, this.ramp.rows[this.warmIdx], this.working, unit);
    } else {
      this.status.hidden = true;
      this.status.className = 'status'; // drop any prior state class/label while hidden
      this.statusLabel.textContent = '';
      this.over.hidden = true;
      this.over.textContent = '';
      this.atcap.hidden = true; // capacity is a decode-outcome caption (RBAR-47)
      this.entry.loadLine = null; // nothing decoded -> the keypad sheet hides the line
      this.workEntry.loadLine = null;
      this.barnote.hidden = true;
      this.barnote.textContent = '';
      // No decode outcome to qualify the Total (Encode, or no Target yet): the spoken
      // line is the Total (RBAR-53) -- what a plate add/remove changes -- plus "Sleeve
      // full" when the last-fitting Plate just went on, so By Plates speaks the same
      // capacity fact By Weight's pill already does (the visible warning is RBAR-54's;
      // same atSleeveCapacity source of truth, so they cannot disagree).
      const full = this.mode === 'encode' && atSleeveCapacity(this.side, this.inventory());
      this.announce(
        announceLine(
          shownIn(this.loadTotalKg(), unit),
          unit,
          full ? 'Sleeve full' : undefined,
        ),
      );
    }
  }

  // Update the screen-reader announcement region (RBAR-53). Two gates keep it honest:
  // while the keypad sheet is showing (open AND Decode active) the sheet's own load line
  // is the single live source, so the console stays quiet; and an unchanged line is left
  // untouched, so an action that renders more than once (a Recent re-apply decodes, then
  // re-remembers) still settles to exactly one announcement -- and the numRoll transition
  // never drives it, because only render() writes here, once, with the final value.
  private announce(text: string): void {
    if (this.keypadOwner !== null && this.keypadOwner === this.mode) return;
    if (this.announcer.textContent === text) return;
    this.announcer.textContent = text;
  }

  // Reflect the active Primary unit on the kg|lb toggle.
  private renderUnitToggle(unit: Unit): void {
    this.unitButtons.forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.unit === unit));
    });
  }

  // The Secondary readout: the same Total in the OTHER unit, or a "Show <unit>" prompt
  // when hidden (still tappable to bring it back). The lifter's choice persists.
  private renderSecondary(unit: Unit): void {
    const other: Unit = unit === 'kg' ? 'lb' : 'kg';
    const totalKgVal = this.loadTotalKg();
    this.secondary.classList.toggle('off', !this.showSecondary);
    this.secondary.textContent = this.showSecondary
      ? format(totalKgVal, other)
      : `Show ${other}`;
    this.secondary.setAttribute(
      'aria-label',
      this.showSecondary ? `Hide ${other} readout` : `Show ${other} readout`,
    );
  }

  // Warm up's status (RBAR-65 slice 2): the pill reads the selected row off the
  // DISPLAYED numbers (warmStatus: "Bare bar", "70% - exact", "71% of 140 kg"); a Working
  // set that is not exact reads Decode's own pill (short / at capacity, ADR-0003). The
  // By Weight round-up row is not part of Warm up, so its occupants stay hidden. The
  // working-weight keypad's "On the bar" line reads the Working set, and the spoken line
  // is the selected row's Total + its pill.
  private renderWarmStatus(ramp: Ramp, row: RampRow, working: number, unit: Unit): void {
    const workingTotal = ramp.working.primary.total;
    const atCap = ramp.working.over === undefined;
    const pill =
      warmStatus(row, workingTotal, unit) ??
      statusPill(shownIn(row.total, unit), shownIn(row.targetKg, unit), unit, atCap);
    this.status.hidden = false;
    this.status.className = `status ${pill.kind}`;
    this.statusLabel.textContent = pill.label;
    this.over.hidden = true;
    this.over.textContent = '';
    this.atcap.hidden = true;
    this.barnote.hidden = true;
    this.barnote.textContent = '';
    this.entry.loadLine = null;
    this.workEntry.loadLine = onBarLine(workingTotal, working, unit, atCap);
    this.announce(announceLine(shownIn(row.total, unit), unit, pill.label));
  }

  // The Total status pill (RBAR-28, handoff 4a), keyed off the DISPLAYED numbers
  // (ADR-0010): the shown Total vs the Target, both rounded to the active unit, plus the
  // physical sleeve-capacity flag. Always shown while a Target is decoded (Exact reads
  // as a green pill, not a hidden one). The pill's `kind` rides a class so the CSS picks
  // the dot colour / solid-vs-outline fill; the label rides the inner span.
  private renderStatus(
    shown: Loadout,
    targetKg: number,
    unit: Unit,
    atCapacity: boolean,
  ): void {
    const { kind, label } = statusPill(
      shownIn(shown.total, unit),
      shownIn(targetKg, unit),
      unit,
      atCapacity,
    );
    this.status.hidden = false;
    this.status.className = `status ${kind}`;
    this.statusLabel.textContent = label;
  }

  // The over-target opt-in control (ADR-0003), in the active unit. Absent in Encode and
  // when there is no over option. While the lifter is NOT on the over loadout it is the
  // round-up offer, hidden when the primary already DISPLAYS exact (a sub-display-unit
  // miss the lifter can't feel -- ADR-0010) or when rounding up would not change the
  // displayed Total. While the lifter IS on the over loadout (`showingOver`) the control
  // is their only way back to the at-or-under primary, so it must ALWAYS show -- otherwise
  // a unit toggle that makes the primary display exact would strand them over Target with
  // no path back (the ADR-0003 invariant). Offers: round up while on primary, back to
  // primary while on over -- so the lifter can step either way.
  //
  // No capacity suppression here any more: the core itself caps (RBAR-31, ADR-0012)
  // and carries an `over` only when it is physically loadable, so an offer that
  // reaches this method is always honest -- the RBAR-28 view-side stopgap retired.
  private renderOver(
    over: Loadout | null,
    primary: Loadout,
    targetKg: number,
    unit: Unit,
  ): void {
    const dTarget = shownIn(targetKg, unit);
    const dPrimary = shownIn(primary.total, unit);
    const dOver = over ? shownIn(over.total, unit) : dPrimary;
    const noRoundUpToOffer = dPrimary === dTarget || dOver === dPrimary;
    if (over === null || (!this.showingOver && noRoundUpToOffer)) {
      this.over.hidden = true;
      this.over.textContent = '';
      return;
    }
    // The handoff's two-state copy verbatim (RBAR-38, prototype L812): the resting offer
    // "Round up -> NNN", the applied state "Use NNN" (the way back to the at-or-under
    // primary). No delta suffix, per the prototype -- once applied, the status pill
    // beside the Total reads the overshoot. Arrow in the app's ASCII convention (cf.
    // onBarLine's parenthetical for the prototype's middle dot). Wording is Caitlin's
    // plain-language call -- flagged on the PR (RBAR-38 copy note).
    this.over.hidden = false;
    this.over.textContent = this.showingOver
      ? `Use ${format(primary.total, unit)}`
      : `Round up -> ${format(over.total, unit)}`;
  }
}

// Strip floating-point fuzz and trailing zeros so a 0.5 kg miss reads "0.5", not
// "0.5000000001" or "0.50". Whole lb values pass through unchanged.
function fmtNum(n: number): string {
  return String(Number(n.toFixed(2)));
}

/** The state the Total status pill is in (RBAR-28). `capacity` is a short Total the
 * lifter cannot close (the sleeve is full, ADR-0012): the pill still reads the
 * shortfall -- the separate at-capacity caption names the capacity fact (RBAR-47). */
export type StatusKind = 'exact' | 'over' | 'short' | 'capacity';

/** A resolved status pill: its `kind` (drives the styling) and its plain-language copy. */
export interface Status {
  readonly kind: StatusKind;
  readonly label: string;
}

/**
 * The Total readout's status pill (RBAR-28, handoff 4a), derived purely from the
 * DISPLAYED numbers (ADR-0010) so it stays honest to what the lifter reads, never the
 * raw kg delta. `shownTotal`/`shownTarget` are both already rounded to the active unit:
 *
 *   equal               -> Exact (a green-dot reassurance)
 *   Total above Target  -> "N over" (the round-up opt-in AND the sub-baseline floor case)
 *   Total below Target  -> "N short"; when the Side is physically full (`atCapacity`)
 *                          the kind is `capacity` but the LABEL keeps the shortfall
 *                          (RBAR-47, prototype L138) -- "Bar at capacity" renders as
 *                          its own accent caption in the round-up row, so the
 *                          magnitude of the miss is never lost.
 *
 * Capacity only qualifies the SHORT reading -- an over or exact Total is never masked.
 */
export function statusPill(
  shownTotal: number,
  shownTarget: number,
  unit: Unit,
  atCapacity: boolean,
): Status {
  if (shownTotal === shownTarget) return { kind: 'exact', label: 'Exact' };
  const mag = fmtNum(Math.abs(shownTotal - shownTarget));
  if (shownTotal > shownTarget) return { kind: 'over', label: `${mag} ${unit} over` };
  if (atCapacity) return { kind: 'capacity', label: `${mag} ${unit} short` };
  return { kind: 'short', label: `${mag} ${unit} short` };
}

/**
 * The keypad sheet's "on the bar" one-liner (RBAR-22, handoff 5): the actual loadable
 * Total plus how far it lands from the Target, so the keypad sheet is self-contained
 * (the lifter never has to read the Total behind it). Like statusPill it keys off the
 * DISPLAYED numbers (ADR-0010) so it is honest in kg and lb; `totalKg`/`targetKg` are
 * canonical kg. Mirrors the prototype's keypad wording ("under"/"over"/"exact"), which
 * deliberately differs from the status pill above ("short"). The prototype separates the
 * two facts with a middle dot; kept ASCII here as a parenthetical (a bare hyphen would
 * read as a minus in a weight readout).
 */
export function onBarLine(
  totalKg: number,
  targetKg: number,
  unit: Unit,
  atCapacity: boolean,
): string {
  const head = `On the bar: ${format(totalKg, unit)}`;
  const shownTotal = shownIn(totalKg, unit);
  const shownTarget = shownIn(targetKg, unit);
  if (shownTotal === shownTarget) return `${head} (exact)`;
  const mag = fmtNum(Math.abs(shownTotal - shownTarget));
  if (shownTotal > shownTarget) return `${head} (${mag} over)`;
  // At capacity the shortfall still rides along (RBAR-47: the magnitude of the miss
  // is never lost): while the sheet is open it is the ONLY surface saying it -- the
  // sheet covers the pill and announce() goes quiet.
  if (atCapacity) return `${head} (${mag} under, at capacity)`;
  return `${head} (${mag} under)`;
}

/**
 * The below-Bar Target explanation (RBAR-55): when the Target sits under what the
 * empty bar itself weighs, the solver correctly shows a bare bar and the pill reads
 * "N over" -- right math, but alone it reads as a malfunction. This line names the
 * plain fact in the display Unit. `baselineKg` is the empty rig (Bar + Collars when
 * fitted, ADR-0008) -- exactly the Total the bare render shows, so the note can never
 * contradict the readout. Keyed off the DISPLAYED numbers (ADR-0010) so it stays
 * silent when the Target displays equal to the bar (where the pill reads Exact).
 * Null at or above the bar -- the note only exists below it.
 */
export function belowBarNote(
  targetKg: number,
  baselineKg: number,
  unit: Unit,
): string | null {
  if (shownIn(targetKg, unit) >= shownIn(baselineKg, unit)) return null;
  return `Empty bar weighs ${format(baselineKg, unit)} - above your Target`;
}

/**
 * The screen-reader announcement line (RBAR-53): the shown Total with its Unit spelled
 * out for speech ("kilograms"/"pounds" -- a naked "kg" is read letter-by-letter by some
 * screen readers), plus the status pill's copy when Decode has one ("142 kilograms,
 * Exact"). `shownTotal` is already display-rounded (shownIn), so the spoken number is
 * exactly the one on screen (ADR-0010).
 */
export function announceLine(
  shownTotal: number,
  unit: Unit,
  statusLabel?: string,
): string {
  const spoken = unit === 'kg' ? 'kilograms' : 'pounds';
  const head = `${fmtNum(shownTotal)} ${spoken}`;
  return statusLabel === undefined ? head : `${head}, ${statusLabel}`;
}

customElements.define('rack-console', RackConsole);
