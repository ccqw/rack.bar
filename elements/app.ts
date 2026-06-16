// <rack-app> — placeholder application shell (scaffold). It exists to prove the
// toolchain end to end: a Web Component (Shadow DOM, themed only through --rack-*
// design tokens, ADR-0001) mounted by index.html and importing the functional
// core from lib/. The real Decode/Encode console replaces it next.
import { ELEIKO_KG } from '../lib/plates.ts';

class RackApp extends HTMLElement {
  private root: ShadowRoot = this.attachShadow({ mode: 'open' });

  connectedCallback(): void {
    const chips = ELEIKO_KG.map(
      (p) =>
        `<span class="chip" data-color="${p.color}" style="--chip: var(--rack-plate-${p.color})">${p.kg}</span>`,
    ).join('');

    this.root.innerHTML = `
      <style>
        :host { display: block; width: 100%; max-width: 520px; }
        .card {
          border: 1px solid var(--rack-line);
          border-radius: var(--rack-radius);
          padding: 28px 24px;
          text-align: center;
        }
        h1 {
          margin: 0;
          font-size: clamp(34px, 12vw, 56px);
          letter-spacing: -0.02em;
        }
        h1 .dot { color: var(--rack-accent); }
        p { color: var(--rack-muted); margin: 8px 0 24px; }
        .row {
          display: flex; flex-wrap: wrap; gap: 8px; justify-content: center;
        }
        .chip {
          font-family: var(--rack-font-num);
          font-size: 14px; font-weight: 600;
          min-width: 40px; padding: 8px 6px;
          border-radius: 999px;
          background: var(--chip);
          /* white plate needs dark ink; the rest carry light text */
          color: #0f1113;
        }
        .chip[data-color="red"],
        .chip[data-color="blue"],
        .chip[data-color="green"] { color: #fff; }
      </style>
      <div class="card">
        <h1>rack<span class="dot">.</span>bar</h1>
        <p>load the bar &middot; scaffold</p>
        <div class="row">${chips}</div>
      </div>
    `;
  }
}

customElements.define('rack-app', RackApp);
