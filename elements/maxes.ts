// <rack-maxes> -- the Maxes sheet (RBAR-84, ADR-0020): where saved maxes are added,
// retyped and removed. "One sheet, two doors" (Caitlin, 2026-10-17): Setup's Maxes row
// opens it on its list; the keypad's "+" and a long-press on a lift chip open it straight
// on the add or edit form, and Save returns to the keypad with that lift picked.
//
// A controlled shell like <rack-setup> (ADR-0001): the app owns the list and feeds it
// down (`maxes`, plus the Primary `unit` a new max is typed in); the sheet emits intents
// up -- `maxadd` {name, value, unit}, `maxset` {index, value, unit}, `maxremove` {index},
// `maxrestore` {max, index} -- and `maxesclose` {door, picked, removed} when it closes, so
// the app can hand the keypad its lift or its Undo. The form's draft, the pending Undo
// row and which view shows are UI state.
import { DEL_ICON } from './delglyph.ts';
import { focusIn } from './entry.ts';
import { BOX_SIZING } from './boxsizing.ts';
import { BUTTON_FX } from './buttonfx.ts';
import { SHORT_SCREEN } from './fit.ts';
import { readPersisted, writePersisted } from './persist.ts';
import {
  MAX_LIFTS,
  MAX_NAME_LENGTH,
  PRESET_LIFTS,
  addRefusal,
  findMax,
  maxShown,
  parseMaxes,
  serializeMaxes,
} from '../lib/maxes.ts';
import type { Max } from '../lib/maxes.ts';
import type { Unit } from '../lib/units.ts';

/** The saved maxes' own key (ADR-0007 one key per concern; RBAR-88 folds it into the
 * typed storage registry with the rest). */
export const MAXES_KEY = 'rackbar.maxes';

/** The stored maxes, validated (a missing or corrupt key reads as none). */
export function loadMaxes(): readonly Max[] {
  return parseMaxes(readPersisted(MAXES_KEY));
}

/** Store the maxes, best-effort. */
export function saveMaxes(list: readonly Max[]): void {
  writePersisted(MAXES_KEY, serializeMaxes(list));
}

/** Which door opened the sheet: Setup's row (the list) or the keypad (a form). */
export type MaxesDoor = 'setup' | 'keypad';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'];
// The keypad types at most five digits of a max ("142.5"), as of a Target.
const MAX_DIGITS = 5;

const PLUS = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path
  d="M2 7h10M7 2v10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
const CHEV = `<svg width="8" height="12" viewBox="0 0 8 12" fill="none" aria-hidden="true"><path
  d="M1.5 1.5L6 6l-4.5 4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"
  stroke-linejoin="round"/></svg>`;
const BACK = `<svg width="8" height="12" viewBox="0 0 8 12" fill="none" aria-hidden="true"><path
  d="M6.5 1.5L2 6l4.5 4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"
  stroke-linejoin="round"/></svg>`;

const esc = (t: string): string =>
  t.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

interface Form {
  // The lift being retyped, or null when adding one.
  readonly index: number | null;
  draft: string;
  // The picked or typed name (adding only); null = none picked yet.
  name: string | null;
  custom: boolean;
}

class RackMaxes extends HTMLElement {
  private root: ShadowRoot = this.attachShadow({ mode: 'open' });
  private panel!: HTMLElement;
  private _maxes: readonly Max[] = [];
  private _unit: Unit = 'kg';
  private door: MaxesDoor = 'setup';
  private form: Form | null = null;
  // A lift removed from the list view: an Undo row in its slot until the sheet closes.
  private undo: { max: Max; index: number } | null = null;

  set maxes(list: readonly Max[]) {
    this._maxes = list;
    if (!this.hidden) this.render();
  }
  get maxes(): readonly Max[] {
    return this._maxes;
  }

  set unit(u: Unit) {
    this._unit = u;
    if (!this.hidden) this.render();
  }
  get unit(): Unit {
    return this._unit;
  }

  /** Open on the list (Setup's Maxes row). */
  openList(): void {
    this.door = 'setup';
    this.form = null;
    this.show();
  }

  /** Open straight on a form (the keypad's door): retype the lift named `name`, or add
   * one when `name` is null. False (and nothing opens) for an unknown lift or a full
   * row. */
  openForm(name: string | null): boolean {
    const i = name === null ? -1 : findMax(this._maxes, name);
    if (name !== null && i === -1) return false;
    if (name === null && this._maxes.length >= MAX_LIFTS) return false;
    this.door = 'keypad';
    this.form = { index: i === -1 ? null : i, draft: '', name: null, custom: false };
    this.show();
    return true;
  }

  connectedCallback(): void {
    this.hidden = true;
    this.root.innerHTML = `
      <style>
        ${BOX_SIZING}${BUTTON_FX}
        :host { display: block; }
        :host([hidden]) { display: none; }
        @keyframes rack-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes rack-rise {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        /* Over the keypad sheet and Setup (both z 50): the one sheet on top. */
        .scrim {
          position: fixed; inset: 0; z-index: 60; background: var(--rack-scrim);
          display: flex; align-items: flex-end; justify-content: center;
          animation: rack-fade .16s ease-out;
        }
        .panel {
          width: 100%; max-width: 520px;
          max-height: calc(100% - env(safe-area-inset-top));
          overflow-y: auto; overscroll-behavior: contain;
          display: flex; flex-direction: column;
          background: var(--rack-overlay);
          border-top: 1px solid var(--rack-border-strong);
          border-radius: var(--rack-radius-sheet) var(--rack-radius-sheet) 0 0;
          padding: 8px 16px calc(14px + env(safe-area-inset-bottom));
          box-shadow: var(--rack-shadow-sheet);
          animation: rack-fade .18s ease-out;
        }
        @media (prefers-reduced-motion: no-preference) {
          .panel { animation: rack-rise .2s ease-out; }
        }
        .grab {
          flex: none; width: 36px; height: 4px; margin: 0 auto 9px;
          border-radius: 9px; background: var(--rack-border-active);
        }
        .head {
          display: flex; align-items: center; justify-content: space-between;
          min-height: 36px; margin-bottom: 8px;
        }
        .head h2 {
          margin: 0; font-size: 17px; font-weight: 800; letter-spacing: -.01em;
          color: var(--rack-text);
        }
        .back { display: flex; align-items: center; gap: 2px; }
        .backbtn {
          display: grid; place-items: center; width: 36px; height: 36px; margin-left: -12px;
          padding: 0; background: transparent; border: 0; border-radius: 999px;
          color: var(--rack-text-dim); cursor: pointer;
        }
        .done {
          font: inherit; font-size: 13px; font-weight: 700; min-height: 36px;
          padding: 0 16px; border-radius: 999px; cursor: pointer;
          color: var(--rack-accent-ink); background: var(--rack-accent);
          border: 1px solid var(--rack-accent);
        }
        .row {
          display: flex; align-items: center; gap: 10px; width: 100%; min-height: 46px;
          padding: 0 4px; text-align: left; cursor: pointer;
          color: var(--rack-text-dim); background: transparent;
          border: 0; border-bottom: 1px solid var(--rack-divider);
        }
        .row .n { flex: 1; min-width: 0; font: 600 15px var(--rack-font); color: var(--rack-text);
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .row .v { font: 700 15px var(--rack-font-num); color: var(--rack-text); }
        .row .v small { font-size: 11px; color: var(--rack-text-dim); margin-left: 3px; }
        .row.gone { cursor: default; }
        .row.gone .n { color: var(--rack-text-disabled); text-decoration: line-through; }
        .undo {
          border: 0; background: transparent; padding: 8px 4px; cursor: pointer;
          font: 700 13px var(--rack-font); color: var(--rack-accent);
        }
        .row.add { border-bottom: 0; color: var(--rack-accent); }
        .row.add .n { color: var(--rack-accent); font-size: 14px; }
        .names { display: flex; gap: 6px; margin-bottom: 10px; min-height: 40px; }
        .nm {
          flex: 1; min-width: 0; min-height: 40px; padding: 0 4px; white-space: nowrap;
          font: 600 12.5px var(--rack-font); color: var(--rack-text-secondary);
          background: transparent; border: 1px solid var(--rack-border-muted);
          border-radius: var(--rack-radius-sheet-control); cursor: pointer;
        }
        .nm[aria-pressed="true"] {
          color: var(--rack-text); background: var(--rack-active); border-color: var(--rack-accent);
        }
        .nm.icon { flex: 0 0 44px; display: grid; place-items: center; }
        .nin {
          flex: 1; min-width: 0; min-height: 40px; padding: 0 12px; outline: none;
          font: 600 16px var(--rack-font); color: var(--rack-text);
          background: var(--rack-active); border: 1px solid var(--rack-accent);
          border-radius: var(--rack-radius-sheet-control);
        }
        .live { text-align: center; margin-bottom: 12px; }
        .live-num {
          font: 800 46px/1 var(--rack-font); letter-spacing: -.02em;
          font-variant-numeric: tabular-nums; color: var(--rack-text);
        }
        .live-num.empty { color: var(--rack-text-dim); }
        .live-u { font-size: 20px; font-weight: 600; color: var(--rack-text-dim); margin-left: 4px; }
        .keypad { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
        .key {
          min-height: 44px; font-family: var(--rack-font-num); font-size: 20px; font-weight: 600;
          color: var(--rack-fg); background: var(--rack-raised);
          border: 1px solid var(--rack-line); border-radius: var(--rack-radius-sheet-control);
          cursor: pointer;
        }
        .key svg { display: block; margin: 0 auto; }
        .key:active { background: var(--rack-line); }
        .foot { display: flex; gap: 8px; margin-top: 8px; }
        .foot button {
          flex: 1; min-height: 42px; font: 600 13px var(--rack-font); cursor: pointer;
          color: var(--rack-text-secondary); background: transparent;
          border: 1px solid var(--rack-border-muted); border-radius: var(--rack-radius-sheet-control);
        }
        .foot .save {
          font-size: 14px; font-weight: 700; color: var(--rack-accent-ink);
          background: var(--rack-accent); border-color: var(--rack-accent);
        }
        .foot .save:disabled { opacity: .35; cursor: default; }
        .foot .remove { color: var(--rack-danger); }
        button:focus-visible { outline: 2px solid var(--rack-accent); outline-offset: 2px; }
        @media ${SHORT_SCREEN} {
          .live { margin-bottom: 8px; }
          .live-num { font-size: 40px; }
          .key { min-height: 40px; }
          .keypad { gap: 6px; }
        }
      </style>
      <div class="scrim" data-scrim>
        <div class="panel" data-panel role="dialog" aria-modal="true" aria-label="Maxes"></div>
      </div>
    `;
    this.panel = this.root.querySelector('[data-panel]')!;
    this.root.querySelector('[data-scrim]')!.addEventListener('click', () => this.dismiss());
    this.panel.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onClick(e);
    });
    this.panel.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset.name !== undefined && this.form) {
        this.form.name = t.value;
        this.syncSave();
      }
    });
  }

  disconnectedCallback(): void {
    document.removeEventListener('keydown', this.onKeydown);
  }

  // The control that opened the sheet, to hand focus back to on close.
  private opener: HTMLElement | null = null;

  private show(): void {
    let a = document.activeElement as HTMLElement | null;
    while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement as HTMLElement;
    this.opener = a;
    this.undo = null;
    this.hidden = false;
    document.addEventListener('keydown', this.onKeydown);
    this.render();
    this.panel.querySelector<HTMLElement>('[data-focus]')?.focus();
  }

  private close(picked: string | null, removed: { max: Max; index: number } | null): void {
    const door = this.door;
    this.hidden = true;
    this.form = null;
    this.undo = null;
    document.removeEventListener('keydown', this.onKeydown);
    // Back to the opener if it is still on screen (a keypad chip that was just removed
    // is not: its row moves focus on, see <rack-entry>).
    if (this.opener?.isConnected) this.opener.focus();
    this.opener = null;
    this.dispatchEvent(
      new CustomEvent('maxesclose', {
        detail: { door, picked, removed },
        bubbles: true,
        composed: true,
      }),
    );
  }

  // A scrim tap or Escape: leave a form without saving (back to the list from Setup's
  // door, out to the keypad from its own), or close the list.
  private dismiss(): void {
    if (this.form && this.door === 'setup') {
      this.form = null;
      this.render();
    } else {
      this.close(null, null);
    }
  }

  private emit(type: string, detail: object): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  // The form's Save: retype the lift, or add the named one.
  private save(): void {
    const f = this.form;
    if (!f || !this.canSave()) return;
    const value = Number(f.draft);
    let picked: string;
    if (f.index !== null) {
      picked = this._maxes[f.index].name;
      if (f.draft !== '') this.emit('maxset', { index: f.index, value, unit: this._unit });
    } else {
      picked = (f.name ?? '').trim();
      this.emit('maxadd', { name: picked, value, unit: this._unit });
    }
    if (this.door === 'keypad') this.close(picked, null);
    else {
      this.form = null;
      this.render();
    }
  }

  private removeLift(): void {
    const f = this.form;
    if (!f || f.index === null) return;
    const index = f.index;
    const max = this._maxes[index];
    this.emit('maxremove', { index });
    if (this.door === 'keypad') this.close(null, { max, index });
    else {
      this.form = null;
      this.undo = { max, index };
      this.render();
    }
  }

  private canSave(): boolean {
    const f = this.form;
    if (!f) return false;
    if (f.index !== null) return f.draft === '' || addRefusal([], 'x', Number(f.draft)) === null;
    return addRefusal(this._maxes, f.name ?? '', Number(f.draft === '' ? NaN : f.draft)) === null;
  }

  private syncSave(): void {
    const b = this.panel.querySelector<HTMLButtonElement>('[data-save]');
    if (b) b.disabled = !this.canSave();
  }

  private key(k: string): void {
    const f = this.form;
    if (!f) return;
    if (k === 'del') f.draft = f.draft.slice(0, -1);
    else if (k === '.') {
      if (!f.draft.includes('.')) f.draft += f.draft === '' ? '0.' : '.';
    } else if (f.draft.replace('.', '').length < MAX_DIGITS) {
      f.draft = f.draft === '0' ? k : f.draft + k;
    }
    this.renderLive();
    this.syncSave();
  }

  private onClick(e: Event): void {
    const b = (e.target as Element).closest<HTMLButtonElement>('button');
    if (!b || b.disabled) return;
    const a = b.dataset.act;
    if (a === 'done') this.close(null, null);
    else if (a === 'edit') {
      this.undo = null;
      this.form = { index: Number(b.dataset.i), draft: '', name: null, custom: false };
      this.render();
    } else if (a === 'add') {
      this.undo = null;
      this.form = { index: null, draft: '', name: null, custom: false };
      this.render();
    } else if (a === 'undo' && this.undo) {
      this.emit('maxrestore', this.undo);
      this.undo = null;
      this.render();
    } else if (a === 'cancel') {
      if (this.door === 'keypad') this.close(null, null);
      else {
        this.form = null;
        this.render();
      }
    } else if (a === 'save') this.save();
    else if (a === 'remove') this.removeLift();
    else if (a === 'name' && this.form) {
      this.form.name = b.dataset.n!;
      this.form.custom = false;
      this.render();
    } else if (a === 'custom' && this.form) {
      this.form.custom = true;
      this.form.name = '';
      this.render();
      this.panel.querySelector<HTMLInputElement>('[data-name]')?.focus();
    } else if (a === 'presets' && this.form) {
      this.form.custom = false;
      this.form.name = null;
      this.render();
    } else if (b.dataset.key) this.key(b.dataset.key);
  }

  // The physical keyboard while the sheet is open: digits, the point and Backspace type
  // the max (not while the name field has focus), Enter saves, Escape backs out.
  private onKeydown = (e: KeyboardEvent): void => {
    if (this.hidden || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
    const inName = (e.composedPath()[0] as Element | undefined)?.matches?.('input') ?? false;
    const k = e.key;
    if (k === 'Escape') {
      e.preventDefault();
      this.dismiss();
    } else if (k === 'Enter' && this.form) {
      e.preventDefault();
      this.save();
    } else if (inName || !this.form) {
      return;
    } else if (/^[0-9]$/.test(k) || k === '.' || k === ',') {
      e.preventDefault();
      this.key(k === ',' ? '.' : k);
    } else if (k === 'Backspace') {
      e.preventDefault();
      this.key('del');
    }
  };

  // A rebuild of the panel keeps focus on the same control (by its act and name), or
  // lands it on the view's first control when that control is gone.
  private render(): void {
    if (!this.panel) return;
    const had = focusIn(this.root);
    const key = had ? `${had.dataset.act ?? ''}|${had.dataset.n ?? had.dataset.i ?? ''}` : null;
    this.panel.innerHTML = this.form ? this.formHtml(this.form) : this.listHtml();
    this.panel.setAttribute('aria-label', this.form ? this.formTitle(this.form) : 'Maxes');
    if (this.form) this.renderLive();
    if (key !== null && !this.hidden) {
      const same = [...this.panel.querySelectorAll<HTMLElement>('[data-act]')].find(
        (b) => `${b.dataset.act ?? ''}|${b.dataset.n ?? b.dataset.i ?? ''}` === key,
      );
      (same ?? this.panel.querySelector<HTMLElement>('[data-focus]'))?.focus();
    }
  }

  private listHtml(): string {
    const rows = this._maxes.map(
      (m, i) => `<button type="button" class="row" data-act="edit" data-i="${i}"
        aria-label="${esc(m.name)} ${maxShown(m, this._unit)} ${this._unit}. Edit"
        ><span class="n">${esc(m.name)}</span><span class="v">${maxShown(m, this._unit)}<small
        >${this._unit}</small></span>${CHEV}</button>`,
    );
    if (this.undo) {
      const at = Math.min(this.undo.index, rows.length);
      rows.splice(at, 0, `<div class="row gone"><span class="n">${esc(this.undo.max.name)}</span
        ><button type="button" class="undo" data-act="undo"
        aria-label="Undo removing ${esc(this.undo.max.name)}">Undo</button></div>`);
    }
    if (this._maxes.length < MAX_LIFTS) {
      rows.push(`<button type="button" class="row add" data-act="add">${PLUS}<span class="n"
        >Add a lift</span></button>`);
    }
    return `<div class="grab"></div>
      <div class="head"><h2>Maxes</h2><button type="button" class="done" data-act="done"
        data-focus>Done</button></div>
      <div class="list">${rows.join('')}</div>`;
  }

  private formTitle(f: Form): string {
    return f.index !== null ? this._maxes[f.index]?.name ?? 'Max' : 'Add a lift';
  }

  private formHtml(f: Form): string {
    let names = '';
    if (f.index === null) {
      const free = PRESET_LIFTS.filter((n) => findMax(this._maxes, n) === -1);
      names = f.custom
        ? `<div class="names"><input class="nin" data-name maxlength="${MAX_NAME_LENGTH}"
            placeholder="Name" aria-label="Lift name" autocomplete="off"
            value="${esc(f.name ?? '')}"><button type="button" class="nm icon"
            data-act="presets" aria-label="Back to names">${BACK}</button></div>`
        : `<div class="names" role="group" aria-label="Lift">${free
            .map(
              (n) => `<button type="button" class="nm" data-act="name" data-n="${n}"
                aria-pressed="${f.name === n}">${n}</button>`,
            )
            .join('')}<button type="button" class="nm" data-act="custom">Custom</button></div>`;
    }
    const keys = KEYS.map(
      (k) => `<button type="button" class="key" data-key="${k}"
        aria-label="${k === 'del' ? 'Delete' : k === '.' ? 'Decimal point' : k}"
        >${k === 'del' ? DEL_ICON : k}</button>`,
    ).join('');
    const foot =
      f.index !== null
        ? `<button type="button" class="remove" data-act="remove">Remove</button>
           <button type="button" data-act="cancel">Cancel</button>
           <button type="button" class="save" data-act="save" data-save>Save</button>`
        : `<button type="button" data-act="cancel">Cancel</button>
           <button type="button" class="save" data-act="save" data-save>Save</button>`;
    return `<div class="grab"></div>
      <div class="head"><div class="back"><button type="button" class="backbtn"
        data-act="cancel" data-focus aria-label="Back">${BACK}</button><h2
        >${esc(this.formTitle(f))}</h2></div></div>
      ${names}
      <div class="live" role="status"><span class="live-num" data-live></span><span
        class="live-u" data-live-u></span></div>
      <div class="keypad" role="group" aria-label="${esc(this.formTitle(f))} max">${keys}</div>
      <div class="foot">${foot}</div>`;
  }

  // The form's live number: the typed max, or (dim) the lift's current max / 0.
  private renderLive(): void {
    const f = this.form;
    const num = this.panel.querySelector<HTMLElement>('[data-live]');
    if (!f || !num) return;
    const m = f.index !== null ? this._maxes[f.index] : null;
    const empty = f.draft === '';
    num.textContent = empty ? (m ? String(maxShown(m, this._unit)) : '0') : f.draft;
    num.classList.toggle('empty', empty);
    this.panel.querySelector('[data-live-u]')!.textContent = this._unit;
    this.syncSave();
  }
}

customElements.define('rack-maxes', RackMaxes);
export type Maxes = RackMaxes;
