// <rack-ways> -- the Another way sheet (RBAR-66): "Load N kg another way". A bottom
// sheet in the Setup sheet's look that lists the ways to make the Total on the Bar
// (lib/ways.ts waysFor, at most MAX_WAYS): each row a mini stack of colored Plate chips,
// heaviest-first, with its "k per side" count, the loaded way selected (a radio look).
// Tapping a row emits `wayselect` with its index -- the console loads it; the sheet
// stays open so the lifter can compare. Done or a scrim tap closes (`close`). At the
// bottom, "Set Plate Inventory" (the Setup sliders glyph) emits `opensetup` and closes:
// the app opens the Setup sheet, where the plates you have are set (RBAR-72).
// No list label and no helper text (Caitlin, 2026-10-17, design H).
//
// Near-stateless, like <rack-setup> (ADR-0001): the console owns the ways and which
// one is loaded and feeds them in (`ways`, `index`, `heading`); this only draws them
// and emits intent.
import type { Plate } from '../lib/plates.ts';
import { plateLabel, darkInk } from '../lib/sleevefit.ts';
import { BOX_SIZING } from './boxsizing.ts';
import { BUTTON_FX } from './buttonfx.ts';
import { DISC_FILL } from './discfill.ts';
import { SLIDERS_GLYPH } from './sliders.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// A Plate's spoken name in a row label: the lb stamp on iron, the kg on Eleiko.
const faceOf = (p: Plate) => (p.label !== undefined ? `${p.label} lb` : `${p.kg} kg`);

class RackWays extends HTMLElement {
  private root: ShadowRoot = this.attachShadow({ mode: 'open' });
  private _ways: readonly (readonly Plate[])[] = [];
  private _index = 0;
  private _heading = '';
  private listEl?: HTMLElement;
  private headingEl?: HTMLElement;

  /** The ways to list, in rank order (lib/ways.ts). Setting it re-renders. */
  set ways(list: readonly (readonly Plate[])[]) {
    this._ways = list;
    this.render();
  }
  get ways(): readonly (readonly Plate[])[] {
    return this._ways;
  }

  /** Which way is on the Bar. Setting it moves the selection in place, so a row that
   * has keyboard focus keeps it. */
  set index(i: number) {
    this._index = i;
    this.listEl
      ?.querySelectorAll<HTMLElement>('[data-way]')
      .forEach((row) => row.setAttribute('aria-checked', String(Number(row.dataset.way) === i)));
  }
  get index(): number {
    return this._index;
  }

  /** The sheet title, "Load 140 kg another way" -- the console words the Total. */
  set heading(text: string) {
    this._heading = text;
    if (this.headingEl) this.headingEl.textContent = text;
  }
  get heading(): string {
    return this._heading;
  }

  /** Show the sheet. */
  open(): void {
    this.hidden = false;
  }

  /** Hide the sheet and tell the console. */
  close(): void {
    if (this.hidden) return;
    this.hidden = true;
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  connectedCallback(): void {
    this.hidden = true; // a sheet is closed until opened
    this.root.innerHTML = `
      <style>
        ${BOX_SIZING}${BUTTON_FX}
        :host { display: block; }
        :host([hidden]) { display: none; }
        /* The Setup sheet's scrim, panel, entrance and Done (elements/setup.ts). */
        @keyframes rack-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes rack-rise {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .scrim {
          position: fixed; inset: 0; z-index: 50;
          background: var(--rack-scrim);
          display: flex; align-items: flex-end; justify-content: center;
          animation: rack-fade .16s ease-out;
        }
        /* Scrolls inside itself on a short phone rather than run off the top
           (ADR-0013: the page never scrolls). */
        .panel {
          width: 100%; max-width: 520px; max-height: 90%; overflow-y: auto;
          overscroll-behavior: contain;
          display: flex; flex-direction: column; gap: 12px;
          background: var(--rack-overlay);
          border-top: 1px solid var(--rack-border-strong);
          border-radius: var(--rack-radius-sheet) var(--rack-radius-sheet) 0 0;
          padding: 18px 20px calc(26px + env(safe-area-inset-bottom));
          box-shadow: var(--rack-shadow-setup);
          animation: rack-fade .26s cubic-bezier(.2, .85, .25, 1);
        }
        @media (prefers-reduced-motion: no-preference) {
          .panel { animation: rack-rise .26s cubic-bezier(.2, .85, .25, 1); }
        }
        .head {
          display: flex; align-items: center; justify-content: space-between; gap: 12px;
          margin-bottom: 6px;
        }
        .head .title {
          font-size: 17px; font-weight: 800; letter-spacing: -.01em;
          color: var(--rack-fg); margin: 0;
        }
        .done {
          flex: none; font: inherit; font-size: 12px; font-weight: 700;
          color: var(--rack-bg); background: var(--rack-accent);
          border: none; border-radius: 999px; padding: 7px 17px;
          min-height: 36px; cursor: pointer;
        }
        .done:focus-visible { outline: 2px solid var(--rack-accent); outline-offset: 2px; }
        /* The ways (prototype H .alts): a radio dot, the mini stack, the count. The
           loaded way takes the active-row fill and ring of the Setup plate-set rows. */
        .list { display: flex; flex-direction: column; gap: 4px; }
        .way {
          display: grid; grid-template-columns: 16px minmax(0, 1fr) auto;
          gap: 10px; align-items: center; width: 100%; min-height: 44px;
          padding: 6px 10px; cursor: pointer; text-align: left;
          color: var(--rack-text); background: transparent;
          border: 1px solid transparent; border-radius: var(--rack-radius-tile);
        }
        .way[aria-checked="true"] {
          background: var(--rack-active); border-color: var(--rack-border-active);
        }
        .way:focus-visible { outline: 2px solid var(--rack-accent); outline-offset: 2px; }
        .dot {
          width: 14px; height: 14px; border-radius: 999px;
          border: 1.5px solid var(--rack-border-active);
        }
        .way[aria-checked="true"] .dot { border: 4px solid var(--rack-accent); }
        .mini { display: flex; flex-wrap: wrap; gap: 3px; }
        /* A mini Plate chip: the shared top-lit disc fill over its plate color, the
           engraved-numeral inks (dark on the light Plates). */
        .mc {
          font-family: var(--rack-font-num); font-size: 10.5px; font-weight: 800;
          line-height: 1; padding: 4px 6px; border-radius: 4px;
          color: #fff; ${DISC_FILL}
          box-shadow: var(--rack-shadow-disc);
        }
        .mc.dark { color: var(--rack-accent-ink); }
        .bare { font-family: var(--rack-font-num); font-size: 11px; color: var(--rack-text-dim); }
        .count {
          font-family: var(--rack-font-num); font-size: 11px; font-weight: 600;
          color: var(--rack-text-dim); white-space: nowrap;
        }
        /* "Set Plate Inventory": a ghost pill with the Setup sliders glyph. */
        .inv {
          align-self: flex-start; display: inline-flex; align-items: center; gap: 8px;
          min-height: 42px; padding: 0 16px; cursor: pointer; white-space: nowrap;
          font-family: var(--rack-font); font-size: 13px; font-weight: 700;
          color: var(--rack-text-secondary); background: transparent;
          border: 1px solid var(--rack-border-muted); border-radius: 999px;
        }
        .inv svg { display: block; flex: none; }
        .inv:focus-visible { outline: 2px solid var(--rack-accent); outline-offset: 2px; }
      </style>
      <div class="scrim" data-scrim>
        <div class="panel" data-panel role="dialog" aria-modal="true" aria-labelledby="ways-heading">
          <div class="head">
            <h2 class="title" id="ways-heading" data-heading></h2>
            <button type="button" class="done" data-done>Done</button>
          </div>
          <div class="list" data-list role="radiogroup" aria-labelledby="ways-heading"></div>
          <button type="button" class="inv" data-inventory
            ><svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">${SLIDERS_GLYPH}</svg
            >Set Plate Inventory</button>
        </div>
      </div>
    `;
    this.listEl = this.root.querySelector<HTMLElement>('[data-list]')!;
    this.headingEl = this.root.querySelector<HTMLElement>('[data-heading]')!;
    this.headingEl.textContent = this._heading;
    // A scrim tap dismisses; a tap inside the panel must not (the <rack-setup> guard).
    this.root.querySelector('[data-scrim]')!.addEventListener('click', () => this.close());
    this.root
      .querySelector('[data-panel]')!
      .addEventListener('click', (e) => e.stopPropagation());
    this.root.querySelector('[data-done]')!.addEventListener('click', () => this.close());
    this.root.querySelector('[data-inventory]')!.addEventListener('click', () => {
      this.close();
      this.dispatchEvent(new CustomEvent('opensetup', { bubbles: true, composed: true }));
    });
    this.listEl.addEventListener('click', (e) => {
      const row = (e.target as Element | null)?.closest?.<HTMLElement>('[data-way]');
      if (!row) return;
      this.dispatchEvent(
        new CustomEvent<{ index: number }>('wayselect', {
          detail: { index: Number(row.dataset.way) },
          bubbles: true,
          composed: true,
        }),
      );
    });
    this.render();
  }

  private render(): void {
    if (!this.listEl) return;
    this.listEl.innerHTML = this._ways
      .map((way, i) => {
        const chips =
          way.length === 0
            ? '<span class="bare">bare Bar</span>'
            : `<span class="mini">${way
                .map(
                  (p) =>
                    `<span class="mc${darkInk(p.color) ? ' dark' : ''}" style="--disc: var(--rack-plate-${p.color})">${esc(plateLabel(p))}</span>`,
                )
                .join('')}</span>`;
        const name = way.length === 0 ? 'bare Bar' : way.map(faceOf).join(' + ');
        const on = i === this._index;
        return `<button type="button" class="way" role="radio" data-way="${i}"
          aria-checked="${on}" aria-label="${esc(`${name}, ${way.length} per side`)}"
          ><span class="dot" aria-hidden="true"></span>${chips}<span class="count"
            aria-hidden="true">${way.length} per side</span></button>`;
      })
      .join('');
  }
}

customElements.define('rack-ways', RackWays);
