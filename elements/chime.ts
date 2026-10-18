// The Rest chime (RBAR-94, ADR-0019): one soft two-note sine chime, about 0.6 s, played
// once when a Rest reaches zero -- never an alarm, nothing to dismiss. Off by default
// ("Chime at zero" in the timer settings), with a preview button beside the switch.
//
// Web Audio must be unlocked by a user gesture (iOS Safari starts every AudioContext
// suspended), so the shell calls unlock() on the first tap anywhere in the timer and
// play() later from the clock. Synthesis is not unit-tested (happy-dom has no audio);
// the clock takes a Chime, so tests pass a fake through this seam.

/** The seam the Rest clock plays through. */
export type Chime = {
  /** Create / resume the audio context. Call from a user gesture. Never throws. */
  unlock(): void;
  /** Play the chime once. Silently does nothing without audio. Never throws. */
  play(): void;
};

type AudioCtor = typeof AudioContext;

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
    try {
      ctx = new Ctor();
    } catch {
      ctx = null;
    }
    return ctx;
  };
  return {
    unlock() {
      wake(context());
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
