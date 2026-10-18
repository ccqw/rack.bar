// The Rest chime (RBAR-94, ADR-0019): one soft two-note sine chime, about 0.6 s, played
// once when a Rest reaches zero -- never an alarm, nothing to dismiss. Off by default
// ("Chime at zero" in the timer settings), with a preview button beside the switch.
//
// Web Audio must be unlocked by a user gesture (iOS Safari starts every AudioContext
// suspended), so the shell calls unlock() on every tap in the timer while the chime is
// on, and play() later from the clock. unlock() resumes the context INSIDE the gesture
// and starts a one-sample silent buffer there too (older iOS only counts a context as
// unlocked once a sound has started from a gesture). Synthesis is not unit-tested
// (happy-dom has no audio); the clock takes a Chime, so tests pass a fake.
//
// iOS and the ringer switch (ADR-0019, section 7): a page's audio session defaults to
// WebKit's "ambient" category, which MIXES with other apps' audio (the lifter's music
// keeps playing) but is MUTED by the silent switch. Safari 17+ exposes
// navigator.audioSession; its only type that plays through the silent switch is
// 'playback', and WebKit maps that to the non-mixable Playback category, so it would
// pause the lifter's music at every zero. We set 'transient' (a short sound over other
// audio; ambient underneath) where it exists and is still 'auto': the chime mixes with
// music, and on a phone in silent mode it stays silent, like any notification ding.
// Feature-detected throughout; without the API nothing changes.

/** The seam the Rest clock plays through. */
export type Chime = {
  /** Create / resume the audio context. Call from a user gesture. Never throws. */
  unlock(): void;
  /** Play the chime once. Silently does nothing without audio. Never throws. */
  play(): void;
};

type AudioCtor = typeof AudioContext;
type AudioSessionLike = { type: string };

/** The audio session type the chime asks for (ADR-0019): mixes with music. */
export const CHIME_SESSION_TYPE = 'transient';

/** Ask for CHIME_SESSION_TYPE where Safari's navigator.audioSession exists and the page
 * has not chosen a type already. Never throws. */
export function preferMixingSession(nav: Navigator = navigator): void {
  const session = (nav as Navigator & { audioSession?: AudioSessionLike }).audioSession;
  if (!session || typeof session.type !== 'string') return;
  try {
    if (session.type === 'auto') session.type = CHIME_SESSION_TYPE;
  } catch {
    /* an unknown type on an older engine: keep the default */
  }
}

// E5 then B5, 140 ms apart: a quick attack and an exponential decay each, so the two
// notes overlap into one soft "ding-dong" that has died away by about 0.62 s.
const NOTES: ReadonlyArray<readonly [hz: number, at: number]> = [
  [659.25, 0],
  [987.77, 0.14],
];
const PEAK = 0.18;
const ATTACK_S = 0.012;
const DECAY_S = 0.46;

// Resume a context that is not running: 'suspended' before a gesture, and iOS's
// 'interrupted' after a call or the app going to the background. Cheap when running.
function wake(c: AudioContext | null): void {
  if (c && c.state !== 'running' && c.state !== 'closed') c.resume().catch(() => {});
}

export function webAudioChime(): Chime {
  let ctx: AudioContext | null = null;
  const context = (): AudioContext | null => {
    if (ctx) return ctx;
    const Ctor = (window.AudioContext ??
      (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext) as
      | AudioCtor
      | undefined;
    if (!Ctor) return null;
    preferMixingSession();
    try {
      ctx = new Ctor();
    } catch {
      ctx = null;
    }
    return ctx;
  };
  return {
    unlock() {
      const c = context();
      if (!c || c.state === 'running') return;
      wake(c);
      try {
        // A one-sample silent buffer started inside the gesture.
        const src = c.createBufferSource();
        src.buffer = c.createBuffer(1, 1, c.sampleRate);
        src.connect(c.destination);
        src.start(0);
      } catch {
        /* the resume above is the unlock that matters */
      }
    },
    play() {
      const c = context();
      if (!c) return;
      try {
        wake(c);
        const t0 = c.currentTime + 0.02;
        for (const [hz, at] of NOTES) {
          const osc = c.createOscillator();
          const gain = c.createGain();
          osc.type = 'sine';
          osc.frequency.value = hz;
          osc.connect(gain);
          gain.connect(c.destination);
          const s = t0 + at;
          gain.gain.setValueAtTime(0.0001, s);
          gain.gain.exponentialRampToValueAtTime(PEAK, s + ATTACK_S);
          gain.gain.exponentialRampToValueAtTime(0.0001, s + DECAY_S);
          osc.start(s);
          osc.stop(s + DECAY_S + 0.02);
        }
      } catch (err) {
        // A chime is a nicety; leave a trace for field debugging, no UI.
        console.debug('rack.bar: rest chime failed', err);
      }
    },
  };
}
