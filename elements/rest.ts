// <rack-rest> -- the Rest timer (RBAR-94, ADR-0019): the RestClock plus its two views,
// the floating pill (the dock) and the timer screen, and the thin yellow line that
// blinks at the screen edge when a Rest reaches zero. <rack-app> mounts one beside the
// console and wires two doors in:
//
//   tap()        -- the console's stopwatch button: open the screen while a Rest shows,
//                   else start the remembered Rest (the dock comes up)
//   afterNext()  -- Warm up's Next: start the remembered Rest if "Start after Next" is on
//
// It says `restlive` { live } whenever the dock comes or goes, so the app can reserve
// the dock's height (the bar block flexes, ADR-0013) and light the stopwatch.
import { RestClock } from './restclock.ts';
import { isLive } from '../lib/rest.ts';
import './restdock.ts';
import './restscreen.ts';

type Dock = HTMLElement & { clock: RestClock };
type Screen = HTMLElement & { clock: RestClock; open(): void; close(): void };

// Whether `el` is still on screen: connected, with no `hidden` on it or on any ancestor,
// across shadow roots.
function shown(el: Element): boolean {
  if (!el.isConnected) return false;
  for (let n: Node | null = el; n; ) {
    if (n instanceof HTMLElement && n.hidden) return false;
    n = n.parentNode instanceof ShadowRoot ? n.parentNode.host : n.parentNode;
  }
  return true;
}

// How long the edge flash runs: three blinks, then a fade to nothing (the dock
// prototype's edgeBlink, 2.4 s). The class comes off a little after, so the next zero
// can restart it; the resting look between is opacity 0 either way.
export const FLASH_MS = 2600;

class RackRest extends HTMLElement {
  private root: ShadowRoot = this.attachShadow({ mode: 'open' });
  private _clock: RestClock | null = null;
  private screen!: Screen;
  private flash!: HTMLElement;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;
  private wasLive: boolean | null = null;
  private opener: HTMLElement | null = null;

  /** The clock (tests may hand one in before connecting; otherwise a default one). */
  get clock(): RestClock {
    this._clock ??= new RestClock();
    return this._clock;
  }
  set clock(c: RestClock) {
    this._clock = c;
  }

  get live(): boolean {
    return isLive(this.clock.state);
  }

  connectedCallback(): void {
    if (!this.flash) {
      this.root.innerHTML = `
        <style>
          :host { display: contents; }
          /* At zero: a thin yellow line at the screen edge blinks three times and fades
             to nothing (dock prototype edgeBlink), above everything and through to the
             taps under it. It RESTS at opacity 0: the base rule is 0 and both animations
             end at 0 and hold it (forwards), so nothing stays lit if a class lingers.
             Reduced motion: one soft fade out instead of the blinks. */
          .flash {
            position: fixed; inset: 0; z-index: 90; pointer-events: none; opacity: 0;
            box-shadow: inset 0 0 0 3px var(--rack-accent),
                        inset 0 0 36px color-mix(in srgb, var(--rack-accent) 22%, transparent);
          }
          .flash.on { animation: edgeonce 1.6s ease-out forwards; }
          @keyframes edgeonce { 0% { opacity: .9; } 100% { opacity: 0; } }
          @media (prefers-reduced-motion: no-preference) {
            .flash.on { animation: edgeblink 2.4s linear forwards; }
            @keyframes edgeblink {
              0% { opacity: 0; } 8% { opacity: 1; } 17% { opacity: .1; } 25% { opacity: 1; }
              34% { opacity: .1; } 42% { opacity: 1; } 100% { opacity: 0; }
            }
          }
        </style>
        <rack-rest-dock></rack-rest-dock>
        <rack-rest-screen></rack-rest-screen>
        <div class="flash" data-flash aria-hidden="true"></div>
      `;
      this.flash = this.root.querySelector('[data-flash]')!;
      this.screen = this.root.querySelector('rack-rest-screen') as Screen;
      const dock = this.root.querySelector('rack-rest-dock') as Dock;
      const c = this.clock;
      dock.clock = c;
      this.screen.clock = c;
      c.addEventListener('change', () => this.onChange());
      c.addEventListener('zero', () => this.onZero());
      dock.addEventListener('restopen', (e) =>
        this.openScreen((e.composedPath()[0] as HTMLElement | undefined) ?? null),
      );
      this.screen.addEventListener('close', () => {
        const o = this.opener;
        this.opener = null;
        // The dock button that opened the screen may be gone by now (a reset hid the
        // dock, a zero swapped its row): then ask the app to focus the stopwatch.
        if (o && shown(o)) o.focus();
        else this.dispatchEvent(new Event('restfocus'));
      });
    }
    this.clock.connect();
    this.onChange();
  }

  disconnectedCallback(): void {
    this._clock?.stop();
  }

  /** The stopwatch: open the screen while a Rest shows, else start the remembered one. */
  tap(opener: HTMLElement | null = null): void {
    this.clock.unlockAudio();
    if (this.live) this.openScreen(opener);
    else this.clock.restart();
  }

  /** Warm up's Next. */
  afterNext(): void {
    this.clock.unlockAudio();
    this.clock.afterNext();
  }

  private openScreen(opener: HTMLElement | null): void {
    this.opener = opener;
    this.screen.open();
  }

  private onChange(): void {
    const live = this.live;
    if (live === this.wasLive) return;
    this.wasLive = live;
    this.dispatchEvent(new CustomEvent('restlive', { detail: { live } }));
  }

  private onZero(): void {
    const f = this.flash;
    if (this.flashTimer !== null) clearTimeout(this.flashTimer);
    f.classList.remove('on');
    void f.offsetWidth; // restart the animation
    f.classList.add('on');
    this.flashTimer = setTimeout(() => {
      f.classList.remove('on');
      this.flashTimer = null;
    }, FLASH_MS);
  }
}

customElements.define('rack-rest', RackRest);
