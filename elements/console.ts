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
import './sleeve.ts';
import './recents.ts';
import { decode } from '../lib/decode.ts';
import { addPlate, encode, removePlate } from '../lib/encode.ts';
import { DEFAULT_BAR_KG, barWithCollars } from '../lib/plates.ts';
import { DEFAULT_COLLAR_KG } from './setup.ts';
import { readPersisted, writePersisted } from './persist.ts';
import { parseRecents, pushRecent, isRememberable } from '../lib/recents.ts';
import { plateSetFor, isOfferedPlateSet } from '../lib/platesets.ts';
import type { PlateSetKey } from '../lib/platesets.ts';
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
};
type Recents = HTMLElement & { targets: readonly number[]; unit: Unit };
type Palette = HTMLElement & { inventory: readonly Plate[] };
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
  private palette!: Palette;
  private sleeve!: Sleeve;
  private total!: HTMLElement;
  private secondary!: HTMLButtonElement;
  private delta!: HTMLElement;
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
        .readout output {
          display: block; font-family: var(--rack-font-num);
          font-size: clamp(28px, 9vw, 40px); font-weight: 600;
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
        <!-- Recent Targets: a quick-pick row under the entry, By-Weight mode only
             (RBAR-20). Hidden until the lifter has committed a Target. -->
        <rack-recents hidden></rack-recents>
        <rack-palette hidden></rack-palette>
        <rack-sleeve></rack-sleeve>
        <div class="readout">
          <div class="readhead">
            <span class="label">Total</span>
            <div class="units" role="group" aria-label="Display unit">
              <button type="button" data-unit="kg" aria-pressed="true">kg</button>
              <button type="button" data-unit="lb" aria-pressed="false">lb</button>
            </div>
          </div>
          <output data-total>${DEFAULT_BAR_KG} kg</output>
          <button type="button" class="secondary" data-secondary></button>
          <span class="delta" data-delta hidden></span>
        </div>
        <button type="button" class="over" data-over hidden></button>
      </div>
    `;
    this.entry = this.root.querySelector('rack-entry') as Entry;
    this.recentsRow = this.root.querySelector('rack-recents') as Recents;
    this.palette = this.root.querySelector('rack-palette') as Palette;
    this.sleeve = this.root.querySelector('rack-sleeve') as Sleeve;
    this.total = this.root.querySelector('[data-total]')!;
    this.secondary = this.root.querySelector('[data-secondary]')!;
    this.delta = this.root.querySelector('[data-delta]')!;
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
    this.total.textContent = format(encode(this.side, this.baselineKg()), unit);
    this.renderUnitToggle(unit);
    this.renderSecondary(unit);
    this.entry.hidden = this.mode !== 'decode';
    // The Recent row is a By-Weight (Decode) affordance: shown only there, and only once
    // there is something to show (the row also self-hides when empty -- ADR-0009).
    this.recentsRow.hidden = this.mode !== 'decode' || this.recents.length === 0;
    this.palette.hidden = this.mode !== 'encode';
    this.modeButtons.forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.mode === this.mode)),
    );

    // The delta note and over opt-in are Decode-only, and only once a Target is typed.
    // Both read off the DISPLAYED numbers in the active unit (ADR-0010 displayed-unit
    // exactness): in kg this reduces to the raw delta, in lb it keeps "exact/under/over"
    // honest to what is on screen.
    if (this.mode === 'decode' && this.decoded) {
      const { primary, over } = this.decoded;
      const shown = this.showingOver && over ? over : primary;
      const targetKg = primary.total - primary.delta;
      this.renderDelta(shown, targetKg, shown === over, unit);
      this.renderOver(over ?? null, primary, targetKg, unit);
    } else {
      this.delta.hidden = true;
      this.delta.textContent = '';
      this.over.hidden = true;
      this.over.textContent = '';
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

  // The delta note, keyed off the DISPLAYED numbers (ADR-0010). Compare the shown Total
  // to the Target in the active unit: equal -> displayed-exact, hidden; shown under ->
  // "N under target"; shown over -> the over-target option ("N over target") or, for the
  // primary, the sub-baseline floor (the Target sits below the bare rig).
  private renderDelta(shown: Loadout, targetKg: number, isOver: boolean, unit: Unit): void {
    const dTarget = shownIn(targetKg, unit);
    const dShown = shownIn(shown.total, unit);
    if (dShown === dTarget) {
      this.delta.hidden = true;
      this.delta.textContent = '';
      return;
    }
    this.delta.hidden = false;
    if (dShown < dTarget) {
      this.delta.textContent = `${fmtNum(dTarget - dShown)} ${unit} under target`;
    } else if (isOver) {
      this.delta.textContent = `${fmtNum(dShown - dTarget)} ${unit} over target`;
    } else {
      // The primary sits above the Target: the Target is below the bare rig (the floor).
      // With collars on, the floor is Bar + 2 x collar, so name that baseline (ADR-0008),
      // shown in the active unit so it is truthful about what the lifter can't go under.
      this.delta.textContent =
        this._collarKg > 0
          ? `below the Bar + Collars (${format(this.baselineKg(), unit)})`
          : `below the ${format(this._barKg, unit)} Bar`;
    }
  }

  // The over-target opt-in control (ADR-0003), in the active unit. Absent in Encode, when
  // there is no over option, when the primary already DISPLAYS exact (a sub-display-unit
  // miss the lifter can't feel -- ADR-0010), or when rounding up would not change the
  // displayed Total. Otherwise it offers the other Loadout: round up to over while on
  // primary, or drop back to primary while on over -- so the lifter can step either way.
  private renderOver(
    over: Loadout | null,
    primary: Loadout,
    targetKg: number,
    unit: Unit,
  ): void {
    const dTarget = shownIn(targetKg, unit);
    const dPrimary = shownIn(primary.total, unit);
    const dOver = over ? shownIn(over.total, unit) : dPrimary;
    if (over === null || dPrimary === dTarget || dOver === dPrimary) {
      this.over.hidden = true;
      this.over.textContent = '';
      return;
    }
    this.over.hidden = false;
    this.over.textContent = this.showingOver
      ? `Back to ${format(primary.total, unit)} (under target)`
      : `Round up to ${format(over.total, unit)} (+${fmtNum(dOver - dTarget)})`;
  }
}

// Strip floating-point fuzz and trailing zeros so a 0.5 kg miss reads "0.5", not
// "0.5000000001" or "0.50". Whole lb values pass through unchanged.
function fmtNum(n: number): string {
  return String(Number(n.toFixed(2)));
}

customElements.define('rack-console', RackConsole);
