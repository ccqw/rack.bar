// <rack-rest-dock> -- the Rest timer's bottom dock (RBAR-94, Caitlin's direction B;
// ADR-0019). A 60px bar pinned to the bottom of the screen (54px on a short one) while a
// Rest shows: a progress track on its top edge, a mini ring and the time (a tap opens
// the timer screen), then the four presets. At zero the whole dock turns yellow and
// counts the overtime up ("+0:12"); a tap restarts the last Rest and the x clears it.
//
// A dumb view over the RestClock (elements/restclock.ts): it reads the clock and calls
// it, and says `restopen` (bubbling) when the time is tapped. <rack-rest> owns both.
// The dock never covers the column: <rack-app> reserves its height while it shows
// (ADR-0019), so the bar block flexes instead (ADR-0013).
import { BOX_SIZING } from './boxsizing.ts';
import { BUTTON_FX } from './buttonfx.ts';
import { SHORT_SCREEN } from './fit.ts';
import { REST_PRESETS, formatClock } from '../lib/rest.ts';
import type { RestClock } from './restclock.ts';
import { PAUSE_GLYPH, RESTART_GLYPH, X_GLYPH, NARROW_SCREEN } from './restglyphs.ts';

/** The dock's height, and on a short screen (fit.ts SHORT_SCREEN). <rack-app> reserves it. */
export const DOCK_PX = 60;
export const DOCK_SHORT_PX = 54;

class RackRestDock extends HTMLElement {
  private root: ShadowRoot = this.attachShadow({ mode: 'open' });
  private _clock: RestClock | null = null;
  private dock!: HTMLElement;
  private live!: HTMLElement;
  private done!: HTMLElement;
  private times!: HTMLElement[];
  private pauseMark!: HTMLElement;
  private again!: HTMLElement;
  private mainBtn!: HTMLButtonElement;
  // The phase last drawn: "Rest over" is announced only on a run/pause -> over change,
  // never for a Rest that was already over when the page loaded (ADR-0019).
  private drawn: string | null = null;
  private readonly onChange = (): void => this.render();
  private readonly onTick = (): void => this.paint();

  set clock(c: RestClock) {
    this._clock?.removeEventListener('change', this.onChange);
    this._clock?.removeEventListener('tick', this.onTick);
    this._clock = c;
    c.addEventListener('change', this.onChange);
    c.addEventListener('tick', this.onTick);
    if (this.dock) this.render();
  }

  connectedCallback(): void {
    if (this.dock) return;
    this.root.innerHTML = `
      <style>
        ${BOX_SIZING}${BUTTON_FX}
        :host {
          position: fixed; left: 0; right: 0; bottom: 0; z-index: 40; display: block;
          color: var(--rack-text);
        }
        :host([hidden]) { display: none; }
        .dk {
          position: relative; height: calc(${DOCK_PX}px + env(safe-area-inset-bottom));
          padding: 0 calc(12px + env(safe-area-inset-right))
                   env(safe-area-inset-bottom) calc(14px + env(safe-area-inset-left));
          background: var(--rack-overlay);
          border-top: 1px solid var(--rack-border-strong);
          box-shadow: var(--rack-shadow-sheet);
        }
        .row {
          height: 100%; max-width: 520px; margin: 0 auto;
          display: flex; align-items: center; gap: 10px;
        }
        .row[hidden] { display: none; }
        button { font: inherit; color: inherit; cursor: pointer; }
        button:focus-visible { outline: 2px solid var(--rack-accent); outline-offset: 2px; }
        /* The progress track on the top edge: the share of the Rest still to go. */
        .track {
          position: absolute; left: 0; right: 0; top: -1px; height: 3px;
          background: var(--rack-divider); overflow: hidden; pointer-events: none;
        }
        .track i {
          position: absolute; inset: 0; transform-origin: left center;
          transform: scaleX(var(--r, 1)); background: var(--rack-accent);
        }
        .is-pause .track i { background: var(--rack-border-active); }
        .is-over .track { display: none; }
        .time {
          flex: none; height: 48px; display: flex; align-items: center; gap: 8px;
          padding: 0 4px; border: 0; background: transparent;
        }
        .time b, .main b {
          font: 800 28px/1 var(--rack-font); letter-spacing: -.02em;
          font-variant-numeric: tabular-nums;
        }
        .is-pause .time b { color: var(--rack-text-secondary); }
        .pz { color: var(--rack-text-dim); display: grid; }
        .pz[hidden] { display: none; }
        .mini { width: 30px; height: 30px; flex: none; transform: rotate(-90deg); }
        .mini .tr { fill: none; stroke: var(--rack-selected); stroke-width: 4; }
        .mini .pr {
          fill: none; stroke: var(--rack-accent); stroke-width: 4; stroke-linecap: round;
          stroke-dasharray: 100 100; stroke-dashoffset: calc(100 - var(--r, 1) * 100);
        }
        .is-pause .mini .pr { stroke: var(--rack-text-dim); }
        .chips {
          flex: 1; min-width: 0; display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px;
        }
        .chip {
          height: 40px; min-width: 0; padding: 0;
          border-radius: 12px; border: 1px solid var(--rack-border-muted);
          background: transparent; color: var(--rack-text-secondary);
          font: 600 13px var(--rack-font-num);
        }
        .chip[aria-pressed="true"] {
          border-color: var(--rack-accent); background: var(--rack-active);
          color: var(--rack-text);
        }
        /* Zero: the whole dock turns yellow and becomes one restart button + the x. */
        .is-over { background: var(--rack-accent); border-top-color: var(--rack-accent); }
        .main {
          flex: 1; min-width: 0; height: 52px; border: 0; background: transparent;
          display: flex; align-items: center; justify-content: space-between; gap: 10px;
          padding: 0 4px; color: var(--rack-accent-ink);
        }
        .again {
          display: inline-flex; align-items: center; gap: 6px;
          font: 700 14px var(--rack-font-num);
        }
        .x {
          width: 40px; height: 40px; flex: none; border-radius: 999px; padding: 0;
          border: 1px solid color-mix(in srgb, var(--rack-accent-ink) 35%, transparent);
          background: transparent; display: grid; place-items: center;
          color: var(--rack-accent-ink);
        }
        .is-over button:focus-visible { outline-color: var(--rack-accent-ink); }
        .sr {
          position: absolute; width: 1px; height: 1px; overflow: hidden;
          clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap;
        }
        @media (prefers-reduced-motion: no-preference) {
          :host(:not([hidden])) .dk { animation: dkin .2s cubic-bezier(.2, .8, .2, 1) both; }
          @keyframes dkin { from { transform: translateY(100%); } to { transform: none; } }
        }
        @media ${SHORT_SCREEN} {
          .dk { height: calc(${DOCK_SHORT_PX}px + env(safe-area-inset-bottom)); }
          .time b, .main b { font-size: 25px; }
          .chip { height: 36px; }
        }
        @media ${NARROW_SCREEN} {
          .dk {
            padding-left: calc(10px + env(safe-area-inset-left));
            padding-right: calc(8px + env(safe-area-inset-right));
          }
          .row { gap: 6px; }
          .time { gap: 6px; }
          .time b { font-size: 24px; }
          .chips { gap: 4px; }
          .chip { font-size: 12px; border-radius: 10px; }
          .mini { width: 24px; height: 24px; }
        }
      </style>
      <div class="dk" data-dock>
        <span class="track" aria-hidden="true"><i data-r></i></span>
        <div class="row" data-live>
          <!-- No aria-label: the name is the content, so it carries the live time --
               "Rest 1:24 left, open timer" -- without announcing every tick. -->
          <button type="button" class="time" data-open aria-haspopup="dialog"
            ><span class="sr">Rest </span><svg class="mini" viewBox="0 0 36 36" aria-hidden="true"
              ><circle class="tr" cx="18" cy="18" r="15"></circle
              ><circle class="pr" cx="18" cy="18" r="15" pathLength="100" data-r></circle
            ></svg
            ><b data-time></b
            ><span class="pz" data-paused hidden>${PAUSE_GLYPH(12)}</span
            ><span class="sr" data-time-tail> left, open timer</span
          ></button>
          <div class="chips" role="group" aria-label="Rest presets">
            ${REST_PRESETS.map(
              (s) => `<button type="button" class="chip" data-preset="${s}"
                aria-label="Rest ${formatClock(s)}">${formatClock(s)}</button>`,
            ).join('')}
          </div>
        </div>
        <div class="row" data-done hidden>
          <button type="button" class="main" data-again
            ><b data-time></b><span class="again"
              >${RESTART_GLYPH(15)}<span data-again-len></span></span
          ></button>
          <button type="button" class="x" data-clear aria-label="Clear rest timer"
            >${X_GLYPH}</button>
        </div>
        <div class="sr" role="status" data-announce></div>
      </div>
    `;
    this.dock = this.root.querySelector('[data-dock]')!;
    this.live = this.root.querySelector('[data-live]')!;
    this.done = this.root.querySelector('[data-done]')!;
    this.times = [...this.root.querySelectorAll<HTMLElement>('[data-time]')];
    this.pauseMark = this.root.querySelector('[data-paused]')!;
    this.again = this.root.querySelector('[data-again-len]')!;
    this.mainBtn = this.root.querySelector('[data-again]')!;

    this.root.addEventListener('click', (e) => {
      const c = this._clock;
      const b = (e.target as Element).closest('button');
      if (!c || !b) return;
      c.unlockAudio();
      if (b.matches('[data-open]')) {
        // From the button, so the screen can hand focus back to it on close.
        b.dispatchEvent(new CustomEvent('restopen', { bubbles: true, composed: true }));
      } else if (b.dataset.preset) {
        c.start(Number(b.dataset.preset));
      } else if (b.matches('[data-again]')) {
        c.restart();
      } else if (b.matches('[data-clear]')) {
        c.clear();
      }
    });
    this.render();
  }

  private render(): void {
    const c = this._clock;
    if (!this.dock) return;
    const r = c?.reading();
    const phase = r?.phase ?? 'idle';
    this.hidden = phase === 'idle';
    const announce = this.root.querySelector<HTMLElement>('[data-announce]')!;
    this.dock.className = `dk is-${phase}`;
    this.live.hidden = phase === 'over';
    this.done.hidden = phase !== 'over';
    this.pauseMark.hidden = phase !== 'pause';
    this.root.querySelector('[data-time-tail]')!.textContent =
      phase === 'pause' ? ' left, paused, open timer' : ' left, open timer';
    if (c) {
      const last = formatClock(c.state.last);
      this.again.textContent = last;
      this.mainBtn.setAttribute('aria-label', `Rest over. Restart ${last}`);
      this.root.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) => {
        b.setAttribute('aria-pressed', String(Number(b.dataset.preset) === c.state.last));
      });
    }
    announce.textContent =
      phase === 'over' && (this.drawn === 'run' || this.drawn === 'pause') ? 'Rest over' : '';
    this.drawn = phase;
    this.paint();
  }

  // The per-tick redraw: the clock text and the share left, nothing else.
  private paint(): void {
    const r = this._clock?.reading();
    if (!r || !this.dock) return;
    for (const t of this.times) if (t.textContent !== r.text) t.textContent = r.text;
    const f = r.fraction.toFixed(4);
    this.root.querySelectorAll<HTMLElement | SVGElement>('[data-r]').forEach((el) => {
      if (el.style.getPropertyValue('--r') !== f) el.style.setProperty('--r', f);
    });
  }
}

customElements.define('rack-rest-dock', RackRestDock);
