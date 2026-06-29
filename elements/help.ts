// <rack-help> -- the "how it works" popover (RBAR-21). A circular help icon in the
// header that opens a compact, numbered two-step explainer of the calculator's two
// modes. Low-stakes first-run onboarding; it touches no calculator state.
//
// A self-contained, stateless shell (ADR-0001): it owns nothing but its own open/closed
// flag and renders the button plus its anchored popover together, so <rack-app> just
// drops one <rack-help> into the header. Unlike <rack-setup> / <rack-share> (scrim-backed
// modals), this is a header popover -- it dismisses on an outside tap, a second tap on the
// button, or Escape, via a document listener that is live only while open.
//
// The explainer names the modes with the words the toggle actually shows ("By Weight" /
// "By Plates", see <rack-console>), not the design handoff's prototype labels -- the help
// must match what the lifter sees on screen. Copy uses glossary terms (Target, Plates,
// Side; CONTEXT.md).

class RackHelp extends HTMLElement {
  private root: ShadowRoot = this.attachShadow({ mode: 'open' });
  private toggleBtn!: HTMLButtonElement;
  private popoverEl!: HTMLElement;
  private isOpen = false;

  // Bound once so add/removeEventListener pair up (an inline arrow would not unregister).
  // While open, a tap anywhere outside this element -- or Escape -- dismisses the popover.
  private onDocPointer = (e: Event): void => {
    if (!e.composedPath().includes(this)) this.close();
  };
  private onKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this.close();
  };

  /** Show the popover. */
  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.reflect();
    // Listen on the next tick is unnecessary: the opening click already stops at the
    // button (stopPropagation), so it never reaches this document handler.
    document.addEventListener('click', this.onDocPointer);
    document.addEventListener('keydown', this.onKeydown);
  }

  /** Hide the popover and tear down the outside-dismiss listeners. */
  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.reflect();
    document.removeEventListener('click', this.onDocPointer);
    document.removeEventListener('keydown', this.onKeydown);
  }

  private toggle(): void {
    this.isOpen ? this.close() : this.open();
  }

  // Push the open/closed flag onto the DOM: the popover's visibility and the button's
  // expanded state. The single source is `isOpen`; this just mirrors it.
  private reflect(): void {
    this.popoverEl.hidden = !this.isOpen;
    this.toggleBtn.setAttribute('aria-expanded', String(this.isOpen));
  }

  connectedCallback(): void {
    this.root.innerHTML = `
      <style>
        :host { position: relative; display: inline-flex; }
        @keyframes rack-pop { from { opacity: 0; transform: scale(.96); } to { opacity: 1; transform: scale(1); } }
        /* The circular help icon. Picks up the accent when open, mirroring the Setup pill. */
        .toggle {
          display: flex; align-items: center; justify-content: center;
          width: 22px; height: 22px; padding: 0;
          border-radius: 999px; cursor: pointer;
          color: var(--rack-muted);
          background: transparent; border: 1px solid var(--rack-line);
        }
        .toggle:hover { color: var(--rack-fg); }
        .toggle[aria-expanded="true"] {
          color: var(--rack-accent); border-color: var(--rack-accent);
          background: color-mix(in srgb, var(--rack-accent) 14%, transparent);
        }
        .toggle:focus-visible { outline: 2px solid var(--rack-accent); outline-offset: 2px; }
        .toggle svg { display: block; }
        /* The popover: anchored below-left of the icon, a compact raised card. */
        .popover {
          position: absolute; top: 100%; left: 0; margin-top: 9px; z-index: 30;
          width: 248px; padding: 13px 14px;
          background: var(--rack-overlay);
          border: 1px solid var(--rack-line);
          border-radius: var(--rack-radius-tile);
          box-shadow: 0 18px 40px -16px rgba(0, 0, 0, .7);
          display: flex; flex-direction: column; gap: 9px;
          transform-origin: top left;
          animation: rack-pop .16s cubic-bezier(.2, .85, .25, 1);
        }
        .popover[hidden] { display: none; }
        .heading {
          font-family: var(--rack-font-num); font-size: 11px; font-weight: 600;
          letter-spacing: .14em; text-transform: uppercase; color: var(--rack-muted);
        }
        .step { display: flex; gap: 8px; align-items: baseline; }
        .step .n {
          flex: none; font-family: var(--rack-font-num); font-size: 11px;
          font-weight: 700; color: var(--rack-accent);
        }
        .step .body {
          font-family: var(--rack-font); font-size: 12px; font-weight: 500;
          line-height: 1.4; color: var(--rack-fg);
        }
        .step .body strong { font-weight: 700; }
      </style>
      <button type="button" class="toggle" data-help-toggle
              aria-haspopup="dialog" aria-expanded="false" aria-label="How it works">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="6.4" stroke="currentColor" stroke-width="1.5"></circle>
          <circle cx="8" cy="5.1" r=".95" fill="currentColor"></circle>
          <path d="M8 7.3v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>
        </svg>
      </button>
      <div class="popover" data-help-popover role="dialog" aria-label="How it works" hidden>
        <span class="heading">How it works</span>
        <div class="step" data-help-step>
          <span class="n">1</span>
          <span class="body"><strong>By Weight</strong> - type a Target and we rack the Plates per Side.</span>
        </div>
        <div class="step" data-help-step>
          <span class="n">2</span>
          <span class="body"><strong>By Plates</strong> - tap a Plate to load a pair, tap a loaded Plate to remove it.</span>
        </div>
      </div>
    `;

    this.toggleBtn = this.root.querySelector('[data-help-toggle]')!;
    this.popoverEl = this.root.querySelector('[data-help-popover]')!;

    // The button toggles, and stops the click from bubbling to the document dismiss
    // handler -- otherwise opening and immediately self-dismissing would race.
    this.toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });
  }

  // Drop the document listeners if the element leaves the DOM while open, so a later
  // stray outside click never reaches a detached popover. Reset the open flag too: a
  // reconnect rebuilds the markup closed, so leaving `isOpen` stale-true would desync the
  // flag from the DOM -- the first toggle would no-op and a programmatic open() would be
  // silently dropped by its own guard. Resetting keeps the flag honest across reconnects.
  disconnectedCallback(): void {
    this.isOpen = false;
    document.removeEventListener('click', this.onDocPointer);
    document.removeEventListener('keydown', this.onKeydown);
  }
}

customElements.define('rack-help', RackHelp);
