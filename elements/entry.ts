// <rack-entry> -- the Target input. WALKING SKELETON (RBAR-2): a single numeric
// field that emits the typed Target on every keystroke (no submit step). It
// reports an empty field as a null Target so the console can show the bare Bar.
// The plus/minus steppers and tap-to-type keypad (PRD hybrid entry) land in RBAR-8.

class RackEntry extends HTMLElement {
  private root: ShadowRoot = this.attachShadow({ mode: 'open' });
  private input!: HTMLInputElement;

  /**
   * Show `value` in the field without emitting a `target` event (null clears it). The
   * console calls this when switching back into Decode (RBAR-7, ADR-0005): it seeds the
   * box with the carried Side Load's Total so the +/- steppers move from the real
   * current weight, not from zero -- and stays silent, so the hand-built loadout is not
   * re-decoded (and never collapses to its canonical form) until the lifter acts.
   */
  display(value: number | null): void {
    this.input.value = value === null ? '' : String(value);
  }

  connectedCallback(): void {
    this.root.innerHTML = `
      <style>
        :host { display: block; }
        label {
          display: block; text-align: center;
          color: var(--rack-muted); font-size: 13px; margin-bottom: 6px;
        }
        input {
          width: 100%; box-sizing: border-box; text-align: center;
          font-family: var(--rack-font-num);
          font-size: clamp(36px, 14vw, 56px); font-weight: 600;
          color: var(--rack-fg); background: transparent;
          border: none; border-bottom: 2px solid var(--rack-line);
          padding: 6px 0; outline: none;
        }
        input:focus { border-bottom-color: var(--rack-accent); }
      </style>
      <label for="t">Target (kg)</label>
      <!-- step=1: every achievable Total is a whole kg. The smallest Plate is
           0.5 kg, but it loads on both Sides (2 x 0.5 = 1), so the Total grid is
           integers. Stepping by 0.5 would land on off-grid half-kilos every
           other tick. -->
      <input id="t" type="number" inputmode="numeric" min="0" step="1"
             placeholder="0" />
    `;
    this.input = this.root.querySelector('input')!;
    const input = this.input;
    input.addEventListener('input', () => {
      const raw = input.value.trim();
      const parsed = raw === '' ? null : Number(raw);
      const target = parsed !== null && Number.isNaN(parsed) ? null : parsed;
      this.dispatchEvent(
        new CustomEvent<{ target: number | null }>('target', {
          detail: { target },
          bubbles: true,
          composed: true,
        }),
      );
    });
  }
}

customElements.define('rack-entry', RackEntry);
