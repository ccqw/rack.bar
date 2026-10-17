// RBAR-80: the screen stays awake while fullscreen or Warm up is showing. The helper
// (ScreenWake) against a stubbed navigator.wakeLock, then the console wiring through the
// real controls (the mode toggle, the fullscreen button, the card's close).
import { describe, it, expect, afterEach } from 'vitest';
import './console.ts';
import { ScreenWake } from './wakelock.ts';
import { stubWakeLock, flush } from './wakelock.stub.ts';
import type { WakeStub } from './wakelock.stub.ts';

let stub: WakeStub | null = null;
// Every helper a test makes, let go after it so no visibilitychange listener leaks on.
const made: ScreenWake[] = [];
const wake = (): ScreenWake => {
  const w = new ScreenWake();
  made.push(w);
  return w;
};
afterEach(() => {
  made.splice(0).forEach((w) => w.hold(false));
  stub?.restore();
  stub = null;
  document.body.innerHTML = '';
  localStorage.clear();
});

describe('ScreenWake', () => {
  it('requests the screen lock on hold(true) and releases it on hold(false)', async () => {
    stub = stubWakeLock();
    const w = wake();
    w.hold(true);
    await flush();
    expect(stub.live).toBe(1);
    expect(w.held).toBe(true);
    w.hold(false);
    await flush();
    expect(stub.live).toBe(0);
    expect(w.held).toBe(false);
  });

  it('is idempotent: repeated hold(true) asks once', async () => {
    stub = stubWakeLock();
    const w = wake();
    w.hold(true);
    w.hold(true);
    await flush();
    w.hold(true);
    await flush();
    expect(stub.requests).toBe(1);
    expect(stub.live).toBe(1);
  });

  it('re-acquires when the page comes back visible, while still wanted', async () => {
    stub = stubWakeLock();
    const w = wake();
    w.hold(true);
    await flush();
    stub.hide();
    await flush();
    expect(stub.live).toBe(0);
    stub.show();
    await flush();
    expect(stub.live).toBe(1);
    w.hold(false);
    stub.hide();
    stub.show();
    await flush();
    expect(stub.live).toBe(0);
  });

  it('re-acquires when the browser releases the lock while the page stays visible', async () => {
    stub = stubWakeLock();
    const w = wake();
    w.hold(true);
    await flush();
    stub.drop(); // battery saver / policy release, no visibility change
    await flush();
    expect(stub.live).toBe(1);
    expect(stub.requests).toBe(2);
  });

  it('a request in flight across a hide is refused, and the next visible asks again', async () => {
    stub = stubWakeLock();
    stub.stall = true;
    const w = wake();
    w.hold(true);
    stub.hide();
    stub.settle();
    await flush();
    expect(stub.live).toBe(0);
    stub.stall = false;
    stub.show();
    await flush();
    expect(stub.live).toBe(1);
  });

  it('never adopts an already-released sentinel', async () => {
    const dead = Object.assign(new EventTarget(), {
      released: true,
      release: () => Promise.resolve(),
    });
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: { request: () => Promise.resolve(dead) },
    });
    try {
      const w = wake();
      w.hold(true);
      await flush();
      expect(w.held).toBe(false);
    } finally {
      delete (navigator as { wakeLock?: unknown }).wakeLock;
    }
  });

  it('gives back a lock granted after it stopped being wanted', async () => {
    stub = stubWakeLock();
    const w = wake();
    w.hold(true);
    w.hold(false); // before the request settles
    await flush();
    expect(stub.live).toBe(0);
  });

  it('stays quiet when the request is rejected, and retries on the next visible', async () => {
    stub = stubWakeLock();
    stub.deny = true;
    const w = wake();
    w.hold(true);
    await flush();
    expect(stub.live).toBe(0);
    stub.deny = false;
    stub.show();
    await flush();
    expect(stub.live).toBe(1);
  });

  it('does nothing (and never throws) where the browser has no wakeLock', async () => {
    const w = wake();
    expect(() => {
      w.hold(true);
      w.hold(false);
      w.hold(true);
    }).not.toThrow();
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(w.held).toBe(false);
  });
});

describe('<rack-console> wake lock (RBAR-80)', () => {
  const mount = (): HTMLElement => {
    const el = document.createElement('rack-console');
    document.body.append(el);
    return el;
  };
  const btn = (el: HTMLElement, sel: string) =>
    el.shadowRoot!.querySelector<HTMLButtonElement>(sel)!;
  const card = (el: HTMLElement) =>
    el.shadowRoot!.querySelector<HTMLElement & { close(): void }>('rack-fullscreen')!;

  it('holds no lock in By Weight or By Plates', async () => {
    stub = stubWakeLock();
    const el = mount();
    await flush();
    expect(stub.live).toBe(0);
    btn(el, '[data-mode="encode"]').click();
    await flush();
    expect(stub.live).toBe(0);
  });

  it('holds the lock while Warm up is the mode, and releases it on leaving', async () => {
    stub = stubWakeLock();
    const el = mount();
    btn(el, '[data-mode="warmup"]').click();
    await flush();
    expect(stub.live).toBe(1);
    btn(el, '[data-mode="decode"]').click();
    await flush();
    expect(stub.live).toBe(0);
  });

  it('holds the lock while fullscreen is open, and releases it on close', async () => {
    stub = stubWakeLock();
    const el = mount();
    btn(el, '[data-fullscreen]').click();
    await flush();
    expect(stub.live).toBe(1);
    card(el).close();
    await flush();
    expect(stub.live).toBe(0);
  });

  it('keeps the lock when fullscreen closes over Warm up', async () => {
    stub = stubWakeLock();
    const el = mount();
    btn(el, '[data-mode="warmup"]').click();
    btn(el, '[data-fullscreen]').click();
    card(el).close();
    await flush();
    expect(stub.live).toBe(1);
  });

  it('lets go when the console is removed', async () => {
    stub = stubWakeLock();
    btn(mount(), '[data-mode="warmup"]').click();
    await flush();
    expect(stub.live).toBe(1);
    document.body.innerHTML = '';
    await flush();
    expect(stub.live).toBe(0);
  });

  it('re-acquires in Warm up after the page was hidden', async () => {
    stub = stubWakeLock();
    btn(mount(), '[data-mode="warmup"]').click();
    await flush();
    stub.hide();
    stub.show();
    await flush();
    expect(stub.live).toBe(1);
  });
});
