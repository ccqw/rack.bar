// <rack-rest-dock> -- the Rest timer's dock (RBAR-94, ADR-0019): Caitlin's option B,
// a floating pill centered over the bottom of the screen while a Rest shows. Its mini
// ring is the only progress indicator. Left to right: the mini ring and the time (a
// tap opens the timer screen), pause / resume right on the pill, and a dots button
// that slides out -15 / +15 (before pause) and the x (after it). At zero the pill
// stays grey: a check, the overtime in grey ("+0:12"), a restart and the x.
//
// A dumb view over the RestClock (elements/restclock.ts): it reads the clock and calls
// it, and says `restopen` (bubbling) when the time is tapped. <rack-rest> owns both.
// Which controls show is the pure pillControls (lib/rest.ts). The pill never covers
// the column: <rack-app> reserves its height while it shows (ADR-0019), so the bar
// block flexes instead (ADR-0013).
import { BOX_SIZING } from './boxsizing.ts';
import { BUTTON_FX } from './buttonfx.ts';
import { SHORT_SCREEN } from './fit.ts';
import { REST_STEP_S, formatClock, pillControls } from '../lib/rest.ts';
import type { PillControl } from '../lib/rest.ts';
import type { RestClock } from './restclock.ts';
import {
  CHECK_GLYPH,
  CHEVRON_LEFT_GLYPH,
  DOTS_GLYPH,
  NARROW_SCREEN,
  PAUSE_GLYPH,
  PLAY_GLYPH,
  RESTART_GLYPH,
  X_GLYPH,
} from './restglyphs.ts';

// The pill (prototype option B): 52px tall, 10px off the bottom edge; 48px on a short
// screen (fit.ts SHORT_SCREEN). On a short screen it sits 6px off the edge (the
// prototype's 8px) and the reserve drops its 4px of air above the pill: Warm up on the
// Training set at 375x548 already has its Bar at the docked floor, and the fit-check
// measured the prototype's 60px reserve covering Next by 5px. 54px is the old bar
// dock's short reserve, which fit every state.
const PILL_PX = 52;
const PILL_SHORT_PX = 48;
const PILL_GAP_PX = 10;
const PILL_GAP_SHORT_PX = 6;
/** What <rack-app> reserves while the pill shows: the pill and its gap below, plus 4px
 * of air above it (none on a short screen). */
export const DOCK_PX = PILL_PX + PILL_GAP_PX + 4;
export const DOCK_SHORT_PX = PILL_SHORT_PX + PILL_GAP_SHORT_PX;

class RackRestDock extends HTMLElement {
  private root: ShadowRoot = this.attachShadow({ mode: 'open' });
  private _clock: RestClock | null = null;
  private dock!: HTMLElement;
  // Whether the dots are open (-15 / +15 / x showing). View state only: it folds when
  // the Rest ends or clears.
  private expanded = false;
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
        /* The host spans the bottom so its box is the pill's row (the fit-check reads its
           top); only the pill itself takes taps. */
        :host {
          position: fixed; left: 0; right: 0; z-index: 40;
          bottom: calc(${PILL_GAP_PX}px + env(safe-area-inset-bottom));
          display: flex; justify-content: center; pointer-events: none;
          color: var(--rack-text);
        }
        :host([hidden]) { display: none; }
        .dk {
          pointer-events: auto; position: relative;
          height: ${PILL_PX}px; max-width: calc(100vw - 20px);
          display: flex; align-items: center; gap: 6px; padding: 0 6px 0 10px;
          border-radius: 999px; background: var(--rack-overlay);
          border: 1px solid var(--rack-border-strong); box-shadow: var(--rack-shadow-pop);
        }
        button { font: inherit; color: inherit; cursor: pointer; padding: 0; }
        button[hidden], span[hidden], svg[hidden] { display: none; }
        button:focus-visible { outline: 2px solid var(--rack-accent); outline-offset: 2px; }
        .time {
          flex: none; height: 44px; display: flex; align-items: center; gap: 7px;
          padding: 0 6px 0 4px; border: 0; background: transparent;
        }
        .time b {
          font: 800 22px/1 var(--rack-font); letter-spacing: -.02em;
          font-variant-numeric: tabular-nums;
        }
        .is-pause .time b { color: var(--rack-text-dim); }
        .mini { width: 26px; height: 26px; flex: none; transform: rotate(-90deg); }
        .mini .tr { fill: none; stroke: var(--rack-selected); stroke-width: 4; }
        .mini .pr {
          fill: none; stroke: var(--rack-accent); stroke-width: 4; stroke-linecap: round;
          stroke-dasharray: 100 100; stroke-dashoffset: calc(100 - var(--r, 1) * 100);
        }
        .is-pause .mini .pr { stroke: var(--rack-text-dim); }
        /* Over: a check in a ring, the overtime in grey. Nothing on the pill turns yellow
           but the check. */
        .ck {
          width: 26px; height: 26px; flex: none; border-radius: 999px;
          border: 2px solid var(--rack-accent); color: var(--rack-accent);
          display: grid; place-items: center;
        }
        .is-over .time b { color: var(--rack-text-secondary); font-weight: 700; }
        .db {
          width: 40px; height: 40px; flex: none; border-radius: 999px;
          border: 1px solid var(--rack-border-muted); background: var(--rack-raised);
          display: grid; place-items: center; color: var(--rack-text);
        }
        .db.ghost { background: transparent; color: var(--rack-text-dim); }
        .db.adj { font: 700 13px var(--rack-font-num); color: var(--rack-text-secondary); }
        .db.more[aria-expanded="true"] {
          border-color: var(--rack-border-active); color: var(--rack-text);
        }
        .sr {
          position: absolute; width: 1px; height: 1px; overflow: hidden;
          clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap;
        }
        @media (prefers-reduced-motion: no-preference) {
          :host(:not([hidden])) .dk { animation: pillin .22s cubic-bezier(.2, .8, .2, 1) both; }
          .db.in { animation: popin .16s cubic-bezier(.2, .8, .2, 1) both; }
          @keyframes pillin { from { transform: translateY(130%); } to { transform: none; } }
          @keyframes popin { from { opacity: 0; transform: scale(.7); } }
        }
        @media ${SHORT_SCREEN} {
          :host { bottom: calc(${PILL_GAP_SHORT_PX}px + env(safe-area-inset-bottom)); }
          .dk { height: ${PILL_SHORT_PX}px; }
          .db { width: 38px; height: 38px; }
        }
        @media ${NARROW_SCREEN} {
          .dk { gap: 4px; padding-left: 8px; }
          .db { width: 36px; height: 36px; }
          /* The open pill drops the mini ring to make room for its five buttons. */
          .open .mini { display: none; }
          .open .time b { font-size: 20px; }
        }
      </style>
      <div class="dk" data-dock>
        <!-- No aria-label: the name is the content, so it carries the live time --
             "Rest 1:24 left, open timer" -- without announcing every tick. -->
        <button type="button" class="time" data-open aria-haspopup="dialog"
          ><span class="sr" data-time-head>Rest </span><svg class="mini" data-mini
            viewBox="0 0 36 36" aria-hidden="true"
            ><circle class="tr" cx="18" cy="18" r="15"></circle
            ><circle class="pr" cx="18" cy="18" r="15" pathLength="100" data-r></circle
          ></svg
          ><span class="ck" data-check aria-hidden="true" hidden>${CHECK_GLYPH(14)}</span
          ><b data-time></b
          ><span class="sr" data-time-tail> left, open timer</span
        ></button>
        <button type="button" class="db adj" data-pill="minus" data-adjust="-${REST_STEP_S}"
          aria-label="${REST_STEP_S} seconds less" hidden>-${REST_STEP_S}</button>
        <button type="button" class="db adj" data-pill="plus" data-adjust="${REST_STEP_S}"
          aria-label="${REST_STEP_S} seconds more" hidden>+${REST_STEP_S}</button>
        <button type="button" class="db" data-pill="pp" data-pp></button>
        <button type="button" class="db" data-pill="restart" data-again hidden
          >${RESTART_GLYPH(16)}</button>
        <button type="button" class="db ghost" data-pill="clear" data-clear
          aria-label="Clear rest timer" hidden>${X_GLYPH}</button>
        <button type="button" class="db ghost more" data-pill="more" data-more
          aria-expanded="false"></button>
        <div class="sr" role="status" data-announce></div>
      </div>
    `;
    this.dock = this.root.querySelector('[data-dock]')!;

    this.root.addEventListener('click', (e) => {
      const c = this._clock;
      const b = (e.target as Element).closest('button');
      if (!c || !b) return;
      c.unlockAudio();
      if (b.matches('[data-open]')) {
        // From the button, so the screen can hand focus back to it on close.
        b.dispatchEvent(new CustomEvent('restopen', { bubbles: true, composed: true }));
      } else if (b.matches('[data-pp]')) {
        c.toggle();
      } else if (b.dataset.adjust) {
        c.adjust(Number(b.dataset.adjust));
      } else if (b.matches('[data-again]')) {
        c.restart();
      } else if (b.matches('[data-clear]')) {
        this.expanded = false;
        c.clear();
      } else if (b.matches('[data-more]')) {
        this.expanded = !this.expanded;
        this.render(true);
      }
    });
    this.render();
  }

  private render(popIn = false): void {
    const c = this._clock;
    if (!this.dock) return;
    const r = c?.reading();
    const phase = r?.phase ?? 'idle';
    if (phase === 'idle' || phase === 'over') this.expanded = false;
    this.hidden = phase === 'idle';
    const shown = new Set<PillControl>(pillControls(phase, this.expanded));
    this.dock.className = `dk is-${phase}${this.expanded ? ' open' : ''}`;

    const q = <T extends Element = HTMLButtonElement>(sel: string) =>
      this.root.querySelector(sel) as T;
    const show = (sel: string, on: boolean, pop = false) => {
      const el = q<HTMLElement>(sel);
      const was = !el.hidden;
      el.hidden = !on;
      el.classList.toggle('in', pop && on && !was);
    };
    show('[data-pill="minus"]', shown.has('minus'), popIn);
    show('[data-pill="plus"]', shown.has('plus'), popIn);
    show('[data-pill="pp"]', shown.has('pause') || shown.has('resume'));
    show('[data-pill="restart"]', shown.has('restart'));
    show('[data-pill="clear"]', shown.has('clear'), popIn);
    show('[data-pill="more"]', shown.has('more') || shown.has('less'));
    q<SVGElement>('[data-mini]').toggleAttribute('hidden', phase === 'over');
    q<HTMLElement>('[data-check]').hidden = phase !== 'over';

    const pp = q('[data-pp]');
    const ppLabel = phase === 'pause' ? 'Resume' : 'Pause';
    if (pp.getAttribute('aria-label') !== ppLabel) {
      pp.setAttribute('aria-label', ppLabel);
      pp.innerHTML = phase === 'pause' ? PLAY_GLYPH(16) : PAUSE_GLYPH(16);
    }
    const more = q('[data-more]');
    const moreLabel = this.expanded ? 'Fewer controls' : 'More controls';
    if (more.getAttribute('aria-label') !== moreLabel) {
      more.setAttribute('aria-label', moreLabel);
      more.setAttribute('aria-expanded', String(this.expanded));
      more.innerHTML = this.expanded ? CHEVRON_LEFT_GLYPH : DOTS_GLYPH;
    }
    q('[data-time-head]').textContent = phase === 'over' ? 'Rest over, ' : 'Rest ';
    q('[data-time-tail]').textContent =
      phase === 'over'
        ? ', open timer'
        : phase === 'pause'
          ? ' left, paused, open timer'
          : ' left, open timer';
    if (c) q('[data-again]').setAttribute('aria-label', `Restart ${formatClock(c.state.last)}`);

    q<HTMLElement>('[data-announce]').textContent =
      phase === 'over' && (this.drawn === 'run' || this.drawn === 'pause') ? 'Rest over' : '';
    this.drawn = phase;
    this.paint();
  }

  // The per-tick redraw: the clock text and the share left, nothing else.
  private paint(): void {
    const r = this._clock?.reading();
    if (!r || !this.dock) return;
    const t = this.root.querySelector<HTMLElement>('[data-time]')!;
    if (t.textContent !== r.text) t.textContent = r.text;
    const f = r.fraction.toFixed(4);
    const ring = this.root.querySelector<SVGElement>('[data-r]')!;
    if (ring.style.getPropertyValue('--r') !== f) ring.style.setProperty('--r', f);
  }
}

customElements.define('rack-rest-dock', RackRestDock);
