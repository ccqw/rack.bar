// The screen wake lock (RBAR-80): keep the phone from dimming while the lifter is
// reading the Bar at the rack -- fullscreen and Warm up. A tiny shell helper, no lib
// logic: the console says whether it wants the lock (`hold(true|false)`, idempotent, so
// it can be called on every render), and this owns the navigator.wakeLock dance.
//
// - The browser drops the lock whenever the page hides, so while wanted it re-requests
//   on visibilitychange back to visible.
// - An unsupported browser or a rejected request is silently tolerated: no UI, no error.
//   The lock is a nicety, never a requirement.

// navigator.wakeLock is typed as always present, but older Safari/Firefox lack it.
const api = (): WakeLock | undefined =>
  (navigator as Navigator & { wakeLock?: WakeLock }).wakeLock;

export class ScreenWake {
  private want = false;
  private sentinel: WakeLockSentinel | null = null;
  private pending = false;
  private readonly onVisibility = (): void => this.acquire();

  /** Whether the lock is currently held (a granted, unreleased sentinel). */
  get held(): boolean {
    return this.sentinel !== null;
  }

  /** Want the screen kept awake, or not. Idempotent; safe to call on every render. */
  hold(want: boolean): void {
    if (want === this.want) return;
    this.want = want;
    if (want) {
      document.addEventListener('visibilitychange', this.onVisibility);
      this.acquire();
    } else {
      document.removeEventListener('visibilitychange', this.onVisibility);
      this.release();
    }
  }

  private acquire(): void {
    const wl = api();
    if (!this.want || this.sentinel || this.pending || !wl) return;
    // A hidden page's request rejects; the visibilitychange listener retries.
    if (document.visibilityState !== 'visible') return;
    this.pending = true;
    let request: Promise<WakeLockSentinel>;
    try {
      request = wl.request('screen');
    } catch {
      this.pending = false;
      return;
    }
    request.then(
      (s) => {
        this.pending = false;
        // Released while the request was in flight: give it straight back.
        if (!this.want) return void s.release().catch(() => {});
        this.sentinel = s;
        // The browser releases it on hide; forget it so the next visible re-acquires.
        s.addEventListener('release', () => {
          if (this.sentinel === s) this.sentinel = null;
        });
      },
      () => {
        this.pending = false; // denied (power saver, policy): stay quiet
      },
    );
  }

  private release(): void {
    const s = this.sentinel;
    this.sentinel = null;
    s?.release().catch(() => {});
  }
}
