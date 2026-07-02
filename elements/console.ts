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
// plate set selects the Inventory to solve against and can FORCE the unit (the iron set
// is lb-only), so the unit toggle derives free-vs-locked from the set.
import './entry.ts';
import './palette.ts';
import './loaded.ts';
import './sleeve.ts';
import './recents.ts';
import './share.ts';
import './fullscreen.ts';
import { decode } from '../lib/decode.ts';
import { addPlate, encode, removePlate } from '../lib/encode.ts';
import {
  DEFAULT_BAR_KG,
  barWithCollars,
  atSleeveCapacity,
  sideWidthMm,
} from '../lib/plates.ts';
import { DEFAULT_COLLAR_KG } from './setup.ts';
import { readPersisted, writePersisted } from './persist.ts';
import { parseRecents, pushRecent, isRememberable } from '../lib/recents.ts';
import { BUTTON_FX } from './buttonfx.ts';
import { ROLL_CSS, rollText } from './numroll.ts';
import { plateSetFor, isOfferedPlateSet } from '../lib/platesets.ts';
import type { PlateSetKey } from '../lib/platesets.ts';
import type { LoadSummary } from '../lib/summary.ts';
import { format, shownIn } from '../lib/units.ts';
import type { Unit } from '../lib/units.ts';
import type { Plate } from '../lib/plates.ts';
import type { Decoded, Loadout } from '../lib/decode.ts';

type Sleeve = HTMLElement & {
  sideLoad: readonly Plate[];
  interactive: boolean;
};
type Entry = HTMLElement & {
  display(value: number | null): void;
  barKg: number;
  unit: Unit;
  loadLine: string | null;
};
type Recents = HTMLElement & { targets: readonly number[]; unit: Unit };
type Loaded = HTMLElement & { side: readonly Plate[] };
type Palette = HTMLElement & { inventory: readonly Plate[]; sideMm: number };
type Share = HTMLElement & { load: LoadSummary; open(): void };
type Fullscreen = HTMLElement & { load: LoadSummary; plateSet: string; open(): void };
type Mode = 'decode' | 'encode';

// The Recent Targets history persists shell-side under its own key (ADR-0007/0009),
// canonically in kg (ADR-0006); the row renders it in the active unit (RBAR-17).
const RECENTS_KEY = 'rackbar.recents';
// The Target display state, console-owned and console-persisted (ADR-0010): the
// lifter's free Primary-unit choice (used on the Competition set) and whether the
// Secondary readout shows.
const UNIT_KEY = 'rackbar.unit';
const SECONDARY_KEY = 'rackbar.secondary';

class RackConsole extends HTMLElement {
  private root: ShadowRoot = this.attachShadow({ mode: 'open' });
  private entry!: Entry;
  private recentsRow!: Recents;
  private loadedRow!: Loaded;
  private palette!: Palette;
  private sleeve!: Sleeve;
  private share!: Share;
  private fullscreen!: Fullscreen;
  private total!: HTMLElement;
  private secondary!: HTMLButtonElement;
  private status!: HTMLElement;
  private statusLabel!: HTMLElement;
  private over!: HTMLButtonElement;
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
  // against and whether the display unit is locked. Defaults to Competition (kg Eleiko);
  // the app sets it from Setup.
  private _plateSetKey: PlateSetKey = 'comp';
  // The lifter's free Primary-unit choice and Secondary-visible preference (ADR-0010).
  // unitPref is honored on the Competition set; the Training set forces lb (see
  // activeUnit). Both restore from storage on connect and persist on change.
  private unitPref: Unit = 'kg';
  private showSecondary = true;
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

  /**
   * The active plate set (RBAR-17, ADR-0010). Switching it changes the Inventory and may
   * force the unit (training -> lb). The Plates do not cross sets, so a hand-built Encode
   * loadout is reset to the bare rig; a Decode Target is unit-agnostic kg, so it
   * re-solves on the new rig (the same weight on the new Plates). The app pairs this with
   * a barKg change to the set's default -- set barKg first so the re-decode sees it.
   */
  set plateSet(key: string) {
    const k = isOfferedPlateSet(key) ? key : 'comp';
    if (k === this._plateSetKey) return;
    this._plateSetKey = k;
    if (this.palette) this.palette.inventory = this.inventory(); // swap the Encode palette
    if (this.mode === 'encode') {
      this.side = []; // iron and Eleiko Plates are different objects -- no carry across sets
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

  // The effective display Unit: the set forces it when locked (the iron set is lb-only),
  // otherwise the lifter's free choice. A locked set never overwrites unitPref, so
  // toggling sets back and forth restores the lifter's Competition choice (ADR-0010).
  private activeUnit(): Unit {
    const set = plateSetFor(this._plateSetKey);
    return set.unitLocked ? set.unit : this.unitPref;
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
    if (this.mode === 'decode' && this.decoded) {
      this.decodeTo(this.decoded.primary.total - this.decoded.primary.delta);
    } else {
      this.render();
    }
  }

  connectedCallback(): void {
    this.root.innerHTML = `
      <style>
        ${BUTTON_FX}${ROLL_CSS}
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
        /* The bar visualizer block: the sleeve, with the fullscreen control floated at
           its top-right corner (handoff section 3) -- it blows the loaded Bar up to a
           landscape, glanceable card (RBAR-18). */
        .viz { position: relative; }
        .fullscreen {
          position: absolute; top: 0; right: 0; z-index: 1;
          width: 36px; height: 36px; display: flex; align-items: center;
          justify-content: center; padding: 0;
          color: var(--rack-muted); background: transparent;
          border: 1px solid var(--rack-line); border-radius: 10px; cursor: pointer;
        }
        .fullscreen:hover { color: var(--rack-fg); }
        .fullscreen:focus-visible { outline: 2px solid var(--rack-accent); outline-offset: 2px; }
        .readout { text-align: center; }
        /* The Total label sits beside the kg|lb unit toggle (the handoff's readout head). */
        .readhead {
          display: flex; align-items: center; justify-content: center; gap: 10px;
        }
        .readout .label { color: var(--rack-muted); font-size: 13px; }
        /* The kg|lb Primary unit toggle: a small segmented control. Disabled (locked)
           when the plate set fixes the unit -- the iron set is lb-only (ADR-0010). */
        .units {
          display: inline-flex; gap: 2px;
          border: 1px solid var(--rack-line); border-radius: 999px; padding: 2px;
        }
        .units button {
          font-family: var(--rack-font-num); font-size: 12px; font-weight: 600;
          color: var(--rack-muted); background: transparent;
          border: none; border-radius: 999px; padding: 3px 10px; cursor: pointer;
        }
        .units button[aria-pressed="true"] {
          color: var(--rack-bg); background: var(--rack-accent);
        }
        .units button:disabled { cursor: default; opacity: .55; }
        .units button:focus-visible { outline: 2px solid var(--rack-accent); }
        /* The big Total (handoff 4a): Hanken 800 / 54px / -.025em with tabular figures.
           Hanken is proportional, so tnum must be explicit -- it "stayed on" only while
           the Total was monospace JetBrains Mono; now that it is Hanken the digits would
           jitter on change without it. Rolls up on change (numRoll, via rollText). */
        .readout output {
          display: block; font-family: var(--rack-font); font-weight: 800;
          font-size: clamp(40px, 13vw, 54px); letter-spacing: -.025em;
          font-variant-numeric: tabular-nums;
          color: var(--rack-fg); margin-top: 4px;
        }
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
        /* The status pill (RBAR-28): the Total's Exact / N over / N short / Bar at
           capacity indicator. A quiet uppercase mono pill with a state dot. Over is the
           one solid variant (accent fill, ink text) -- the handoff's emphasis on going
           over Target; the rest are outline pills. */
        .status {
          display: inline-flex; align-items: center; gap: 6px;
          font-family: var(--rack-font-num); font-size: 10px; font-weight: 600;
          letter-spacing: .1em; text-transform: uppercase; white-space: nowrap;
          line-height: 1; border-radius: 999px; padding: 4px 10px;
          color: var(--rack-muted);
          background: transparent; border: 1px solid var(--rack-line-strong);
        }
        .status[hidden] { display: none; }
        .status .dot {
          width: 5px; height: 5px; border-radius: 999px; flex: none;
          background: var(--rack-accent);
        }
        .status.exact .dot { background: var(--rack-success); }
        .status.over {
          color: var(--rack-accent-ink);
          background: var(--rack-accent); border-color: var(--rack-accent);
        }
        .status.over .dot { display: none; }
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
        /* The Share control: a quiet pill that opens the loading card (RBAR-19). Always
           available -- the card reflects whatever is on the Bar, bare or loaded. */
        .share {
          align-self: center;
          display: inline-flex; align-items: center; gap: 7px;
          font: inherit; font-size: 14px; font-weight: 600; color: var(--rack-muted);
          background: transparent; border: 1px solid var(--rack-line);
          border-radius: 999px; padding: 8px 16px; min-height: 44px; cursor: pointer;
        }
        .share:hover { color: var(--rack-fg); }
        .share:focus-visible { outline: 2px solid var(--rack-accent); outline-offset: 2px; }
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
        <!-- The bar is the hero (RBAR-25, handoff section 3 + 4a/4b): the sleeve sits
             directly under the mode toggle, with the Total readout and the round-up
             immediately below it, THEN the editors (Target entry / Recents in By Weight,
             the Add palette in By Plates). One DOM order serves both modes -- the editors
             toggle by the hidden attribute, so the visible column reads right either way. -->
        <div class="viz">
          <button type="button" class="fullscreen" data-fullscreen aria-label="Full screen">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M5.5 2V5.5H2M14 5.5H10.5V2M10.5 14V10.5H14M2 10.5H5.5V14"
                    stroke="currentColor" stroke-width="1.6"
                    stroke-linecap="round" stroke-linejoin="round"></path>
            </svg>
          </button>
          <rack-sleeve></rack-sleeve>
        </div>
        <div class="readout">
          <div class="readhead">
            <span class="label">Total</span>
            <div class="units" role="group" aria-label="Display unit">
              <button type="button" data-unit="kg" aria-pressed="true">kg</button>
              <button type="button" data-unit="lb" aria-pressed="false">lb</button>
            </div>
          </div>
          <output data-total>${DEFAULT_BAR_KG} kg</output>
          <div class="statusline">
            <button type="button" class="secondary" data-secondary></button>
            <span class="status" data-status hidden
              ><span class="dot" aria-hidden="true"></span
              ><span data-status-label></span></span>
          </div>
        </div>
        <!-- The round-up opt-in sits under the Total (handoff 4a), above the Target block. -->
        <button type="button" class="over" data-over hidden></button>
        <rack-entry></rack-entry>
        <!-- Recent Targets: a quick-pick row under the entry, By-Weight mode only
             (RBAR-20). Hidden until the lifter has committed a Target. -->
        <rack-recents hidden></rack-recents>
        <!-- "On the bar": the loaded-chips row + Clear, By-Plates mode only (RBAR-27,
             handoff 4b). Sits directly above the Add palette; both share the editor slot
             with the By-Weight Target/Recent blocks, toggled by hidden. -->
        <rack-loaded hidden></rack-loaded>
        <rack-palette hidden></rack-palette>
        <button type="button" class="share" data-share>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 10V2M8 2L5 5M8 2l3 3M3 9v3a2 2 0 002 2h6a2 2 0 002-2V9"
                  stroke="currentColor" stroke-width="1.6"
                  stroke-linecap="round" stroke-linejoin="round"></path>
          </svg>
          Share
        </button>
      </div>
      <rack-share></rack-share>
      <rack-fullscreen></rack-fullscreen>
    `;
    this.entry = this.root.querySelector('rack-entry') as Entry;
    this.recentsRow = this.root.querySelector('rack-recents') as Recents;
    this.loadedRow = this.root.querySelector('rack-loaded') as Loaded;
    this.palette = this.root.querySelector('rack-palette') as Palette;
    this.sleeve = this.root.querySelector('rack-sleeve') as Sleeve;
    this.share = this.root.querySelector('rack-share') as Share;
    this.fullscreen = this.root.querySelector('rack-fullscreen') as Fullscreen;
    this.total = this.root.querySelector('[data-total]')!;
    this.secondary = this.root.querySelector('[data-secondary]')!;
    this.status = this.root.querySelector('[data-status]')!;
    this.statusLabel = this.root.querySelector('[data-status-label]')!;
    this.over = this.root.querySelector('[data-over]')!;
    this.unitButtons = this.root.querySelectorAll('[data-unit]');
    this.modeButtons = this.root.querySelectorAll('[data-mode]');

    // Decode: the Target entry derives the Side Load.
    this.entry.addEventListener('target', (e) => {
      if (this.mode !== 'decode') return;
      this.decodeTo((e as CustomEvent<{ target: number | null }>).detail.target);
    });
    // A Target commit (the keypad closing) is remembered in the Recent row (RBAR-20).
    // Distinct from `target`, which fires on every keystroke -- only the commit is kept,
    // so mid-entry digits never litter the history. A null Target (empty field) is a
    // no-op (rememberTarget guards it).
    this.entry.addEventListener('keypadclose', (e) =>
      this.rememberTarget((e as CustomEvent<{ target: number | null }>).detail.target),
    );
    // A recent chip tap re-applies that Target: seed the field, decode it, and move it
    // back to the front of the history (a re-use is a fresh commit).
    this.recentsRow.addEventListener('recentapply', (e) => {
      const { target } = (e as CustomEvent<{ target: number }>).detail;
      this.entry.display(target);
      this.decodeTo(target);
      this.rememberTarget(target);
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
    // The kg|lb Primary unit toggle (ADR-0010). Honored only on an unlocked set; the
    // chosen unit persists and the surfaces re-render in it.
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
        if (mode === 'decode' || mode === 'encode') this.setMode(mode);
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
    this.render(); // initial state: Decode, a bare rig, no Target typed yet
  }

  // Adopt a Primary-unit choice from the toggle: ignored on a locked set (the toggle is
  // disabled there anyway), else record it, persist, and re-render every surface in it.
  private chooseUnit(unit: Unit): void {
    if (plateSetFor(this._plateSetKey).unitLocked) return;
    if (unit === this.unitPref) return;
    this.unitPref = unit;
    writePersisted(UNIT_KEY, unit);
    this.render();
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
    this.recents = pushRecent(this.recents, target);
    this.recentsRow.targets = this.recents;
    this.render(); // keep the row's mode visibility in sync
    writePersisted(RECENTS_KEY, JSON.stringify(this.recents));
  }

  // Open the loading card (RBAR-19, ADR-0011): snapshot the current load -- the achieved
  // Total, the Side Load, the bare Bar + per-Side Collar, and the active display Unit --
  // and hand it to the card. Opening in By-Weight (Decode) with a committed Target also
  // remembers it (the third recents push site, closing the RBAR-20 seam from ADR-0009);
  // By-Plates (Encode) has no Target, so it pushes nothing.
  private openShare(): void {
    if (this.mode === 'decode' && this.decoded) {
      this.rememberTarget(this.decoded.primary.total - this.decoded.primary.delta);
    }
    // The card derives the Total from these (loadTotalKg), so no separate Total is
    // passed -- nothing to drift from the Plates.
    this.share.load = {
      side: this.side,
      barKg: this._barKg,
      collarKg: this._collarKg,
      unit: this.activeUnit(),
    };
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
      collarKg: this._collarKg,
      unit: this.activeUnit(),
    };
    // The set drives the caption's name + native-Unit Bar (RBAR-30); the load snapshot
    // (ADR-0011 shape, shared with the share card) deliberately stays set-agnostic.
    this.fullscreen.plateSet = this._plateSetKey;
    this.fullscreen.open();
  }

  // A new Target always lands on the at-or-under primary -- any prior over choice is
  // cleared, so the lifter is never silently left over Target (ADR-0003). A null Target
  // (empty field) clears to the bare Bar. Solved against the active set's Inventory.
  private decodeTo(target: number | null): void {
    this.showingOver = false;
    this.decoded = target === null ? null : decode(target, this.baselineKg(), this.inventory());
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
    const unit = this.activeUnit();
    this.sleeve.sideLoad = this.side;
    this.sleeve.interactive = this.mode === 'encode';
    this.entry.unit = unit;
    this.recentsRow.unit = unit;
    rollText(this.total, format(encode(this.side, this.baselineKg()), unit));
    this.renderUnitToggle(unit);
    this.renderSecondary(unit);
    this.entry.hidden = this.mode !== 'decode';
    // The Recent row is a By-Weight (Decode) affordance: shown only there, and only once
    // there is something to show (the row also self-hides when empty -- ADR-0009).
    this.recentsRow.hidden = this.mode !== 'decode' || this.recents.length === 0;
    this.palette.hidden = this.mode !== 'encode';
    // Feed the palette the Side's used sleeve width so it can disable the keys that
    // no longer fit (RBAR-31, ADR-0012) -- the visible face of addPlate's refusal.
    this.palette.sideMm = sideWidthMm(this.side);
    // The "On the bar" chips + Clear are By-Plates only; the row stays visible there even
    // when empty (it shows its own "Tap to add a pair" hint), so it toggles by mode alone.
    this.loadedRow.hidden = this.mode !== 'encode';
    this.loadedRow.side = this.side;
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
      const atCap = atSleeveCapacity(shown.side, this.inventory());
      this.renderStatus(shown, targetKg, unit, atCap);
      this.renderOver(over ?? null, primary, targetKg, unit);
      // Feed the keypad sheet its "on the bar" line (RBAR-22): the loadable Total + delta,
      // so the sheet reads self-contained without the (bright, un-scrimmed) Total behind it.
      this.entry.loadLine = onBarLine(shown.total, targetKg, unit, atCap);
    } else {
      this.status.hidden = true;
      this.status.className = 'status'; // drop any prior state class/label while hidden
      this.statusLabel.textContent = '';
      this.over.hidden = true;
      this.over.textContent = '';
      this.entry.loadLine = null; // nothing decoded -> the keypad sheet hides the line
    }
  }

  // Reflect the active Primary unit on the kg|lb toggle, and disable it when the plate
  // set locks the unit (the iron set is lb-only -- ADR-0010).
  private renderUnitToggle(unit: Unit): void {
    const locked = plateSetFor(this._plateSetKey).unitLocked;
    this.unitButtons.forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.unit === unit));
      b.disabled = locked;
    });
  }

  // The Secondary readout: the same Total in the OTHER unit, or a "Show <unit>" prompt
  // when hidden (still tappable to bring it back). The lifter's choice persists.
  private renderSecondary(unit: Unit): void {
    const other: Unit = unit === 'kg' ? 'lb' : 'kg';
    const totalKgVal = encode(this.side, this.baselineKg());
    this.secondary.classList.toggle('off', !this.showSecondary);
    this.secondary.textContent = this.showSecondary
      ? format(totalKgVal, other)
      : `Show ${other}`;
    this.secondary.setAttribute(
      'aria-label',
      this.showSecondary ? `Hide ${other} readout` : `Show ${other} readout`,
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
    this.over.hidden = false;
    this.over.textContent = this.showingOver
      ? `Back to ${format(primary.total, unit)}`
      : `Round up to ${format(over.total, unit)} (+${fmtNum(dOver - dTarget)})`;
  }
}

// Strip floating-point fuzz and trailing zeros so a 0.5 kg miss reads "0.5", not
// "0.5000000001" or "0.50". Whole lb values pass through unchanged.
function fmtNum(n: number): string {
  return String(Number(n.toFixed(2)));
}

/** The state the Total status pill is in (RBAR-28). */
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
 *   Total below Target  -> "N short", or "Bar at capacity" when the Side is physically
 *                          full (`atCapacity`) so the miss cannot be closed
 *
 * Capacity only overrides the SHORT reading -- an over or exact Total is never masked.
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
  if (atCapacity) return { kind: 'capacity', label: 'Bar at capacity' };
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
  if (atCapacity) return `${head} (at capacity)`;
  return `${head} (${mag} under)`;
}

customElements.define('rack-console', RackConsole);
