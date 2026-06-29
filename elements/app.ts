// <rack-app> -- the app shell and composition root (RBAR-15, ADR-0007). It owns the
// rig configuration (the Bar, the Collars, and the plate set) and feeds it down: it
// renders the header (wordmark + a Setup pill), the <rack-console> calculator, and the
// <rack-setup> sheet, and wires the three together.
//
//   pill tap                -> open the Setup sheet
//   sheet `barchange`       -> adopt the Bar: persist it, push it to the console, relabel
//                              the pill, reflect the active tile
//   sheet `collarchange`    -> adopt the Collar: persist it, push it to the console,
//                              reflect the active tile (RBAR-16, ADR-0008)
//   sheet `platesetchange`  -> adopt the plate set: persist it, swap the Bar to the set's
//                              default, push set + Bar to the console and sheet (RBAR-17,
//                              ADR-0010)
//   sheet `close`           -> drop the pill's open state
//
// Each config concern persists shell-side under its own localStorage key (ADR-0007);
// the core stays pure and only ever sees these as function arguments (ADR-0001/0002).
import './console.ts';
import './setup.ts';
import { isOfferedCollar, DEFAULT_COLLAR_KG } from './setup.ts';
import { readPersisted, writePersisted } from './persist.ts';
import { plateSetFor, isOfferedPlateSet } from '../lib/platesets.ts';
import type { PlateSetKey } from '../lib/platesets.ts';
import { format } from '../lib/units.ts';

type Console = HTMLElement & { barKg: number; collarKg: number; plateSet: string };
type Setup = HTMLElement & {
  barKg: number;
  collarKg: number;
  plateSet: string;
  open(): void;
  close(): void;
};

// One persisted config key per concern (ADR-0007), read/written through the shared
// best-effort helpers (persist.ts). Recents persists shell-side too but console-owned,
// under its own key (ADR-0009); the unit preference is console-owned too (ADR-0010).
const STORAGE_KEY = 'rackbar.barKg';
const COLLAR_STORAGE_KEY = 'rackbar.collarKg';
const PLATESET_STORAGE_KEY = 'rackbar.plateSet';

class RackApp extends HTMLElement {
  private root: ShadowRoot = this.attachShadow({ mode: 'open' });
  private console!: Console;
  private setup!: Setup;
  private pill!: HTMLButtonElement;
  private pillLabel!: HTMLElement;

  // The active plate set drives the offered Bars and the native Unit (ADR-0010); load it
  // first, since the Bar validates against its Bars.
  private plateSetKey: PlateSetKey = 'comp';
  private barKg = plateSetFor('comp').defaultBarKg;
  private collarKg = DEFAULT_COLLAR_KG;

  connectedCallback(): void {
    this.plateSetKey = this.loadPlateSet();
    this.barKg = this.loadBar();
    this.collarKg = this.loadCollar();
    // Children are defined before this runs (imports at top + rack-app's own define is
    // last), so assigning innerHTML upgrades <rack-console>/<rack-setup> synchronously
    // and their connectedCallbacks finish here -- which is why the seeding below (after
    // the queries) lands on already-connected elements, not inert ones.
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

    // Seed every surface from the (possibly persisted) plate set, Bar, and Collar. Push
    // the Bar before the plate set, matching adoptPlateSet's invariant ("set barKg first
    // so a re-decode sees it") -- harmless at init (no standing Target yet), but keeping
    // one ordering rule everywhere avoids a stale-Bar transient if that ever changes.
    this.console.barKg = this.barKg;
    this.console.collarKg = this.collarKg;
    this.console.plateSet = this.plateSetKey;
    this.setup.barKg = this.barKg;
    this.setup.collarKg = this.collarKg;
    this.setup.plateSet = this.plateSetKey;
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
    this.setup.addEventListener('platesetchange', (e) =>
      this.adoptPlateSet((e as CustomEvent<{ plateSet: string }>).detail.plateSet),
    );
    this.setup.addEventListener('close', () =>
      this.pill.setAttribute('aria-expanded', 'false'),
    );
  }

  // The Bars the active plate set offers -- the set the persisted/chosen Bar validates
  // against (ADR-0010). Each set carries its own Bars; comp is kg, training a single lb.
  private offeredBars(): readonly number[] {
    return plateSetFor(this.plateSetKey).bars;
  }

  // Adopt a Bar chosen in Setup: persist it, thread it into the calculator, relabel the
  // pill, and reflect the active tile. The sheet stays open so the lifter sees the choice.
  // An off-menu Bar (one the active set does not offer) is an invariant breach, not a
  // value to persist and feed the core -- ignore it rather than stranding the readout.
  private adopt(kg: number): void {
    if (!this.offeredBars().includes(kg)) return;
    this.barKg = kg;
    this.saveBar(kg);
    this.console.barKg = kg;
    this.setup.barKg = kg;
    this.relabel();
  }

  // Adopt a Collar chosen in Setup: same shape as adopt() (ADR-0007/0008). An off-menu
  // value is an invariant breach, ignored rather than fed to the core.
  private adoptCollar(kg: number): void {
    if (!isOfferedCollar(kg)) return;
    this.collarKg = kg;
    this.saveCollar(kg);
    this.console.collarKg = kg;
    this.setup.collarKg = kg;
  }

  // Adopt a plate set chosen in Setup (RBAR-17, ADR-0010): persist it, swap the Bar to
  // the set's default (a Bar does not cross sets), persist that too, then push the Bar
  // FIRST and the set second so the console re-solves against the right Bar AND Inventory.
  // An off-menu key is ignored. The sheet stays open so the lifter sees the switch land.
  private adoptPlateSet(key: string): void {
    if (!isOfferedPlateSet(key)) return;
    this.plateSetKey = key;
    this.savePlateSet(key);
    this.barKg = plateSetFor(key).defaultBarKg;
    this.saveBar(this.barKg);
    this.console.barKg = this.barKg;
    this.setup.barKg = this.barKg;
    this.console.plateSet = key;
    this.setup.plateSet = key;
    this.relabel();
  }

  // The pill names the current Bar in the active set's native Unit (e.g. "20 kg bar",
  // "45 lb bar") -- the lb readout already signals a Training rig.
  private relabel(): void {
    const set = plateSetFor(this.plateSetKey);
    this.pillLabel.textContent = `${format(this.barKg, set.unit)} bar`;
  }

  // Read the persisted plate set, validated against the offered keys (ADR-0007 pattern):
  // a missing, blocked, or off-menu value falls back to Competition (the default).
  private loadPlateSet(): PlateSetKey {
    const raw = readPersisted(PLATESET_STORAGE_KEY);
    return raw !== null && isOfferedPlateSet(raw) ? raw : 'comp';
  }

  // Read the persisted Bar, validated against the ACTIVE set's Bars. A missing,
  // non-numeric, off-menu, or storage-blocked value falls back to that set's default Bar,
  // so a corrupt or legacy key can never load a Bar no tile matches.
  private loadBar(): number {
    const set = plateSetFor(this.plateSetKey);
    const raw = readPersisted(STORAGE_KEY);
    if (raw === null) return set.defaultBarKg; // absent or storage blocked: the default.
    const n = Number(raw);
    return this.offeredBars().includes(n) ? n : set.defaultBarKg;
  }

  // Persist the Bar, best-effort (writePersisted swallows a failed write).
  private saveBar(kg: number): void {
    writePersisted(STORAGE_KEY, String(kg));
  }

  // Read the persisted Collar, validated against the offered set exactly like the Bar.
  private loadCollar(): number {
    const raw = readPersisted(COLLAR_STORAGE_KEY);
    if (raw === null) return DEFAULT_COLLAR_KG; // absent or storage blocked: None.
    const n = Number(raw);
    return isOfferedCollar(n) ? n : DEFAULT_COLLAR_KG;
  }

  // Persist the Collar, best-effort -- same swallow-on-failure contract as the Bar.
  private saveCollar(kg: number): void {
    writePersisted(COLLAR_STORAGE_KEY, String(kg));
  }

  // Persist the plate set, best-effort.
  private savePlateSet(key: PlateSetKey): void {
    writePersisted(PLATESET_STORAGE_KEY, key);
  }
}

customElements.define('rack-app', RackApp);
