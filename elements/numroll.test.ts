import { describe, it, expect } from 'vitest';
import { rollText, ROLL_CLASS } from './numroll.ts';

describe('rollText', () => {
  it('sets the text and marks it for the roll', () => {
    const el = document.createElement('span');
    rollText(el, '142 kg');
    expect(el.textContent).toBe('142 kg');
    expect(el.classList.contains(ROLL_CLASS)).toBe(true);
  });

  it('leaves the marker off when the value is unchanged (no flicker on re-render)', () => {
    const el = document.createElement('span');
    el.textContent = '100 kg';
    rollText(el, '100 kg');
    expect(el.classList.contains(ROLL_CLASS)).toBe(false);
  });

  it('re-arms the roll on a real change', () => {
    const el = document.createElement('span');
    rollText(el, '100 kg');
    expect(el.classList.contains(ROLL_CLASS)).toBe(true);
    // an unchanged call would drop the marker; a changed one keeps it armed
    rollText(el, '105 kg');
    expect(el.textContent).toBe('105 kg');
    expect(el.classList.contains(ROLL_CLASS)).toBe(true);
  });
});
