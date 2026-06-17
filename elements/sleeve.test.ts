import { describe, it, expect } from 'vitest';
import './sleeve.ts';
import { ELEIKO_KG } from '../lib/plates.ts';
import type { Plate } from '../lib/plates.ts';

function side(...kgs: number[]): Plate[] {
  return kgs.map((kg) => ELEIKO_KG.find((p) => p.kg === kg)!);
}

function mountSleeve(): HTMLElement & { sideLoad: readonly Plate[] } {
  const el = document.createElement('rack-sleeve') as HTMLElement & {
    sideLoad: readonly Plate[];
  };
  document.body.append(el);
  return el;
}

describe('<rack-sleeve>', () => {
  it('renders one disc per Plate, in Side Load order, tagged with kg and color', () => {
    const el = mountSleeve();
    el.sideLoad = side(25, 15);
    const discs = [...el.shadowRoot!.querySelectorAll<HTMLElement>('.disc')];
    expect(discs.map((d) => d.dataset.kg)).toEqual(['25', '15']);
    expect(discs.map((d) => d.dataset.color)).toEqual(['red', 'yellow']);
  });

  it('renders no discs for an empty Side Load (a bare Bar)', () => {
    const el = mountSleeve();
    el.sideLoad = [];
    expect(el.shadowRoot!.querySelectorAll('.disc').length).toBe(0);
  });

  it('re-renders when the Side Load changes', () => {
    const el = mountSleeve();
    el.sideLoad = side(20);
    expect(el.shadowRoot!.querySelectorAll('.disc').length).toBe(1);
    el.sideLoad = side(25, 15, 5);
    expect(el.shadowRoot!.querySelectorAll('.disc').length).toBe(3);
  });
});
