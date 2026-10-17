// TEST-ONLY: a stand-in navigator.wakeLock (RBAR-80). happy-dom has none, so the wake
// lock suites install this, drive the app, and read how many screen locks are live.
// Never imported by app code.

export type WakeStub = {
  /** Locks granted and not yet released (the browser's view of "held"). */
  readonly live: number;
  /** Every request('screen') call so far. */
  readonly requests: number;
  /** Make the next requests reject (power saver, policy). */
  deny: boolean;
  /** The browser hiding the page: every live lock is released by the system. */
  hide(): void;
  /** The page coming back: visibilityState 'visible' + a visibilitychange. */
  show(): void;
  /** Remove the stub (navigator.wakeLock absent again, the page visible). */
  restore(): void;
};

// Let the request promises (and their .then) settle.
export const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

let visibility: DocumentVisibilityState = 'visible';
Object.defineProperty(document, 'visibilityState', {
  configurable: true,
  get: () => visibility,
});

export function stubWakeLock(): WakeStub {
  const active = new Set<EventTarget>();
  let requests = 0;
  const stub = {
    deny: false,
    get live() {
      return active.size;
    },
    get requests() {
      return requests;
    },
    hide() {
      visibility = 'hidden';
      for (const s of [...active]) {
        active.delete(s);
        s.dispatchEvent(new Event('release'));
      }
      document.dispatchEvent(new Event('visibilitychange'));
    },
    show() {
      visibility = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
    },
    restore() {
      visibility = 'visible';
      delete (navigator as { wakeLock?: unknown }).wakeLock;
    },
  };
  const wakeLock = {
    request(type: string): Promise<EventTarget> {
      requests++;
      if (stub.deny || type !== 'screen' || visibility !== 'visible') {
        return Promise.reject(new DOMException('denied', 'NotAllowedError'));
      }
      const s = new EventTarget() as EventTarget & { release(): Promise<void> };
      s.release = () => {
        if (active.delete(s)) s.dispatchEvent(new Event('release'));
        return Promise.resolve();
      };
      active.add(s);
      return Promise.resolve(s);
    },
  };
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: wakeLock });
  return stub;
}
