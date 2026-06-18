import { describe, it, expect } from 'vitest';
import './console.ts';

function mountConsole(): HTMLElement {
  const el = document.createElement('rack-console');
  document.body.append(el);
  return el;
}

// Type a Target through the entry's on-screen keypad (RBAR-8) -- the real input path.
// Clears first, then taps each digit/decimal; '' just clears back to a bare Bar.
function type(el: HTMLElement, value: string): void {
  const root = el.shadowRoot!.querySelector('rack-entry')!.shadowRoot!;
  const press = (k: string) =>
    root.querySelector<HTMLButtonElement>(`[data-key="${CSS.escape(k)}"]`)!.click();
  press('clear');
  for (const ch of value) press(ch);
}

function discs(el: HTMLElement): HTMLElement[] {
  return [
    ...el
      .shadowRoot!.querySelector('rack-sleeve')!
      .shadowRoot!.querySelectorAll<HTMLElement>('.disc'),
  ];
}

function total(el: HTMLElement): string {
  return el.shadowRoot!.querySelector('[data-total]')!.textContent ?? '';
}

function delta(el: HTMLElement): HTMLElement {
  return el.shadowRoot!.querySelector<HTMLElement>('[data-delta]')!;
}

function over(el: HTMLElement): HTMLButtonElement {
  return el.shadowRoot!.querySelector<HTMLButtonElement>('[data-over]')!;
}

function modeBtn(el: HTMLElement, mode: 'decode' | 'encode'): HTMLButtonElement {
  return el.shadowRoot!.querySelector<HTMLButtonElement>(
    `[data-mode="${mode}"]`,
  )!;
}

function entry(el: HTMLElement): HTMLElement {
  return el.shadowRoot!.querySelector<HTMLElement>('rack-entry')!;
}

function palette(el: HTMLElement): HTMLElement {
  return el.shadowRoot!.querySelector<HTMLElement>('rack-palette')!;
}

// The value currently shown in the Target field (what the +/- steppers move from).
// An empty draft renders the muted Bar-weight anchor; report that as '' (no Target).
function entryValue(el: HTMLElement): string {
  const v = entry(el).shadowRoot!.querySelector<HTMLElement>('[data-value]')!;
  return v.classList.contains('empty') ? '' : v.textContent ?? '';
}

// Tap a denomination key on the Encode palette (by kg).
function tapAdd(el: HTMLElement, kg: number): void {
  const key = palette(el)
    .shadowRoot!.querySelector<HTMLButtonElement>(`.key[data-kg="${kg}"]`)!;
  key.click();
}

// Tap a loaded disc on the sleeve to remove it (by position).
function tapDisc(el: HTMLElement, index: number): void {
  discs(el)[index].click();
}

describe('<rack-console> (Decode: at-or-under + delta)', () => {
  it('decodes an exact Target into discs and the achieved Total, with no delta note', () => {
    const el = mountConsole();
    type(el, '100');
    expect(discs(el).map((d) => d.dataset.kg)).toEqual(['25', '15']);
    expect(total(el)).toContain('100');
    expect(delta(el).hidden).toBe(true);
  });

  it('shows the bare Bar and Total 20 for an empty Target', () => {
    const el = mountConsole();
    type(el, '');
    expect(discs(el).length).toBe(0);
    expect(total(el)).toContain('20');
    expect(delta(el).hidden).toBe(true);
  });

  it('rounds an off-grid Target down and renders how far under it landed', () => {
    const el = mountConsole();
    type(el, '100.5');
    // Nearest at-or-under is 100 -> the same 25 + 15 Side Load is shown.
    expect(discs(el).map((d) => d.dataset.kg)).toEqual(['25', '15']);
    expect(total(el)).toContain('100');
    const note = delta(el);
    expect(note.hidden).toBe(false);
    expect(note.textContent).toContain('0.5');
    expect(note.textContent!.toLowerCase()).toContain('under');
  });

  it('floors a sub-Bar Target at the bare Bar and flags it', () => {
    const el = mountConsole();
    type(el, '10');
    expect(discs(el).length).toBe(0);
    expect(total(el)).toContain('20');
    const note = delta(el);
    expect(note.hidden).toBe(false);
    expect(note.textContent!.toLowerCase()).toContain('bar');
    // A sub-Bar Target already sits above the Target -- no round-up to offer.
    expect(over(el).hidden).toBe(true);
  });

  describe('over-target opt-in (ADR-0003, RBAR-11)', () => {
    it('offers the over option as an explicit opt-in, primary still selected', () => {
      const el = mountConsole();
      type(el, '100.5');
      // The at-or-under primary renders by default -- over is never auto-selected.
      expect(total(el)).toContain('100');
      expect(discs(el).map((d) => d.dataset.kg)).toEqual(['25', '15']);
      // The opt-in control surfaces the over Total and its positive delta.
      const opt = over(el);
      expect(opt.hidden).toBe(false);
      expect(opt.textContent).toContain('101');
      expect(opt.textContent).toContain('0.5');
    });

    it('renders the over Side Load and Total when the opt-in is chosen', () => {
      const el = mountConsole();
      type(el, '100.5');
      over(el).click();
      expect(total(el)).toContain('101');
      expect(discs(el).map((d) => d.dataset.kg)).toEqual(['25', '15', '0.5']);
      const note = delta(el);
      expect(note.hidden).toBe(false);
      expect(note.textContent!.toLowerCase()).toContain('over');
    });

    it('toggles back to the at-or-under primary from the over option', () => {
      const el = mountConsole();
      type(el, '100.5');
      over(el).click(); // -> over (101)
      over(el).click(); // -> back to primary (100)
      expect(total(el)).toContain('100');
      expect(discs(el).map((d) => d.dataset.kg)).toEqual(['25', '15']);
    });

    it('hides the over option for an exactly achievable Target', () => {
      const el = mountConsole();
      type(el, '100');
      expect(over(el).hidden).toBe(true);
    });

    it('resets to the primary (clearing any over choice) when the Target changes', () => {
      const el = mountConsole();
      type(el, '100.5');
      over(el).click(); // chose over (101)
      type(el, '100'); // exact Target -> primary, no over
      expect(total(el)).toContain('100');
      expect(over(el).hidden).toBe(true);
    });

    it('re-offers the round-up (not "back to") when a new off-grid Target is typed', () => {
      const el = mountConsole();
      type(el, '100.5');
      over(el).click(); // showing over (101)
      type(el, '142.5'); // new off-grid Target -> back on primary, over re-offered
      expect(total(el)).toContain('142');
      const opt = over(el);
      expect(opt.hidden).toBe(false);
      expect(opt.textContent!.toLowerCase()).toContain('round up'); // not the "back to" label
      expect(opt.textContent).toContain('143');
    });
  });
});

describe('<rack-console> (Decode/Encode toggle, shared Side Load)', () => {
  it('starts in Decode mode: the Target entry shows, the palette is hidden', () => {
    const el = mountConsole();
    expect(modeBtn(el, 'decode').getAttribute('aria-pressed')).toBe('true');
    expect(modeBtn(el, 'encode').getAttribute('aria-pressed')).toBe('false');
    expect(entry(el).hidden).toBe(false);
    expect(palette(el).hidden).toBe(true);
  });

  it('labels the toggle by input (By Weight / By Plates), not by direction name', () => {
    // The user-facing copy names the input you work from; the internal direction
    // stays Decode/Encode via data-mode (the controlled vocabulary).
    const el = mountConsole();
    expect(modeBtn(el, 'decode').textContent).toBe('By Weight');
    expect(modeBtn(el, 'encode').textContent).toBe('By Plates');
  });

  it('toggling to Encode reveals the palette and hides the Target entry', () => {
    const el = mountConsole();
    modeBtn(el, 'encode').click();
    expect(modeBtn(el, 'encode').getAttribute('aria-pressed')).toBe('true');
    expect(palette(el).hidden).toBe(false);
    expect(entry(el).hidden).toBe(true);
  });

  it('reads an empty Side Load as the bare Bar (Total 20) in Encode', () => {
    const el = mountConsole();
    modeBtn(el, 'encode').click();
    expect(discs(el).length).toBe(0);
    expect(total(el)).toContain('20');
  });

  it('builds a Side Load by tapping plates and reads the running Total', () => {
    const el = mountConsole();
    modeBtn(el, 'encode').click();
    tapAdd(el, 25);
    tapAdd(el, 15);
    expect(discs(el).map((d) => d.dataset.kg)).toEqual(['25', '15']);
    expect(total(el)).toContain('100'); // 20 + 2 x 40
  });

  it('keeps the built Side Load heaviest-first regardless of tap order', () => {
    const el = mountConsole();
    modeBtn(el, 'encode').click();
    tapAdd(el, 5);
    tapAdd(el, 25);
    tapAdd(el, 15);
    expect(discs(el).map((d) => d.dataset.kg)).toEqual(['25', '15', '5']);
  });

  it('removes a Plate when its loaded disc is tapped, and updates the Total', () => {
    const el = mountConsole();
    modeBtn(el, 'encode').click();
    tapAdd(el, 25);
    tapAdd(el, 15);
    tapDisc(el, 0); // tap the 25 off
    expect(discs(el).map((d) => d.dataset.kg)).toEqual(['15']);
    expect(total(el)).toContain('50'); // 20 + 2 x 15
  });

  it('hides the delta and the over-target opt-in in Encode mode', () => {
    const el = mountConsole();
    type(el, '100.5'); // Decode: over option surfaces
    expect(over(el).hidden).toBe(false);
    modeBtn(el, 'encode').click();
    expect(over(el).hidden).toBe(true);
    expect(delta(el).hidden).toBe(true);
  });

  it('carries the chosen over loadout through Encode and back without a stale note', () => {
    // The three reset duties of a mode switch crossing at once: choose the over option
    // (showingOver=true, side = the 101 loadout), flip to Encode and back. On return the
    // over Side Load must persist, with no leftover over button or "over target" note.
    const el = mountConsole();
    type(el, '100.5');
    over(el).click(); // -> over (101): 25 + 15 + 0.5
    modeBtn(el, 'encode').click();
    modeBtn(el, 'decode').click();
    expect(discs(el).map((d) => d.dataset.kg)).toEqual(['25', '15', '0.5']);
    expect(total(el)).toContain('101');
    expect(over(el).hidden).toBe(true);
    expect(delta(el).hidden).toBe(true);
  });

  it('removes the tapped duplicate, not just any match, through the DOM path', () => {
    // The disc->Plate binding is positional while removePlate matches by value; with two
    // identical 25s loaded, tapping the second disc must still leave exactly one 25.
    const el = mountConsole();
    modeBtn(el, 'encode').click();
    tapAdd(el, 25);
    tapAdd(el, 25);
    expect(discs(el).map((d) => d.dataset.kg)).toEqual(['25', '25']);
    tapDisc(el, 1); // tap the second 25 off
    expect(discs(el).map((d) => d.dataset.kg)).toEqual(['25']);
    expect(total(el)).toContain('70'); // 20 + 2 x 25
  });

  describe('shared Side Load state persists across the switch', () => {
    it('carries the decoded Side Load into Encode, ready to edit', () => {
      const el = mountConsole();
      type(el, '100'); // Decode -> 25 + 15
      modeBtn(el, 'encode').click();
      expect(discs(el).map((d) => d.dataset.kg)).toEqual(['25', '15']);
      expect(total(el)).toContain('100');
      // and it is now editable: tap a 5 on
      tapAdd(el, 5);
      expect(discs(el).map((d) => d.dataset.kg)).toEqual(['25', '15', '5']);
      expect(total(el)).toContain('110');
    });

    it('carries an encoded Side Load back into Decode until a new Target is typed', () => {
      const el = mountConsole();
      modeBtn(el, 'encode').click();
      tapAdd(el, 25);
      tapAdd(el, 20); // 20 + 2 x 45 = 110
      modeBtn(el, 'decode').click();
      // the hand-built loadout is still on the Bar, with no delta note (no Target yet)
      expect(discs(el).map((d) => d.dataset.kg)).toEqual(['25', '20']);
      expect(total(el)).toContain('110');
      expect(delta(el).hidden).toBe(true);
      // typing a Target takes Decode back over
      type(el, '100');
      expect(discs(el).map((d) => d.dataset.kg)).toEqual(['25', '15']);
      expect(total(el)).toContain('100');
    });

    it('seeds the Target field with the carried Total so the steppers move from it', () => {
      // After building in Encode and switching to Decode, the field must hold the
      // current Total -- the +/- steppers step from the field value, so a blank
      // field would step from zero and throw away the loaded weight.
      const el = mountConsole();
      modeBtn(el, 'encode').click();
      tapAdd(el, 25);
      tapAdd(el, 20); // Total 110
      modeBtn(el, 'decode').click();
      expect(entryValue(el)).toBe('110');
      // an empty loadout seeds a blank field, not "20"
      type(el, ''); // back to bare Bar in Decode
      modeBtn(el, 'encode').click();
      modeBtn(el, 'decode').click();
      expect(entryValue(el)).toBe('');
    });
  });
});
