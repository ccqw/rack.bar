// The Rest timer (RBAR-94, ADR-0019) -- the pure state machine behind the dock and the
// timer screen. A Rest is the timed pause between sets: it counts down from a preset,
// can be paused, nudged by 15 s, and once it reaches zero it counts UP as overtime
// until the lifter restarts or clears it.
//
// Time is read from timestamps, never counted in ticks: every transition takes `now`
// (epoch ms, Date.now() in the shell) and a running Rest stores the moment it ends. A
// throttled background tab, a locked phone or a reload therefore never loses time --
// the reading at any instant depends only on the state and that instant. The shell
// persists the state as-is (serializeRest/parseRest), so a reload resumes the Rest.
//
// Pure (ADR-0001): no clock, no DOM, no storage. The shell (elements/restclock.ts)
// supplies `now`, ticks the display, and reacts to the run -> done edge (the alert).

/** The preset Rests, in seconds: 1:30 / 2:00 / 3:00 / 5:00 (Caitlin's pick). */
export const REST_PRESETS: readonly number[] = [90, 120, 180, 300];
/** The Rest a fresh lifter starts with (2:00). */
export const DEFAULT_REST_S = 120;
/** One -15 / +15 nudge, in seconds. */
export const REST_STEP_S = 15;
/** The shortest Rest the idle -15 can set. */
export const MIN_REST_S = 15;
/** The longest Rest (and the most time a running Rest can hold): an hour. */
export const MAX_REST_S = 3600;
/** An overtime older than this clears itself: the lifter has long since moved on. */
export const STALE_OVERTIME_MS = 30 * 60 * 1000;
/** A pause older than this clears itself too (and so lets the screen sleep). */
export const STALE_PAUSE_MS = 30 * 60 * 1000;

/**
 * A Rest. `last` is the length the lifter last chose (a preset or a nudged idle
 * length); a restart runs it again. `dur` is the length of the Rest in progress, the
 * ring's full sweep (a +15 past it grows it, so the ring never overfills).
 *  - idle:  nothing running; the dock is hidden.
 *  - run:   counting down to `endAt` (epoch ms).
 *  - pause: frozen with `leftMs` to go, since `pausedAt` (epoch ms).
 *  - done:  zero passed at `endAt`; the reading counts up from there (overtime).
 */
export type Rest =
  | { readonly phase: 'idle'; readonly last: number }
  | { readonly phase: 'run'; readonly last: number; readonly dur: number; readonly endAt: number }
  | {
      readonly phase: 'pause';
      readonly last: number;
      readonly dur: number;
      readonly leftMs: number;
      readonly pausedAt: number;
    }
  | { readonly phase: 'done'; readonly last: number; readonly dur: number; readonly endAt: number };

/** What the dock and the screen draw at one instant. */
export type RestReading = {
  /** 'over' is a finished Rest counting up (a run whose end has passed reads 'over'). */
  readonly phase: 'idle' | 'run' | 'pause' | 'over';
  /** "1:58" counting down, "+0:12" in overtime. */
  readonly text: string;
  /** Share of the Rest still to go, 1 (full) -> 0; 0 in overtime, 1 when idle. */
  readonly fraction: number;
  /** The Rest's length as a clock ("2:00"), for the screen's "of 2:00" line. */
  readonly length: string;
};

const clampRest = (s: number): number =>
  Math.min(MAX_REST_S, Math.max(MIN_REST_S, Math.round(s)));

/** An idle Rest remembering `last` seconds (clamped to the allowed range). */
export function idleRest(last: number = DEFAULT_REST_S): Rest {
  return { phase: 'idle', last: Number.isFinite(last) ? clampRest(last) : DEFAULT_REST_S };
}

/** m:ss for a whole number of seconds (negative reads as 0). */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Whether a Rest shows (anything but idle): the dock is up and the stopwatch is live. */
export function isLive(r: Rest): boolean {
  return r.phase !== 'idle';
}

/** Start a fresh Rest of `seconds` now; it becomes the remembered length. */
export function startRest(r: Rest, seconds: number, now: number): Rest {
  const s = Number.isFinite(seconds) ? clampRest(seconds) : r.last;
  return { phase: 'run', last: s, dur: s, endAt: now + s * 1000 };
}

/** Start the remembered Rest again (a finished dock's tap, the auto-start after Next). */
export function restartRest(r: Rest, now: number): Rest {
  return startRest(r, r.last, now);
}

/** Clear the Rest (Reset, the dock's x): idle, the remembered length kept. */
export function clearRest(r: Rest): Rest {
  return { phase: 'idle', last: r.last };
}

/**
 * Bring a Rest up to `now`: a run whose end has passed becomes done (at its own end
 * time, so the overtime counts from the true zero, not from when it was noticed), an
 * overtime older than STALE_OVERTIME_MS clears, and so does a pause older than
 * STALE_PAUSE_MS. Idempotent and order-free over increasing times: settling at t1 then
 * t2 equals settling at t2.
 */
export function settleRest(r: Rest, now: number): Rest {
  let s = r;
  if (s.phase === 'run' && now >= s.endAt) {
    s = { phase: 'done', last: s.last, dur: s.dur, endAt: s.endAt };
  }
  if (s.phase === 'done' && now - s.endAt >= STALE_OVERTIME_MS) return clearRest(s);
  if (s.phase === 'pause' && now - s.pausedAt >= STALE_PAUSE_MS) return clearRest(s);
  return s;
}

/** Pause a running Rest (a run already past zero settles to done instead). */
export function pauseRest(r: Rest, now: number): Rest {
  const s = settleRest(r, now);
  if (s.phase !== 'run') return s;
  return { phase: 'pause', last: s.last, dur: s.dur, leftMs: s.endAt - now, pausedAt: now };
}

/** Resume a paused Rest: it ends `leftMs` from now (a stale pause has cleared). */
export function resumeRest(r: Rest, now: number): Rest {
  const s = settleRest(r, now);
  if (s.phase !== 'pause') return s;
  return { phase: 'run', last: s.last, dur: s.dur, endAt: now + s.leftMs };
}

/** The screen's round primary button: pause / resume / restart / start. */
export function toggleRest(r: Rest, now: number): Rest {
  const s = settleRest(r, now);
  switch (s.phase) {
    case 'run':
      return pauseRest(s, now);
    case 'pause':
      return resumeRest(s, now);
    default:
      return restartRest(s, now);
  }
}

/**
 * -15 / +15 (any whole `deltaS`). Running or paused, it moves the time left; reaching
 * zero finishes the Rest now (never a past zero, so the overtime starts at +0:00). The
 * time left is capped at MAX_REST_S, and `dur` grows to cover it. Idle, it nudges the
 * remembered length within [MIN_REST_S, MAX_REST_S]. A finished Rest ignores it.
 */
export function adjustRest(r: Rest, deltaS: number, now: number): Rest {
  if (!Number.isFinite(deltaS)) return r;
  const s = settleRest(r, now);
  if (s.phase === 'idle') return { phase: 'idle', last: clampRest(s.last + deltaS) };
  if (s.phase === 'done') return s;
  const leftMs = (s.phase === 'run' ? s.endAt - now : s.leftMs) + deltaS * 1000;
  if (leftMs <= 0) return { phase: 'done', last: s.last, dur: s.dur, endAt: now };
  const left = Math.min(leftMs, MAX_REST_S * 1000);
  const dur = Math.max(s.dur, Math.ceil(left / 1000));
  return s.phase === 'run'
    ? { phase: 'run', last: s.last, dur, endAt: now + left }
    : { phase: 'pause', last: s.last, dur, leftMs: left, pausedAt: s.pausedAt };
}

/** Read a Rest at `now`: the phase, the clock text and the ring's fraction. */
export function readRest(r: Rest, now: number): RestReading {
  const s = settleRest(r, now);
  switch (s.phase) {
    case 'idle':
      return { phase: 'idle', text: formatClock(s.last), fraction: 1, length: formatClock(s.last) };
    case 'done':
      return {
        phase: 'over',
        text: `+${formatClock((now - s.endAt) / 1000)}`,
        fraction: 0,
        length: formatClock(s.dur),
      };
    default: {
      const leftMs = s.phase === 'run' ? s.endAt - now : s.leftMs;
      return {
        phase: s.phase,
        // Counting down shows the second in progress (1:59.4 left reads 2:00), so the
        // clock reads 0:00 only at zero itself.
        text: formatClock(Math.ceil(leftMs / 1000 - 1e-9)),
        fraction: Math.min(1, Math.max(0, leftMs / (s.dur * 1000))),
        length: formatClock(s.dur),
      };
    }
  }
}

// ---- persistence (the shell stores these strings under its own keys, ADR-0007) ----

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isLen = (v: unknown): v is number => isNum(v) && v >= MIN_REST_S && v <= MAX_REST_S;

/** The Rest as a storable string (epoch-ms end times survive a reload). */
export function serializeRest(r: Rest): string {
  return JSON.stringify(r);
}

/**
 * A stored Rest, validated at the boundary (ADR-0007): anything malformed, of an
 * unknown phase or out of range reads as null and the shell falls back to idle.
 */
export function parseRest(raw: string | null): Rest | null {
  if (raw === null) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (!isLen(o.last)) return null;
  const last = Math.round(o.last);
  if (o.phase === 'idle') return { phase: 'idle', last };
  if (!isNum(o.dur) || o.dur <= 0 || o.dur > MAX_REST_S) return null;
  const dur = Math.ceil(o.dur);
  if (o.phase === 'run' || o.phase === 'done') {
    if (!isNum(o.endAt)) return null;
    return { phase: o.phase, last, dur, endAt: o.endAt };
  }
  if (o.phase === 'pause') {
    if (!isNum(o.leftMs) || o.leftMs <= 0 || o.leftMs > MAX_REST_S * 1000) return null;
    if (!isNum(o.pausedAt)) return null;
    return { phase: 'pause', last, dur, leftMs: o.leftMs, pausedAt: o.pausedAt };
  }
  return null;
}

/** The timer settings (the screen's sliders card). */
export type RestSettings = {
  /** "Chime at zero": a short two-note chime when the Rest ends. Off by default. */
  readonly chime: boolean;
  /** "Start after Next": Warm up's Next starts the remembered Rest. On by default. */
  readonly autoStart: boolean;
};

export const DEFAULT_REST_SETTINGS: RestSettings = { chime: false, autoStart: true };

export function serializeRestSettings(s: RestSettings): string {
  return JSON.stringify({ chime: s.chime, autoStart: s.autoStart });
}

/** Stored settings, each field validated on its own; a missing or bad field is its default. */
export function parseRestSettings(raw: string | null): RestSettings {
  if (raw === null) return DEFAULT_REST_SETTINGS;
  try {
    const o = JSON.parse(raw) as Record<string, unknown> | null;
    if (typeof o !== 'object' || o === null) return DEFAULT_REST_SETTINGS;
    return {
      chime: typeof o.chime === 'boolean' ? o.chime : DEFAULT_REST_SETTINGS.chime,
      autoStart: typeof o.autoStart === 'boolean' ? o.autoStart : DEFAULT_REST_SETTINGS.autoStart,
    };
  } catch {
    return DEFAULT_REST_SETTINGS;
  }
}
