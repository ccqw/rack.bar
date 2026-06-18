import { describe, it, expect, vi } from 'vitest';
import './entry.ts';

function mountEntry(): { el: HTMLElement; input: HTMLInputElement } {
  const el = document.createElement('rack-entry');
  document.body.append(el);
  const input = el.shadowRoot!.querySelector('input')!;
  return { el, input };
}

describe('<rack-entry>', () => {
  it('emits a target event with the parsed number on input (no submit step)', () => {
    const { el, input } = mountEntry();
    const seen = vi.fn();
    el.addEventListener('target', (e) =>
      seen((e as CustomEvent<{ target: number | null }>).detail.target),
    );
    input.value = '100';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(seen).toHaveBeenCalledWith(100);
  });

  it('steps by whole kilos -- the achievable Total grid is integers', () => {
    // Smallest Plate is 0.5 kg but it loads on both Sides (2 x 0.5 = 1 kg), so
    // every loadable Total is a whole number. Stepping by 0.5 would land on
    // off-grid half-kilos every other tick.
    const { input } = mountEntry();
    expect(input.step).toBe('1');
  });

  it('reports an empty field as a null Target, never NaN', () => {
    const { el, input } = mountEntry();
    let detail: { target: number | null } | undefined;
    el.addEventListener('target', (e) => {
      detail = (e as CustomEvent<{ target: number | null }>).detail;
    });
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(detail?.target).toBeNull();
  });

  it('reset() clears the field WITHOUT emitting a target event', () => {
    // The load-bearing half of the contract: the console calls reset() on switching
    // back to Decode, and a stray target event would re-decode and stomp the carried
    // Side Load (ADR-0005). Clearing must stay silent.
    const el = document.createElement('rack-entry') as HTMLElement & {
      reset(): void;
    };
    document.body.append(el);
    const input = el.shadowRoot!.querySelector('input')!;
    input.value = '100';
    const seen = vi.fn();
    el.addEventListener('target', seen);
    el.reset();
    expect(input.value).toBe('');
    expect(seen).not.toHaveBeenCalled();
  });
});
