import { describe, it, expect, vi, afterEach } from 'vitest';
import { registerOffline, RackUpdate, ACCEPT_TIMEOUT_MS, READY_ANNOUNCEMENT } from './update.ts';
import type { WorkerContainer } from './update.ts';

// RBAR-81 (ADR-0018): an updated worker waits; the lifter gets one quiet Update
// button, and only that tap activates the new worker and reloads. Driven with fake
// service-worker objects (happy-dom has no service workers); registration itself is
// skipped outside production builds, so importing this module registers nothing.

type FakeWorker = EventTarget & { state: string; postMessage: ReturnType<typeof vi.fn> };

/** A minimal event target with a settable state, standing in for a ServiceWorker. */
function fakeWorker(state = 'installing'): FakeWorker {
  const t = new EventTarget() as FakeWorker;
  t.state = state;
  t.postMessage = vi.fn();
  return t;
}

/** Move a fake worker to a new lifecycle state, as the browser would. */
function become(w: FakeWorker, state: string): void {
  w.state = state;
  w.dispatchEvent(new Event('statechange'));
}

function setup(opts: { controlled: boolean; waiting?: boolean; installing?: boolean }) {
  const reg = new EventTarget() as EventTarget & {
    waiting: FakeWorker | null;
    installing: FakeWorker | null;
    update: ReturnType<typeof vi.fn>;
  };
  reg.waiting = opts.waiting ? fakeWorker('installed') : null;
  reg.installing = opts.installing ? fakeWorker('installing') : null;
  reg.update = vi.fn(() => Promise.resolve());
  const container = new EventTarget() as EventTarget & WorkerContainer;
  Object.assign(container, {
    controller: opts.controlled ? ({} as ServiceWorker) : null,
    register: vi.fn(() => Promise.resolve(reg)),
  });
  // A fresh document per test, so visibilitychange listeners never pile up on the
  // shared one.
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' }) as unknown as Document;
  const offer = vi.fn<(accept: () => void) => void>();
  const reload = vi.fn();
  const start = () => registerOffline(container, offer, reload, doc);
  return { reg, container, offer, reload, doc, start };
}

/** The accept callback from the nth offer. */
const acceptOf = (offer: ReturnType<typeof vi.fn>, n = 0) =>
  offer.mock.calls[n]![0] as () => void;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('registerOffline', () => {
  it('registers /sw.js', async () => {
    const s = setup({ controlled: false });
    await s.start();
    expect(s.container.register).toHaveBeenCalledWith('/sw.js');
  });

  it('offers nothing on a first install (no controller yet)', async () => {
    const s = setup({ controlled: false });
    await s.start();
    const w = fakeWorker();
    s.reg.installing = w;
    s.reg.dispatchEvent(new Event('updatefound'));
    become(w, 'installed');
    // the first install's clients.claim() changes the controller: no reload
    s.container.dispatchEvent(new Event('controllerchange'));
    expect(s.offer).not.toHaveBeenCalled();
    expect(s.reload).not.toHaveBeenCalled();
  });

  it('offers nothing for a waiting worker when the page is not controlled (shift-reload)', async () => {
    const s = setup({ controlled: false, waiting: true });
    await s.start();
    expect(s.offer).not.toHaveBeenCalled();
  });

  it('offers an update already waiting at load', async () => {
    const s = setup({ controlled: true, waiting: true });
    await s.start();
    expect(s.offer).toHaveBeenCalledTimes(1);
  });

  it('offers an update already installing when register() resolves', async () => {
    // the browser's own navigation-time update check started it before this page
    // held the registration, so its updatefound has already fired
    const s = setup({ controlled: true, installing: true });
    await s.start();
    expect(s.offer).not.toHaveBeenCalled();
    become(s.reg.installing!, 'installed');
    expect(s.offer).toHaveBeenCalledTimes(1);
  });

  it('offers an update that finishes installing while the app is open', async () => {
    const s = setup({ controlled: true });
    await s.start();
    const w = fakeWorker();
    s.reg.installing = w;
    s.reg.dispatchEvent(new Event('updatefound'));
    expect(s.offer).not.toHaveBeenCalled();
    become(w, 'installed');
    expect(s.offer).toHaveBeenCalledTimes(1);
  });

  it('never reloads on its own: only after the lifter accepts', async () => {
    vi.useFakeTimers();
    const s = setup({ controlled: true, waiting: true });
    await s.start();
    s.container.dispatchEvent(new Event('controllerchange'));
    vi.advanceTimersByTime(ACCEPT_TIMEOUT_MS * 10);
    expect(s.reload).not.toHaveBeenCalled();

    acceptOf(s.offer)();
    expect(s.reg.waiting!.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(s.reload).not.toHaveBeenCalled(); // not until the new worker takes over
    s.container.dispatchEvent(new Event('controllerchange'));
    expect(s.reload).toHaveBeenCalledTimes(1);
  });

  it('reloads once when the accepted worker activates, even if controllerchange follows', async () => {
    vi.useFakeTimers();
    const s = setup({ controlled: true, waiting: true });
    await s.start();
    acceptOf(s.offer)();
    become(s.reg.waiting!, 'activated');
    s.container.dispatchEvent(new Event('controllerchange'));
    vi.advanceTimersByTime(ACCEPT_TIMEOUT_MS);
    expect(s.reload).toHaveBeenCalledTimes(1);
  });

  it('reloads after a timeout if the accepted worker never reports back', async () => {
    vi.useFakeTimers();
    const s = setup({ controlled: true, waiting: true });
    await s.start();
    acceptOf(s.offer)();
    vi.advanceTimersByTime(ACCEPT_TIMEOUT_MS - 1);
    expect(s.reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(s.reload).toHaveBeenCalledTimes(1);
  });

  it('re-offers a newer waiting worker when the accepted one turns redundant', async () => {
    vi.useFakeTimers();
    const s = setup({ controlled: true, waiting: true });
    await s.start();
    const first = s.reg.waiting!;
    acceptOf(s.offer)();
    const newer = fakeWorker('installed');
    s.reg.waiting = newer;
    become(first, 'redundant');
    expect(s.offer).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(ACCEPT_TIMEOUT_MS * 2); // the first tap's fallback is off
    expect(s.reload).not.toHaveBeenCalled();
    acceptOf(s.offer, 1)();
    expect(newer.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  });

  it('reloads onto the newest page when the accepted worker turns redundant with nothing newer', async () => {
    vi.useFakeTimers();
    const s = setup({ controlled: true, waiting: true });
    await s.start();
    const first = s.reg.waiting!;
    acceptOf(s.offer)();
    s.reg.waiting = null;
    become(first, 'redundant');
    expect(s.reload).toHaveBeenCalledTimes(1);
  });

  it('checks for a new version when the app returns to the foreground', async () => {
    const s = setup({ controlled: true });
    await s.start();
    s.doc.dispatchEvent(new Event('visibilitychange'));
    expect(s.reg.update).toHaveBeenCalled();
  });

  it('logs a failed update check only when online', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const online = vi.spyOn(navigator, 'onLine', 'get');
    const s = setup({ controlled: true });
    s.reg.update = vi.fn(() => Promise.reject(new TypeError('bad sw.js')));
    await s.start();

    online.mockReturnValue(false);
    s.doc.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).not.toHaveBeenCalled();

    online.mockReturnValue(true);
    s.doc.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('<rack-update>', () => {
  const make = () => {
    const el = document.createElement('rack-update') as RackUpdate;
    document.body.append(el);
    return el;
  };
  const button = (el: RackUpdate) =>
    el.shadowRoot!.querySelector<HTMLButtonElement>('[data-update]')!;
  const status = (el: RackUpdate) => el.shadowRoot!.querySelector('[role="status"]')!;

  it('is hidden until an update is offered', () => {
    const el = make();
    expect(el.hidden).toBe(true);
    el.offer(() => {});
    expect(el.hidden).toBe(false);
    el.remove();
  });

  it('is one plain button reading "Update", named for what it updates', () => {
    const el = make();
    expect(el.shadowRoot!.querySelectorAll('button')).toHaveLength(1);
    expect(button(el).textContent).toBe('Update');
    expect(button(el).getAttribute('aria-label')).toBe('Update rack.bar');
    expect(button(el).type).toBe('button');
    el.remove();
  });

  it('announces its arrival through a status region, and clears it on tap', () => {
    vi.useFakeTimers();
    const el = make();
    expect(status(el).textContent).toBe('');
    el.offer(() => {});
    vi.advanceTimersByTime(100);
    expect(status(el).textContent).toBe(READY_ANNOUNCEMENT);
    button(el).click();
    expect(status(el).textContent).toBe('');
    el.remove();
  });

  it('accepts once on tap and hides', () => {
    const el = make();
    const accept = vi.fn();
    el.offer(accept);
    button(el).click();
    button(el).click();
    expect(accept).toHaveBeenCalledTimes(1);
    expect(el.hidden).toBe(true);
    el.remove();
  });

  it('keeps a 44px tap target around the 36px pill', () => {
    const el = make();
    const css = el.shadowRoot!.querySelector('style')!.textContent!;
    expect(css).toMatch(/min-height:\s*36px/);
    expect(css).toMatch(/button::after\s*\{[^}]*inset:\s*-4px 0/);
    el.remove();
  });

  it('styles through --rack-* tokens', () => {
    const el = make();
    const css = el.shadowRoot!.querySelector('style')!.textContent!;
    expect(css).toContain('var(--rack-accent)');
    expect(css).not.toMatch(/#[0-9a-f]{3,6}\b/i);
    el.remove();
  });
});
