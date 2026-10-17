// <rack-warmup> -- the Warm up mode's ramp block (RBAR-65 slice 2, Caitlin's Option D
// "Ramp stairs + Next"): one tappable stair per Ramp row, its height the loaded Total,
// then a full-width accent Next button naming the following set and what to change.
// A dumb view (ADR-0001): the console plans the Ramp (lib/plan.ts) and hands down a
// ready-made WarmupView (lib/warmup.ts); this element only draws it and reports which
// row the lifter picked, as a `warmupselect` event { index }. Back is a tap on an
// earlier stair; Left/Right (and Home/End) walk the stairs when focus is in them.
// With no view (no Working set yet) the stairs give way to a prompt and Next disables.
import { BOX_SIZING } from './boxsizing.ts';
import { BUTTON_FX } from './buttonfx.ts';
import { SHORT_SCREEN } from './fit.ts';
import { walkIndex } from '../lib/warmup.ts';
import type { WarmupView } from '../lib/warmup.ts';

// The stairs' height (normal and short-screen tier, ADR-0013) and the fixed parts of a
// stair inside it: the Total label above the bar, the name below, and their gaps. The
// bar takes the rest, scaled by the row's fraction of the Working Total.
export const STAIRS_PX = 84;
export const STAIRS_SHORT_PX = 66;
const LABELS_PX = 34;

class RackWarmup extends HTMLElement {
  private root: ShadowRoot = this.attachShadow({ mode: 'open' });
  private stairs!: HTMLElement;
  private prompt!: HTMLElement;
  private nextBtn!: HTMLButtonElement;
  private nextLabel!: HTMLElement;
  private nextSub!: HTMLElement;
  private _view: WarmupView | null = null;

  /** The Ramp to draw, or null for the no-Working-set prompt. */
  set view(v: WarmupView | null) {
    this._view = v;
    if (this.stairs) this.render();
  }
  get view(): WarmupView | null {
    return this._view;
  }

  connectedCallback(): void {
    this.root.innerHTML = `
      <style>
        ${BOX_SIZING}${BUTTON_FX}
        :host { display: flex; flex-direction: column; gap: 10px; }
        :host([hidden]) { display: none; }
        /* The stairs (mock option D): five equal columns, bars bottom-aligned, so the
           row of bars draws the Ramp's shape. Each stair is a full-height button. */
        .stairs {
          display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 6px;
          height: ${STAIRS_PX}px; margin: 0; padding: 0; list-style: none;
        }
        .stairs[hidden], .prompt[hidden] { display: none; }
        .st {
          display: flex; flex-direction: column; justify-content: flex-end;
          align-items: stretch; gap: 4px; height: 100%; min-width: 0;
          border: 0; background: transparent; padding: 0; cursor: pointer;
          color: var(--rack-text-secondary); font: inherit;
        }
        .st:focus-visible { outline: 2px solid var(--rack-accent); outline-offset: 2px; border-radius: 8px; }
        /* The Total above each stair: Hanken number + the small dim unit suffix
           (RBAR-39's numeric typography), never a bare numeral. */
        .tot {
          font-family: var(--rack-font); font-size: 12px; font-weight: 700;
          font-variant-numeric: tabular-nums; line-height: 1; white-space: nowrap;
          text-align: center; color: var(--rack-text-secondary);
        }
        .tot .u { font-size: 9px; font-weight: 600; color: var(--rack-text-dim); margin-left: 1px; }
        .st.wk .tot {
          color: var(--rack-text);
          text-decoration: underline; text-decoration-color: var(--rack-border-active);
          text-underline-offset: 3px;
        }
        .bar {
          height: calc(var(--f) * (100% - ${LABELS_PX}px)); min-height: 8px;
          border-radius: 7px 7px 3px 3px;
          background: var(--rack-selected); border: 1px solid var(--rack-border-active);
        }
        .nm {
          font-family: var(--rack-font-num); font-size: 10px; font-weight: 600;
          letter-spacing: .08em; text-transform: uppercase; line-height: 1;
          text-align: center; color: var(--rack-text-dim);
        }
        .st.past .bar { background: var(--rack-active); border-color: var(--rack-border-muted); }
        .st.past .tot { color: var(--rack-text-dim); }
        .st[aria-pressed="true"] .bar { background: var(--rack-accent); border-color: var(--rack-accent); }
        .st[aria-pressed="true"] .tot, .st[aria-pressed="true"] .nm,
        .st[aria-pressed="true"] .tot .u { color: var(--rack-accent); }
        /* The no-Working-set prompt holds the stairs' height, so entering a weight
           never moves the Next button. */
        .prompt {
          height: ${STAIRS_PX}px; display: flex; align-items: center; justify-content: center;
          border: 1px dashed var(--rack-border-muted); border-radius: var(--rack-radius-card);
          font-family: var(--rack-font); font-size: 14px; font-weight: 600;
          color: var(--rack-text-dim);
        }
        /* Next: the thumb-sized forward action (mock option D), 44px -- the touch
           floor -- on the accent pill; the delta rides as a small mono line. */
        /* A long delta (a swap) wraps under the label instead of being cut off: the
           two lines still fit the 44px pill. */
        .next {
          height: 44px; flex: none; display: flex; flex-wrap: wrap; align-content: center;
          align-items: baseline; justify-content: center;
          gap: 0 10px; padding: 0 14px; min-width: 0; line-height: 1.15;
          border: 0; border-radius: var(--rack-radius-pill); cursor: pointer;
          background: var(--rack-accent); color: var(--rack-accent-ink);
          font-family: var(--rack-font); font-size: 14px; font-weight: 700; white-space: nowrap;
        }
        .next small {
          font-family: var(--rack-font-num); font-size: 11px; font-weight: 600; opacity: .75;
          max-width: 100%; overflow: hidden; text-overflow: ellipsis;
        }
        .next small:empty { display: none; }
        .next:disabled { background: var(--rack-selected); color: var(--rack-text-dim); cursor: default; }
        .next:focus-visible { outline: 2px solid var(--rack-accent); outline-offset: 2px; }
        @media ${SHORT_SCREEN} {
          :host { gap: 8px; }
          .stairs, .prompt { height: ${STAIRS_SHORT_PX}px; }
        }
      </style>
      <div class="stairs" data-stairs role="group" aria-label="Warm-up sets" hidden></div>
      <div class="prompt" data-prompt>Enter your working weight</div>
      <button type="button" class="next" data-next disabled
        ><span data-next-label>Next</span><small data-next-sub></small></button>
    `;
    this.stairs = this.root.querySelector('[data-stairs]')!;
    this.prompt = this.root.querySelector('[data-prompt]')!;
    this.nextBtn = this.root.querySelector('[data-next]')!;
    this.nextLabel = this.root.querySelector('[data-next-label]')!;
    this.nextSub = this.root.querySelector('[data-next-sub]')!;

    this.stairs.addEventListener('click', (e) => {
      const st = (e.target as Element).closest<HTMLElement>('.st');
      if (st) this.select(Number(st.dataset.index));
    });
    this.stairs.addEventListener('keydown', (e) => {
      const v = this._view;
      if (!v) return;
      const to = walkIndex(v.selected, e.key, v.steps.length);
      if (to === null) return;
      e.preventDefault();
      this.select(to);
      this.stepEl(this._view?.selected ?? to)?.focus();
    });
    this.nextBtn.addEventListener('click', () => {
      const v = this._view;
      if (v && v.selected < v.steps.length - 1) this.select(v.selected + 1);
    });
    this.render();
  }

  private stepEl(i: number): HTMLButtonElement | null {
    return this.stairs.querySelector<HTMLButtonElement>(`.st[data-index="${i}"]`);
  }

  private select(index: number): void {
    this.dispatchEvent(
      new CustomEvent<{ index: number }>('warmupselect', {
        detail: { index },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private render(): void {
    const v = this._view;
    this.stairs.hidden = v === null;
    this.prompt.hidden = v !== null;
    if (v === null) {
      this.stairs.replaceChildren();
      this.nextBtn.disabled = true;
      this.nextLabel.textContent = 'Next';
      this.nextSub.textContent = '';
      return;
    }
    // Rebuild the stairs only when the row count changes, so a selection change keeps
    // the focused stair (arrow walking) in place.
    if (this.stairs.children.length !== v.steps.length) {
      this.stairs.innerHTML = v.steps
        .map(
          (_, i) => `<button type="button" class="st" data-index="${i}"
              ><span class="tot"><span data-num></span><span class="u" data-unit></span></span
              ><span class="bar" aria-hidden="true"></span
              ><span class="nm" data-name></span></button>`,
        )
        .join('');
    }
    v.steps.forEach((s, i) => {
      const b = this.stepEl(i)!;
      const on = i === v.selected;
      b.classList.toggle('past', i < v.selected);
      b.classList.toggle('wk', s.working);
      b.setAttribute('aria-pressed', String(on));
      if (on) b.setAttribute('aria-current', 'step');
      else b.removeAttribute('aria-current');
      // Roving focus: only the selected stair is in the Tab order; arrows move it.
      b.tabIndex = on ? 0 : -1;
      b.setAttribute('aria-label', s.label);
      b.style.setProperty('--f', String(s.fraction));
      b.querySelector('[data-num]')!.textContent = s.totalNum;
      b.querySelector('[data-unit]')!.textContent = ` ${s.totalUnit}`;
      b.querySelector('[data-name]')!.textContent = s.name;
    });
    this.nextBtn.disabled = v.next.disabled;
    this.nextLabel.textContent = v.next.label;
    this.nextSub.textContent = v.next.sub;
  }
}

customElements.define('rack-warmup', RackWarmup);
