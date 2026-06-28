// <rack-app> -- the app shell and composition root (RBAR-15, ADR-0007). It owns the
// rig configuration (the Bar and the Collars; the plate set later) and feeds it down:
// it renders the header (wordmark + a Setup pill), the <rack-console> calculator, and
// the <rack-setup> sheet, and wires the three together.
//
//   pill tap             -> open the Setup sheet
//   sheet `barchange`    -> adopt the Bar: persist it, push it to the console, relabel
//                           the pill, reflect the active tile
//   sheet `collarchange` -> adopt the Collar: persist it, push it to the console, reflect
//                           the active tile (RBAR-16, ADR-0008)
//   sheet `close`        -> drop the pill's open state
//
// Each config concern persists shell-side under its own localStorage key (ADR-0007);
// the core stays pure and only ever sees these as function arguments (ADR-0001/0002).
import './console.ts';
import './setup.ts';
import { isOfferedBar, isOfferedCollar, DEFAULT_COLLAR_KG } from './setup.ts';
import { DEFAULT_BAR_KG } from '../lib/plates.ts';

type Console = HTMLElement & { barKg: number; collarKg: number };
type Setup = HTMLElement & {
  barKg: number;
  collarKg: number;
  open(): void;
  close(): void;
};

// One persisted config key per concern (ADR-0007); the unit preference and recents will
// join these as their slices land.
const STORAGE_KEY = 'rackbar.barKg';
const COLLAR_STORAGE_KEY = 'rackbar.collarKg';

class RackApp extends HTMLElement {
  private root: ShadowRoot = this.attachShadow({ mode: 'open' });
  private console!: Console;
  private setup!: Setup;
  private pill!: HTMLButtonElement;
  private pillLabel!: HTMLElement;

  private barKg = DEFAULT_BAR_KG;
  private collarKg = DEFAULT_COLLAR_KG;

  connectedCallback(): void {
    this.barKg = this.loadBar();
    this.collarKg = this.loadCollar();
    // Children are defined before this runs (imports at top + rack-app's own define is
    // last), so assigning innerHTML upgrades <rack-console>/<rack-setup> synchronously
    // and their connectedCallbacks finish here -- which is why the barKg seeding below
    // (after the queries) lands on already-connected elements, not inert ones.
    this.root.innerHTML = `
      <style>
        :host { display: flex; flex-direction: column; flex: 1; width: 100%; }
        header {
          display: flex; align-items: center; justify-content: space-between;
          gap: 12px; padding: 14px 18px;
        }
        .wordmark {
          font-family: var(--rack-font); font-weight: 800; font-size: 18px;
          letter-spacing: -.01em; color: var(--rack-fg);
        }
        .wordmark .dot { color: var(--rack-accent); }
        /* The Setup pill: the rig's current Bar, tappable to open the sheet. */
        .pill {
          display: inline-flex; align-items: center; gap: 7px;
          font-family: var(--rack-font-num); font-size: 12px; font-weight: 600;
          letter-spacing: .02em; color: var(--rack-muted);
          background: transparent; border: 1px solid var(--rack-line);
          border-radius: 999px; padding: 8px 14px; min-height: 36px; cursor: pointer;
        }
        .pill:hover { color: var(--rack-fg); }
        .pill:focus-visible { outline: 2px solid var(--rack-accent); outline-offset: 2px; }
        .pill .chev { display: block; transition: transform .16s ease; }
        .pill[aria-expanded="true"] .chev { transform: rotate(180deg); }
        main {
          flex: 1; display: flex; align-items: center; justify-content: center;
          padding: 2vh 5vw 6vh;
        }
      </style>
      <header>
        <span class="wordmark">rack<span class="dot">.</span>bar</span>
        <button type="button" class="pill" data-setup-pill
                aria-haspopup="dialog" aria-expanded="false">
          <span data-pill-label></span>
          <svg class="chev" width="11" height="11" viewBox="0 0 16 16" fill="none"
               aria-hidden="true">
            <path d="M3.5 6L8 10.5 12.5 6" stroke="currentColor" stroke-width="1.8"
                  stroke-linecap="round" stroke-linejoin="round"></path>
          </svg>
        </button>
      </header>
      <main><rack-console></rack-console></main>
      <rack-setup></rack-setup>
    `;

    this.console = this.root.querySelector('rack-console') as Console;
    this.setup = this.root.querySelector('rack-setup') as Setup;
    this.pill = this.root.querySelector('[data-setup-pill]')!;
    this.pillLabel = this.root.querySelector('[data-pill-label]')!;

    // Seed every surface from the (possibly persisted) Bar and Collar.
    this.console.barKg = this.barKg;
    this.console.collarKg = this.collarKg;
    this.setup.barKg = this.barKg;
    this.setup.collarKg = this.collarKg;
    this.relabel();

    this.pill.addEventListener('click', () => {
      this.setup.open();
      this.pill.setAttribute('aria-expanded', 'true');
    });
    this.setup.addEventListener('barchange', (e) =>
      this.adopt((e as CustomEvent<{ barKg: number }>).detail.barKg),
    );
    this.setup.addEventListener('collarchange', (e) =>
      this.adoptCollar((e as CustomEvent<{ collarKg: number }>).detail.collarKg),
    );
    this.setup.addEventListener('close', () =>
      this.pill.setAttribute('aria-expanded', 'false'),
    );
  }

  // Adopt a Bar chosen in Setup: persist it, thread it into the calculator, relabel the
  // pill, and reflect the active tile. The sheet stays open so the lifter sees the choice.
  // The barchange payload is an external contract (ADR-0007 grows it in RBAR-16/17), so an
  // off-menu Bar is an invariant breach, not a value to persist and feed the core -- ignore
  // it rather than stranding the readout on a Bar no tile matches or poisoning storage.
  private adopt(kg: number): void {
    if (!isOfferedBar(kg)) return;
    this.barKg = kg;
    this.saveBar(kg);
    this.console.barKg = kg;
    this.setup.barKg = kg;
    this.relabel();
  }

  // Adopt a Collar chosen in Setup: same shape as adopt() (ADR-0007/0008). An off-menu
  // value is an invariant breach (a rogue or forward-compat event), not a value to
  // persist and feed the core -- ignore it rather than stranding the rig on a Collar no
  // tile matches. The sheet stays open so the lifter sees the choice land.
  private adoptCollar(kg: number): void {
    if (!isOfferedCollar(kg)) return;
    this.collarKg = kg;
    this.saveCollar(kg);
    this.console.collarKg = kg;
    this.setup.collarKg = kg;
  }

  private relabel(): void {
    this.pillLabel.textContent = `${this.barKg} kg bar`;
  }

  // Read the persisted Bar. A missing, non-numeric, or off-menu value (including a
  // blocked localStorage) falls back to the 20 kg default -- never throws. Validating
  // against the offered set (not just "finite and positive") means a corrupt or legacy
  // key can't load a Bar that no tile matches.
  private loadBar(): number {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch {
      return DEFAULT_BAR_KG; // storage blocked (private mode); best-effort per ADR-0007.
    }
    if (raw === null) return DEFAULT_BAR_KG; // nothing persisted yet (first run).
    const n = Number(raw);
    return isOfferedBar(n) ? n : DEFAULT_BAR_KG;
  }

  // Persist the Bar, best-effort. A write can fail (quota, private mode); persistence is
  // a convenience, not core function, so a failure must not break Setup -- swallow it.
  private saveBar(kg: number): void {
    try {
      localStorage.setItem(STORAGE_KEY, String(kg));
    } catch {
      /* persistence is best-effort; the session keeps working without it. */
    }
  }

  // Read the persisted Collar, validated against the offered set exactly like the Bar:
  // a missing, non-numeric, off-menu, or storage-blocked value falls back to None, so a
  // corrupt or legacy key can never load a Collar no tile matches.
  private loadCollar(): number {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(COLLAR_STORAGE_KEY);
    } catch {
      return DEFAULT_COLLAR_KG; // storage blocked (private mode); best-effort per ADR-0007.
    }
    if (raw === null) return DEFAULT_COLLAR_KG; // nothing persisted yet (first run).
    const n = Number(raw);
    return isOfferedCollar(n) ? n : DEFAULT_COLLAR_KG;
  }

  // Persist the Collar, best-effort -- same swallow-on-failure contract as the Bar.
  private saveCollar(kg: number): void {
    try {
      localStorage.setItem(COLLAR_STORAGE_KEY, String(kg));
    } catch {
      /* persistence is best-effort; the session keeps working without it. */
    }
  }
}

customElements.define('rack-app', RackApp);
