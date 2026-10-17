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
import { VISUALLY_HIDDEN } from './sectionlabel.ts';

/** The parts of navigator.serviceWorker this module uses (a seam for tests). */
export type WorkerContainer = Pick<
  ServiceWorkerContainer,
  'controller' | 'register' | 'addEventListener'
>;

/**
 * After the tap, how long to wait for the new worker to take over before reloading
 * anyway. The tap was the lifter asking for the new version, so a reload is expected;
 * this only guards a worker that never reports back.
 */
export const ACCEPT_TIMEOUT_MS = 4000;

/**
 * Register /sw.js and call `offer(accept)` whenever an updated worker is installed and
 * waiting behind the one controlling this page. `accept()` activates it; the page
 * reloads (via `reload`, once) when the new worker activates or takes control, or after
 * ACCEPT_TIMEOUT_MS. If the accepted worker turns redundant instead (a newer deploy
 * replaced it), a newer waiting worker is offered again, or the page reloads onto the
 * network's newest page. A first install (no controller yet) is not an update and
 * offers nothing.
 */
export async function registerOffline(
  sw: WorkerContainer,
  offer: (accept: () => void) => void,
  reload: () => void,
  doc: Document = document,
): Promise<ServiceWorkerRegistration> {
  const reg = await sw.register('/sw.js');
  let accepted = false;
  let reloaded = false;
  const reloadOnce = (): void => {
    if (reloaded) return;
    reloaded = true;
    reload();
  };

  const waiting = (worker: ServiceWorker): void => {
    if (!sw.controller) return;
    offer(() => {
      accepted = true;
      const fallback = setTimeout(reloadOnce, ACCEPT_TIMEOUT_MS);
      worker.addEventListener('statechange', () => {
        if (worker.state === 'activated') reloadOnce();
        if (worker.state !== 'redundant') return;
        clearTimeout(fallback);
        accepted = false;
        if (reg.waiting && reg.waiting !== worker) waiting(reg.waiting);
        else if (!reg.installing) reloadOnce();
        // else: a newer worker is still installing; track() offers it once installed.
      });
      worker.postMessage({ type: 'SKIP_WAITING' });
    });
  };

  // Offer a worker once it finishes installing. The browser may already be installing
  // one when register() resolves (its own update check ran during navigation, before
  // this page held the registration), so that one is tracked as well as later ones.
  const track = (worker: ServiceWorker): void => {
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed') waiting(worker);
    });
  };
  if (reg.waiting) waiting(reg.waiting);
  if (reg.installing) track(reg.installing);
  reg.addEventListener('updatefound', () => {
    if (reg.installing) track(reg.installing);
  });

  // The first install's clients.claim() also changes the controller; only a change the
  // lifter asked for reloads.
  sw.addEventListener('controllerchange', () => {
    if (accepted) reloadOnce();
  });
  // An installed app can sit open for days: look for a new version whenever it comes
  // back to the foreground. Offline the check fails and the cached app carries on, with
  // nothing to tell the lifter; online, a failure (say a broken /sw.js deploy) is logged.
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState !== 'visible') return;
    reg.update().catch((err: unknown) => {
      if (navigator.onLine) console.warn('rack.bar: update check failed', err);
    });
  });
  return reg;
}

/** What the status region says when the button appears (screen readers only). */
export const READY_ANNOUNCEMENT = 'A new version of rack.bar is ready.';

/**
 * <rack-update> -- the one quiet "Update" button, shown only while a new version is
 * waiting. It sits over the header's wordmark (fixed, so it never changes the page's
 * height -- the one-screen fit, ADR-0013): the header has no free space at a phone
 * width, and the wordmark is the one thing in it the lifter never taps, so covering it
 * hides no control. The app stays fully usable underneath. Its arrival is announced
 * through a role="status" region, like the console's announcements (RBAR-53).
 */
export class RackUpdate extends HTMLElement {
  private root: ShadowRoot = this.attachShadow({ mode: 'open' });
  private accept: (() => void) | null = null;
  private announceTimer: ReturnType<typeof setTimeout> | undefined;

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
    // Type and size match the header's Setup pill (app.ts); like it and the section
    // labels, the 11px type has no token (tokens.css has no type scale).
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
          position: relative; flex: 1;
          font-family: var(--rack-font-num); font-size: 11px; font-weight: 600;
          letter-spacing: .04em; color: var(--rack-accent-ink);
          background: var(--rack-accent); border: 0;
          border-radius: var(--rack-radius-pill); padding: 8px 14px; min-height: 36px;
          cursor: pointer;
        }
        /* The 36px pill keeps a 44px-tall tap target: an invisible layer 4px past it
           above and below (the console's icon-button idiom, RBAR-67). */
        button::after { content: ""; position: absolute; inset: -4px 0; }
        button:focus-visible { outline: 2px solid var(--rack-fg); outline-offset: 2px; }
        .sr { ${VISUALLY_HIDDEN} }
      </style>
      <button type="button" data-update aria-label="Update rack.bar">Update</button>
      <div class="sr" data-announce role="status"></div>
    `;
    this.root.querySelector('[data-update]')!.addEventListener('click', () => {
      this.accept?.();
      this.accept = null;
      this.hide();
    });
  }

  disconnectedCallback(): void {
    window.removeEventListener('resize', this.place);
    clearTimeout(this.announceTimer);
  }

  /** Show the button over the wordmark and announce it; a tap calls `accept` once. */
  offer(accept: () => void): void {
    this.accept = accept;
    this.hidden = false;
    this.place();
    window.addEventListener('resize', this.place);
    // Fill the live region a beat after it is shown: a region that appears already
    // holding its text is not reliably announced.
    const region = this.root.querySelector('[data-announce]')!;
    region.textContent = '';
    clearTimeout(this.announceTimer);
    this.announceTimer = setTimeout(() => {
      region.textContent = READY_ANNOUNCEMENT;
    }, 100);
  }

  private hide(): void {
    this.hidden = true;
    window.removeEventListener('resize', this.place);
    clearTimeout(this.announceTimer);
    this.root.querySelector('[data-announce]')!.textContent = '';
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
