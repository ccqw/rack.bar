import { describe, it, expect } from 'vitest';
import './console.ts';
import { lbToKg } from '../lib/units.ts';

type Console = HTMLElement & {
  barKg: number;
  collarKg: number;
  plateSet: string;
};

function mountConsole(): Console {
  const el = document.createElement('rack-console') as Console;
  document.body.append(el);
  return el;
}

// The raw text in the Target field, anchor included (entryValue hides the muted
// anchor; this test needs to read it to prove it follows the Bar).
function entryAnchorText(el: HTMLElement): string {
  return (
    entry(el).shadowRoot!.querySelector<HTMLElement>('[data-value]')!.textContent ??
    ''
  );
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

describe('<rack-console> (Bar selection flows into the solver, RBAR-15)', () => {
  it('reflects a chosen Bar in the bare-Bar Total', () => {
    const el = mountConsole();
    el.barKg = 15;
    expect(discs(el).length).toBe(0);
    expect(total(el)).toContain('15'); // bare 15 kg Bar, not the 20 kg default
  });

  it('decodes a Target against the chosen Bar (not the 20 kg default)', () => {
    const el = mountConsole();
    el.barKg = 15;
    type(el, '65'); // (65 - 15) / 2 = 25 per Side -> a single 25
    expect(discs(el).map((d) => d.dataset.kg)).toEqual(['25']);
    expect(total(el)).toContain('65');
  });

  it('encodes a hand-built Side Load against the chosen Bar', () => {
    const el = mountConsole();
    el.barKg = 15;
    modeBtn(el, 'encode').click();
    tapAdd(el, 25);
    expect(total(el)).toContain('65'); // 15 + 2 x 25
  });

  it('re-decodes the standing Target when the Bar changes', () => {
    // Changing the Bar with a Target on screen recomputes the Side Load: the same
    // 100 kg Target needs different Plates on a lighter Bar.
    const el = mountConsole();
    type(el, '100'); // 20 kg Bar -> 25 + 15
    expect(discs(el).map((d) => d.dataset.kg)).toEqual(['25', '15']);
    el.barKg = 15; // (100 - 15) / 2 = 42.5 -> 25 + 15 + 2.5
    expect(discs(el).map((d) => d.dataset.kg)).toEqual(['25', '15', '2.5']);
    expect(total(el)).toContain('100'); // still hits the Target, just more Plates
  });

  it('names the chosen Bar in the sub-Bar floor note', () => {
    const el = mountConsole();
    el.barKg = 5;
    type(el, '3'); // below the 5 kg Bar -> floored at the bare Bar
    expect(total(el)).toContain('5');
    const note = delta(el);
    expect(note.hidden).toBe(false);
    expect(note.textContent).toContain('5');
    expect(note.textContent!.toLowerCase()).toContain('bar');
  });

  it('moves the Target entry anchor to the chosen Bar', () => {
    const el = mountConsole();
    el.barKg = 15;
    // The empty-field anchor (what the steppers move from) follows the Bar.
    expect(entryAnchorText(el)).toBe('15');
  });

  it('clears a showing over-target option when the Bar changes, re-offering it fresh', () => {
    // The intersection of two state machines: an over-target opt-in is on screen, then
    // the Bar changes. The re-decode must drop back to the new Bar's at-or-under primary
    // (showingOver reset) and re-offer the round-up, not leave the stale over loadout.
    const el = mountConsole();
    type(el, '100.5');
    over(el).click(); // showing over (101) on the 20 kg Bar
    expect(total(el)).toContain('101');
    el.barKg = 15; // re-decode 100.5 against the 15 kg Bar
    expect(total(el)).toContain('100'); // back on the at-or-under primary
    expect(delta(el).textContent!.toLowerCase()).toContain('under');
    const opt = over(el);
    expect(opt.hidden).toBe(false);
    expect(opt.textContent!.toLowerCase()).toContain('round up'); // fresh, not "back to"
  });

  it('re-reads the Total but keeps a hand-built loadout when the Bar changes in Encode', () => {
    const el = mountConsole();
    modeBtn(el, 'encode').click();
    tapAdd(el, 25);
    tapAdd(el, 25); // 20 + 2 x 50 = 120
    expect(total(el)).toContain('120');
    el.barKg = 15; // the carried loadout stays; only the Total re-reads: 15 + 2 x 50
    expect(discs(el).map((d) => d.dataset.kg)).toEqual(['25', '25']);
    expect(total(el)).toContain('115');
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

describe('<rack-console> (Collars fold into the baseline, RBAR-16, ADR-0008)', () => {
  it('shifts the bare-rig Total by both collars', () => {
    const el = mountConsole();
    el.collarKg = 2.5;
    expect(discs(el).length).toBe(0);
    expect(total(el)).toContain('25'); // 20 kg Bar + 2 x 2.5 kg collar, no Plates
  });

  it('decodes a Target against the collar baseline (Bar + 2 x collar)', () => {
    const el = mountConsole();
    el.collarKg = 2.5; // baseline 25
    type(el, '95'); // (95 - 25) / 2 = 35 per Side -> 25 + 10
    expect(discs(el).map((d) => d.dataset.kg)).toEqual(['25', '10']);
    expect(total(el)).toContain('95');
  });

  it('re-decodes the standing Target when the Collar changes', () => {
    const el = mountConsole();
    type(el, '100'); // 20 kg Bar, no collar -> 25 + 15
    expect(discs(el).map((d) => d.dataset.kg)).toEqual(['25', '15']);
    el.collarKg = 2.5; // baseline 25 -> (100 - 25) / 2 = 37.5 -> 25 + 10 + 2.5
    expect(discs(el).map((d) => d.dataset.kg)).toEqual(['25', '10', '2.5']);
    expect(total(el)).toContain('100'); // still hits the Target, different Plates
  });

  it('encodes a hand-built Side Load against the collar baseline', () => {
    const el = mountConsole();
    el.collarKg = 2.5;
    modeBtn(el, 'encode').click();
    tapAdd(el, 25);
    expect(total(el)).toContain('75'); // 25 baseline + 2 x 25
  });

  it('moves the Target entry anchor to the collar baseline', () => {
    const el = mountConsole();
    el.collarKg = 2.5;
    // The empty-field anchor (what the steppers move from) is the bare-rig weight.
    expect(entryAnchorText(el)).toBe('25');
  });

  it('stacks the Collar on top of a chosen Bar', () => {
    const el = mountConsole();
    el.barKg = 15;
    el.collarKg = 2.5; // baseline 15 + 5 = 20
    expect(total(el)).toContain('20');
    type(el, '90'); // (90 - 20) / 2 = 35 per Side -> 25 + 10
    expect(discs(el).map((d) => d.dataset.kg)).toEqual(['25', '10']);
    expect(total(el)).toContain('90');
  });

  it('names the Bar + Collars baseline in the sub-baseline floor note', () => {
    // A Target below the bare rig (Bar + 2 x collar) floors at the baseline. With a
    // collar fitted the note must name that baseline, not the bare Bar (ADR-0008).
    const el = mountConsole();
    el.collarKg = 2.5; // baseline 25 on the default 20 kg Bar
    type(el, '22'); // below the 25 kg floor
    expect(total(el)).toContain('25');
    const note = delta(el);
    expect(note.hidden).toBe(false);
    expect(note.textContent).toContain('25'); // the collared baseline, not 20
    expect(note.textContent!.toLowerCase()).toContain('collars');
  });

  it('re-reads the Total but keeps a hand-built loadout when the Collar changes in Encode', () => {
    // The Encode analogue of the Bar-change test: fitting a collar over a standing
    // hand-built Side Load preserves the Plates and only re-reads the Total.
    const el = mountConsole();
    modeBtn(el, 'encode').click();
    tapAdd(el, 25);
    tapAdd(el, 25); // 20 kg Bar + 2 x 50 = 120
    expect(total(el)).toContain('120');
    el.collarKg = 2.5; // baseline 25; the loadout stays, Total re-reads: 25 + 2 x 50 = 125
    expect(discs(el).map((d) => d.dataset.kg)).toEqual(['25', '25']);
    expect(total(el)).toContain('125');
  });
});

// -- Recent Targets (RBAR-20, ADR-0009) --------------------------------------------
const RECENTS_KEY = 'rackbar.recents';

function recentsEl(el: HTMLElement): HTMLElement & { targets: readonly number[] } {
  return el.shadowRoot!.querySelector('rack-recents')!;
}
function recentChips(el: HTMLElement): HTMLButtonElement[] {
  return [...recentsEl(el).shadowRoot!.querySelectorAll<HTMLButtonElement>('[data-target]')];
}
function recentLabels(el: HTMLElement): number[] {
  return recentChips(el).map((c) => Number(c.dataset.target));
}
// The Target field's value button -- tapping it opens then closes the keypad.
function valueBtn(el: HTMLElement): HTMLButtonElement {
  return entry(el).shadowRoot!.querySelector<HTMLButtonElement>('[data-value]')!;
}
// Commit a typed Target the way a lifter does: type it, then open and close the keypad
// (the close is the commit that feeds Recents).
function commit(el: HTMLElement, value: string): void {
  type(el, value);
  valueBtn(el).click(); // open
  valueBtn(el).click(); // close -> keypadclose
}

describe('<rack-console> Recent Targets (RBAR-20, ADR-0009)', () => {
  it('shows no Recent row before any Target is committed', () => {
    const el = mountConsole();
    expect(recentsEl(el).hidden).toBe(true);
  });

  it('remembers a Target when the keypad closes, rendering it as a chip', () => {
    const el = mountConsole();
    commit(el, '100');
    expect(recentsEl(el).hidden).toBe(false);
    expect(recentLabels(el)).toEqual([100]);
  });

  it('does not remember the default on an idle keypad peek (open then close, no typing)', () => {
    const el = mountConsole();
    valueBtn(el).click(); // open on the pristine 20 kg default
    valueBtn(el).click(); // close without typing
    expect(recentsEl(el).hidden).toBe(true);
    expect(recentLabels(el)).toEqual([]);
  });

  it('does not remember an empty field on keypad close (null Target)', () => {
    const el = mountConsole();
    valueBtn(el).click(); // open
    entry(el)
      .shadowRoot!.querySelector<HTMLButtonElement>('[data-key="clear"]')!
      .click(); // empty the field
    valueBtn(el).click(); // close on null
    expect(recentsEl(el).hidden).toBe(true);
    expect(recentLabels(el)).toEqual([]);
  });

  it('keeps Recents most-recent-first and deduped across commits', () => {
    const el = mountConsole();
    commit(el, '100');
    commit(el, '80');
    commit(el, '100'); // re-commit moves it to the front, no duplicate
    expect(recentLabels(el)).toEqual([100, 80]);
  });

  it('caps the row at 6, dropping the oldest', () => {
    const el = mountConsole();
    ['10', '20', '30', '40', '50', '60', '70'].forEach((v) => commit(el, v));
    expect(recentLabels(el)).toEqual([70, 60, 50, 40, 30, 20]);
  });

  it('tapping a chip re-applies it as the Target: decodes it and shows it in the field', () => {
    const el = mountConsole();
    commit(el, '100');
    commit(el, '60'); // field now holds 60
    recentChips(el).find((c) => c.dataset.target === '100')!.click();
    expect(entryAnchorText(el)).toBe('100'); // the field shows the re-applied Target
    expect(total(el)).toContain('100'); // and it is decoded (100 is exactly loadable)
  });

  it('re-applying a chip moves it back to the front of Recents', () => {
    const el = mountConsole();
    commit(el, '100');
    commit(el, '80');
    commit(el, '60'); // [60, 80, 100]
    recentChips(el).find((c) => c.dataset.target === '100')!.click();
    expect(recentLabels(el)).toEqual([100, 60, 80]);
  });

  it('persists Recents under rackbar.recents (canonical kg)', () => {
    const el = mountConsole();
    commit(el, '100');
    commit(el, '142.5');
    expect(JSON.parse(localStorage.getItem(RECENTS_KEY)!)).toEqual([142.5, 100]);
  });

  it('restores persisted Recents on init', () => {
    localStorage.setItem(RECENTS_KEY, JSON.stringify([120, 100, 80]));
    const el = mountConsole();
    expect(recentsEl(el).hidden).toBe(false);
    expect(recentLabels(el)).toEqual([120, 100, 80]);
  });

  it('survives garbage in the persisted key, starting from an empty row', () => {
    localStorage.setItem(RECENTS_KEY, 'not-json');
    const el = mountConsole();
    expect(recentsEl(el).hidden).toBe(true);
    expect(recentLabels(el)).toEqual([]);
  });

  it('hides the Recent row in By-Plates (Encode) mode, restores it in By-Weight', () => {
    localStorage.setItem(RECENTS_KEY, JSON.stringify([100]));
    const el = mountConsole();
    expect(recentsEl(el).hidden).toBe(false);
    modeBtn(el, 'encode').click();
    expect(recentsEl(el).hidden).toBe(true); // recents are a Decode affordance
    modeBtn(el, 'decode').click();
    expect(recentsEl(el).hidden).toBe(false);
  });
});

// -- kg|lb display unit + plate set (RBAR-17, ADR-0010) ------------------------------
const UNIT_KEY = 'rackbar.unit';
const SECONDARY_KEY = 'rackbar.secondary';

function unitBtn(el: HTMLElement, unit: 'kg' | 'lb'): HTMLButtonElement {
  return el.shadowRoot!.querySelector<HTMLButtonElement>(`[data-unit="${unit}"]`)!;
}
function secondaryEl(el: HTMLElement): HTMLButtonElement {
  return el.shadowRoot!.querySelector<HTMLButtonElement>('[data-secondary]')!;
}

describe('<rack-console> display unit toggle (RBAR-17, ADR-0010)', () => {
  it('defaults to kg and reads the Total in kg', () => {
    const el = mountConsole();
    expect(unitBtn(el, 'kg').getAttribute('aria-pressed')).toBe('true');
    expect(total(el)).toBe('20 kg');
  });

  it('toggling to lb re-reads the Total in pounds and entry follows', () => {
    const el = mountConsole();
    unitBtn(el, 'lb').click();
    expect(unitBtn(el, 'lb').getAttribute('aria-pressed')).toBe('true');
    expect(total(el)).toBe('44 lb'); // a bare 20 kg Bar reads 44 lb
    // the entry caption follows the unit
    expect(
      entry(el).shadowRoot!.querySelector('[data-caption]')!.textContent,
    ).toBe('Target (lb)');
  });

  it('persists the Primary unit and restores it on init', () => {
    const el = mountConsole();
    unitBtn(el, 'lb').click();
    expect(localStorage.getItem(UNIT_KEY)).toBe('lb');
    el.remove();
    const el2 = mountConsole();
    expect(unitBtn(el2, 'lb').getAttribute('aria-pressed')).toBe('true');
    expect(total(el2)).toBe('44 lb');
  });

  it('shows the Secondary readout in the other unit, hideable and persisted', () => {
    const el = mountConsole();
    const sec = secondaryEl(el);
    expect(sec.textContent).toBe('44 lb'); // kg primary -> lb secondary
    sec.click(); // hide it
    expect(sec.textContent).toContain('Show');
    expect(localStorage.getItem(SECONDARY_KEY)).toBe('0');
    el.remove();
    const el2 = mountConsole();
    expect(secondaryEl(el2).textContent).toContain('Show'); // stays hidden
  });

  it('keys the under-target note off the DISPLAYED pounds, not the raw kg delta', () => {
    // 311 lb decodes to a 141 kg bar that reads back as 311 lb -- displayed-exact, even
    // though it is 0.15 lb under in raw kg. The note and the round-up must both hide.
    const el = mountConsole();
    unitBtn(el, 'lb').click();
    type(el, '311');
    expect(total(el)).toBe('311 lb');
    expect(delta(el).hidden).toBe(true);
    expect(over(el).hidden).toBe(true);
  });

  it('keeps the round-up control reachable after a unit toggle while parked on over (ADR-0003)', () => {
    // The two state machines crossing: choose the over loadout, then toggle units to a
    // unit where the primary now DISPLAYS exact. The over control must not vanish -- it is
    // the only way back to the at-or-under primary, so hiding it would strand the lifter
    // over Target with no path back (100.01 kg -> primary 100, over 101; in lb both the
    // primary and the Target display 220, which pre-fix hid the control).
    const el = mountConsole();
    type(el, '100.01'); // off-grid: primary 100 kg, over 101 kg
    over(el).click(); // round up -> on the 101 kg over loadout
    expect(total(el)).toBe('101 kg');
    unitBtn(el, 'lb').click(); // primary now displays 220 lb == Target 220 lb
    expect(total(el)).toBe('223 lb'); // still parked on the over loadout
    expect(over(el).hidden).toBe(false); // the way back is still offered
    over(el).click(); // step back to the at-or-under primary
    expect(total(el)).toBe('220 lb');
    expect(discs(el).map((d) => d.dataset.kg)).toEqual(['25', '15']);
  });

  it('shows a pounds under-target note when the displayed pounds really miss', () => {
    const el = mountConsole();
    unitBtn(el, 'lb').click();
    // 310 lb = 140.6 kg; nearest Eleiko at-or-under is 140 kg, which reads 309 lb -- a
    // real 1 lb miss in displayed pounds (not a sub-display-unit rounding miss).
    type(el, '310');
    expect(total(el)).toBe('309 lb');
    const note = delta(el);
    expect(note.hidden).toBe(false);
    expect(note.textContent).toContain('lb');
    expect(note.textContent!.toLowerCase()).toContain('under');
    // and the round-up to the next pound is offered
    expect(over(el).hidden).toBe(false);
    expect(over(el).textContent!.toLowerCase()).toContain('round up');
  });
});

describe('<rack-console> plate set (RBAR-17, ADR-0010)', () => {
  it('decodes against the iron Inventory and forces lb when Training is chosen', () => {
    const el = mountConsole();
    el.barKg = lbToKg(45); // the app pairs the set with its default Bar
    el.plateSet = 'training';
    // unit is forced to lb and the toggle is locked
    expect(unitBtn(el, 'lb').getAttribute('aria-pressed')).toBe('true');
    expect(unitBtn(el, 'kg').disabled).toBe(true);
    expect(unitBtn(el, 'lb').disabled).toBe(true);
    // a whole-lb Target lands exactly on the iron grid
    type(el, '135'); // 45 lb Bar + one 45 lb pair
    expect(total(el)).toBe('135 lb');
    expect(discs(el).length).toBe(1);
  });

  it('restores a free kg|lb toggle when switching back to Competition', () => {
    const el = mountConsole();
    unitBtn(el, 'lb').click(); // free lb choice on Competition, persisted as the pref
    el.barKg = lbToKg(45);
    el.plateSet = 'training'; // forced lb (toggle locked)
    expect(unitBtn(el, 'kg').disabled).toBe(true);
    el.barKg = 20;
    el.plateSet = 'comp';
    expect(unitBtn(el, 'kg').disabled).toBe(false); // free again
    expect(unitBtn(el, 'lb').getAttribute('aria-pressed')).toBe('true'); // remembered lb pref
  });

  it('re-solves a standing Decode Target against the new set when the plate set changes', () => {
    // A Decode Target is unit-agnostic kg, so switching the set does NOT clear it (unlike
    // a hand-built Encode loadout): the same ~100 kg Target re-solves on the iron rig.
    const el = mountConsole();
    type(el, '100'); // comp: 25 + 15 Eleiko, exact
    expect(discs(el).map((d) => d.dataset.kg)).toEqual(['25', '15']);
    el.barKg = lbToKg(45);
    el.plateSet = 'training';
    // the Target persisted and re-solved on iron: a non-empty all-iron Side Load, in lb,
    // and not the bare 45 lb Bar
    expect(discs(el).length).toBeGreaterThan(0);
    expect(discs(el).every((d) => d.dataset.color === 'iron')).toBe(true);
    expect(total(el)).toContain('lb');
    expect(total(el)).not.toBe('45 lb');
  });

  it('swaps the Encode palette to the iron denominations on Training', () => {
    const el = mountConsole();
    el.barKg = lbToKg(45);
    el.plateSet = 'training';
    modeBtn(el, 'encode').click();
    const keys = [
      ...palette(el).shadowRoot!.querySelectorAll<HTMLButtonElement>('.key'),
    ].map((k) => k.textContent);
    expect(keys).toEqual(['45', '35', '25', '10', '5', '2.5']);
  });

  it('clears a hand-built Encode loadout when the plate set changes (Plates do not cross sets)', () => {
    const el = mountConsole();
    modeBtn(el, 'encode').click();
    tapAdd(el, 25);
    tapAdd(el, 20); // an Eleiko loadout
    expect(discs(el).length).toBe(2);
    el.barKg = lbToKg(45);
    el.plateSet = 'training'; // iron rig -- the Eleiko Plates are gone
    expect(discs(el).length).toBe(0);
    expect(total(el)).toBe('45 lb'); // bare 45 lb iron Bar, no Plates
  });
});

// The share card (RBAR-19, ADR-0011): the console owns the card, snapshots its current
// load, and feeds it. Opening the card in By-Weight mode also remembers the shown Target
// (the third recents push site -- closes the RBAR-20 deferred seam, ADR-0009/0011).
function shareCard(el: HTMLElement): HTMLElement {
  return el.shadowRoot!.querySelector<HTMLElement>('rack-share')!;
}
function shareBtn(el: HTMLElement): HTMLButtonElement {
  return el.shadowRoot!.querySelector<HTMLButtonElement>('[data-share]')!;
}
function shareText(el: HTMLElement, sel: string): string {
  return shareCard(el).shadowRoot!.querySelector<HTMLElement>(sel)!.textContent!.trim();
}
function shareChips(el: HTMLElement): string[] {
  return [
    ...shareCard(el).shadowRoot!.querySelectorAll<HTMLElement>('[data-chip]'),
  ].map((c) => c.textContent!.trim());
}
describe('<rack-console> (Share card)', () => {
  it('a Share control opens the card, hidden until then', () => {
    const el = mountConsole();
    expect(shareCard(el).hidden).toBe(true);
    shareBtn(el).click();
    expect(shareCard(el).hidden).toBe(false);
  });

  it('the card reflects the current Decode load: Total and per-Side chips', () => {
    const el = mountConsole();
    type(el, '100'); // 20 Bar + 25 + 15 per side
    shareBtn(el).click();
    expect(shareText(el, '[data-total]')).toBe('100 kg');
    expect(shareChips(el)).toEqual(['25', '15']);
  });

  it('the card reflects a hand-built Encode load', () => {
    const el = mountConsole();
    modeBtn(el, 'encode').click();
    tapAdd(el, 25);
    tapAdd(el, 25);
    shareBtn(el).click();
    expect(shareText(el, '[data-total]')).toBe('120 kg'); // 20 + 2*(25+25)
    expect(shareChips(el)).toEqual(['2x 25']);
  });

  it('shows the bare-bar state when nothing is loaded', () => {
    const el = mountConsole();
    shareBtn(el).click();
    expect(shareChips(el)).toHaveLength(0);
    expect(shareText(el, '[data-bare]')).toContain('Bare bar');
  });

  it('reads the card in the active display Unit', () => {
    const el = mountConsole();
    type(el, '100'); // 100 kg Target in the default kg display
    el.shadowRoot!.querySelector<HTMLButtonElement>('[data-unit="lb"]')!.click();
    shareBtn(el).click();
    expect(shareText(el, '[data-total]')).toBe('220 lb');
    expect(shareText(el, '[data-secondary]')).toBe('100 kg');
  });

  it('opening the card in By-Weight remembers the shown Target (RBAR-20 seam)', () => {
    const el = mountConsole();
    type(el, '100'); // typed but keypad not closed -- not yet remembered
    expect(recentLabels(el)).toEqual([]);
    shareBtn(el).click();
    expect(recentLabels(el)).toEqual([100]); // the open pushed it (kg-canonical)
  });

  it('opening the card in By-Plates remembers nothing (no Target there)', () => {
    const el = mountConsole();
    modeBtn(el, 'encode').click();
    tapAdd(el, 25);
    shareBtn(el).click();
    expect(recentLabels(el)).toEqual([]);
  });

  it('reflects the over-target loadout when shown, while remembering the typed Target', () => {
    const el = mountConsole();
    type(el, '100.5'); // off-grid: primary 100 (under), round-up 101
    over(el).click(); // show the round-up loadout -- this.side becomes the over loadout
    shareBtn(el).click();
    expect(shareText(el, '[data-total]')).toBe('101 kg'); // the over Total, not the 100 primary
    expect(shareChips(el)).toEqual(['25', '15', '0.5']);
    expect(recentLabels(el)).toEqual([100.5]); // the typed Target, not the over Total
  });

  it('folds a fitted Collar into the card Total and caption', () => {
    const el = mountConsole();
    el.collarKg = 2.5; // 20 Bar + 2 x 2.5 Collar baseline
    type(el, '105');
    shareBtn(el).click();
    expect(shareText(el, '[data-total]')).toBe('105 kg'); // 25 + 2 x (25 + 15) folded baseline
    expect(shareText(el, '[data-caption]')).toContain('collars 2.5 kg');
  });

  it('reads iron faces and lb through the card on the Training set', () => {
    const el = mountConsole();
    el.barKg = lbToKg(45);
    el.plateSet = 'training';
    type(el, '135'); // 45 lb iron Bar + 2 x 45 lb iron = 135 lb
    shareBtn(el).click();
    expect(shareText(el, '[data-total]')).toBe('135 lb');
    expect(shareChips(el)).toEqual(['45']); // the stamped lb face, not a kg mass
  });

  it('closing the card from within dismisses it', () => {
    const el = mountConsole();
    shareBtn(el).click();
    expect(shareCard(el).hidden).toBe(false);
    shareCard(el)
      .shadowRoot!.querySelector<HTMLButtonElement>('[data-close]')!
      .click();
    expect(shareCard(el).hidden).toBe(true);
  });
});

// The fullscreen rack card (RBAR-18): the console owns it like the share card -- the
// fullscreen control on the bar visualizer snapshots the current load and blows it up.
function fsCard(el: HTMLElement): HTMLElement {
  return el.shadowRoot!.querySelector<HTMLElement>('rack-fullscreen')!;
}
function fsBtn(el: HTMLElement): HTMLButtonElement {
  return el.shadowRoot!.querySelector<HTMLButtonElement>('[data-fullscreen]')!;
}
function fsText(el: HTMLElement, sel: string): string {
  return fsCard(el).shadowRoot!.querySelector<HTMLElement>(sel)!.textContent!.trim();
}
function fsSide(el: HTMLElement): number[] {
  return [
    ...fsCard(el)
      .shadowRoot!.querySelector('rack-sleeve')!
      .shadowRoot!.querySelectorAll<HTMLElement>('.disc'),
  ].map((d) => Number(d.dataset.kg));
}
describe('<rack-console> (Fullscreen rack card)', () => {
  it('a fullscreen control opens the immersive view, hidden until then', () => {
    const el = mountConsole();
    expect(fsCard(el).hidden).toBe(true);
    fsBtn(el).click();
    expect(fsCard(el).hidden).toBe(false);
  });

  it('blows up the current Decode load: Total and Side Load', () => {
    const el = mountConsole();
    type(el, '100'); // 20 Bar + 25 + 15 per side
    fsBtn(el).click();
    expect(fsText(el, '[data-total]')).toBe('100 kg');
    expect(fsSide(el)).toEqual([25, 15]);
  });

  it('blows up a hand-built Encode load', () => {
    const el = mountConsole();
    modeBtn(el, 'encode').click();
    tapAdd(el, 25);
    tapAdd(el, 25);
    fsBtn(el).click();
    expect(fsText(el, '[data-total]')).toBe('120 kg'); // 20 + 2*(25+25)
    expect(fsSide(el)).toEqual([25, 25]);
  });

  it('reads the view in the active display Unit', () => {
    const el = mountConsole();
    type(el, '100');
    el.shadowRoot!.querySelector<HTMLButtonElement>('[data-unit="lb"]')!.click();
    fsBtn(el).click();
    expect(fsText(el, '[data-total]')).toBe('220 lb');
  });

  it('a glance is read-only: opening fullscreen remembers nothing', () => {
    const el = mountConsole();
    type(el, '100'); // typed but keypad not closed -- not yet remembered
    expect(recentLabels(el)).toEqual([]);
    fsBtn(el).click();
    expect(recentLabels(el)).toEqual([]); // unlike the share card, no push on open
  });

  it('closing the view from within dismisses it', () => {
    const el = mountConsole();
    fsBtn(el).click();
    expect(fsCard(el).hidden).toBe(false);
    fsCard(el)
      .shadowRoot!.querySelector<HTMLButtonElement>('[data-close]')!
      .click();
    expect(fsCard(el).hidden).toBe(true);
  });
});
