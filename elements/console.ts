// <rack-console> -- the calculator surface, both directions. A Decode/Encode toggle
// switches which editor drives a single shared Side Load (RBAR-7, ADR-0005):
//   Decode -- the Target entry derives the Side Load via decode() (ADR-0003: never
//             overshoots by default, with the over-target opt-in). Tapping the bar, or
//             the Another way list, loads another way to the same Total (RBAR-66).
//   Encode -- a Plate palette taps addPlate() on; tapping a loaded disc taps
//             removePlate() off; the Total reads encode(side).
// The Side Load is one value this shell owns; the mode picks who edits it, and a
// switch never clears it -- so a loadout persists across the toggle for free. All the
// plate math lives in the pure core (lib/); the elements only wire DOM to it (ADR-0001).
//
// The console also owns the Target DISPLAY (RBAR-17, ADR-0010): the kg|lb Primary unit
// and whether the Secondary readout shows, persisted console-side (rackbar.unit /
// rackbar.secondary) -- the line ADR-0009 drew, putting Target-display state with the
// console. The app pushes the rig config down (barKg, collarKg, plateSet, platesOnHand);
// the chosen plate set and its Pairs of Plates on Hand (RBAR-72, ADR-0016) select the
// Inventory to solve against. The unit toggle is free on every set
// (RBAR-60, ADR-0010 amendment): a kg lifter can load the iron set by kg Targets.
import { MINUS_ICON, PLUS_ICON } from './entry.ts';
import './palette.ts';
import './loaded.ts';
import { SLEEVE_BLOCK_PX, SLEEVE_MIN_PX } from './sleeve.ts';
import './recents.ts';
import './share.ts';
import './fullscreen.ts';
import './warmup.ts';
import { ScreenWake } from './wakelock.ts';
import { wayName } from './ways.ts';
import { LONG_PRESS_MS } from './recents.ts';
import { decodeWithin } from '../lib/decode.ts';
import { waysFor } from '../lib/ways.ts';
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
import { ALL_PLATES, inventoryOnHand } from '../lib/platesonhand.ts';
import type { PlatesOnHand } from '../lib/platesonhand.ts';
import type { LoadSummary } from '../lib/summary.ts';
import { format, shownIn, displayCeilingKg, draftToKg, stepFor } from '../lib/units.ts';
import type { Unit } from '../lib/units.ts';
import type { InventoryEntry, Plate } from '../lib/plates.ts';
import type { Decoded, Loadout } from '../lib/decode.ts';
import { linkUrl, restackForLink } from '../lib/link.ts';
import type { LinkState } from '../lib/link.ts';
import { DEFAULT_RAMP } from '../lib/plan.ts';
import { planEasyRamp } from '../lib/moves.ts';
import type { Ramp, RampRow } from '../lib/plan.ts';
import { deltaSpoken, parseWorking, rowDelta, warmStatus, warmupView } from '../lib/warmup.ts';
import type { WarmupView } from '../lib/warmup.ts';

type Sleeve = HTMLElement & {
  sideLoad: readonly Plate[];
  interactive: boolean;
  collars: boolean;
};
type Entry = HTMLElement & {
  display(value: number | null, reading?: string): void;
  readonly reading: string;
  retarget(kg: number): void;
  open(): void;
  step(dir: 1 | -1): void;
  controls: readonly Element[];
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
type Palette = HTMLElement & { inventory: readonly InventoryEntry[]; sideMm: number };
type Share = HTMLElement & {
  load: LoadSummary;
  plateSet: string;
  link: string | null;
  open(): void;
};
type Fullscreen = HTMLElement & { load: LoadSummary; plateSet: string; open(): void };
type Warmup = HTMLElement & { view: WarmupView | null };
type Ways = HTMLElement & {
  ways: readonly (readonly Plate[])[];
  index: number;
  heading: string;
  open(): void;
  close(toSetup?: boolean): void;
};
// 'warmup' is the Warm up mode (RBAR-65 slice 2): the Ramp's stairs drive the Side.
type Mode = 'decode' | 'encode' | 'warmup';
const isMode = (m: string | undefined): m is Mode =>
  m === 'decode' || m === 'encode' || m === 'warmup';
// The load half of an opened share link (RBAR-50, ADR-0014): the app applies the rig
// half (set, Bar, Collar) first, then hands this to applyLink. Split on mode like
// LinkState, so only By Weight carries a Target.
export type LinkLoad =
  | Pick<Extract<LinkState, { mode: 'decode' }>, 'mode' | 'side' | 'targetKg' | 'reading' | 'unit'>
  | Pick<Extract<LinkState, { mode: 'encode' }>, 'mode' | 'side' | 'unit'>;

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

/** The lifter's persisted Primary unit (ADR-0010); a missing/blocked/garbage value is
 * kg (the app's default and canonical unit). Exported so <rack-app> can hand the
 * recipient's own unit to parseLink (ADR-0014) without a second copy of the key. */
export function persistedPrimaryUnit(): Unit {
  return readPersisted(UNIT_KEY) === 'lb' ? 'lb' : 'kg';
}

// Same Plates in the same order, by face and finish: a limited size is a copy of the
// set's Plate (withLimits, ADR-0016), so a linked Side (the set's own objects) and a
// solved one need not share identity.
function sameSide(a: readonly Plate[], b: readonly Plate[]): boolean {
  return (
    a.length === b.length &&
    a.every((p, i) => p.kg === b[i].kg && p.color === b[i].color && p.label === b[i].label)
  );
}

// The bar block's fixed parts (RBAR-67, re-cut by RBAR-75): the label row sits in flow
// INSIDE the handoff's 204px block (prototype L97) -- VIZ_PAD_PX down, LABEL_PX tall --
// and the sleeve VIZ_GAP_PX under it (its own 4px pad makes the prototype's 10px to the
// discs). The 30px icon buttons overlap the sleeve's top-right, out of flow.
const ICON_PX = 30;
const VIZ_PAD_PX = 5;
const LABEL_PX = 15;
const VIZ_GAP_PX = 6;
// A click this soon after a long press's release belongs to that press (RBAR-66): the
// browser fires it right after pointerup, so this only needs to outlast that gap.
const HELD_CLICK_MS = 300;

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
  // RBAR-80: the screen stays awake exactly while fullscreen or Warm up is showing.
  private readonly wake = new ScreenWake();
  private totalNum!: HTMLElement;
  private totalTap!: HTMLButtonElement;
  private totalUnit!: HTMLElement;
  private totalLabel!: HTMLElement;
  // By Weight's hero steppers (RBAR-58): they flank the Total but nudge the Target.
  private heroSteps!: NodeListOf<HTMLButtonElement>;
  // The "You asked" chip (RBAR-58): the Target, split off the hero only when the load
  // misses it as read.
  private asked!: HTMLButtonElement;
  private askedNum!: HTMLElement;
  private askedUnit!: HTMLElement;
  private secondary!: HTMLButtonElement;
  private status!: HTMLElement;
  private statusLabel!: HTMLElement;
  private barnote!: HTMLElement;
  private vizLabel!: HTMLElement;
  private announcer!: HTMLElement;
  private over!: HTMLButtonElement;
  private another!: HTMLButtonElement;
  private anotherCount!: HTMLElement;
  private waysSheet!: Ways;
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
  // Pairs of Plates on Hand for every set (RBAR-72, ADR-0016), from Setup via the app.
  // inventory() applies the active set's; the capped Inventory is cached per (limits,
  // set) so its entries keep one identity between solves (the Ramp planner and the
  // palette compare Plates by identity).
  private _onHand: PlatesOnHand = ALL_PLATES;
  private invCache: {
    onHand: PlatesOnHand;
    key: PlateSetKey;
    inv: readonly InventoryEntry[];
  } | null = null;
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
  // Another way (RBAR-66): the ways to make the shown Decode answer's Total (lib/ways.ts,
  // the primary's or the round-up's), and which one is on the Bar. Only meaningful with
  // a live `decoded`; loadWays() rebuilds them on every re-solve, back on the first way.
  private ways: readonly (readonly Plate[])[] = [];
  private wayIdx = 0;
  // When the last press on the bar went down, so a long-press does not count as a tap
  // (long-press stays free, RBAR-73).
  private barDownAt: number | null = null;
  // When a long press on the bar was released (null: the last release was a tap).
  private barHeldUpAt: number | null = null;
  // Whether the last change to the loaded way was a step by the lifter (a bar tap or a
  // list row), so the spoken line names the Plates now on the Bar (RBAR-66).
  private wayStepped = false;
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

  /**
   * Pairs of Plates on Hand (RBAR-72, ADR-0016): every set's limits, set from Setup.
   * A change re-solves whatever stands on the new Inventory, like a Bar change: a Decode
   * Target re-decodes (and any chosen round-up is dropped -- the lifter re-opts in), a
   * Warm up Ramp re-plans. A hand-built By Plates Side is the lifter's and is kept; the
   * palette re-badges. Share links never carry these (a recipient's gym is theirs).
   */
  set platesOnHand(onHand: PlatesOnHand) {
    if (onHand === this._onHand) return;
    this._onHand = onHand;
    if (this.palette) this.palette.inventory = this.inventory();
    this.reconfigure();
  }
  get platesOnHand(): PlatesOnHand {
    return this._onHand;
  }

  // The Inventory the core draws from: the active set's (ADR-0010) with its Pairs of
  // Plates on Hand applied (ADR-0016).
  private inventory(): readonly InventoryEntry[] {
    const c = this.invCache;
    if (c && c.onHand === this._onHand && c.key === this._plateSetKey) return c.inv;
    const inv = inventoryOnHand(this._onHand, this._plateSetKey);
    this.invCache = { onHand: this._onHand, key: this._plateSetKey, inv };
    return inv;
  }

  // Whether a short load with no round-up is short because the SLEEVE is full -- the
  // "Bar at capacity" claim (ADR-0012) -- rather than because the Plates on hand ran out
  // (ADR-0016), which reads plain "N short" (ADR-0003). `over` absent on the capped solve
  // means nothing heavier is loadable from the plates on hand; the Sleeve is the reason
  // only when the full set, solved to the same ceiling, has no round-up either -- the
  // core's own capacity signal, so a reshuffled heavier stack is never called "full".
  private sleeveBinds(over: Loadout | undefined, targetKg: number, ceilingKg: number): boolean {
    if (over !== undefined) return false;
    const full = plateSetFor(this._plateSetKey).inventory;
    if (this.inventory() === full) return true;
    return decodeWithin(targetKg, ceilingKg, this.baselineKg(), full).over === undefined;
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
           (RBAR-18/35/61) -- then the sleeve (RBAR-75: the controls overlap it). */
        /* RBAR-67: the bar block is the column's one flexible piece. It takes the
           leftover height between a floor (label row + gap + SLEEVE_MIN_PX, so the Plates
           stay readable) and a cap (the handoff's SLEEVE_BLOCK_PX, label row included), and
           the sleeve fills it under the label row; the sleeve fits its discs to that
           height. A short phone gets a shorter Bar picture; a tall one gets the full
           handoff block, never more -- spare height falls below the column. */
        /* RBAR-75 (ADR-0013 amended): the label row is in flow inside the 204px block
           and the icons overlap the sleeve (.icons below), so the cap is the handoff's
           block itself and the floor is the label row + gap + SLEEVE_MIN_PX. */
        .viz {
          position: relative; padding-top: ${VIZ_PAD_PX}px;
          display: flex; flex-direction: column; gap: ${VIZ_GAP_PX}px;
          flex: 1 1 0;
          min-height: ${VIZ_PAD_PX + LABEL_PX + VIZ_GAP_PX + SLEEVE_MIN_PX}px;
          max-height: ${SLEEVE_BLOCK_PX}px;
          /* RBAR-99: in the Home Screen app the height left once the block is at its
             cap goes around it (auto margins take only what flexing leaves), never
             into the keypad or tiles. 0 in a browser tab (tokens.css). */
          margin-bottom: var(--rack-bar-air);
        }
        .viz rack-sleeve { flex: 1 1 0; min-height: 0; }
        /* Another way (RBAR-66): with more than one way to make the Total, the bar is a
           button that steps to the next one. No hint text; a press darkens the block
           (prototype H .sleeve.tappable:active). No callout or selection on a hold --
           long-press stays free. */
        .viz rack-sleeve[role="button"] {
          cursor: pointer; border-radius: var(--rack-radius-tile);
          -webkit-touch-callout: none; -webkit-user-select: none; user-select: none;
          -webkit-tap-highlight-color: transparent;
        }
        .viz rack-sleeve[role="button"]:active { background: var(--rack-raised); }
        .viz rack-sleeve[role="button"]:focus-visible { outline: 2px solid var(--rack-accent); }
        .vizhead {
          display: flex; align-items: center; justify-content: space-between;
          height: ${LABEL_PX}px;
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
           RBAR-48's respec, landed here by RBAR-67; out of the flex budget since
           RBAR-75 overlaps them on the sleeve). */
        /* RBAR-75: out of flow at the block's top-right over the sleeve (prototype L98:
           absolute, top 0, right 0, z-index 2), above any disc; the opaque raised fill
           keeps the glyphs legible over a loadout. */
        .icons {
          display: flex; gap: 8px; flex: none;
          position: absolute; top: 0; right: 0; z-index: 2;
        }
        .iconbtn {
          position: relative;
          width: ${ICON_PX}px; height: ${ICON_PX}px; display: flex; align-items: center;
          justify-content: center; padding: 0; flex: none;
          color: var(--rack-muted); background: var(--rack-raised);
          border: 1px solid var(--rack-border); border-radius: 9px; cursor: pointer;
        }
        /* The 30px drawn box keeps a 44px-tall tap target (RBAR-67): an invisible
           layer that reaches 7px past the border above and below, and 4px each side --
           half the .icons gap, so the two neighbours' hit areas meet without
           overlapping. (inset is measured from the padding box, inside the 1px border,
           hence 8px / 5px.) */
        .iconbtn::after { content: ""; position: absolute; inset: -8px -5px; }
        /* Fill, radius and hover ring per prototype L98 (RBAR-74). */
        .iconbtn:hover { color: var(--rack-text); border-color: var(--rack-border-hover); }
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
          display: inline-block; font-family: var(--rack-font); font-weight: 800;
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
          display: block; flex: 1; min-width: 0; padding: 0; margin: 0; border: 0;
          background: none; color: inherit; text-align: center; font: inherit;
          white-space: nowrap; cursor: pointer;
        }
        .totaltap:disabled { cursor: default; }
        .totaltap:focus-visible { outline: 2px solid var(--rack-accent); outline-offset: 4px; }
        /* RBAR-58 (option C, "split when different"): the Total is By Weight's one hero
           number AND its editor -- the steppers flank it and a tap opens the keypad on
           the Target. A thin underline marks it editable (the prototype's hero-under),
           accent while the keypad is open. By Weight only: By Plates and Warm up keep
           the bare Total and its 6px for their Bar picture (a mode switch may move the
           column a few px, ADR-0013). */
        .hero {
          display: flex; align-items: center; justify-content: center; gap: 8px;
        }
        .totaltap:not(:disabled) output {
          padding-bottom: 4px; border-bottom: 2px solid var(--rack-border-muted);
        }
        .totaltap.editing output { border-bottom-color: var(--rack-accent); }
        /* The hero steppers: the 44px round touch targets the Target row had (RBAR-74),
           the same glyph pair (entry.ts). By Weight only -- hidden elsewhere, where the
           centered Total stays put because the pair is symmetric. */
        .step {
          flex: none; width: 44px; height: 44px; padding: 0;
          display: flex; align-items: center; justify-content: center;
          color: var(--rack-fg); background: transparent;
          border: 1px solid var(--rack-line); border-radius: 999px;
          cursor: pointer;
        }
        .step[hidden] { display: none; }
        .step svg { display: block; }
        .step:active { background: var(--rack-line); }
        .step:focus-visible { outline: 2px solid var(--rack-accent); }
        /* The "You asked" chip (RBAR-58, prototype .asked): the Target split off the hero
           when the load misses it as read -- dashed, on the sunken fill, so it reads as
           the lifter's input rather than a result. Tapping it opens the keypad. 24px
           tall, the status line's reserved height, so it never moves the column. */
        .asked {
          display: inline-block; white-space: nowrap;
          font-family: var(--rack-font-num); font-size: 12px; font-weight: 500;
          line-height: 14px; color: var(--rack-text-secondary);
          background: var(--rack-sunken);
          border: 1px dashed var(--rack-border-active);
          border-radius: var(--rack-radius-pill); padding: 4px 10px 4px 11px;
          cursor: pointer;
        }
        .asked[hidden] { display: none; }
        .asked b { color: var(--rack-text); font-weight: 700; }
        .asked .au { font-size: 11px; color: var(--rack-text-dim); }
        .asked:focus-visible { outline: 2px solid var(--rack-accent); outline-offset: 2px; }
        /* The Secondary readout: the same Total in the other unit, tap to hide/show
           (ADR-0006/0010). A quiet line under the prominent Total, in Hanken 500 13px
           (prototype L137; RBAR-74). Side pad only, so the button adds no height. */
        .secondary {
          font-family: var(--rack-font); font-weight: 500; font-size: 13px;
          color: var(--rack-text-dim);
          background: transparent; border: none; cursor: pointer; padding: 0 6px;
        }
        .secondary.off { opacity: .7; font-style: italic; }
        .secondary:focus-visible { outline: 2px solid var(--rack-accent); }
        /* The status line: the Secondary readout with the status pill beside it, on one
           centered row (handoff 4a, screenshot 01). Decode only. 6px under the Total
           (prototype L134-L138; RBAR-74), 18px tall -- 24px in By Weight since RBAR-58, so
           the "You asked" chip that takes the Secondary's place on a miss never moves
           the column. */
        .statusline {
          display: flex; align-items: center; justify-content: center;
          gap: 9px; margin-top: 6px; min-height: 18px;
        }
        .readout[data-by-weight] .statusline { min-height: 24px; }
        .secondary[hidden] { display: none; }
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
          line-height: 1; border-radius: 999px; padding: 3px 10px;
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
          display: flex; align-items: center; justify-content: center; gap: 8px;
          min-height: 36px;
          /* 8px under the status row (the prototype's 6px gap + 2px margin, L134/L140;
             RBAR-74): the column's 12px gap, less 4. */
          margin-top: -4px;
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
        /* Another way (RBAR-66, prototype H): the round-up's quiet pill beside it, opening
           the ways sheet; off the first way it carries a small mono "2/5". Its own class
           (not .roundup) so the round-up's rules stay the round-up's. */
        .anotherway {
          display: inline-flex; align-items: center; gap: 6px; white-space: nowrap;
          font-family: var(--rack-font); font-size: 12px; font-weight: 600;
          color: var(--rack-accent);
          background: transparent; border: 1px solid var(--rack-border-muted);
          border-radius: 999px; padding: 8px 15px; cursor: pointer;
        }
        .anotherway[hidden] { display: none; }
        .anotherway small {
          font-family: var(--rack-font-num); font-size: 11px; font-weight: 600;
          color: var(--rack-text-dim);
        }
        .anotherway small:empty { display: none; }
        .anotherway:focus-visible { outline: 2px solid var(--rack-accent); }
        /* With both pills in the row, each stays one line at its natural width (a
           shrunk round-up wrapped to two lines and grew the row, RBAR-66), and the
           narrowest phones (320px) trim the side pads so the pair still fits. */
        .rounduprow > button { flex: none; white-space: nowrap; }
        @media (max-width: 359px) {
          .rounduprow > button { padding-left: 10px; padding-right: 10px; }
        }
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
        /* The narrowest phones (320px): a long miss -- "You asked 1000 kg" beside
           "630 KG SHORT" -- ran a few px past the column, so the status line closes up
           its gap and the two pills their side pads (fit-check's LINE CLIPPED). */
        @media (max-width: 359px) {
          .statusline { gap: 4px; }
          .asked { padding: 4px 6px; }
          .status { padding: 3px 7px; }
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
      <!-- By Weight's Target (RBAR-58): headless -- the hero Total below is its visible
           editor, so the element adds only the draft and the fixed keypad sheet. It sits
           outside the column (zero height, no row and no gap in it), first in the root. -->
      <rack-entry headless></rack-entry>
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
               controls over the sleeve's top-right (RBAR-75). The label's text is state-driven
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
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M8 10V2M8 2L5 5M8 2l3 3M3 9v3a2 2 0 002 2h6a2 2 0 002-2V9"
                        stroke="currentColor" stroke-width="1.5"
                        stroke-linecap="round" stroke-linejoin="round"></path>
                </svg>
              </button>
              <button type="button" class="iconbtn" data-fullscreen aria-label="Full screen">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M2 6V2.5H5.5M14 6V2.5H10.5M2 10V13.5H5.5M14 10V13.5H10.5"
                        stroke="currentColor" stroke-width="1.5"
                        stroke-linecap="round" stroke-linejoin="round"></path>
                </svg>
              </button>
            </div>
          </div>
          <rack-sleeve></rack-sleeve>
        </div>
        <div class="readout">
          <div class="readhead">
            <h2 class="label" data-total-label>Total</h2>
            <div class="units" role="group" aria-label="Display unit">
              <button type="button" data-unit="kg" aria-pressed="true">kg</button>
              <button type="button" data-unit="lb" aria-pressed="false">lb</button>
            </div>
          </div>
          <!-- The hero (RBAR-58): the Total, flanked in By Weight by the Target's
               steppers; a tap opens the keypad on the Target. -->
          <div class="hero">
            <button type="button" class="step" data-hero-step="dec" hidden
              >${MINUS_ICON}</button>
            <button type="button" class="totaltap" data-total-tap
              ><output data-total><span data-total-num>${DEFAULT_BAR_KG}</span><span
                class="tu" data-total-unit> kg</span></output
            ></button>
            <button type="button" class="step" data-hero-step="inc" hidden
              >${PLUS_ICON}</button>
          </div>
          <div class="statusline">
            <button type="button" class="secondary" data-secondary></button>
            <button type="button" class="asked" data-asked aria-haspopup="true" hidden
              >You asked <b data-asked-num></b><span class="au" data-asked-unit></span></button>
            <span class="status" data-status hidden
              ><span class="dot" aria-hidden="true"></span
              ><span data-status-label></span></span>
          </div>
          <!-- The decode outcome for screen readers (RBAR-53): a polite status region
               that speaks the Total + status once per user action. Visually hidden --
               the sighted readout above IS this information. -->
          <div class="sr" data-announce role="status"></div>
        </div>
        <!-- The round-up row sits under the Total (handoff 4a), above Recents:
             the round-up opt-in OR the at-capacity caption (never both -- ADR-0012)
             OR the below-Bar note (RBAR-67; exclusive with both).
             The wrapper's "over" class is the block-order token only (blockToken in
             console.test.ts); every style rule is scoped to .rounduprow/.roundup/.atcap
             so the "status over" pill can never match a round-up rule (RBAR-56). -->
        <div class="over rounduprow" data-roundup-row>
          <button type="button" class="roundup" data-over hidden></button>
          <!-- Another way (RBAR-66): opens the ways sheet; shown only when the Total has
               more than one way. Sits beside the round-up or the capacity caption. -->
          <button type="button" class="anotherway" data-another aria-haspopup="dialog" hidden
            >Another way<small data-another-count></small></button>
          <span class="atcap" data-atcap hidden
            ><span class="dot" aria-hidden="true"></span>Bar at capacity</span>
          <!-- The below-Bar note (RBAR-55), seated here by RBAR-67: never shown with
               the offer or the caption, so the row's fixed height holds all three. -->
          <span class="barnote" data-barnote hidden></span>
        </div>
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
      <rack-ways></rack-ways>
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
    this.totalLabel = this.root.querySelector('[data-total-label]')!;
    this.heroSteps = this.root.querySelectorAll('[data-hero-step]');
    this.asked = this.root.querySelector('[data-asked]')!;
    this.askedNum = this.root.querySelector('[data-asked-num]')!;
    this.askedUnit = this.root.querySelector('[data-asked-unit]')!;
    this.secondary = this.root.querySelector('[data-secondary]')!;
    this.status = this.root.querySelector('[data-status]')!;
    this.statusLabel = this.root.querySelector('[data-status-label]')!;
    this.barnote = this.root.querySelector('[data-barnote]')!;
    this.vizLabel = this.root.querySelector('[data-viz-label]')!;
    this.announcer = this.root.querySelector('[data-announce]')!;
    this.over = this.root.querySelector('[data-over]')!;
    this.another = this.root.querySelector('[data-another]')!;
    this.anotherCount = this.root.querySelector('[data-another-count]')!;
    this.waysSheet = this.root.querySelector('rack-ways') as Ways;
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
      this.renderHeroEditing();
    });
    // A Target commit (the keypad closing) is remembered in the Recent row (RBAR-20).
    // Distinct from `target`, which fires on every keystroke -- only the commit is kept,
    // so mid-entry digits never litter the history. A null Target (empty field) is a
    // no-op (rememberTarget guards it). The trailing render() unmutes the announcement
    // region even on a null commit (rememberTarget only renders on a real Target).
    this.entry.addEventListener('keypadclose', (e) => {
      this.keypadOwner = null;
      this.renderHeroEditing();
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
    // The hero Total is By Weight's editor (RBAR-58, after RBAR-57): a tap opens the
    // keypad on the Target -- the draft, so 142.3 when 142 is loaded. Open-only, as
    // RBAR-57 settled: a re-tap keeps editing; Done, Enter or Escape close. The steppers
    // nudge the Target's draft (+ from "142, asked 142.3" goes to 143), never the Total.
    // The "You asked" chip opens the same keypad. All four are the entry's controls, so
    // Enter on any of them while the pad is open is Done (RBAR-49).
    this.entry.controls = [...this.heroSteps, this.totalTap, this.asked];
    this.totalTap.addEventListener('click', () => this.entry.open());
    this.heroSteps.forEach((b) =>
      b.addEventListener('click', () => this.entry.step(b.dataset.heroStep === 'inc' ? 1 : -1)),
    );
    this.asked.addEventListener('click', () => this.entry.open());
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
      this.loadWays(); // the other answer, on its first way
      this.render();
    });
    // Another way (RBAR-66). Tapping the bar steps to the next way, wrapping to the
    // first; it is a button only while there is more than one (see render). A press
    // held past LONG_PRESS_MS is not a tap: long-press stays free (RBAR-73). The hold is
    // judged at pointerup (on touch, pointerleave fires between pointerup and click),
    // and only swallows a click that follows that release at once -- so a press that
    // was cancelled, dragged off, or never produced a click cannot swallow a later
    // click with no pointer of its own (a TalkBack double-tap, Switch Access).
    this.sleeve.addEventListener('pointerdown', (e) => {
      this.barDownAt = e.timeStamp;
    });
    this.sleeve.addEventListener('pointerup', (e) => {
      const down = this.barDownAt;
      this.barDownAt = null;
      this.barHeldUpAt = down !== null && e.timeStamp - down >= LONG_PRESS_MS ? e.timeStamp : null;
    });
    const dropPress = () => {
      this.barDownAt = null;
    };
    this.sleeve.addEventListener('pointercancel', dropPress);
    this.sleeve.addEventListener('pointerleave', dropPress);
    this.sleeve.addEventListener('click', (e) => {
      const up = this.barHeldUpAt;
      this.barHeldUpAt = null;
      if (up !== null && e.timeStamp - up < HELD_CLICK_MS) return;
      this.nextWay();
    });
    this.sleeve.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (this.wayCount() < 2) return;
      e.preventDefault(); // Space would scroll
      this.nextWay();
    });
    // The Another way pill opens the list of ways; a row loads that way.
    this.another.addEventListener('click', () => this.openWays());
    this.waysSheet.addEventListener('wayselect', (e) => {
      this.loadWay((e as CustomEvent<{ index: number }>).detail.index, true);
    });
    // Closing the sheet hands focus back to the pill that opened it -- unless it closed
    // into Setup ("Set Plate Inventory"), where the app moves focus into that sheet.
    this.waysSheet.addEventListener('close', (e) => {
      const toSetup = (e as CustomEvent<{ toSetup?: boolean } | null>).detail?.toSetup;
      if (!toSetup && !this.another.hidden) this.another.focus();
    });
    // The Share control opens the loading card (RBAR-19, ADR-0011); see openShare.
    this.root.querySelector('[data-share]')!.addEventListener('click', () => this.openShare());
    // The fullscreen control blows the loaded Bar up to the immersive card (RBAR-18).
    this.root
      .querySelector('[data-fullscreen]')!
      .addEventListener('click', () => this.openFullscreen());
    this.fullscreen.addEventListener('close', () => this.syncWake());
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
    // The way on the Bar (RBAR-66) is kept when the toggle leaves the Total as it was.
    const loaded = this.side;
    if (!this.showingOver && shownIn(primary.total, was) === shownIn(target, was)) {
      this.entry.retarget(primary.total);
      this.solveTo(primary.total);
    } else {
      const chosenOver = this.showingOver && over ? over.total : null;
      this.solveTo(target); // clears showingOver
      const next = this.decoded as Decoded | null;
      if (chosenOver !== null && next?.over && Math.abs(next.over.total - chosenOver) < 1e-9) {
        this.showingOver = true;
        this.loadWays();
      }
    }
    // A Total that held keeps its way list, so the loaded way is found in it; then one
    // render, so the toggle is announced once, with the way.
    const kept = this.ways.findIndex((w) => sameSide(w, loaded));
    if (kept > 0) {
      this.wayIdx = kept;
      this.side = this.ways[kept];
    }
    this.render();
  }

  /**
   * Show an opened share link's load (RBAR-50, ADR-0014). The app has already pushed the
   * link's rig (set, Bar, Collar). Transient: the unit is applied for this view and NOT
   * persisted (a later toggle tap persists as today). Plates win over a re-solve:
   *  - By Weight with a Target: decode it; if the linked Plates are one of the primary's
   *    ways (RBAR-66), show that way; else if they are one of the round-up's, show the
   *    round-up on that way (as if the lifter tapped it); if they are none of these (a
   *    solver or Inventory change since the link was made), fall back to the ADR-0005
   *    carry -- the linked Plates with their Total in the entry, no live decode. The
   *    Target joins Recents through the normal push (Caitlin, 2026-10-16).
   *  - By Weight without a Target, or By Plates: the linked Plates as the carried Side.
   */
  applyLink(link: LinkLoad): void {
    this.closeWays(); // a link pasted over an open ways sheet replaces its load
    this.unitPref = link.unit;
    // The entry seeds below read in the link's unit, so hand it over first (a later
    // render-time unit change would re-dress a seed as a lifter reformat, RBAR-38).
    this.entry.unit = link.unit;
    this.recentsRow.unit = link.unit;
    this.mode = link.mode;
    this.decoded = null;
    this.showingOver = false;
    this.side = link.side;
    if (link.mode === 'encode') {
      this.render();
      return;
    }
    const target = link.targetKg;
    if (target === undefined) {
      this.entry.display(link.side.length > 0 ? encode(link.side, this.baselineKg()) : null);
      this.render();
      return;
    }
    // The sender's own Target reading (`d`, RBAR-50 slice 3) is shown as is and solved
    // from, so the display window -- and so the Plates and status -- match the sender's
    // (a typed 52.5 lb reads 53; its 2 dp kg alone reads 52). Without one, the Target
    // shows as its readout and solves from the kg.
    const reading = link.reading;
    this.entry.display(target, reading);
    this.decodeTo(reading === undefined ? target : (draftToKg(reading, link.unit) ?? target));
    // The linked Plates may be another way (RBAR-66) of the primary or of the round-up.
    let at = this.ways.findIndex((w) => sameSide(w, link.side));
    // (decodeTo set `decoded`; the cast undoes the narrowing from the null above.)
    if (at < 0 && (this.decoded as Decoded | null)?.over) {
      this.showingOver = true;
      this.loadWays();
      at = this.ways.findIndex((w) => sameSide(w, link.side));
      if (at < 0) this.showingOver = false;
    }
    if (at < 0) {
      this.decoded = null; // drift: the carry, not a decode that disagrees with the Plates
      this.side = link.side;
      this.entry.display(encode(link.side, this.baselineKg()));
      this.render();
    } else {
      this.loadWay(at);
    }
    this.rememberTarget(target);
  }

  // Restore the persisted Primary-unit choice; a missing/blocked/garbage value -> kg
  // (the app's default and canonical unit). Validated so a corrupt key can't strand it.
  private loadUnit(): Unit {
    return persistedPrimaryUnit();
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
    this.share.link = this.shareLink();
    this.share.open();
  }

  // The share link for what is on screen (RBAR-50, ADR-0014): mode, Side Load, rig and
  // display Unit, plus the Target in By Weight with a live decode (`target = total -
  // delta`, as reconfigure reads it). A carry has no live decode, so it sends no Target.
  // With the Target goes the entry's own reading (`d`), so the recipient shows that text
  // and solves the same display window. Null when the load has no exact link (e.g. an
  // off-menu Bar, a Target over MAX_TARGET_KG): the card then shows a disabled "No
  // link" with its reason under the row, never a link that opens to a different load.
  //
  // The link describes exactly what the card shows (RBAR-78, ADR-0014): the same Collar
  // rule (loadCollarKg -- the bare-Bar Ramp row carries none), so the card's Total is
  // the link's. A Warm up share opens in By Weight on the selected row's load: its Total
  // as the Target, read as the readout shows it, with the row's Plates (ADR-0014's
  // "Plates win" keeps them even if the recipient's solve would pick another way).
  // The link carries the Plates heaviest-first, its one Side order: a Warm-up stack
  // with a big Plate outside a lighter one (ADR-0015 as amended) travels as the same
  // Plates restacked, never as "No link".
  private shareLink(): string | null {
    // Restacked against the set's base Inventory by value (restackForLink). A Plate the
    // set lacks (not expected: a set switch drops the Side, ADR-0010) restacks to null;
    // then the Side goes as is and serializeLink refuses it ("No link").
    const stacked = restackForLink(this.side, plateSetFor(this._plateSetKey).inventory);
    const load = {
      set: this._plateSetKey,
      barKg: this._barKg,
      // serializeLink validates the Collar against the offered options.
      collarKg: this.loadCollarKg() as LinkState['collarKg'],
      unit: this.activeUnit(),
      side: stacked ?? this.side,
    };
    if (this.mode === 'encode') return linkUrl({ ...load, mode: 'encode' });
    const row = this.warmRow();
    if (row) {
      const reading = String(shownIn(row.total, load.unit));
      return linkUrl({ ...load, mode: 'decode', targetKg: row.total, reading });
    }
    const d = this.decoded;
    if (!d) return linkUrl({ ...load, mode: 'decode' });
    const targetKg = d.primary.total - d.primary.delta;
    // A mid-entry draft ("142.") normalises to its number; a reading that still does not
    // fit (not expected) falls back to the Target alone, which opens to its readout.
    const n = Number(this.entry.reading);
    const reading = Number.isFinite(n) ? String(n) : undefined;
    return (
      linkUrl({ ...load, mode: 'decode', targetKg, reading }) ??
      linkUrl({ ...load, mode: 'decode', targetKg })
    );
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
    this.syncWake();
  }

  // Hold the screen wake lock exactly while fullscreen or Warm up is showing (RBAR-80).
  // Idempotent, so render calls it on every pass (that covers mode changes and a
  // reload straight into Warm up).
  private syncWake(): void {
    this.wake.hold(this.isConnected && (this.mode === 'warmup' || !this.fullscreen.hidden));
  }

  disconnectedCallback(): void {
    this.wake.hold(false);
  }

  // A new Target always lands on the at-or-under primary -- any prior over choice is
  // cleared, so the lifter is never silently left over Target (ADR-0003). A null Target
  // (empty field) clears to the bare Bar. Solved against the active set's Inventory, at
  // or under everything the Target's READING covers in the active unit (RBAR-60): a
  // typed-back displayed Total must land on itself, not a Plate step below it.
  private decodeTo(target: number | null): void {
    this.solveTo(target);
    this.render();
  }

  // decodeTo without the render, for a caller that adjusts the result first (the kg|lb
  // toggle keeping a way) and then renders -- and so announces -- once.
  private solveTo(target: number | null): void {
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
    this.loadWays();
  }

  // Load the shown Decode answer (the primary, or the round-up while chosen) on its
  // first way, and list its ways (RBAR-66, lib/ways.ts) on the same Inventory -- so a
  // re-solve of any kind (Target, Bar, Collar, Plate set, Round up, the Inventory)
  // starts over from the canonical stack. No live decode: no ways, a bare Side. An open
  // ways sheet closes: its rows are the old list, and a tap on one must never load a
  // way of the new list it does not show.
  private loadWays(): void {
    const d = this.decoded;
    const shown = d ? (this.showingOver && d.over ? d.over : d.primary) : null;
    this.ways = shown ? waysFor(shown.side, this.inventory()) : [];
    this.wayIdx = 0;
    this.wayStepped = false;
    this.side = shown ? shown.side : [];
    this.closeWays();
  }

  // Close the ways sheet if it is open (pre-connect there is none yet).
  private closeWays(): void {
    if (this.waysSheet && !this.waysSheet.hidden) this.waysSheet.close();
  }

  // How many ways the Bar can step through right now: By Weight with a live decode.
  private wayCount(): number {
    return this.mode === 'decode' && this.decoded ? this.ways.length : 0;
  }

  // Put way `i` on the Bar (a list row, a bar tap, a link's Plates) and render.
  // `stepped`: the lifter chose it, so the spoken line names its Plates.
  private loadWay(i: number, stepped = false): void {
    if (this.wayCount() === 0) return;
    this.wayIdx = Math.min(Math.max(0, Math.trunc(i) || 0), this.ways.length - 1);
    this.side = this.ways[this.wayIdx];
    this.wayStepped = stepped;
    this.render();
  }

  // A tap on the bar: the next way, wrapping to the first. Inert with one way or none.
  private nextWay(): void {
    const n = this.wayCount();
    if (n > 1) this.loadWay((this.wayIdx + 1) % n, true);
  }

  // Open the ways sheet, titled with the Total in the display unit.
  private openWays(): void {
    if (this.wayCount() < 2) return;
    this.waysSheet.heading = `Load ${format(this.loadTotalKg(), this.activeUnit())} another way`;
    this.waysSheet.ways = this.ways;
    this.waysSheet.index = this.wayIdx;
    this.waysSheet.open(); // focuses the loaded way's row
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

  // Plan the Ramp for the Working set on the current rig by Caitlin's station rule
  // (lib/moves.ts, ADR-0015 as amended), and load the selected row. The Working set
  // solves at or under its reading in the display unit (displayCeilingKg, RBAR-60),
  // exactly as By Weight would. The template
  // is DEFAULT_RAMP (editing it is slice 3). The selection is kept across re-plans,
  // clamped into the rows.
  private planWarmup(): void {
    if (this.working === null) {
      this.ramp = null;
      this.side = [];
      return;
    }
    this.ramp = planEasyRamp(
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
    this.syncWake();
    const unit = this.activeUnit();
    this.sleeve.sideLoad = this.side;
    this.sleeve.interactive = this.mode === 'encode';
    // The sleeve draws a Collar on the outer disc when Setup's collars are on (RBAR-96);
    // a bare-Bar Ramp row carries none, the same as the cards.
    this.sleeve.collars = this.loadCollarKg() > 0;
    this.renderWays();
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
    this.renderHero(unit);
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
      // With Pairs of Plates on Hand (RBAR-72) a missing `over` can also mean the plates
      // on hand ran out; sleeveBinds keeps the capacity claim to a full Sleeve.
      const atCap = this.sleeveBinds(over, targetKg, displayCeilingKg(targetKg, unit));
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
      // Split when different (RBAR-58): the Target splits off the hero only when the
      // load misses it AS READ (ADR-0010) -- the pill's own test, so the chip and the
      // pill always come and go together; the chip quotes the Target as typed, the pill
      // reads the rounded miss. Exact: the Target is the hero, not shown twice, and the
      // Secondary readout keeps its place.
      this.renderAsked(pill.kind === 'exact' ? null : targetKg, unit);
      // After a step to another way, or while off the first (RBAR-66), the line says
      // which way and names its Plates -- a bar tap keeps the Total, so the Plates are
      // the news ("140 kilograms, Exact, way 2 of 5, 25 kg + 20 kg + 15 kg per side").
      const way =
        this.wayIdx > 0 || this.wayStepped
          ? `, way ${this.wayIdx + 1} of ${this.ways.length}, ${wayName(this.side)} per side`
          : '';
      const line = announceLine(
        shownIn(shown.total, unit),
        unit,
        (pill.kind === 'capacity' ? `${pill.label}, bar at capacity` : pill.label) + way,
      );
      this.announce(note === null ? line : `${line}. ${note}`);
    } else if (this.mode === 'warmup' && this.ramp && this.working !== null) {
      this.renderAsked(null, unit);
      this.renderWarmStatus(this.ramp, this.warmIdx, this.working, unit);
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
      this.renderAsked(null, unit);
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

  // Another way's surfaces (RBAR-66), shown only while the Total has more than one way:
  // the bar becomes a button (focusable, Enter/Space step like a tap), and the pill in
  // the round-up row reads "2/5" once off the first way. The open sheet tracks the way.
  private renderWays(): void {
    const n = this.wayCount();
    const on = n > 1;
    const at = on && this.wayIdx > 0 ? `${this.wayIdx + 1}/${n}` : '';
    if (on) {
      // A button's children are presentational, so its label carries the Plates the
      // discs would have named: in By Weight the bar is the only per-Plate readout.
      this.sleeve.setAttribute('role', 'button');
      this.sleeve.tabIndex = 0;
      this.sleeve.setAttribute(
        'aria-label',
        `${wayName(this.side)} per side. Another way, ${this.wayIdx + 1} of ${n}`,
      );
    } else {
      this.sleeve.removeAttribute('role');
      this.sleeve.removeAttribute('tabindex');
      this.sleeve.removeAttribute('aria-label');
    }
    this.another.hidden = !on;
    this.anotherCount.textContent = at;
    if (at) this.another.setAttribute('aria-label', `Another way, ${this.wayIdx + 1} of ${n}`);
    else this.another.removeAttribute('aria-label');
    this.waysSheet.index = this.wayIdx;
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

  // The hero (RBAR-58). In By Weight the Total is labelled "On the bar" (plain language
  // for the Total, CONTEXT.md user-facing copy) and is the Target's editor: steppers
  // either side, a tap for the keypad. By Plates keeps "Total" -- its own "On the bar"
  // row names the loaded chips -- and so does Warm up; neither edits from the hero.
  private renderHero(unit: Unit): void {
    const byWeight = this.mode === 'decode';
    this.totalLabel.textContent = byWeight ? 'On the bar' : 'Total';
    // Reserves the chip's 24px status line in By Weight only (see .statusline).
    this.totalLabel.closest('.readout')!.toggleAttribute('data-by-weight', byWeight);
    const step = stepFor(unit);
    this.heroSteps.forEach((b) => {
      b.hidden = !byWeight;
      const verb = b.dataset.heroStep === 'inc' ? 'Increase' : 'Decrease';
      b.setAttribute('aria-label', `${verb} Target by ${step} ${unit}`);
    });
    if (byWeight) {
      this.totalTap.setAttribute('aria-haspopup', 'true');
      this.totalTap.setAttribute(
        'aria-label',
        `${format(this.loadTotalKg(), unit)} on the bar. Edit Target`,
      );
    } else {
      this.totalTap.removeAttribute('aria-haspopup');
      this.totalTap.removeAttribute('aria-label');
    }
    this.renderHeroEditing();
  }

  // The hero's open-keypad state: the accent underline, and aria-expanded on both
  // controls that open the pad (the hero and the chip), off the entry's
  // keypadopen/keypadclose edges (keypadOwner).
  private renderHeroEditing(): void {
    const editing = this.keypadOwner === 'decode' && this.mode === 'decode';
    this.totalTap.classList.toggle('editing', editing);
    this.asked.setAttribute('aria-expanded', String(editing));
    if (this.mode === 'decode') this.totalTap.setAttribute('aria-expanded', String(editing));
    else this.totalTap.removeAttribute('aria-expanded');
  }

  // The "You asked" chip (RBAR-58): the Target, in place of the Secondary readout, or
  // (null) hidden with the Secondary back. The chip quotes the Target exactly as the keypad holds it in the active unit
  // (Caitlin, 2026-10-17): "You asked 142.3 lb", never rounded to the readout's
  // precision -- the pill keeps its own rounded miss. A draft mid-entry ("142.")
  // reads as its number; an empty draft falls back to the Target as shown.
  private renderAsked(targetKg: number | null, unit: Unit): void {
    this.asked.hidden = targetKg === null;
    this.secondary.hidden = targetKg !== null;
    const typed = Number(this.entry.reading);
    const asRead = this.entry.reading !== '' && Number.isFinite(typed) ? typed : null;
    this.askedNum.textContent =
      targetKg === null ? '' : fmtNum(asRead ?? shownIn(targetKg, unit));
    this.askedUnit.textContent = targetKg === null ? '' : ` ${unit}`;
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
  // is the selected row's Total + its pill + what to change to load it ("add 10 and 2.5
  // kilograms per side"): since RBAR-95 the Next button names nothing, so after a Next
  // the announcement is where a screen reader hears what to load.
  private renderWarmStatus(ramp: Ramp, idx: number, working: number, unit: Unit): void {
    const row = ramp.rows[idx];
    const workingTotal = ramp.working.primary.total;
    const atCap = this.sleeveBinds(ramp.working.over, working, displayCeilingKg(working, unit));
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
    const change = deltaSpoken(rowDelta(ramp.rows, idx), plateSetFor(this._plateSetKey).unit);
    this.announce(
      announceLine(shownIn(row.total, unit), unit, change === null ? pill.label : `${pill.label}, ${change}`),
    );
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
    // onBarLine's escaped middle dot). Wording is Caitlin's
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
 * canonical kg. Since RBAR-58 it says the miss in the status pill's words ("0.5 kg
 * short", "0.7 kg over") -- the prototype's keypad "under" said the same fact as the
 * pill's "short" in a second word, and without the unit. The prototype separates the
 * two facts with a middle dot (L803, "On the bar: 142 kg <middot> 0.5 kg short"; RBAR-74),
 * emitted as an escape so the source stays ASCII (the Setup pill's precedent, app.ts).
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
  if (shownTotal === shownTarget) return `${head} \u00B7 exact`;
  // The miss is statusPill's own label ("0.3 kg short" / "0.7 kg over"), so the two
  // surfaces say the same fact in the same words (RBAR-58).
  const { label } = statusPill(shownTotal, shownTarget, unit, atCapacity);
  // At capacity the shortfall still rides along (RBAR-47: the magnitude of the miss
  // is never lost): while the sheet is open it is the ONLY surface saying it -- the
  // sheet covers the pill and announce() goes quiet.
  return atCapacity && shownTotal < shownTarget
    ? `${head} \u00B7 ${label}, at capacity`
    : `${head} \u00B7 ${label}`;
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
