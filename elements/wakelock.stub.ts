// TEST-ONLY: a stand-in navigator.wakeLock (RBAR-80). happy-dom has none, so the wake
// lock suites install this, drive the app, and read how many screen locks are live.
// Never imported by app code.
//
// NOTE: importing this module redefines document.visibilityState for the whole test
// file (a getter over the stub's own visibility flag, 'visible' until hide()).
// restore() puts it back to 'visible'.
//
// Like a browser, a request settles in a later task (not synchronously), and is judged
// THEN: a page hidden by the time it settles is refused. So a request can be in flight
// across a hide. `stall` holds requests until settle(), to pin one in flight.

export type WakeStub = {
  /** Locks granted and not yet released (the browser's view of "held"). */
  readonly live: number;
  /** Every request('screen') call so far. */
  readonly requests: number;
  /** Make requests reject when they settle (power saver, policy). */
  deny: boolean;
  /** Hold requests in flight until settle() instead of settling on the next task. */
  stall: boolean;
  /** Settle every stalled request now. */
  settle(): void;
  /** The browser hiding the page: every live lock is released by the system. */
  hide(): void;
  /** The page coming back: visibilityState 'visible' + a visibilitychange. */
  show(): void;
  /** The browser releasing every live lock while the page stays visible (battery saver). */
  drop(): void;
  /** Remove the stub (navigator.wakeLock absent again, the page visible). */
  restore(): void;
};

type Sentinel = EventTarget & { released: boolean; release(): Promise<void> };

// Let the request promises (and their .then) settle.
export const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

let visibility: DocumentVisibilityState = 'visible';
Object.defineProperty(document, 'visibilityState', {
  configurable: true,
  get: () => visibility,
});

export function stubWakeLock(): WakeStub {
  const active = new Set<Sentinel>();
  const stalled: Array<() => void> = [];
  let requests = 0;
  const systemRelease = (): void => {
    for (const s of [...active]) {
      active.delete(s);
      s.released = true;
      s.dispatchEvent(new Event('release'));
    }
  };
  const stub = {
    deny: false,
    stall: false,
    get live() {
      return active.size;
    },
    get requests() {
      return requests;
    },
    settle() {
      stalled.splice(0).forEach((go) => go());
    },
    hide() {
      visibility = 'hidden';
      systemRelease();
      document.dispatchEvent(new Event('visibilitychange'));
    },
    show() {
      visibility = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
    },
    drop: systemRelease,
    restore() {
      visibility = 'visible';
      delete (navigator as { wakeLock?: unknown }).wakeLock;
    },
  };
  const grant = (type: string): Promise<Sentinel> => {
    if (stub.deny || type !== 'screen' || visibility !== 'visible') {
      return Promise.reject(new DOMException('denied', 'NotAllowedError'));
    }
    const s = new EventTarget() as Sentinel;
    s.released = false;
    s.release = () => {
      if (active.delete(s)) {
        s.released = true;
        s.dispatchEvent(new Event('release'));
      }
      return Promise.resolve();
    };
    active.add(s);
    return Promise.resolve(s);
  };
  const wakeLock = {
    request(type: string): Promise<Sentinel> {
      requests++;
      return new Promise((resolve, reject) => {
        const go = (): void => void grant(type).then(resolve, reject);
        if (stub.stall) stalled.push(go);
        else setTimeout(go, 0);
      });
    },
  };
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: wakeLock });
  return stub;
}
