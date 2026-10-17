// The share card's Copy link action and its link line (RBAR-50 slice 3, ADR-0011
// amendment, ADR-0014). Kept beside share.test.ts so the card's older suites stay as
// they were. The console builds the URL; the card only shows, sends and copies it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import './share.ts';
import { ELEIKO_KG } from '../lib/plates.ts';
import type { LoadSummary } from '../lib/summary.ts';
import { loadingSummary, SHARE_LINK } from '../lib/summary.ts';

type Share = HTMLElement & {
  load: LoadSummary;
  plateSet: string;
  link: string | null;
  open(): void;
  close(): void;
};

const eleiko = (kg: number) => ELEIKO_KG.find((x) => x.kg === kg)!;
const LOAD: LoadSummary = { side: [eleiko(25), eleiko(15)], barKg: 20, collarKg: 0, unit: 'kg' };
const URL_100 = 'https://rack.bar/#v=1&s=comp&b=20kg&m=w&c=0&u=kg&p=25,15&t=100';

function openCard(link: string | null): { el: Share; root: ShadowRoot } {
  const el = document.createElement('rack-share') as Share;
  el.load = LOAD;
  document.body.append(el);
  el.link = link;
  el.open();
  return { el, root: el.shadowRoot! };
}
const linkBtn = (root: ShadowRoot) => root.querySelector<HTMLButtonElement>('[data-link]')!;
const noLink = (root: ShadowRoot) => root.querySelector<HTMLElement>('[data-nolink]')!;
const settle = async () => {
  for (let i = 0; i < 3; i++) await Promise.resolve();
};

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('<rack-share> Copy link (RBAR-50, ADR-0011)', () => {
  it('sits in the one action row between the summary button and Close', () => {
    const { root } = openCard(URL_100);
    const row = [...root.querySelector('.actions')!.children] as HTMLElement[];
    const hook = (b: HTMLElement) => b.getAttributeNames().find((a) => a.startsWith('data-'));
    expect(row.map(hook)).toEqual(['data-copy', 'data-link', 'data-close']);
    expect(linkBtn(root).type).toBe('button');
    expect(linkBtn(root).textContent).toBe('Copy link');
    expect(linkBtn(root).disabled).toBe(false);
    expect(noLink(root).hidden).toBe(true);
  });

  // A load serializeLink refuses (an off-menu or custom Bar, a Side Load that is not
  // heaviest-first, a Target that rounds to 0) has no link. That is an explicit state:
  // the button stays in the row, disabled, reading "No link", and a one-line reason
  // shows under the row -- never a silent no-op, never a lossy link.
  it('with no link: disabled "No link" plus a visible reason (never a silent no-op)', () => {
    const { root } = openCard(null);
    expect(linkBtn(root).hidden).toBe(false);
    expect(linkBtn(root).disabled).toBe(true);
    expect(linkBtn(root).textContent).toBe('No link');
    expect(noLink(root).hidden).toBe(false);
    expect(noLink(root).textContent).toBe("This load can't be sent as a link.");
    expect(linkBtn(root).getAttribute('aria-describedby')).toBe(noLink(root).id);
  });

  it('with no link a tap writes nothing and never says "Copied"', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { root } = openCard(null);
    linkBtn(root).click();
    await settle();
    expect(writeText).not.toHaveBeenCalled();
    expect(linkBtn(root).textContent).toBe('No link');
  });

  it('follows a link change while open', () => {
    const { el, root } = openCard(URL_100);
    el.link = null;
    expect(linkBtn(root).disabled).toBe(true);
    expect(linkBtn(root).textContent).toBe('No link');
    expect(noLink(root).hidden).toBe(false);
    el.link = URL_100;
    expect(linkBtn(root).disabled).toBe(false);
    expect(linkBtn(root).textContent).toBe('Copy link');
    expect(noLink(root).hidden).toBe(true);
  });

  it('a link that goes away mid-confirmation lands on "No link", not "Copied"', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { el, root } = openCard(URL_100);
    linkBtn(root).click();
    await settle();
    el.link = null;
    expect(linkBtn(root).textContent).toBe('No link');
  });

  it('writes exactly the link to the clipboard and confirms "Copied"', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { root } = openCard(URL_100);
    linkBtn(root).click();
    await settle();
    expect(writeText).toHaveBeenCalledWith(URL_100);
    expect(linkBtn(root).textContent).toBe('Copied');
  });

  it('copies through the clipboard even where the share sheet exists', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { share, clipboard: { writeText } });
    const { root } = openCard(URL_100);
    linkBtn(root).click();
    await settle();
    expect(share).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith(URL_100);
    expect(linkBtn(root).textContent).toBe('Copied');
  });

  it('a denied clipboard says so on the button, never "Copied"', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { root } = openCard(URL_100);
    linkBtn(root).click();
    await settle();
    expect(linkBtn(root).textContent).toBe('Copy failed');
  });

  it('a missing clipboard says so on the button, never "Copied"', async () => {
    vi.stubGlobal('navigator', {});
    const { root } = openCard(URL_100);
    linkBtn(root).click();
    await settle();
    expect(linkBtn(root).textContent).toBe('Copy failed');
  });

  it('a write that settles after close leaves the hidden card alone', async () => {
    let resolveWrite!: () => void;
    const writeText = vi.fn(() => new Promise<void>((r) => (resolveWrite = r)));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { el, root } = openCard(URL_100);
    linkBtn(root).click();
    el.close();
    resolveWrite();
    await settle();
    expect(linkBtn(root).textContent).toBe('Copy link');
  });

  // Review finding (PR #111): the stale-link guard had no test. The write is still
  // pending when the load (and so the link) changes; its result is for a URL no longer
  // shown, so it confirms nothing, whether it resolves or rejects.
  it.each(['resolves', 'rejects'] as const)(
    'a write for a link that has since changed confirms nothing when it %s',
    async (how) => {
      let settle1!: () => void;
      const writeText = vi.fn(
        () => new Promise<void>((res, rej) => (settle1 = how === 'resolves' ? res : () => rej(new Error('denied')))),
      );
      vi.stubGlobal('navigator', { clipboard: { writeText } });
      const { el, root } = openCard(URL_100);
      linkBtn(root).click();
      el.link = URL_100.replace('t=100', 't=101'); // the load changed mid-write
      settle1();
      await settle();
      expect(linkBtn(root).textContent).toBe('Copy link');
    },
  );

  // Review finding (PR #111): a write from an EARLIER opening of the card (closed and
  // reopened on the same link before it settled, e.g. behind a permission prompt) must
  // not relabel the new opening. Same rule for Copy summary's "Copied".
  it.each(['resolves', 'rejects'] as const)(
    'a Copy link write from an earlier opening says nothing on the next one when it %s',
    async (how) => {
      let settle1!: () => void;
      const writeText = vi.fn(
        () => new Promise<void>((res, rej) => (settle1 = how === 'resolves' ? res : () => rej(new Error('denied')))),
      );
      vi.stubGlobal('navigator', { clipboard: { writeText } });
      const { el, root } = openCard(URL_100);
      linkBtn(root).click();
      el.close();
      el.open(); // same link, a new opening
      settle1();
      await settle();
      expect(linkBtn(root).textContent).toBe('Copy link');
    },
  );

  it('a Copy summary write from an earlier opening does not say "Copied" on the next one', async () => {
    let resolveWrite!: () => void;
    const writeText = vi.fn(() => new Promise<void>((r) => (resolveWrite = r)));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { el, root } = openCard(URL_100);
    const copy = root.querySelector<HTMLButtonElement>('[data-copy]')!;
    copy.click();
    el.close();
    el.open();
    resolveWrite();
    await settle();
    expect(copy.textContent).toBe('Copy summary');
  });

  it('leaves the summary button label alone (each action confirms on its own)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { root } = openCard(URL_100);
    linkBtn(root).click();
    await settle();
    expect(root.querySelector('[data-copy]')!.textContent).toBe('Copy summary');
  });

  describe('the confirmation reverts', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('"Copied" and "Copy failed" both revert to "Copy link" after a short delay', async () => {
      const writeText = vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('denied'));
      vi.stubGlobal('navigator', { clipboard: { writeText } });
      const { root } = openCard(URL_100);
      linkBtn(root).click();
      await vi.advanceTimersByTimeAsync(0);
      expect(linkBtn(root).textContent).toBe('Copied');
      linkBtn(root).click(); // a re-tap restarts the window
      await vi.advanceTimersByTimeAsync(0);
      expect(linkBtn(root).textContent).toBe('Copy failed');
      await vi.advanceTimersByTimeAsync(1600);
      expect(linkBtn(root).textContent).toBe('Copy link');
    });

    it('reopening mid-confirmation shows the resting label', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('navigator', { clipboard: { writeText } });
      const { el, root } = openCard(URL_100);
      linkBtn(root).click();
      await vi.advanceTimersByTimeAsync(0);
      el.close();
      el.open();
      expect(linkBtn(root).textContent).toBe('Copy link');
    });

    // RBAR-90: a pending revert's closure holds the card (and the app tree around it)
    // for 1.6 s after removal -- the per-mount "retention" the link properties hit.
    it('leaving the DOM mid-confirmation cancels the pending revert', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('navigator', { clipboard: { writeText } });
      const { el, root } = openCard(URL_100);
      root.querySelector<HTMLButtonElement>('[data-copy]')!.click();
      linkBtn(root).click();
      await vi.advanceTimersByTimeAsync(0);
      expect(linkBtn(root).textContent).toBe('Copied');
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      el.remove();
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});

describe('<rack-share> Close glyph (RBAR-50)', () => {
  it('is a 44px glyph square that keeps the accessible name "Close"', () => {
    const { root } = openCard(URL_100);
    const close = root.querySelector<HTMLButtonElement>('[data-close]')!;
    expect(close.getAttribute('aria-label')).toBe('Close');
    expect(close.textContent!.trim()).toBe('');
    expect(close.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    const css = root.querySelector('style')!.textContent!;
    const rule = css.slice(css.indexOf('.close {'), css.indexOf('}', css.indexOf('.close {')));
    expect(rule).toContain('width: 44px');
  });
});

describe('<rack-share> summary link line (RBAR-50, ADR-0011)', () => {
  it('Copy summary closes with the load link when there is one', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { root } = openCard(URL_100);
    root.querySelector<HTMLButtonElement>('[data-copy]')!.click();
    await settle();
    expect(writeText).toHaveBeenCalledWith(loadingSummary(LOAD, URL_100));
  });

  it('the share sheet gets the same linked summary', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { share });
    const { root } = openCard(URL_100);
    root.querySelector<HTMLButtonElement>('[data-copy]')!.click();
    await settle();
    const sent = (share.mock.calls[0]![0] as { text: string }).text;
    expect(sent.split('\n').at(-1)).toBe(URL_100);
  });

  it('without a link the summary still closes with the bare site', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { root } = openCard(null);
    root.querySelector<HTMLButtonElement>('[data-copy]')!.click();
    await settle();
    expect((writeText.mock.calls[0]![0] as string).split('\n').at(-1)).toBe(SHARE_LINK);
  });
});
