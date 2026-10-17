// <rack-console> under Pairs of Plates on Hand (RBAR-72 slice 2, ADR-0016): a change
// re-solves whatever depends on the Inventory, at once.
import { describe, it, expect, beforeEach } from 'vitest';
import './console.ts';
import { ELEIKO_KG, plateFace } from '../lib/plates.ts';
import { PLATE_SETS } from '../lib/platesets.ts';
import type { PlatesOnHand } from '../lib/platesonhand.ts';
import {
  q, sr, type, modeBtn, tapAdd, roundUp, totalText, sideOnScreen, stairs, commitWorking,
} from './properties.drivers.ts';

type Console = HTMLElement & { plateSet: string; platesOnHand: PlatesOnHand };

function mount(): Console {
  document.body.innerHTML = '';
  localStorage.clear();
  const el = document.createElement('rack-console') as Console;
  document.body.append(el);
  return el;
}
const faces = () => sideOnScreen(document.querySelector('rack-console')!).map((d) => String(d.kg));

beforeEach(() => localStorage.clear());

describe('<rack-console> Pairs of Plates on Hand (RBAR-72)', () => {
  it('re-solves a standing By Weight Target the moment a limit changes', () => {
    const el = mount();
    type(el, '140');
    expect(faces()).toEqual(['25', '25', '10']);
    el.platesOnHand = { comp: { '25': 1 } };
    expect(faces()).toEqual(['25', '20', '15']); // still exactly 140
    expect(totalText(el)).toContain('140');
    el.platesOnHand = {};
    expect(faces()).toEqual(['25', '25', '10']);
  });

  it('falls back at or under (ADR-0003) and drops a chosen round-up', () => {
    const el = mount();
    type(el, '100.5');
    roundUp(el).click(); // showing the 101 round-up
    expect(totalText(el)).toContain('101');
    el.platesOnHand = { comp: { '0.5': 0 } };
    // Without 0.5s the Side steps by 1 kg on the 20 kg Bar: 100 at or under, not 101.
    expect(totalText(el)).toContain('100');
    expect(faces()).not.toContain('0.5');
    expect(roundUp(el).hidden).toBe(false);
    expect(roundUp(el).textContent!.toLowerCase()).toContain('round up');
  });

  it('every size none: the bare Bar, with no round-up, and nothing throws', () => {
    const el = mount();
    type(el, '100');
    const none = Object.fromEntries(PLATE_SETS.comp.inventory.map((p) => [plateFace(p), 0]));
    el.platesOnHand = { comp: none };
    expect(faces()).toEqual([]);
    expect(totalText(el)).toContain('20');
    expect(roundUp(el).hidden).toBe(true);
  });

  it('keeps a hand-built By Plates Side and re-badges the palette', () => {
    const el = mount();
    modeBtn(el, 'encode').click();
    tapAdd(el, 25);
    tapAdd(el, 25);
    el.platesOnHand = { comp: { '25': 1 } };
    expect(faces()).toEqual(['25', '25']);
    const key = sr(q(sr(el), 'rack-palette')).querySelector<HTMLElement>('[data-kg="25"]')!;
    expect(key.querySelector('.badge')!.textContent).toBe('x1');
  });

  it('re-plans the Warm up Ramp on the plates on hand; all none gives bare-Bar rows', () => {
    const el = mount();
    modeBtn(el, 'warmup').click();
    commitWorking(el, '140');
    const last = () => stairs(el).length - 1;
    stairs(el)[last()].click();
    expect(faces()).toContain('25'); // the Working set, on every size
    el.platesOnHand = { comp: { '25': 0 } };
    expect(faces()).not.toContain('25');
    for (let i = 0; i <= last(); i++) {
      stairs(el)[i].click();
      expect(faces()).not.toContain('25');
    }
    const none = Object.fromEntries(PLATE_SETS.comp.inventory.map((p) => [plateFace(p), 0]));
    el.platesOnHand = { comp: none };
    for (let i = 0; i <= last(); i++) {
      stairs(el)[i].click();
      expect(faces()).toEqual([]);
    }
  });

  it('a share link whose Plates the limits also pick opens as a live Decode, not a carry (ADR-0014)', () => {
    const el = mount() as Console & { applyLink(l: unknown): void };
    el.platesOnHand = { comp: { '25': 1 } };
    const by = (kg: number) => ELEIKO_KG.find((p) => p.kg === kg)!;
    el.applyLink({ mode: 'decode', side: [by(25), by(20), by(15)], targetKg: 140, unit: 'kg' });
    expect(faces()).toEqual(['25', '20', '15']);
    // Live: a limit change re-solves it (a carried Side would stay as linked).
    el.platesOnHand = { comp: { '25': 1, '20': 0 } };
    expect(faces()).not.toContain('20');
  });

  it('out of plates on hand reads "N kg short", never "Bar at capacity" (ADR-0003, ADR-0012, ADR-0016)', () => {
    const el = mount();
    const none = Object.fromEntries(PLATE_SETS.comp.inventory.map((p) => [plateFace(p), 0]));
    el.platesOnHand = { comp: { ...none, '25': 1, '20': 1 } };
    type(el, '200');
    expect(faces()).toEqual(['25', '20']);
    expect(totalText(el)).toContain('110');
    const status = q(sr(el), '[data-status]');
    expect(status.className).toBe('status short');
    expect(status.textContent).toContain('90 kg short');
    expect(q(sr(el), '[data-atcap]').hidden).toBe(true);
    const spoken = q(sr(el), '[data-announce]').textContent ?? '';
    const keypad = (q(sr(el), 'rack-entry') as HTMLElement & { loadLine: string | null }).loadLine ?? '';
    for (const line of [spoken, keypad]) {
      expect(line).toMatch(/90 (kg short|under)/);
      expect(line.toLowerCase()).not.toContain('capacity');
    }
  });

  it('every size none reads short against the bare Bar, with no capacity caption', () => {
    const el = mount();
    el.platesOnHand = {
      comp: Object.fromEntries(PLATE_SETS.comp.inventory.map((p) => [plateFace(p), 0])),
    };
    type(el, '100');
    expect(q(sr(el), '[data-status]').className).toBe('status short');
    expect(q(sr(el), '[data-atcap]').hidden).toBe(true);
  });

  it('a truly full Sleeve still reads at capacity under limits (ADR-0012)', () => {
    const el = mount();
    el.platesOnHand = { comp: { '0.5': 0 } };
    type(el, '1000');
    expect(q(sr(el), '[data-status]').className).toBe('status capacity');
    expect(q(sr(el), '[data-atcap]').hidden).toBe(false);
  });

  it('Warm up: a Working set out of plates on hand reads short, not at capacity', () => {
    const el = mount();
    const none = Object.fromEntries(PLATE_SETS.comp.inventory.map((p) => [plateFace(p), 0]));
    el.platesOnHand = { comp: { ...none, '25': 1, '20': 1 } };
    modeBtn(el, 'warmup').click();
    commitWorking(el, '200');
    const work = q(sr(el), 'rack-entry[data-working]') as HTMLElement & { loadLine: string | null };
    expect(work.loadLine ?? '').toMatch(/90 kg short/);
    expect((work.loadLine ?? '').toLowerCase()).not.toContain('capacity');
    stairs(el)[stairs(el).length - 1].click();
    expect(q(sr(el), '[data-status]').className).toBe('status short');
  });

  it('a share link whose Plates break the limits opens as the carry and stays put on a later limit change (ADR-0014, ADR-0016)', () => {
    const el = mount() as Console & { applyLink(l: unknown): void };
    el.platesOnHand = { comp: { '25': 1 } };
    const by = (kg: number) => ELEIKO_KG.find((p) => p.kg === kg)!;
    el.applyLink({ mode: 'decode', side: [by(25), by(25), by(10)], targetKg: 140, unit: 'kg' });
    expect(faces()).toEqual(['25', '25', '10']); // the linked Plates, not a re-solve
    el.platesOnHand = { comp: { '25': 0 } };
    expect(faces()).toEqual(['25', '25', '10']); // a carry, not a live Decode
  });

  it('limits on the other set change nothing here', () => {
    const el = mount();
    type(el, '140');
    el.platesOnHand = { training: { '45': 0 } };
    expect(faces()).toEqual(['25', '25', '10']);
  });
});
