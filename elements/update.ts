// update.ts -- registers the offline service worker and offers a waiting update
// (RBAR-81, ADR-0018).
//
// The worker (scripts/sw.js, emitted as /sw.js by the build) precaches the app, so an
// installed rack.bar opens with no signal. A new deploy installs a new worker that
// WAITS: the page keeps running the version it loaded, and <rack-update> shows one
// quiet "Update" button. Only that tap activates the new worker and reloads -- the app
// never reloads itself mid-set.
//
// Registration runs in production builds only (import.meta.env.PROD): the dev server
// has no /sw.js, and tests drive registerOffline() with fakes.
import { BOX_SIZING } from './boxsizing.ts';
import { BUTTON_FX } from './buttonfx.ts';

/** The parts of navigator.serviceWorker this module uses (a seam for tests). */
export type WorkerContainer = Pick<
  ServiceWorkerContainer,
  'controller' | 'register' | 'addEventListener'
>;

/**
 * Register /sw.js and call `offer(accept)` whenever an updated worker is installed and
 * waiting behind the one controlling this page. `accept()` activates it; the page
 * reloads (via `reload`) only once the new worker has taken control after an accept.
 * A first install (no controller yet) is not an update and offers nothing.
 */
export async function registerOffline(
  sw: WorkerContainer,
  offer: (accept: () => void) => void,
  reload: () => void,
  doc: Document = document,
): Promise<ServiceWorkerRegistration> {
  const reg = await sw.register('/sw.js');
  let accepted = false;
  const waiting = (worker: ServiceWorker): void => {
    if (!sw.controller) return;
    offer(() => {
      accepted = true;
      worker.postMessage({ type: 'SKIP_WAITING' });
    });
  };
  if (reg.waiting) waiting(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const worker = reg.installing;
    worker?.addEventListener('statechange', () => {
      if (worker.state === 'installed') waiting(worker);
    });
  });
  // The first install's clients.claim() also changes the controller; only a change the
  // lifter asked for reloads.
  sw.addEventListener('controllerchange', () => {
    if (accepted) reload();
  });
  // An installed app can sit open for days: look for a new version whenever it comes
  // back to the foreground. Offline, the check fails and the cached app carries on --
  // there is nothing to tell the lifter, so the rejection is dropped on purpose.
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'visible') reg.update().catch(() => {});
  });
  return reg;
}

/**
 * <rack-update> -- the one quiet "Update" button, shown only while a new version is
 * waiting. It sits over the header's wordmark (fixed, so it never changes the page's
 * height -- the one-screen fit, ADR-0013): the header has no free space at a phone
 * width, and the wordmark is the one thing in it the lifter never taps, so covering it
 * hides no control. The app stays fully usable underneath.
 */
export class RackUpdate extends HTMLElement {
  private root: ShadowRoot = this.attachShadow({ mode: 'open' });
  private accept: (() => void) | null = null;

  // Lay the button over the wordmark's box, centred on it. Re-run on resize while
  // shown (the header changes height at the short-screen tier, RBAR-67). Without a
  // wordmark (another page), the CSS default spot -- the header row's left -- stands.
  private place = (): void => {
    const mark = document.querySelector('rack-app')?.shadowRoot?.querySelector('.wordmark');
    if (!mark) return;
    const r = mark.getBoundingClientRect();
    this.style.left = `${r.left}px`;
    this.style.top = `${r.top + r.height / 2}px`;
    this.style.minWidth = `${r.width}px`;
  };

  connectedCallback(): void {
    if (this.root.firstChild) return;
    this.hidden = true;
    this.root.innerHTML = `
      <style>
        ${BOX_SIZING}${BUTTON_FX}
        :host {
          position: fixed; z-index: 5; transform: translateY(-50%);
          left: calc(env(safe-area-inset-left) + 22px);
          top: calc(env(safe-area-inset-top) + 32px);
          display: flex;
        }
        :host([hidden]) { display: none; }
        button {
          flex: 1;
          font-family: var(--rack-font-num); font-size: 11px; font-weight: 600;
          letter-spacing: .04em; color: var(--rack-accent-ink);
          background: var(--rack-accent); border: 0;
          border-radius: var(--rack-radius-pill); padding: 8px 14px; min-height: 36px;
          cursor: pointer;
        }
        button:focus-visible { outline: 2px solid var(--rack-fg); outline-offset: 2px; }
      </style>
      <button type="button" data-update>Update</button>
    `;
    this.root.querySelector('[data-update]')!.addEventListener('click', () => {
      this.accept?.();
      this.accept = null;
      this.hide();
    });
  }

  disconnectedCallback(): void {
    window.removeEventListener('resize', this.place);
  }

  /** Show the button over the wordmark; a tap calls `accept` once. */
  offer(accept: () => void): void {
    this.accept = accept;
    this.hidden = false;
    this.place();
    window.addEventListener('resize', this.place);
  }

  private hide(): void {
    this.hidden = true;
    window.removeEventListener('resize', this.place);
  }
}

customElements.define('rack-update', RackUpdate);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const el = document.createElement('rack-update') as RackUpdate;
  document.body.append(el);
  // After load, so the worker's precache fetches never compete with the first paint.
  window.addEventListener('load', () => {
    registerOffline(
      navigator.serviceWorker,
      (accept) => el.offer(accept),
      () => location.reload(),
    ).catch((err: unknown) => console.error('rack.bar: offline support unavailable', err));
  });
}
