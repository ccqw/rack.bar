// Opening a share link (RBAR-50 slice 2, ADR-0014): <rack-app> reads the URL fragment
// on boot (and on `hashchange`), applies the rig for this view only, hands the load to
// the console, and clears the fragment. Driven through the real boot path -- the URL is
// set before <rack-app> mounts -- and judged from what is on screen and in storage.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import './app.ts';
import {
  q, sr, entryDraft, modeBtn, unitBtn, roundUp, sideOnScreen, statusKind,
  totalText, type,
} from './properties.drivers.ts';
import type { Console } from './properties.drivers.ts';

const RIG_KEYS = ['rackbar.plateSet', 'rackbar.barKg', 'rackbar.collarKg', 'rackbar.unit'];

// Put `fragment` in the URL the way a tapped link arrives (no hashchange), then boot.
function openLink(fragment: string): HTMLElement {
  history.replaceState(null, '', `/${fragment}`);
  document.body.innerHTML = '';
  const app = document.createElement('rack-app');
  document.body.append(app);
  return app;
}
const appConsole = (app: HTMLElement) => q<Console>(sr(app), 'rack-console');
const setupRoot = (app: HTMLElement) => sr(q(sr(app), 'rack-setup'));
const pillLabel = (app: HTMLElement) => q(sr(app), '[data-pill-label]').textContent;
const pressed = (app: HTMLElement, attr: string) =>
  [...setupRoot(app).querySelectorAll<HTMLElement>(`[${attr}]`)]
    .filter((t) => t.getAttribute('aria-pressed') === 'true')
    .map((t) => t.getAttribute(attr));
const mode = (app: HTMLElement) =>
  modeBtn(appConsole(app), 'encode').getAttribute('aria-pressed') === 'true' ? 'encode' : 'decode';
const unit = (app: HTMLElement) =>
  unitBtn(appConsole(app), 'lb').getAttribute('aria-pressed') === 'true' ? 'lb' : 'kg';
const sideKg = (app: HTMLElement) => sideOnScreen(appConsole(app)).map((p) => p.kg);
const rigKeys = () => RIG_KEYS.map((k) => localStorage.getItem(k));
const recents = () => localStorage.getItem('rackbar.recents');
// Paste `fragment` into an already-open tab: the hash changes, no reload.
function paste(fragment: string): void {
  history.replaceState(null, '', `/${fragment}`);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}
// The hero Total: By Weight's Target editor since RBAR-58 (a tap opens the keypad).
const valueBtn = (app: HTMLElement) =>
  q<HTMLButtonElement>(appConsole(app).shadowRoot!, '[data-total-tap]');
// The keypad's Done (the hero is open-only, RBAR-57).
const doneBtn = (app: HTMLElement) =>
  q<HTMLButtonElement>(appConsole(app).shadowRoot!.querySelector('rack-entry')!.shadowRoot!, '[data-done]');

describe('opening a share link (RBAR-50, ADR-0014)', () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState(null, '', '/');
  });
  afterEach(() => {
    document.body.innerHTML = ''; // disconnect: drop the app's hashchange listener
    vi.restoreAllMocks();
  });

  it('a By Weight link boots on its rig and load and writes no rackbar.* rig key (ADR-0014)', () => {
    const app = openLink('#v=1&s=comp&b=20kg&m=w&c=0&u=kg&p=2x25,10&t=140');
    const c = appConsole(app);
    expect(mode(app)).toBe('decode');
    expect(sideKg(app)).toEqual([25, 25, 10]);
    expect(entryDraft(c)).toBe('140');
    expect(totalText(c)).toContain('140');
    expect(statusKind(c)).toBe('exact');
    expect(rigKeys()).toEqual([null, null, null, null]);
  });

  // RBAR-50 slice 3: the link carries the sender's Target reading `d`; the entry shows
  // it as is (225.5, not the whole-lb readout 225) and the console solves from it.
  it('an lb Target reads in the entry as its sender typed it (the `d` reading)', () => {
    const app = openLink('#v=1&s=comp&b=20kg&m=w&c=0&u=lb&p=25,15,1&t=102.28&d=225.5');
    const c = appConsole(app);
    expect(sideKg(app)).toEqual([25, 15, 1]);
    expect(statusKind(c)).not.toBe(''); // a live decode, not the carry
    expect(entryDraft(c)).toBe('225.5');
  });

  // Review finding (PR #111): without `d`, an x.5 lb Target re-solved a different
  // window -- 52.5 lb (reads 53) exact on the sender, over on the recipient; 103.5 lb
  // short on the sender, a carry with no Target on the recipient. Sender to link to app.
  it.each(['52.5', '43.5', '44.5', '103.5', '225.25'])(
    'a typed %s lb Target opens to the same reading, Plates and status',
    (draft) => {
      const sender = document.createElement('rack-console') as Console;
      document.body.append(sender);
      unitBtn(sender, 'lb').click();
      type(sender, draft);
      const seen = { side: sideOnScreen(sender), status: statusKind(sender), draft: entryDraft(sender) };
      q<HTMLButtonElement>(sr(sender), '[data-share]').click();
      const url = (q(sr(sender), 'rack-share') as HTMLElement & { link: string }).link;
      expect(url).toContain(`&d=${draft}`);
      localStorage.clear();
      const c = appConsole(openLink(url.slice(url.indexOf('#'))));
      expect({ side: sideOnScreen(c), status: statusKind(c), draft: entryDraft(c) }).toEqual(seen);
    },
  );

  // Review finding (PR #111): typed in kg, then shown in lb, the sender reads the whole
  // lb readout (100 kg -> 220); the recipient must read 220 too, not 220.5.
  it('a kg Target shown in lb opens to the same whole-lb reading', () => {
    const sender = document.createElement('rack-console') as Console;
    document.body.append(sender);
    type(sender, '100');
    unitBtn(sender, 'lb').click();
    const seen = { side: sideOnScreen(sender), status: statusKind(sender), draft: entryDraft(sender) };
    expect(seen.draft).toBe('220');
    q<HTMLButtonElement>(sr(sender), '[data-share]').click();
    const url = (q(sr(sender), 'rack-share') as HTMLElement & { link: string }).link;
    localStorage.clear();
    const c = appConsole(openLink(url.slice(url.indexOf('#'))));
    expect({ side: sideOnScreen(c), status: statusKind(c), draft: entryDraft(c) }).toEqual(seen);
  });

  it('applies the linked rig over the persisted one for the view only (ADR-0014)', () => {
    localStorage.setItem('rackbar.plateSet', 'comp');
    localStorage.setItem('rackbar.barKg', '15');
    localStorage.setItem('rackbar.collarKg', '0');
    localStorage.setItem('rackbar.unit', 'kg');
    const before = rigKeys();
    const app = openLink('#v=1&s=training&b=45lb&m=w&c=2.5&u=lb&p=2x45&t=107.06');
    const c = appConsole(app);
    expect(c.plateSet).toBe('training');
    expect(c.barKg).toBeCloseTo(20.41165665, 6);
    expect(c.collarKg).toBe(2.5);
    expect(unit(app)).toBe('lb');
    expect(pillLabel(app)).toBe('45 lb bar \u00B7 Training');
    expect(pressed(app, 'data-plateset')).toEqual(['training']);
    expect(pressed(app, 'data-collar')).toEqual(['2.5']);
    expect(sideKg(app).length).toBe(2);
    expect(rigKeys()).toEqual(before);
    // A reload (the fragment is gone) is the lifter's own rig again.
    const reloaded = openLink('');
    const rc = appConsole(reloaded);
    expect([rc.plateSet, rc.barKg, rc.collarKg, unit(reloaded)]).toEqual(['comp', 15, 0, 'kg']);
  });

  it('a Training lb By Weight link reads Exact in lb (ADR-0014)', () => {
    const app = openLink('#v=1&s=training&b=45lb&m=w&c=0&u=lb&p=2x45&t=102.06');
    const c = appConsole(app);
    expect(unit(app)).toBe('lb');
    expect(entryDraft(c)).toBe('225');
    expect(totalText(c)).toContain('225');
    expect(statusKind(c)).toBe('exact');
  });

  it('opening a By Weight link pushes its Target to Recents (ADR-0014, ADR-0009)', () => {
    localStorage.setItem('rackbar.recents', JSON.stringify([100]));
    openLink('#v=1&s=comp&b=20kg&m=w&c=0&u=kg&p=2x25,10&t=140');
    expect(JSON.parse(recents()!)).toEqual([140, 100]);
  });

  it('a By Weight link without a Target pushes nothing and carries its Plates (ADR-0014, ADR-0005)', () => {
    const app = openLink('#v=1&s=comp&b=20kg&m=w&c=0&u=kg&p=2x25');
    expect(mode(app)).toBe('decode');
    expect(sideKg(app)).toEqual([25, 25]);
    expect(entryDraft(appConsole(app))).toBe('120');
    expect(statusKind(appConsole(app))).toBe(''); // a carry, no live decode
    expect(recents()).toBeNull();
  });

  it('a By Plates link opens on the plates editor with its Side and pushes nothing (ADR-0014)', () => {
    const app = openLink('#v=1&s=comp&b=15kg&m=p&c=2.5&u=kg&p=20,5,2.5');
    const c = appConsole(app);
    expect(mode(app)).toBe('encode');
    expect(c.barKg).toBe(15);
    expect(c.collarKg).toBe(2.5);
    expect(sideKg(app)).toEqual([20, 5, 2.5]);
    expect(totalText(c)).toContain('75');
    expect(recents()).toBeNull();
    expect(rigKeys()).toEqual([null, null, null, null]);
  });

  it('linked round-up Plates open on the round-up, not the primary (ADR-0014, ADR-0003)', () => {
    const app = openLink('#v=1&s=comp&b=20kg&m=w&c=0&u=kg&p=2x25,10,0.5&t=140.3');
    const c = appConsole(app);
    expect(sideKg(app)).toEqual([25, 25, 10, 0.5]);
    expect(statusKind(c)).toBe('over');
    expect(entryDraft(c)).toBe('140.3');
    // The round-up control offers the way back down, as after a tap.
    roundUp(c).click();
    expect(sideKg(app)).toEqual([25, 25, 10]);
    expect(JSON.parse(recents()!)).toEqual([140.3]);
  });

  it('Plates that match neither decode fall back to the carry showing the linked Plates (ADR-0014, ADR-0005)', () => {
    const app = openLink('#v=1&s=comp&b=20kg&m=w&c=0&u=kg&p=2x20,15,5&t=140');
    const c = appConsole(app);
    expect(sideKg(app)).toEqual([20, 20, 15, 5]);
    expect(entryDraft(c)).toBe('140');
    expect(statusKind(c)).toBe(''); // no live decode disagreeing with the Plates
    expect(JSON.parse(recents()!)).toEqual([140]);
  });

  it('a link without u reads in the recipient\'s persisted Primary unit (ADR-0014)', () => {
    localStorage.setItem('rackbar.unit', 'lb');
    const app = openLink('#v=1&s=comp&b=20kg&m=p&p=25');
    expect(unit(app)).toBe('lb');
  });

  it('clears the fragment with replaceState after applying a link (ADR-0014)', () => {
    const spy = vi.spyOn(history, 'replaceState');
    openLink('#v=1&s=comp&b=20kg&m=p&c=0&u=kg&p=25');
    expect(spy).toHaveBeenLastCalledWith(null, '', '/');
    expect(location.hash).toBe('');
  });

  it('keeps the query string when clearing the fragment (ADR-0014)', () => {
    history.replaceState(null, '', '/?x=1#v=1&s=comp&b=20kg&m=p&p=25');
    document.body.append(document.createElement('rack-app'));
    expect(location.search).toBe('?x=1');
    expect(location.hash).toBe('');
  });

  it.each([
    ['garbage', '#hello'],
    ['wrong version', '#v=2&s=comp&b=20kg&m=w&p=25'],
    ['partial (no mode)', '#v=1&s=comp&b=20kg&p=25'],
    ['foreign plate', '#v=1&s=training&b=45lb&m=p&p=0.5'],
    ['past the Sleeve', '#v=1&s=comp&b=20kg&m=p&p=40x25'],
    ['bad escape', '#v=1&s=comp&b=20kg&m=p&p=%E0%A4%A'],
  ])('a malformed link (%s) is a silent default boot with the persisted rig intact (ADR-0014)', (_, frag) => {
    localStorage.setItem('rackbar.barKg', '15');
    localStorage.setItem('rackbar.recents', JSON.stringify([90]));
    const errors = vi.spyOn(console, 'error');
    const warns = vi.spyOn(console, 'warn');
    const app = openLink(frag);
    const c = appConsole(app);
    expect([c.plateSet, c.barKg, c.collarKg, mode(app), unit(app)]).toEqual([
      'comp', 15, 0, 'decode', 'kg',
    ]);
    expect(sideKg(app)).toEqual([]);
    expect(localStorage.getItem('rackbar.barKg')).toBe('15');
    expect(recents()).toBe('[90]');
    expect(location.hash).toBe('');
    expect(errors).not.toHaveBeenCalled();
    expect(warns).not.toHaveBeenCalled();
  });

  it('a link pasted into an open tab (hashchange) applies the same way (ADR-0014)', () => {
    const app = openLink('');
    const spy = vi.spyOn(history, 'replaceState');
    history.replaceState(null, '', '/#v=1&s=comp&b=15kg&m=p&c=0&u=lb&p=2x20');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    const c = appConsole(app);
    expect(mode(app)).toBe('encode');
    expect(c.barKg).toBe(15);
    expect(unit(app)).toBe('lb');
    expect(sideKg(app)).toEqual([20, 20]);
    expect(spy).toHaveBeenLastCalledWith(null, '', '/');
    expect(location.hash).toBe('');
    expect(rigKeys()).toEqual([null, null, null, null]);
  });

  it('a later Setup or unit tap persists only that one key (ADR-0014, ADR-0007)', () => {
    const app = openLink('#v=1&s=training&b=45lb&m=w&c=2.5&u=lb&p=2x45&t=107.06');
    [...setupRoot(app).querySelectorAll<HTMLButtonElement>('[data-collar]')]
      .find((t) => t.getAttribute('data-collar') === '0')!
      .click();
    expect(rigKeys()).toEqual([null, null, '0', null]);
    unitBtn(appConsole(app), 'kg').click();
    expect(rigKeys()).toEqual([null, null, '0', 'kg']);
  });

  it('a disconnected app stops listening for hashchange', () => {
    const app = openLink('');
    app.remove();
    history.replaceState(null, '', '/#v=1&s=comp&b=15kg&m=p&p=25');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(location.hash).toBe('#v=1&s=comp&b=15kg&m=p&p=25');
  });
  it('drifted Plates carry their own Total in the entry while the Target joins Recents (ADR-0014, ADR-0005)', () => {
    const app = openLink('#v=1&s=comp&b=20kg&m=w&c=0&u=kg&p=2x25&t=140');
    const c = appConsole(app);
    expect(sideKg(app)).toEqual([25, 25]);
    expect(entryDraft(c)).toBe('120');
    expect(statusKind(c)).toBe('');
    expect(JSON.parse(recents()!)).toEqual([140]);
  });

  it('a bare-Bar By Weight link with a Target is the carry of the bare Bar (ADR-0014, ADR-0005)', () => {
    const app = openLink('#v=1&s=comp&b=20kg&m=w&c=0&u=kg&p=&t=140');
    expect(sideKg(app)).toEqual([]);
    expect(entryDraft(appConsole(app))).toBe('20');
    expect(JSON.parse(recents()!)).toEqual([140]);
  });

  it('after a cross-set link Setup shows the linked Bar, and a Bar tap saves that Bar with its set (ADR-0014, ADR-0010)', () => {
    localStorage.setItem('rackbar.plateSet', 'comp');
    localStorage.setItem('rackbar.barKg', '15');
    const app = openLink('#v=1&s=training&b=20kg&m=p&c=0&u=kg&p=25');
    expect(pressed(app, 'data-bar')).toEqual(['20']);
    const ironBar = [...setupRoot(app).querySelectorAll<HTMLButtonElement>('[data-bar]')]
      .find((t) => Number(t.dataset.bar) !== 20)!;
    ironBar.click();
    const c = appConsole(app);
    expect(c.barKg).toBeCloseTo(20.41165665, 6);
    expect(c.plateSet).toBe('training');
    expect(localStorage.getItem('rackbar.plateSet')).toBe('training');
    expect(Number(localStorage.getItem('rackbar.barKg'))).toBeCloseTo(20.41165665, 6);
    // The saved Bar survives a reload: it is saved alongside the set that offers it.
    const rc = appConsole(openLink(''));
    expect([rc.plateSet, rc.barKg]).toEqual(['training', c.barKg]);
  });

  it('a Bar tap after a same-set link saves only the Bar (ADR-0014, ADR-0007)', () => {
    const app = openLink('#v=1&s=comp&b=15kg&m=p&c=0&u=kg&p=20');
    q<HTMLButtonElement>(setupRoot(app), '[data-bar="5"]').click();
    expect(rigKeys()).toEqual([null, '5', null, null]);
  });

  it('a By Weight link pasted over a typed Target replaces it and pushes only its own Target (ADR-0014)', () => {
    const app = openLink('');
    const c = appConsole(app);
    valueBtn(app).click(); // open the keypad
    type(c, '100');
    doneBtn(app).click(); // commit 100
    paste('#v=1&s=comp&b=20kg&m=w&c=0&u=kg&p=2x25,10&t=140');
    expect(sideKg(app)).toEqual([25, 25, 10]);
    expect(entryDraft(c)).toBe('140');
    expect(statusKind(c)).toBe('exact');
    expect(JSON.parse(recents()!)).toEqual([140, 100]);
  });

  it('a link pasted while the keypad is open commits nothing extra on Done (ADR-0014, ADR-0009)', () => {
    const app = openLink('');
    const c = appConsole(app);
    valueBtn(app).click(); // open
    type(c, '9');
    paste('#v=1&s=comp&b=20kg&m=w&c=0&u=kg&p=2x25,10&t=140');
    doneBtn(app).click(); // close: the link's Target is a seed, not a new commit
    expect(JSON.parse(recents()!)).toEqual([140]);
    expect(sideKg(app)).toEqual([25, 25, 10]);
  });

  it('a link replacing a round-up link lands on its own primary (ADR-0014, ADR-0003)', () => {
    const app = openLink('#v=1&s=comp&b=20kg&m=w&c=0&u=kg&p=2x25,10,0.5&t=140.3');
    paste('#v=1&s=comp&b=20kg&m=w&c=0&u=kg&p=2x25,10&t=140');
    const c = appConsole(app);
    expect(statusKind(c)).toBe('exact');
    expect(roundUp(c).hidden).toBe(true);
    expect(sideKg(app)).toEqual([25, 25, 10]);
  });

  it('opening the same link twice keeps one Recent (ADR-0014, ADR-0009)', () => {
    openLink('#v=1&s=comp&b=20kg&m=w&c=0&u=kg&p=2x25,10&t=140');
    paste('#v=1&s=comp&b=20kg&m=w&c=0&u=kg&p=2x25,10&t=140');
    expect(JSON.parse(recents()!)).toEqual([140]);
  });

  it('a By Plates link over a By Weight Target, then By Weight, seeds the linked Total (ADR-0014, ADR-0005)', () => {
    const app = openLink('#v=1&s=comp&b=20kg&m=w&c=0&u=kg&p=2x25,10&t=140');
    paste('#v=1&s=comp&b=20kg&m=p&c=0&u=kg&p=20');
    const c = appConsole(app);
    modeBtn(c, 'decode').click();
    expect(entryDraft(c)).toBe('60');
    expect(sideKg(app)).toEqual([20]);
  });

  it('a malformed link pasted over a shown link changes nothing but the URL (ADR-0014)', () => {
    const errors = vi.spyOn(console, 'error');
    const app = openLink('#v=1&s=comp&b=15kg&m=p&c=2.5&u=lb&p=20,5');
    paste('#garbage');
    const c = appConsole(app);
    expect([c.plateSet, c.barKg, c.collarKg, mode(app), unit(app)]).toEqual([
      'comp', 15, 2.5, 'encode', 'lb',
    ]);
    expect(sideKg(app)).toEqual([20, 5]);
    expect(location.hash).toBe('');
    expect(errors).not.toHaveBeenCalled();
  });
});
