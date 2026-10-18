// <rack-quiz-gear> -- the Loadout quiz's settings sheet (RBAR-92). A bottom sheet over a
// scrim: Plates per side, change Plates, Collars and numbers on the discs. The plate set
// and the Bar are the lifter's Setup (read-only here, named at the top). Purely a view:
// it takes `settings` and the rig facts, and emits `settingschange` with the new
// settings (the page persists them) and `close`.
import { BOX_SIZING } from './boxsizing.ts';
import { BUTTON_FX } from './buttonfx.ts';
import { SHORT_SCREEN } from './fit.ts';
import { SETUP_LINK } from './rig.ts';
import { DEFAULT_QUIZ_SETTINGS } from '../lib/quiz.ts';
import type { CollarsMode, MaxPlates, QuizSettings } from '../lib/quiz.ts';

/** What the sheet says about the rig: Setup's names, and which rows can change. */
export interface GearRig {
  /** "Competition, 20 kg bar". */
  readonly name: string;
  /** Setup has Collars and the set is the kg set: the Collars row is live. */
  readonly collarsOffered: boolean;
  /** Why the Collars row is off, when it is: "Setup has none", "kg set only". */
  readonly collarsNote: string;
  /** The iron set: its Plates are always stamped, so the numbers row is fixed. */
  readonly iron: boolean;
}

type Row = {
  key: keyof QuizSettings;
  label: string;
  tiles: readonly (readonly [value: string, label: string])[];
};

const ROWS: readonly Row[] = [
  {
    key: 'maxPlates',
    label: 'Plates per side',
    tiles: [
      ['2', '1-2'],
      ['4', 'Up to 4'],
      ['6', 'Up to 6'],
    ],
  },
  {
    key: 'change',
    label: 'Change plates',
    tiles: [
      ['true', 'On'],
      ['false', 'Off'],
    ],
  },
  {
    key: 'collars',
    label: 'Collars',
    tiles: [
      ['off', 'Off'],
      ['some', 'Some'],
      ['always', 'Always'],
    ],
  },
  {
    key: 'numbers',
    label: 'Numbers on plates',
    tiles: [
      ['true', 'Show'],
      ['false', 'Colors only'],
    ],
  },
];

// A tile's value back to the setting's type.
function valueOf(key: keyof QuizSettings, raw: string): QuizSettings[keyof QuizSettings] {
  if (key === 'maxPlates') return Number(raw) as MaxPlates;
  if (key === 'collars') return raw as CollarsMode;
  return raw === 'true';
}

class RackQuizGear extends HTMLElement {
  private root: ShadowRoot = this.attachShadow({ mode: 'open' });
  private _settings: QuizSettings = DEFAULT_QUIZ_SETTINGS;
  private _rig: GearRig = { name: '', collarsOffered: false, collarsNote: '', iron: false };

  set settings(s: QuizSettings) {
    this._settings = s;
    this.sync();
  }
  get settings(): QuizSettings {
    return this._settings;
  }

  set rig(r: GearRig) {
    this._rig = r;
    this.sync();
  }

  connectedCallback(): void {
    this.hidden = true;
    const rows = ROWS.map(
      (r) => `
        <div class="sl" id="sl-${r.key}">${r.label} <span class="note" data-note="${r.key}"></span></div>
        <div class="optrow" role="group" aria-labelledby="sl-${r.key}">
          ${r.tiles
            .map(
              ([v, l]) =>
                `<button type="button" class="tile" data-key="${r.key}" data-val="${v}" aria-pressed="false">${l}</button>`,
            )
            .join('')}
        </div>`,
    ).join('');
    this.root.innerHTML = `
      <style>
        ${BOX_SIZING}${BUTTON_FX}
        :host { position: fixed; inset: 0; z-index: 10; }
        :host([hidden]) { display: none; }
        .scrim { position: absolute; inset: 0; background: var(--rack-scrim); }
        .sheet {
          position: absolute; left: 0; right: 0; bottom: 0; max-height: 92%;
          margin: 0 auto; max-width: 520px;
          background: var(--rack-overlay); border-top: 1px solid var(--rack-border-strong);
          border-radius: var(--rack-radius-sheet) var(--rack-radius-sheet) 0 0;
          box-shadow: var(--rack-shadow-sheet);
          padding: 8px 16px calc(16px + env(safe-area-inset-bottom));
          display: flex; flex-direction: column; gap: 10px;
          overflow-y: auto; overscroll-behavior: contain;
          color: var(--rack-text); font-family: var(--rack-font);
        }
        .grab {
          width: 36px; height: 4px; border-radius: 9px; background: var(--rack-border-active);
          margin: 0 auto; flex: none;
        }
        .head { display: flex; align-items: center; justify-content: space-between; min-height: 36px; }
        h2 { margin: 0; font-size: 17px; font-weight: 800; }
        .x {
          width: 44px; height: 44px; margin-right: -8px; border: 0; background: transparent;
          color: var(--rack-text-dim); font: 500 20px var(--rack-font-num); padding: 0;
          border-radius: 999px; cursor: pointer;
        }
        .from { margin: 0; font: 500 12px/1.45 var(--rack-font-num); color: var(--rack-text-dim); }
        .from b { color: var(--rack-text-secondary); font-weight: 600; }
        .from a { color: var(--rack-accent); }
        .sl {
          font-family: var(--rack-font-num); font-size: 10.5px; font-weight: 600;
          letter-spacing: .14em; text-transform: uppercase; color: var(--rack-text-dim);
        }
        .note { letter-spacing: 0; text-transform: none; }
        .optrow { display: flex; gap: 6px; }
        .tile {
          flex: 1; min-height: 44px; border-radius: 12px; border: 1px solid var(--rack-border-muted);
          background: transparent; font: 600 12px var(--rack-font-num);
          color: var(--rack-text-secondary); padding: 0 4px; cursor: pointer;
        }
        .tile[aria-pressed="true"] {
          border-color: var(--rack-accent); color: var(--rack-text); background: var(--rack-active);
        }
        .tile:disabled { opacity: .35; cursor: default; }
        .tile:focus-visible, .x:focus-visible { outline: 2px solid var(--rack-accent); outline-offset: 2px; }
        @media ${SHORT_SCREEN} {
          .sheet { gap: 7px; }
        }
      </style>
      <div class="scrim" data-scrim></div>
      <div class="sheet" data-panel role="dialog" aria-modal="true" aria-labelledby="gear-title">
        <div class="grab" aria-hidden="true"></div>
        <div class="head">
          <h2 id="gear-title">Loadout quiz</h2>
          <button type="button" class="x" data-close aria-label="Close">&times;</button>
        </div>
        <p class="from">Plates and Bar from Setup: <b data-rig-name></b>. <a href="${SETUP_LINK}">Change in Setup</a></p>
        ${rows}
      </div>
    `;
    this.root.querySelector('[data-scrim]')!.addEventListener('click', () => this.close());
    this.root.querySelector('[data-close]')!.addEventListener('click', () => this.close());
    this.root.querySelectorAll<HTMLButtonElement>('.tile').forEach((t) =>
      t.addEventListener('click', () => {
        const key = t.dataset.key as keyof QuizSettings;
        const next = { ...this._settings, [key]: valueOf(key, t.dataset.val!) } as QuizSettings;
        this._settings = next;
        this.sync();
        this.dispatchEvent(new CustomEvent('settingschange', { detail: next }));
      }),
    );
    this.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
    this.sync();
  }

  open(): void {
    this.hidden = false;
    this.root.querySelector<HTMLButtonElement>('[data-close]')?.focus();
  }

  close(): void {
    if (this.hidden) return;
    this.hidden = true;
    this.dispatchEvent(new CustomEvent('close'));
  }

  private sync(): void {
    const name = this.root.querySelector('[data-rig-name]');
    if (!name) return;
    name.textContent = this._rig.name;
    const s = this._settings;
    this.root.querySelectorAll<HTMLButtonElement>('.tile').forEach((t) => {
      const key = t.dataset.key as keyof QuizSettings;
      const disabled =
        (key === 'collars' && !this._rig.collarsOffered) || (key === 'numbers' && this._rig.iron);
      // A fixed row shows what the quiz actually does: no Collars, iron always stamped.
      const shown =
        key === 'collars' && !this._rig.collarsOffered
          ? 'off'
          : key === 'numbers' && this._rig.iron
            ? 'true'
            : String(s[key]);
      t.disabled = disabled;
      t.setAttribute('aria-pressed', String(t.dataset.val === shown));
    });
    this.root.querySelector('[data-note="collars"]')!.textContent = this._rig.collarsOffered
      ? ''
      : `(${this._rig.collarsNote})`;
    this.root.querySelector('[data-note="numbers"]')!.textContent = this._rig.iron
      ? '(iron is always stamped)'
      : '';
  }
}

customElements.define('rack-quiz-gear', RackQuizGear);
