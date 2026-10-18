// The Rest clock (RBAR-94, ADR-0019): the imperative half of the Rest timer. It holds
// the one Rest (lib/rest.ts) and its settings, persists both, supplies `now`, ticks the
// display, keeps the screen awake while a Rest runs, and raises the alert at zero. It
// draws nothing: <rack-rest-dock> and <rack-rest-screen> read it and call it.
//
// Events (on the clock itself):
//   `change` -- the state or the settings changed (redraw everything)
//   `tick`   -- time moved on (redraw the clock text and the ring only)
//   `zero`   -- a running Rest just reached zero (flash the screen edge)
//
// Time comes from `now()` (Date.now, epoch ms) on every read, never from counting ticks,
// so a throttled background tab or a reload loses nothing (the running end time is
// persisted). The tick is only the redraw cadence.
import {
  MAX_REST_S,
  adjustRest,
  clearRest,
  idleRest,
  isLive,
  parseRest,
  parseRestSettings,
  readRest,
  restartRest,
  serializeRest,
  serializeRestSettings,
  settleRest,
  startRest,
  toggleRest,
} from '../lib/rest.ts';
import type { Rest, RestReading, RestSettings } from '../lib/rest.ts';
import { readPersisted, writePersisted } from './persist.ts';
import { ScreenWake } from './wakelock.ts';
import { webAudioChime } from './chime.ts';
import type { Chime } from './chime.ts';

export const REST_STORAGE_KEY = 'rackbar.rest';
export const REST_SETTINGS_STORAGE_KEY = 'rackbar.restSettings';
// Redraw four times a second: the clock text changes once a second, and a quarter
// second keeps it within a frame or two of the true second without a rAF loop.
export const TICK_MS = 250;
// How late the alert may still fire: a zero noticed more than this after the fact (a
// tab that was in the background, a phone that was locked) settles quietly instead.
// A minute still covers Android's once-a-minute background timer throttling.
export const ALERT_GRACE_MS = 60_000;
// The buzz at zero where navigator.vibrate exists (Android Chrome; not iOS).
export const ZERO_VIBRATION: readonly number[] = [220, 120, 220];

export type RestClockOptions = {
  now?: () => number;
  chime?: Chime;
};

export class RestClock extends EventTarget {
  private readonly now: () => number;
  private readonly chime: Chime;
  private readonly wake = new ScreenWake();
  private rest: Rest;
  private _settings: RestSettings;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly onVisible = (): void => {
    if (document.visibilityState === 'visible') this.tick();
  };

  constructor(opts: RestClockOptions = {}) {
    super();
    this.now = opts.now ?? Date.now;
    this.chime = opts.chime ?? webAudioChime();
    // A reload resumes the stored Rest. One that ended while the page was gone is
    // settled QUIETLY: it shows its overtime, but the alert is for a zero the lifter
    // could have watched, not for opening the app.
    // A stored time this app could not have written (a corrupt or hand-edited key, or a
    // clock set back) is dropped: a run ending more than the longest Rest away, a finish
    // or a pause in the future.
    const stored = parseRest(readPersisted(REST_STORAGE_KEY));
    const now = this.now();
    const insane =
      (stored?.phase === 'run' && stored.endAt - now > MAX_REST_S * 1000) ||
      (stored?.phase === 'done' && stored.endAt > now) ||
      (stored?.phase === 'pause' && stored.pausedAt > now);
    const sane = stored && insane ? idleRest(stored.last) : stored;
    this.rest = settleRest(sane ?? idleRest(), this.now());
    this._settings = parseRestSettings(readPersisted(REST_SETTINGS_STORAGE_KEY));
  }

  /** Start ticking (and holding the wake lock as the state asks). The host calls this
   * when it connects, and stop() when it leaves. */
  connect(): void {
    document.addEventListener('visibilitychange', this.onVisible);
    this.sync();
  }

  stop(): void {
    document.removeEventListener('visibilitychange', this.onVisible);
    this.stopTimer();
    this.wake.hold(false);
  }

  get state(): Rest {
    return this.rest;
  }

  get settings(): RestSettings {
    return this._settings;
  }

  reading(): RestReading {
    return readRest(this.rest, this.now());
  }

  /** The screen-wide unlock: Web Audio needs a user gesture before it can sound. Only
   * while "Chime at zero" is on, so a lifter who never wants sound never gets an
   * AudioContext (the switch and the preview unlock it themselves). */
  unlockAudio(): void {
    if (this._settings.chime) this.chime.unlock();
  }

  start(seconds: number): void {
    this.set(startRest(this.rest, seconds, this.now()));
  }

  restart(): void {
    this.set(restartRest(this.rest, this.now()));
  }

  toggle(): void {
    this.set(toggleRest(this.rest, this.now()));
  }

  adjust(deltaS: number): void {
    this.set(adjustRest(this.rest, deltaS, this.now()));
  }

  clear(): void {
    this.set(clearRest(this.rest));
  }

  /** Warm up's Next: start the remembered Rest, only when "Start after Next" is on
   * (off by default). Off, Next leaves the timer exactly as it is. */
  afterNext(): void {
    if (this._settings.startAfterNext) this.restart();
  }

  setChime(on: boolean): void {
    // Turning it on is a tap: unlock now, so the first zero can sound.
    if (on) this.chime.unlock();
    this.setSettings({ ...this._settings, chime: on });
  }

  setStartAfterNext(on: boolean): void {
    this.setSettings({ ...this._settings, startAfterNext: on });
  }

  previewChime(): void {
    this.chime.unlock();
    this.chime.play();
  }

  /** One redraw step: settle the Rest at `now`, alerting on the run -> done edge. */
  tick(): void {
    const before = this.rest;
    const after = settleRest(before, this.now());
    if (after !== before) {
      this.rest = after;
      writePersisted(REST_STORAGE_KEY, serializeRest(after));
      this.alertOnZero(before, after);
      this.sync();
      this.dispatchEvent(new Event('change'));
      return;
    }
    this.dispatchEvent(new Event('tick'));
  }

  // Alert on the run -> done edge, but only for a zero the lifter could have just
  // watched: one noticed late (back from the background, a locked phone) shows its
  // overtime quietly, as a reload does (ADR-0019).
  private alertOnZero(before: Rest, after: Rest): void {
    if (before.phase !== 'run' || after.phase !== 'done') return;
    if (this.now() - after.endAt > ALERT_GRACE_MS) return;
    this.alert();
  }

  private alert(): void {
    try {
      navigator.vibrate?.([...ZERO_VIBRATION]);
    } catch {
      /* vibration is a nicety */
    }
    if (this._settings.chime) this.chime.play();
    this.dispatchEvent(new Event('zero'));
  }

  private set(next: Rest): void {
    const before = this.rest;
    // A -15 to zero finishes the Rest on the spot: that is a zero too.
    const after = settleRest(next, this.now());
    if (after === before) return;
    this.rest = after;
    writePersisted(REST_STORAGE_KEY, serializeRest(after));
    this.alertOnZero(before, after);
    this.sync();
    this.dispatchEvent(new Event('change'));
  }

  private setSettings(next: RestSettings): void {
    this._settings = next;
    writePersisted(REST_SETTINGS_STORAGE_KEY, serializeRestSettings(next));
    this.dispatchEvent(new Event('change'));
  }

  // Tick while a Rest shows; hold the screen awake while one counts (run or paused --
  // the lifter is between sets). Overtime lets the screen sleep: the reading is still
  // right whenever the phone wakes, since it comes from the clock.
  private sync(): void {
    if (isLive(this.rest)) {
      if (this.timer === null) this.timer = setInterval(() => this.tick(), TICK_MS);
    } else {
      this.stopTimer();
    }
    this.wake.hold(this.rest.phase === 'run' || this.rest.phase === 'pause');
  }

  private stopTimer(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }
}
