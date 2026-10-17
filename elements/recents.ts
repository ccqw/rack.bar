// <rack-recents> -- the Recent Targets chip row (RBAR-20, fidelity RBAR-37). In
// By-Weight (Decode) mode it shows the lifter's recent Targets as a horizontally
// scrolling row of chips; tapping one re-applies it. A controlled, stateless shell
// (ADR-0001): it owns no history of its own, it renders the `targets` list the
// console feeds it and emits `recentapply` when a chip is tapped -- one property
// down, one event up, the same shape as the Setup tiles (ADR-0007). The console owns
// the list, its persistence, and its dedupe/cap (lib/recents, ADR-0009).
//
// Targets are kilograms (the canonical store, ADR-0006/0009); the chip faces render
// in the console's active display Unit (RBAR-17, ADR-0010) WITH the unit as a small
// dim suffix (RBAR-58: units on every number -- the handoff's bare sRecentChip leaned
// on the Target block's unit, and that block is gone).
// The `data-target` stays canonical kg, so re-apply is Unit-agnostic; only the
// visible face and aria change Unit. The chip naming the current Target (the
// `target` property, near-equal within the prototype's epsilon) reads selected;
// tapping a chip moves the highlight there at once -- the tapped Target IS the new
// current one -- and the console's round-trip confirms it. The rail wears the shared
// overflow nudge arrows (elements/nudge.ts), the same affordance as the loaded-chips
// rail.
//
// Removing a Recent (RBAR-73, ADR-0009 amendment) costs no rail space -- there is no x
// on a chip. A long-press (LONG_PRESS_MS, holding within MOVE_SLOP_PX) opens a
// one-item "Remove" popover on the chip; the context-menu key, Shift+F10 or a
// right-click open the same popover, and Delete/Backspace on a focused chip removes it
// outright. The element only emits the intent (`recentremove`, and `recentrestore`
// for Undo); the console applies it with the pure core and feeds the list back. Each
// removed chip's slot then holds its own Undo chip, locked to the chip's width -- in
// place, inside the rail, so no row is added (ADR-0013) and nothing moves while the
// lifter is cleaning up. One shared timer (UNDO_MS, restarted by every removal) ends
// the window, and then every pending slot collapses together (COLLAPSE_MS): the only
// moment chips move. Those frozen slots are the only state this element keeps of its
// own, and it is UI state, not history.
import { format, shownIn } from '../lib/units.ts';
import type { Unit } from '../lib/units.ts';
import { BOX_SIZING } from './boxsizing.ts';
import { BUTTON_FX } from './buttonfx.ts';
import { NUDGE_BUTTONS, NUDGE_STYLE, wireNudges } from './nudge.ts';
import type { NudgeRail } from './nudge.ts';
import { SECTION_LABEL, VISUALLY_HIDDEN } from './sectionlabel.ts';

// A chip reads selected when it names the current Target to within the prototype's
// near-equality (engine L851: |target - chip| < 0.05 kg) -- floats from lb<->kg
// round-trips are the same Target, a real 0.5 kg step is not. A chip that READS the same
// as the Target in the display Unit also matches (RBAR-60): an Exact unit toggle can
// re-express the Target as its load (56 lb typed = 25.40 kg; the 25.5 kg load reads
// 56 lb too), and the lifter sees one Target, so the chip stays lit.
const ACTIVE_EPS = 0.05;

/** How long a still press must last to open the Remove popover (the iOS-familiar
 * long-press, RBAR-73). A tap releases well before this, so tap-to-load is untouched. */
export const LONG_PRESS_MS = 500;
/** How far (px, either axis) a press may wander and still count as holding still.
 * Past this it is a rail scroll, and the hold is dropped -- scrolling never removes. */
export const MOVE_SLOP_PX = 8;
/** How long the Undo slots stay after the LAST removal before the removals are final.
 * Each removal resets it, so nothing in the rail moves while the lifter is cleaning up. */
export const UNDO_MS = 5000;
/** The one moment chips move: the pending Undo slots collapse together (width + fade). */
export const COLLAPSE_MS = 200;
// The hold fill starts this long into a press, so a quick tap never flashes it; it then
// sweeps for the rest of LONG_PRESS_MS (the CSS transition below is the remainder).
const HOLD_FILL_DELAY_MS = 150;

const HINT_ID = 'recents-remove-hint';

class RackRecents extends HTMLElement {
  private root: ShadowRoot = this.attachShadow({ mode: 'open' });
  private rail!: HTMLElement;
  private menuEl!: HTMLElement;
  private menuRemove!: HTMLButtonElement;
  private announcer!: HTMLElement;
  private nudges?: NudgeRail;

  private _targets: readonly number[] = [];
  private _unit: Unit = 'kg';
  private _target: number | null = null;

  // The live long-press: where it started and its two timers (the fill, the popover).
  private hold: {
    chip: HTMLButtonElement;
    x: number;
    y: number;
    fill: ReturnType<typeof setTimeout>;
    fire: ReturnType<typeof setTimeout>;
  } | null = null;
  // Set when a long-press opened the popover, so the click its release fires does not
  // also load the Target. Cleared by that click or by the next press.
  private suppressClick = false;
  // The Target (kg) the open popover acts on, or null while it is closed.
  private menuFor: number | null = null;
  // The frozen rail while removals are pending (RBAR-73 rev): every chip that was on
  // screen when the cleanup began, in order, each either live or removed (an Undo slot).
  // The live slots, in order, are always exactly `_targets` -- so a slot's list index is
  // the count of live slots before it. Null when nothing is pending.
  // `fresh` marks the slot removed last: only its Undo fades in, so a re-render (each
  // removal renders, and so does every keystroke's Target feed) never re-blinks the
  // Undos already showing.
  private slots: { kg: number; removed: boolean; width: number; fresh: boolean }[] | null =
    null;
  // The shared lapse timer (reset by every removal) and the collapse in flight.
  private undoTimer: ReturnType<typeof setTimeout> | undefined;
  private collapseTimer: ReturnType<typeof setTimeout> | undefined;
  private collapsing = false;
  // True while this element's own remove/restore event is being dispatched: the owner
  // echoes the new list back synchronously, and that echo must not retire the Undo the
  // way an unrelated new history (a fresh commit) does.
  private echoing = false;

  /** The recent Targets to show, most-recent-first (kg). Assigning re-renders the row
   * and hides the element entirely when the history is empty (no stray empty rail).
   * A new history from anywhere but this element's own remove/restore (a commit, a chip
   * tap) finalizes the pending removals: their slots collapse (the same transition as a
   * lapse), then the new list shows. */
  set targets(list: readonly number[]) {
    const finalize = this.slots !== null && !this.echoing && list !== this._targets;
    this._targets = list;
    if (finalize) this.startCollapse();
    else if (this.rail) this.renderChips();
  }
  get targets(): readonly number[] {
    return this._targets;
  }

  /** True while an Undo chip is showing. The owner keeps the row up for it even when
   * the history itself is empty (the last chip was just removed). */
  get undoPending(): boolean {
    return this.slots !== null;
  }

  /** The display Unit the chip faces read in (the store stays kg). Re-renders.
   * Unchanged values return early: the console re-feeds every property on each of
   * its renders, and an echoed write must not rebuild (and re-scroll) the rail. */
  set unit(u: Unit) {
    if (u === this._unit) return;
    this._unit = u;
    if (this.rail) this.renderChips();
  }
  get unit(): Unit {
    return this._unit;
  }

  /** The current Target (kg) or null. The chip naming it (within ACTIVE_EPS) gets the
   * selected treatment; a tap moves it locally, this property is the console's say. */
  set target(kg: number | null) {
    if (kg === this._target) return;
    this._target = kg;
    if (this.rail) this.renderChips();
  }
  get target(): number | null {
    return this._target;
  }

  // While the popover is open, a press anywhere outside it closes it (no removal).
  private onDocPointer = (e: Event): void => {
    if (!e.composedPath().includes(this.menuEl)) this.closeMenu(false);
  };

  connectedCallback(): void {
    this.root.innerHTML = `
      <style>
        ${BOX_SIZING}${BUTTON_FX}
        /* The row (handoff L162): the Recent label sits inline at the LEFT of the
           scroll viewport -- flex, gap 9px -- not stacked above it. Relative: the
           Remove popover anchors to the row. */
        :host { position: relative; display: flex; align-items: center; gap: 9px; }
        :host([hidden]) { display: none; }
        .sr { ${VISUALLY_HIDDEN} }
        /* An h2 since RBAR-53 (heading navigation); margin pinned over the UA default. */
        .label { flex: none; ${SECTION_LABEL} margin: 0; }
        /* The scroll viewport: the relative anchor the nudge arrows overlay. */
        .viewport { position: relative; flex: 1; min-width: 0; }
        .rail {
          display: flex; gap: 6px; overflow-x: auto;
          padding: 1px 0; scrollbar-width: none; -webkit-overflow-scrolling: touch;
        }
        .rail::-webkit-scrollbar { display: none; }
        /* A chip: a tappable recent Target. The visible pill is the inner .face
           (prototype sRecentChip L410: mono 600 12px, .04em, pad 7px 13px, hairline,
           inactive ink text-dim); the button around it is a transparent >=44px hit
           area, keeping the RBAR-20 touch floor without inflating the pill. The iOS
           long-press callout is off: the long-press is ours (RBAR-73). */
        .chip, .undo {
          flex: none; display: inline-flex; align-items: center; justify-content: center;
          min-height: 44px; min-width: 44px; padding: 0; cursor: pointer;
          background: transparent; border: none; -webkit-touch-callout: none;
        }
        .face {
          position: relative; isolation: isolate; overflow: hidden;
          display: flex; align-items: center; white-space: nowrap; padding: 7px 13px;
          font-family: var(--rack-font-num); font-size: 12px; font-weight: 600;
          letter-spacing: .04em; color: var(--rack-text-dim); background: transparent;
          border: 1px solid var(--rack-border); border-radius: var(--rack-radius-pill);
          transition: background-color .16s ease, border-color .16s ease, color .16s ease;
        }
        /* The unit suffix (RBAR-58): smaller and dimmer than the number, so the chip
           still reads value-first (the hero's .tu, at chip size). */
        .face .fu {
          margin-left: 3px; font-size: 10px; font-weight: 500; color: var(--rack-text-dim);
        }
        .chip.selected .face .fu { color: var(--rack-text-secondary); }
        .chip:hover .face { border-color: var(--rack-border-active); }
        .chip:focus-visible, .undo:focus-visible { outline: none; }
        .chip:focus-visible .face, .undo:focus-visible .face {
          outline: 2px solid var(--rack-accent); outline-offset: 2px;
        }
        /* The chip naming the current Target (prototype sRecentChip(on)): selected
           fill, active ring, full-bright ink. */
        .chip.selected .face {
          background: var(--rack-selected); border-color: var(--rack-border-active);
          color: var(--rack-text);
        }
        /* The press-and-hold fill (RBAR-73): a faint accent wash sweeps across the pill
           over the rest of the long-press, so the gesture can be discovered and the
           lifter sees it coming. Behind the numeral (isolation + z-index -1). Reduced
           motion gets the same wash as a fade, with no sweep. */
        .chip .face::before {
          content: ''; position: absolute; inset: 0; z-index: -1;
          background: color-mix(in srgb, var(--rack-accent) 22%, transparent);
          transform: scaleX(0); transform-origin: left center;
        }
        .chip.holding .face { border-color: var(--rack-border-active); color: var(--rack-text); }
        .chip.holding .face::before {
          transform: scaleX(1);
          transition: transform ${LONG_PRESS_MS - HOLD_FILL_DELAY_MS}ms linear;
        }
        @media (prefers-reduced-motion: reduce) {
          .chip .face::before { transform: none; opacity: 0; }
          .chip.holding .face::before {
            opacity: 1; transition: opacity ${LONG_PRESS_MS - HOLD_FILL_DELAY_MS}ms linear;
          }
        }
        /* The Undo chip: the removed chip's slot, in the accent (the primary-action
           colour) so the way back reads at a glance. Its width is locked inline to the
           removed chip's, and the pill fills it with a tight inset, so "Undo" fits even a
           two-digit chip's 44px and no neighbour ever shifts while removals are pending. */
        .undo { overflow: hidden; }
        .undo .face {
          width: 100%; justify-content: center; padding: 7px 4px;
          font-family: var(--rack-font); letter-spacing: .02em;
          color: var(--rack-accent);
          border-color: color-mix(in srgb, var(--rack-accent) 55%, transparent);
          background: color-mix(in srgb, var(--rack-accent) 10%, transparent);
        }
        /* Only the slot just removed fades in (see slots.fresh). */
        .undo.fresh .face { animation: rack-undo-in .16s ease; }
        @keyframes rack-undo-in { from { opacity: 0; } to { opacity: 1; } }
        /* The one moment chips move: every pending Undo slot collapses together once the
           lifter has stopped (width + fade, ease-out). The negative margin eats the rail
           gap so the last frame lands exactly where the plain list will. Reduced motion
           never gets here -- the element skips straight to the plain list. */
        .undo.collapsing {
          width: 0 !important; min-width: 0; margin-right: -6px; opacity: 0;
          transition: width ${COLLAPSE_MS}ms ease-out, min-width ${COLLAPSE_MS}ms ease-out,
                      margin-right ${COLLAPSE_MS}ms ease-out, opacity ${COLLAPSE_MS}ms ease-out;
        }
        .undo.collapsing .face { animation: none; }
        /* The Remove popover: a raised card on the RBAR-34 popover tokens, anchored
           above the pressed chip so it covers the entry for a moment rather than adding
           a row. Entrance: a fade for everyone, the lift for no-preference. */
        @keyframes rack-pop-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes rack-pop-up {
          from { opacity: 0; transform: translate(-50%, 6px) scale(.97); }
          to { opacity: 1; transform: translate(-50%, 0); }
        }
        .menu {
          position: absolute; bottom: calc(100% + 2px); left: 50%; z-index: 30;
          transform: translateX(-50%); padding: 4px;
          background: var(--rack-overlay);
          border: 1px solid var(--rack-popover-border);
          border-radius: var(--rack-radius-sheet-control);
          box-shadow: var(--rack-shadow-modal);
          animation: rack-pop-fade .16s cubic-bezier(.2, .85, .25, 1);
        }
        @media (prefers-reduced-motion: no-preference) {
          .menu { animation: rack-pop-up .16s cubic-bezier(.2, .85, .25, 1); }
        }
        .menu[hidden] { display: none; }
        .menu button {
          display: flex; align-items: center; gap: 8px;
          min-height: 44px; padding: 0 16px; cursor: pointer;
          font-family: var(--rack-font); font-size: 13px; font-weight: 600;
          color: var(--rack-danger); background: transparent; border: none;
          border-radius: calc(var(--rack-radius-sheet-control) - 4px);
          white-space: nowrap;
        }
        .menu button:hover { background: var(--rack-active); }
        .menu button:focus-visible { outline: 2px solid var(--rack-accent); outline-offset: -2px; }
        .menu svg { display: block; }
        ${NUDGE_STYLE}
      </style>
      <h2 class="label">Recent</h2>
      <div class="viewport">
        <div class="rail" data-rail role="list" aria-label="Recent Targets"></div>
        ${NUDGE_BUTTONS}
      </div>
      <div class="menu" data-menu role="menu" hidden>
        <button type="button" role="menuitem" data-menu-remove
          ><svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"
                  stroke="currentColor" stroke-width="1.5"
                  stroke-linecap="round" stroke-linejoin="round"></path>
          </svg>Remove</button>
      </div>
      <span class="sr" id="${HINT_ID}">Press and hold, or press Delete, to remove.</span>
      <div class="sr" data-recents-announce role="status"></div>
    `;
    this.rail = this.root.querySelector('[data-rail]')!;
    this.menuEl = this.root.querySelector('[data-menu]')!;
    this.menuRemove = this.root.querySelector('[data-menu-remove]')!;
    this.announcer = this.root.querySelector('[data-recents-announce]')!;
    this.nudges = wireNudges(this.rail, this.root);
    this.wireRail();
    this.menuRemove.addEventListener('click', () => {
      const kg = this.menuFor;
      if (kg === null) return;
      this.closeMenu(false);
      this.removeTarget(kg);
    });
    this.menuEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation(); // an open keypad must not also read it as Done
        this.closeMenu(true);
      }
    });
    // Keyboard focus moving on (Tab) closes the popover, per the ARIA menu pattern. Only
    // a focus that lands on a real element outside counts: a null relatedTarget is a
    // blur to the page (Safari blurs on a tap of a button), and that must not close the
    // menu between the press and the click on Remove. Outside taps close it anyway.
    this.menuEl.addEventListener('focusout', (e) => {
      const next = e.relatedTarget;
      if (next instanceof Node && !this.menuEl.contains(next)) this.closeMenu(false);
    });
    this.renderChips();
  }

  disconnectedCallback(): void {
    this.nudges?.disconnect();
    this.nudges = undefined;
    this.cancelHold();
    this.closeMenu(false);
    this.clearPending();
  }

  // Render the rail. With nothing pending: one chip per Target. While removals are
  // pending: the frozen slots, each live chip as itself and each removed one as an Undo
  // chip locked to the removed chip's width, so no neighbour shifts. Nothing pending and
  // no Targets -> hide the whole element (no bare "Recent" label or empty rail). The face
  // is the number with its unit suffix (RBAR-58); the accessible name is the action.
  private renderChips(): void {
    // Mid-collapse the slots are animating shut: a rebuild would restart them at width 0
    // (a snap, the very jump the collapse exists to avoid). finishCollapse renders the
    // plain list -- with any selection or new history that arrived -- within COLLAPSE_MS.
    if (this.collapsing) return;
    this.hidden = this._targets.length === 0 && this.slots === null;
    // Preserve the horizontal scroll position across the re-render (as loaded.ts
    // does): replacing innerHTML resets scrollLeft to 0, which would yank a
    // nudged-along rail back to the newest end whenever the console re-renders.
    const scrollLeft = this.rail.scrollLeft;
    const slots =
      this.slots ?? this._targets.map((kg) => ({ kg, removed: false, width: 0, fresh: false }));
    this.rail.innerHTML = slots
      .map(({ kg, removed, width, fresh }, i) => {
        if (removed) {
          const w = width > 0 ? ` style="width:${width}px"` : '';
          return `
        <button type="button" class="undo${fresh ? ' fresh' : ''}"
                role="listitem" data-undo data-slot="${i}"${w}
                aria-label="Undo remove ${format(kg, this._unit)}"><span
                class="face">Undo</span></button>`;
        }
        const on =
          this._target !== null &&
          (Math.abs(kg - this._target) < ACTIVE_EPS ||
            shownIn(kg, this._unit) === shownIn(this._target, this._unit));
        return `
        <button type="button" class="chip${on ? ' selected' : ''}" role="listitem"
                data-target="${kg}"${on ? ' aria-current="true"' : ''}
                aria-label="Set Target to ${format(kg, this._unit)}"
                aria-describedby="${HINT_ID}" aria-keyshortcuts="Delete"><span
                class="face">${shownIn(kg, this._unit)}<span
                class="fu"> ${this._unit}</span></span></button>`;
      })
      .join('');
    this.rail.scrollLeft = scrollLeft;
    this.nudges?.measure();
  }

  // One set of delegated listeners on the rail (it outlives every chip re-render):
  // tap-to-load, the long-press, the context menu, Delete/Backspace and Undo.
  private wireRail(): void {
    const chipOf = (e: Event): HTMLButtonElement | null =>
      (e.target as Element | null)?.closest?.<HTMLButtonElement>('[data-target]') ?? null;

    this.rail.addEventListener('click', (e) => {
      const undo = (e.target as Element | null)?.closest?.<HTMLElement>('[data-undo]');
      if (undo) {
        this.restoreTarget(Number(undo.dataset.slot));
        return;
      }
      const chip = chipOf(e);
      if (!chip) return;
      if (this.suppressClick) {
        this.suppressClick = false; // the release of a long-press, not a tap
        return;
      }
      this.apply(Number(chip.dataset.target));
    });

    this.rail.addEventListener('pointerdown', (e) => {
      this.suppressClick = false;
      const chip = chipOf(e);
      if (!chip || e.button !== 0) return;
      this.cancelHold();
      this.hold = {
        chip,
        x: e.clientX,
        y: e.clientY,
        fill: setTimeout(() => chip.classList.add('holding'), HOLD_FILL_DELAY_MS),
        fire: setTimeout(() => {
          this.cancelHold();
          this.suppressClick = true;
          this.openMenu(chip);
        }, LONG_PRESS_MS),
      };
    });
    // Movement past the slop is a scroll (or a drag), never a long-press.
    this.rail.addEventListener('pointermove', (e) => {
      if (!this.hold) return;
      const { x, y } = this.hold;
      if (Math.abs(e.clientX - x) > MOVE_SLOP_PX || Math.abs(e.clientY - y) > MOVE_SLOP_PX) {
        this.cancelHold();
      }
    });
    // A release, a browser-claimed gesture (pointercancel: it became a pan) or the rail
    // actually scrolling all end the hold.
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
      this.rail.addEventListener(type, () => this.cancelHold());
    }
    // The click a long-press release fires (if any) is dispatched right after its
    // pointerup, so the swallow flag only needs to outlive that task. iOS often sends no
    // click after a long hold; without this a stale flag would eat the next keyboard
    // activation (Enter/Space fire a click with no pointerdown to reset it).
    this.rail.addEventListener('pointerup', () => {
      if (this.suppressClick) setTimeout(() => (this.suppressClick = false), 0);
    });
    this.rail.addEventListener('scroll', () => this.cancelHold(), { passive: true });

    // The non-gesture route to the same popover: the context-menu key, Shift+F10 and a
    // right-click all fire contextmenu. On Android a long-press fires it too (alongside
    // our timer); the native menu and the iOS callout are suppressed either way.
    this.rail.addEventListener('contextmenu', (e) => {
      const chip = chipOf(e);
      if (!chip) return;
      e.preventDefault();
      if (this.hold) {
        this.cancelHold();
        this.suppressClick = true; // a touch long-press: its release is not a tap
      }
      if (this.menuFor !== Number(chip.dataset.target) || this.menuEl.hidden) {
        this.openMenu(chip);
      }
    });

    // Delete/Backspace on a focused chip removes it at once (RBAR-73, pairing with the
    // RBAR-49 keyboard work). Claimed and stopped here, so an open keypad's document
    // listener never also reads Backspace as deleting a digit -- on the Undo chip too,
    // where focus lands after a removal, so a held key's auto-repeat cannot eat Target
    // digits. A repeat never removes: one held key removes one chip.
    this.rail.addEventListener('keydown', (e) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const onUndo = (e.target as Element | null)?.closest?.('[data-undo]');
      const chip = chipOf(e);
      if (!chip && !onUndo) return;
      e.preventDefault();
      e.stopPropagation();
      if (chip && !e.repeat) this.removeTarget(Number(chip.dataset.target));
    });
  }

  private cancelHold(): void {
    if (!this.hold) return;
    clearTimeout(this.hold.fill);
    clearTimeout(this.hold.fire);
    this.hold.chip.classList.remove('holding');
    this.hold = null;
  }

  // Open the Remove popover over `chip`, centred on it but kept inside the row, and move
  // focus to Remove (a keyboard or screen-reader user lands on the action; on touch the
  // focus ring stays hidden, :focus-visible).
  private openMenu(chip: HTMLButtonElement): void {
    const kg = Number(chip.dataset.target);
    this.menuFor = kg;
    this.menuEl.setAttribute('aria-label', `Recent ${format(kg, this._unit)}`);
    this.menuEl.hidden = false;
    const host = this.getBoundingClientRect();
    const c = chip.getBoundingClientRect();
    const half = this.menuEl.offsetWidth / 2;
    const centre = c.left + c.width / 2 - host.left;
    const left = Math.min(Math.max(centre, half), Math.max(half, host.width - half));
    this.menuEl.style.left = `${left}px`;
    this.menuRemove.focus();
    document.addEventListener('pointerdown', this.onDocPointer, true);
  }

  // Close the popover. `refocus` returns focus to the chip it was opened on (Escape);
  // an outside tap leaves focus where the lifter put it.
  private closeMenu(refocus: boolean): void {
    if (this.menuFor === null) return;
    const kg = this.menuFor;
    this.menuFor = null;
    this.suppressClick = false; // a closed popover has no pending release to swallow
    this.menuEl.hidden = true;
    document.removeEventListener('pointerdown', this.onDocPointer, true);
    if (refocus) this.chipFor(kg)?.focus();
  }

  private chipFor(kg: number): HTMLButtonElement | undefined {
    return [...this.rail.querySelectorAll<HTMLButtonElement>('[data-target]')].find(
      (c) => Number(c.dataset.target) === kg,
    );
  }

  // Remove `kg`: tell the console (it owns the list and its persistence, ADR-0009), turn
  // the chip's slot into its own Undo (locked to the chip's width), focus that Undo, and
  // restart the shared timer. Earlier pending Undos stay exactly where they are.
  private removeTarget(kg: number): void {
    if (this.collapsing) this.finishCollapse(); // a removal right as the slots collapse
    if (!this._targets.includes(kg)) return;
    this.slots ??= this._targets.map((t) => ({ kg: t, removed: false, width: 0, fresh: false }));
    for (const sl of this.slots) sl.fresh = false;
    const at = this.slots.findIndex((sl) => sl.kg === kg && !sl.removed);
    if (at < 0) return;
    const slot = this.slots[at];
    slot.removed = true;
    slot.fresh = true;
    // The exact (sub-pixel) width: a rounded offsetWidth would nudge neighbours by 1px.
    slot.width = this.chipFor(kg)?.getBoundingClientRect().width ?? 0;
    clearTimeout(this.undoTimer);
    this.undoTimer = setTimeout(() => this.startCollapse(), UNDO_MS);
    this.emit('recentremove', kg, this.liveIndex(at));
    this.renderChips();
    this.undoAt(at)?.focus();
    this.announcer.textContent = `Removed ${format(kg, this._unit)}`;
  }

  // Undo one slot: hand its Target back to the console at its list index (the live slots
  // before it), make the slot live again, and focus the restored chip. The other pending
  // Undos and the shared timer are untouched; the last restore ends the cleanup.
  private restoreTarget(at: number): void {
    const slot = this.slots?.[at];
    if (!slot || !slot.removed || this.collapsing) return;
    const index = this.liveIndex(at);
    slot.removed = false;
    slot.fresh = false;
    if (!this.slots!.some((sl) => sl.removed)) this.clearPending();
    this.emit('recentrestore', slot.kg, index);
    this.renderChips();
    this.chipFor(slot.kg)?.focus();
    this.announcer.textContent = `Restored ${format(slot.kg, this._unit)}`;
  }

  // The list index of slot `at`: how many live slots sit before it.
  private liveIndex(at: number): number {
    return this.slots!.slice(0, at).filter((sl) => !sl.removed).length;
  }

  private undoAt(at: number): HTMLButtonElement | null {
    return this.rail.querySelector<HTMLButtonElement>(`[data-undo][data-slot="${at}"]`);
  }

  // The removals are final (the timer lapsed, or a new history arrived): collapse every
  // Undo slot together -- width and opacity over COLLAPSE_MS -- then show the plain list.
  // This is the only moment chips move, and it comes after the lifter has stopped.
  // Reduced motion skips straight to the end.
  private startCollapse(): void {
    if (this.slots === null || this.collapsing) {
      if (this.rail) this.renderChips(); // a no-op mid-collapse (see renderChips)
      return;
    }
    clearTimeout(this.undoTimer);
    if (!this.rail || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.finishCollapse();
      return;
    }
    this.collapsing = true;
    const undos = this.rail.querySelectorAll<HTMLElement>('[data-undo]');
    // Pin each slot's current width so the transition has a start, then collapse.
    undos.forEach((u) => (u.style.width = `${u.getBoundingClientRect().width}px`));
    void this.rail.offsetWidth;
    undos.forEach((u) => u.classList.add('collapsing'));
    this.collapseTimer = setTimeout(() => this.finishCollapse(), COLLAPSE_MS);
  }

  // Show the plain list. Never UN-hide a row the owner hid meanwhile (the console hides
  // it in By Plates; renderChips only knows emptiness). Keyboard focus that sat on an
  // Undo moves to the chip now nearest its slot rather than falling to the page.
  private finishCollapse(): void {
    const focused = this.root.activeElement as HTMLElement | null;
    const at = focused?.hasAttribute('data-undo') ? Number(focused.dataset.slot) : -1;
    const index = at >= 0 && this.slots ? this.liveIndex(at) : -1;
    this.clearPending();
    if (!this.rail) return;
    const wasHidden = this.hidden;
    this.renderChips();
    if (wasHidden) this.hidden = true;
    if (index >= 0) {
      const chips = this.rail.querySelectorAll<HTMLButtonElement>('[data-target]');
      chips[Math.min(index, chips.length - 1)]?.focus();
    }
  }

  private clearPending(): void {
    clearTimeout(this.undoTimer);
    clearTimeout(this.collapseTimer);
    this.undoTimer = undefined;
    this.collapseTimer = undefined;
    this.slots = null;
    this.collapsing = false;
  }

  private emit(type: 'recentremove' | 'recentrestore', target: number, index: number): void {
    this.echoing = true;
    try {
      this.dispatchEvent(
        new CustomEvent<{ target: number; index: number }>(type, {
          detail: { target, index },
          bubbles: true,
          composed: true,
        }),
      );
    } finally {
      this.echoing = false;
    }
  }

  // A chip tap names the chosen Target to the console; the console re-applies it (and
  // re-remembers it, moving it to the front) -- one event up (ADR-0009). The highlight
  // moves first: the tapped chip is the current Target by definition, so the selected
  // state must not wait on (or drift from) the console's round-trip.
  private apply(target: number): void {
    this._target = target;
    this.renderChips();
    this.dispatchEvent(
      new CustomEvent<{ target: number }>('recentapply', {
        detail: { target },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

customElements.define('rack-recents', RackRecents);
