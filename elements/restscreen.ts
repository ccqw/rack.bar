// <rack-rest-screen> -- the Rest timer screen (RBAR-94; Caitlin's pick, the "Ring"
// variant with the Big-numerals preset toggle; ADR-0019). Full screen over the app on
// the fullscreen card's dark wash: a top bar (close chevron, reset, settings sliders),
// a thin ring draining around big digits, the presets as one pill toggle, then round
// -15 / pause / +15 for the thumb. The sliders open a small card with "Chime at zero"
// (+ a preview) and "Start after Next".
//
// A dumb view over the RestClock (elements/restclock.ts), like the dock. It opens with
// open(), closes on the chevron or Escape, and says `close` when it does.
import { BOX_SIZING } from './boxsizing.ts';
import { BUTTON_FX } from './buttonfx.ts';
import { SHORT_SCREEN } from './fit.ts';
import { REST_PRESETS, REST_STEP_S, formatClock } from '../lib/rest.ts';
import type { RestClock } from './restclock.ts';
import {
  BELL_GLYPH,
  CHEVRON_GLYPH,
  NARROW_SCREEN,
  NEXT_GLYPH,
  PAUSE_GLYPH,
  PLAY_GLYPH,
  RESET_GLYPH,
  RESTART_GLYPH,
  SLIDERS_LINE_GLYPH,
  SPEAKER_GLYPH,
} from './restglyphs.ts';

// The ring's quarter ticks, on the 200-unit viewBox (radius 94 track, ticks 78..84).
const TICKS = [0, 0.25, 0.5, 0.75]
  .map((a) => {
    const t = a * 2 * Math.PI;
    const p = (r: number) => `${(100 + r * Math.cos(t)).toFixed(2)}`;
    const q = (r: number) => `${(100 + r * Math.sin(t)).toFixed(2)}`;
    return `<line class="tk" x1="${p(84)}" y1="${q(84)}" x2="${p(78)}" y2="${q(78)}"></line>`;
  })
  .join('');

class RackRestScreen extends HTMLElement {
  private root: ShadowRoot = this.attachShadow({ mode: 'open' });
  private _clock: RestClock | null = null;
  private scr!: HTMLElement;
  private settingsOpen = false;
  private readonly onChange = (): void => this.render();
  private readonly onTick = (): void => this.paint();
  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || this.hidden) return;
    e.preventDefault();
    if (this.settingsOpen) this.toggleSettings(false);
    else this.close();
  };

  set clock(c: RestClock) {
    this._clock?.removeEventListener('change', this.onChange);
    this._clock?.removeEventListener('tick', this.onTick);
    this._clock = c;
    c.addEventListener('change', this.onChange);
    c.addEventListener('tick', this.onTick);
    if (this.scr) this.render();
  }

  connectedCallback(): void {
    // Every connect (a re-mount too): disconnectedCallback takes it off again.
    document.addEventListener('keydown', this.onKey);
    if (this.scr) return;
    this.hidden = true;
    this.root.innerHTML = `
      <style>
        ${BOX_SIZING}${BUTTON_FX}
        :host { position: fixed; inset: 0; z-index: 75; display: block; color: var(--rack-text); }
        :host([hidden]) { display: none; }
        button { font: inherit; color: inherit; cursor: pointer; padding: 0; }
        button:focus-visible { outline: 2px solid var(--rack-accent); outline-offset: 2px; }
        button:disabled { opacity: .35; cursor: default; }
        .scr {
          --ring: 248px; --digits: 62px;
          position: absolute; inset: 0; overflow: hidden;
          display: flex; flex-direction: column; gap: 18px;
          padding: calc(12px + env(safe-area-inset-top)) calc(20px + env(safe-area-inset-right))
                   calc(22px + env(safe-area-inset-bottom)) calc(20px + env(safe-area-inset-left));
          background: radial-gradient(120% 75% at 50% 40%,
                      var(--rack-fullscreen-glow), var(--rack-fullscreen-deep));
        }
        .col {
          width: 100%; max-width: 480px; margin: 0 auto; flex: 1; min-height: 0;
          display: flex; flex-direction: column; gap: inherit;
        }
        /* Top bar: close (chevron) left; reset and settings right. */
        .tb { height: 44px; flex: none; display: flex; align-items: center; gap: 8px; }
        .tb .sp { flex: 1; }
        .tbb {
          width: 40px; height: 40px; border-radius: 999px; flex: none;
          border: 1px solid var(--rack-border-muted); background: var(--rack-raised);
          display: grid; place-items: center; color: var(--rack-text-secondary);
        }
        .tbb[aria-expanded="true"] { border-color: var(--rack-accent); color: var(--rack-accent); }
        /* The ring drains around the digits. */
        .mid { flex: 1 1 auto; min-height: 0; display: grid; place-items: center; }
        .rg { width: var(--ring); height: var(--ring); position: relative; }
        .rg svg { width: 100%; height: 100%; transform: rotate(-90deg); display: block; }
        .rg .tr { fill: none; stroke: var(--rack-active); stroke-width: 6; }
        .rg .tk { fill: none; stroke: var(--rack-border-active); stroke-width: 3; }
        .rg .pr {
          fill: none; stroke: var(--rack-accent); stroke-width: 6; stroke-linecap: round;
          stroke-dasharray: 100 100; stroke-dashoffset: calc(100 - var(--r, 1) * 100);
        }
        .is-pause .rg .pr { stroke: var(--rack-text-dim); }
        .is-over .rg .tr { stroke: var(--rack-accent); }
        .is-over .rg .pr { display: none; }
        .in {
          position: absolute; inset: 0; display: flex; flex-direction: column;
          align-items: center; justify-content: center; gap: 6px;
        }
        .in b {
          font: 800 var(--digits)/1 var(--rack-font); letter-spacing: -.035em;
          font-variant-numeric: tabular-nums;
        }
        .in small {
          font: 600 12px var(--rack-font-num); color: var(--rack-text-dim);
          letter-spacing: .04em; min-height: 15px;
        }
        .is-pause .in b { color: var(--rack-text-secondary); }
        .is-over .in b { color: var(--rack-accent); }
        /* The presets: one pill toggle on the mode switch's raised track; the active
           segment is the selected grey (the accent fill belongs to the mode toggle). */
        .seg {
          flex: none; display: flex; padding: 4px; background: var(--rack-raised);
          border: 1px solid var(--rack-border); border-radius: 999px;
        }
        .seg button {
          flex: 1; min-width: 0; height: 40px; border: 0; border-radius: 999px;
          background: transparent; font: 600 14px var(--rack-font-num);
          color: var(--rack-text-dim);
        }
        .seg button[aria-pressed="true"] { background: var(--rack-selected); color: var(--rack-text); }
        /* -15, the round yellow pause, +15. */
        .ctl { flex: none; display: flex; justify-content: center; align-items: center; gap: 26px; }
        .cb {
          width: 60px; height: 60px; border-radius: 999px; display: grid; place-items: center;
          border: 1px solid var(--rack-border-muted); background: var(--rack-raised);
          font: 700 15px var(--rack-font-num);
        }
        .cb.pri {
          width: 80px; height: 80px; border: 0;
          background: var(--rack-accent); color: var(--rack-accent-ink);
        }
        /* Settings: a card over a light scrim, at the bottom of the screen. */
        .ov {
          position: absolute; inset: 0; z-index: 5; border: 0; cursor: default;
          background: var(--rack-scrim);
        }
        .card {
          position: absolute; z-index: 6;
          left: calc(12px + env(safe-area-inset-left)); right: calc(12px + env(safe-area-inset-right));
          bottom: calc(12px + env(safe-area-inset-bottom));
          max-width: 480px; margin: 0 auto;
          background: var(--rack-overlay); border: 1px solid var(--rack-border-strong);
          border-radius: 18px; box-shadow: var(--rack-shadow-modal); padding: 4px 14px;
        }
        .ov[hidden], .card[hidden] { display: none; }
        .st { display: flex; align-items: center; gap: 10px; min-height: 56px; }
        .st + .st { border-top: 1px solid var(--rack-divider); }
        .st .ic { color: var(--rack-text-dim); display: grid; flex: none; }
        .st .lb { flex: 1; min-width: 0; font: 600 14px var(--rack-font); color: var(--rack-text); }
        .pv {
          width: 36px; height: 36px; flex: none; border-radius: 999px;
          border: 1px solid var(--rack-border-muted); background: transparent;
          display: grid; place-items: center; color: var(--rack-text-secondary);
        }
        .sw {
          width: 46px; height: 28px; flex: none; border-radius: 999px; border: 0;
          background: var(--rack-selected); position: relative;
        }
        .sw::after {
          content: ""; position: absolute; top: 4px; left: 4px; width: 20px; height: 20px;
          border-radius: 999px; background: var(--rack-text-dim);
          transition: transform .16s, background-color .16s;
        }
        .sw[aria-checked="true"] { background: var(--rack-accent); }
        .sw[aria-checked="true"]::after { transform: translateX(18px); background: var(--rack-accent-ink); }
        /* The sliders' own 44px tap target stays: the switch is 28px tall. */
        .sw::before { content: ""; position: absolute; inset: -8px 0; }
        @media (prefers-reduced-motion: no-preference) {
          :host(:not([hidden])) .scr { animation: scrin .26s cubic-bezier(.2, .8, .2, 1) both; }
          .card.enter { animation: up .2s cubic-bezier(.2, .8, .2, 1) both; }
          .pv.ping { animation: ping .6s ease-out; }
          @keyframes scrin { from { transform: translateY(40px); opacity: 0; } to { transform: none; opacity: 1; } }
          @keyframes up { from { transform: translateY(100%); } to { transform: none; } }
          @keyframes ping {
            0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--rack-accent) 50%, transparent); }
            100% { box-shadow: 0 0 0 10px transparent; }
          }
        }
        @media ${SHORT_SCREEN} {
          .scr { --ring: 176px; --digits: 46px; gap: 12px; padding-bottom: calc(16px + env(safe-area-inset-bottom)); }
          .cb { width: 52px; height: 52px; }
          .cb.pri { width: 66px; height: 66px; }
          .seg button { height: 36px; }
        }
        @media ${NARROW_SCREEN} {
          .scr {
            --ring: 224px; --digits: 56px;
            padding-left: calc(16px + env(safe-area-inset-left));
            padding-right: calc(16px + env(safe-area-inset-right));
          }
          .seg button { font-size: 13px; }
        }
        @media ${NARROW_SCREEN} and ${SHORT_SCREEN} {
          .scr { --ring: 196px; --digits: 50px; }
        }
      </style>
      <div class="scr" data-scr role="dialog" aria-modal="true" aria-label="Rest timer">
        <div class="col">
          <div class="tb">
            <button type="button" class="tbb" data-close aria-label="Close rest timer">${CHEVRON_GLYPH}</button>
            <span class="sp"></span>
            <button type="button" class="tbb" data-reset aria-label="Reset rest timer">${RESET_GLYPH}</button>
            <button type="button" class="tbb" data-settings aria-label="Timer settings"
              aria-expanded="false">${SLIDERS_LINE_GLYPH}</button>
          </div>
          <div class="mid">
            <div class="rg">
              <svg viewBox="0 0 200 200" aria-hidden="true"
                ><circle class="tr" cx="100" cy="100" r="94"></circle>${TICKS}<circle
                  class="pr" cx="100" cy="100" r="94" pathLength="100" data-r></circle
              ></svg>
              <div class="in" role="timer" aria-live="off"
                ><b data-time></b><small data-sub></small></div>
            </div>
          </div>
          <div class="seg" role="group" aria-label="Rest presets">
            ${REST_PRESETS.map(
              (s) => `<button type="button" data-preset="${s}"
                aria-label="Rest ${formatClock(s)}">${formatClock(s)}</button>`,
            ).join('')}
          </div>
          <div class="ctl">
            <button type="button" class="cb" data-adjust="-${REST_STEP_S}"
              aria-label="${REST_STEP_S} seconds less">-${REST_STEP_S}</button>
            <button type="button" class="cb pri" data-primary></button>
            <button type="button" class="cb" data-adjust="${REST_STEP_S}"
              aria-label="${REST_STEP_S} seconds more">+${REST_STEP_S}</button>
          </div>
        </div>
        <button type="button" class="ov" data-overlay tabindex="-1"
          aria-label="Close timer settings" hidden></button>
        <div class="card" data-card role="group" aria-label="Timer settings" hidden>
          <div class="st">
            <span class="ic">${BELL_GLYPH}</span><span class="lb" id="chime-l">Chime at zero</span>
            <button type="button" class="pv" data-preview aria-label="Preview chime">${SPEAKER_GLYPH}</button>
            <button type="button" class="sw" data-chime role="switch" aria-checked="false"
              aria-labelledby="chime-l"></button>
          </div>
          <div class="st">
            <span class="ic">${NEXT_GLYPH}</span><span class="lb" id="auto-l">Start after Next</span>
            <button type="button" class="sw" data-auto role="switch" aria-checked="true"
              aria-labelledby="auto-l"></button>
          </div>
        </div>
      </div>
    `;
    this.scr = this.root.querySelector('[data-scr]')!;
    this.root.addEventListener('click', (e) => this.onClick(e));
    this.render();
  }

  disconnectedCallback(): void {
    document.removeEventListener('keydown', this.onKey);
  }

  /** Show the screen, focus on its close button. */
  open(): void {
    this.hidden = false;
    this.toggleSettings(false);
    this.render();
    this.root.querySelector<HTMLButtonElement>('[data-close]')?.focus();
  }

  close(): void {
    if (this.hidden) return;
    this.hidden = true;
    this.toggleSettings(false);
    this.dispatchEvent(new Event('close'));
  }

  private onClick(e: Event): void {
    const c = this._clock;
    const b = (e.target as Element).closest('button');
    if (!c || !b) return;
    c.unlockAudio();
    if (b.matches('[data-close]')) this.close();
    else if (b.matches('[data-reset]')) c.clear();
    else if (b.matches('[data-settings]')) this.toggleSettings(!this.settingsOpen);
    else if (b.matches('[data-overlay]')) this.toggleSettings(false);
    else if (b.dataset.preset) c.start(Number(b.dataset.preset));
    else if (b.dataset.adjust) c.adjust(Number(b.dataset.adjust));
    else if (b.matches('[data-primary]')) c.toggle();
    else if (b.matches('[data-chime]')) c.setChime(!c.settings.chime);
    else if (b.matches('[data-auto]')) c.setAutoStart(!c.settings.autoStart);
    else if (b.matches('[data-preview]')) {
      c.previewChime();
      b.classList.remove('ping');
      void (b as HTMLElement).offsetWidth;
      b.classList.add('ping');
    }
  }

  private toggleSettings(open: boolean): void {
    if (!this.scr) return;
    const was = this.settingsOpen;
    this.settingsOpen = open;
    const card = this.root.querySelector<HTMLElement>('[data-card]')!;
    this.root.querySelector<HTMLElement>('[data-overlay]')!.hidden = !open;
    card.hidden = !open;
    card.classList.toggle('enter', open && !was);
    const gear = this.root.querySelector<HTMLButtonElement>('[data-settings]')!;
    gear.setAttribute('aria-expanded', String(open));
    if (open && !was) this.root.querySelector<HTMLButtonElement>('[data-chime]')?.focus();
    else if (!open && was) gear.focus();
  }

  private render(): void {
    const c = this._clock;
    if (!this.scr || !c) return;
    const r = c.reading();
    this.scr.className = `scr is-${r.phase}`;
    const last = formatClock(c.state.last);
    const pri = this.root.querySelector<HTMLButtonElement>('[data-primary]')!;
    const [glyph, label] =
      r.phase === 'run'
        ? [PAUSE_GLYPH(26), 'Pause']
        : r.phase === 'pause'
          ? [PLAY_GLYPH(26), 'Resume']
          : r.phase === 'over'
            ? [RESTART_GLYPH(26), `Restart ${last}`]
            : [PLAY_GLYPH(26), `Start ${last}`];
    if (pri.getAttribute('aria-label') !== label) {
      pri.innerHTML = glyph;
      pri.setAttribute('aria-label', label);
    }
    this.root.querySelectorAll<HTMLButtonElement>('[data-adjust]').forEach((b) => {
      b.disabled = r.phase === 'over';
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) => {
      b.setAttribute('aria-pressed', String(Number(b.dataset.preset) === c.state.last));
    });
    this.root.querySelector('[data-chime]')!.setAttribute('aria-checked', String(c.settings.chime));
    this.root.querySelector('[data-auto]')!.setAttribute('aria-checked', String(c.settings.autoStart));
    this.paint();
  }

  private paint(): void {
    const c = this._clock;
    if (!this.scr || !c || this.hidden) return;
    const r = c.reading();
    const time = this.root.querySelector<HTMLElement>('[data-time]')!;
    if (time.textContent !== r.text) time.textContent = r.text;
    const sub =
      r.phase === 'idle' ? '' : r.phase === 'over' ? `rest ${r.length}` : `of ${r.length}`;
    const subEl = this.root.querySelector<HTMLElement>('[data-sub]')!;
    if (subEl.textContent !== sub) subEl.textContent = sub;
    const f = r.fraction.toFixed(4);
    const ring = this.root.querySelector<SVGElement>('[data-r]')!;
    if (ring.style.getPropertyValue('--r') !== f) ring.style.setProperty('--r', f);
  }
}

customElements.define('rack-rest-screen', RackRestScreen);
