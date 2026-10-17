// The console builds the share card's link (RBAR-50 slice 3, ADR-0011 amendment,
// ADR-0014): from its mode, Side Load, the live decode's Target, the rig and the
// display Unit. When the load has no exact link, the card shows a disabled "No link"
// with its reason under the row.
import { describe, it, expect, beforeEach } from 'vitest';
import './console.ts';
import { parseLink } from '../lib/link.ts';
import { modeBtn, q, roundUp, sr, tapAdd, type, unitBtn } from './properties.drivers.ts';

type Console = HTMLElement & { barKg: number; collarKg: number; plateSet: string };
type Share = HTMLElement & { link: string | null };

function mountConsole(): Console {
  const el = document.createElement('rack-console') as Console;
  document.body.append(el);
  return el;
}
const card = (el: HTMLElement) => q<Share>(sr(el), 'rack-share');
const shareBtn = (el: HTMLElement) => q<HTMLButtonElement>(sr(el), '[data-share]');
const linkBtn = (el: HTMLElement) => q<HTMLButtonElement>(sr(card(el)), '[data-link]');
function share(el: HTMLElement): string | null {
  shareBtn(el).click();
  return card(el).link;
}
// The fragment of the card's link, parsed back (the recipient's unit is irrelevant: the
// console always writes `u`).
function sent(el: HTMLElement) {
  const url = share(el);
  expect(url).not.toBeNull();
  expect(url!.startsWith('https://rack.bar/#')).toBe(true);
  return parseLink(url!.slice(url!.indexOf('#')), 'kg')!;
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
});

describe('<rack-console> share link (RBAR-50, ADR-0014)', () => {
  it('a By Weight load carries its Target, Plates, rig and unit', () => {
    const el = mountConsole();
    type(el, '100');
    expect(share(el)).toBe(
      'https://rack.bar/#v=1&s=comp&b=20kg&m=w&c=0&u=kg&p=25,15&t=100&d=100',
    );
    expect(linkBtn(el).disabled).toBe(false);
  });

  it('a short Target carries the typed Target, not the loaded Total', () => {
    const el = mountConsole();
    type(el, '100.5');
    const s = sent(el);
    expect(s.mode === 'decode' && s.targetKg).toBe(100.5);
    expect(s.side.map((p) => p.kg)).toEqual([25, 15]);
  });

  it('the round-up carries the round-up Plates with the same Target', () => {
    const el = mountConsole();
    type(el, '100.5');
    roundUp(el).click();
    const s = sent(el);
    expect(s.mode === 'decode' && s.targetKg).toBe(100.5);
    expect(s.side.map((p) => p.kg)).toEqual([25, 15, 0.5]);
  });

  it('a By Plates load carries its Plates and no Target', () => {
    const el = mountConsole();
    modeBtn(el, 'encode').click();
    tapAdd(el, 25);
    tapAdd(el, 25);
    expect(share(el)).toBe('https://rack.bar/#v=1&s=comp&b=20kg&m=p&c=0&u=kg&p=2x25');
  });

  it('a carried load in By Weight (no live decode) carries no Target', () => {
    const el = mountConsole();
    modeBtn(el, 'encode').click();
    tapAdd(el, 25);
    modeBtn(el, 'decode').click();
    const s = sent(el);
    expect(s.mode).toBe('decode');
    expect('targetKg' in s).toBe(false);
    expect(s.side.map((p) => p.kg)).toEqual([25]);
  });

  it('carries the rig and the display unit', () => {
    const el = mountConsole();
    el.barKg = 15;
    el.collarKg = 2.5;
    unitBtn(el, 'lb').click();
    const s = sent(el);
    expect([s.set, s.barKg, s.collarKg, s.unit]).toEqual(['comp', 15, 2.5, 'lb']);
  });

  // An off-menu Bar stands in for a custom Bar (RBAR-76): serializeLink refuses it.
  it('a load no link can carry exactly gets no link: Copy link reads "No link", disabled', () => {
    const el = mountConsole();
    el.barKg = 17; // not a Bar the Competition set offers
    type(el, '100');
    expect(share(el)).toBeNull();
    expect(linkBtn(el).disabled).toBe(true);
    expect(linkBtn(el).textContent).toBe('No link');
  });

  it('carries the Target field text as `d` (52.5 lb, finer than its 2 dp kg)', () => {
    const el = mountConsole();
    unitBtn(el, 'lb').click();
    type(el, '52.5');
    const s = sent(el);
    expect(s.mode === 'decode' && [s.targetKg, s.reading]).toEqual([23.81, '52.5']);
  });

  // Review finding (PR #111): the entry takes any Target, but a link carries at most
  // MAX_TARGET_KG. Typing past it still loads a full Sleeve; that load gets the
  // visible "No link" state rather than a link without its Target (a different screen).
  it('a Target over the link cap (1000 kg) gets the visible "No link" state', () => {
    const el = mountConsole();
    type(el, '1200');
    expect(share(el)).toBeNull();
    expect(linkBtn(el).disabled).toBe(true);
    expect(linkBtn(el).textContent).toBe('No link');
  });

  it('a By Weight Target that rounds to 0 kg gets no link', () => {
    const el = mountConsole();
    type(el, '0');
    expect(share(el)).toBeNull();
    expect(linkBtn(el).disabled).toBe(true);
  });
});
