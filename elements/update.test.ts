import { describe, it, expect, vi } from 'vitest';
import { registerOffline, RackUpdate } from './update.ts';
import type { WorkerContainer } from './update.ts';

// RBAR-81 (ADR-0018): an updated worker waits; the lifter gets one quiet Update
// button, and only that tap activates the new worker and reloads. Driven with fake
// service-worker objects (happy-dom has no service workers); registration itself is
// skipped outside production builds, so importing this module registers nothing.

/** A minimal event target with a settable state, standing in for a ServiceWorker. */
function fakeWorker(state = 'installing') {
  const t = new EventTarget() as EventTarget & { state: string; postMessage: ReturnType<typeof vi.fn> };
  t.state = state;
  t.postMessage = vi.fn();
  return t;
}

function setup(opts: { controlled: boolean; waiting?: boolean }) {
  const reg = new EventTarget() as EventTarget & {
    waiting: ReturnType<typeof fakeWorker> | null;
    installing: ReturnType<typeof fakeWorker> | null;
    update: ReturnType<typeof vi.fn>;
  };
  reg.waiting = opts.waiting ? fakeWorker('installed') : null;
  reg.installing = null;
  reg.update = vi.fn(() => Promise.resolve());
  const container = new EventTarget() as EventTarget & WorkerContainer;
  Object.assign(container, {
    controller: opts.controlled ? ({} as ServiceWorker) : null,
    register: vi.fn(() => Promise.resolve(reg)),
  });
  const offer = vi.fn<(accept: () => void) => void>();
  const reload = vi.fn();
  return { reg, container, offer, reload };
}

describe('registerOffline', () => {
  it('registers /sw.js', async () => {
    const s = setup({ controlled: false });
    await registerOffline(s.container, s.offer, s.reload);
    expect(s.container.register).toHaveBeenCalledWith('/sw.js');
  });

  it('offers nothing on a first install (no controller yet)', async () => {
    const s = setup({ controlled: false });
    await registerOffline(s.container, s.offer, s.reload);
    const w = fakeWorker();
    s.reg.installing = w;
    s.reg.dispatchEvent(new Event('updatefound'));
    w.state = 'installed';
    w.dispatchEvent(new Event('statechange'));
    // the first install's clients.claim() changes the controller: no reload
    s.container.dispatchEvent(new Event('controllerchange'));
    expect(s.offer).not.toHaveBeenCalled();
    expect(s.reload).not.toHaveBeenCalled();
  });

  it('offers an update already waiting at load', async () => {
    const s = setup({ controlled: true, waiting: true });
    await registerOffline(s.container, s.offer, s.reload);
    expect(s.offer).toHaveBeenCalledTimes(1);
  });

  it('offers an update that finishes installing while the app is open', async () => {
    const s = setup({ controlled: true });
    await registerOffline(s.container, s.offer, s.reload);
    const w = fakeWorker();
    s.reg.installing = w;
    s.reg.dispatchEvent(new Event('updatefound'));
    expect(s.offer).not.toHaveBeenCalled();
    w.state = 'installed';
    w.dispatchEvent(new Event('statechange'));
    expect(s.offer).toHaveBeenCalledTimes(1);
  });

  it('never reloads on its own: only after the lifter accepts', async () => {
    const s = setup({ controlled: true, waiting: true });
    await registerOffline(s.container, s.offer, s.reload);
    s.container.dispatchEvent(new Event('controllerchange'));
    expect(s.reload).not.toHaveBeenCalled();

    const accept = s.offer.mock.calls[0]![0];
    accept();
    expect(s.reg.waiting!.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(s.reload).not.toHaveBeenCalled(); // not until the new worker takes over
    s.container.dispatchEvent(new Event('controllerchange'));
    expect(s.reload).toHaveBeenCalledTimes(1);
  });

  it('checks for a new version when the app returns to the foreground', async () => {
    const s = setup({ controlled: true });
    await registerOffline(s.container, s.offer, s.reload);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(s.reg.update).toHaveBeenCalled();
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

  it('is hidden until an update is offered', () => {
    const el = make();
    expect(el.hidden).toBe(true);
    el.offer(() => {});
    expect(el.hidden).toBe(false);
    el.remove();
  });

  it('is one plain button reading "Update"', () => {
    const el = make();
    expect(el.shadowRoot!.querySelectorAll('button')).toHaveLength(1);
    expect(button(el).textContent).toBe('Update');
    expect(button(el).type).toBe('button');
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

  it('styles through --rack-* tokens', () => {
    const el = make();
    const css = el.shadowRoot!.querySelector('style')!.textContent!;
    expect(css).toContain('var(--rack-accent)');
    expect(css).not.toMatch(/#[0-9a-f]{3,6}\b/i);
    el.remove();
  });
});
