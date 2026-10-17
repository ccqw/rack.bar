// <rack-share> attaches the loadout picture (RBAR-70). The picture itself is drawn by
// elements/shareimage.ts (tested on its own); here it is stubbed, so these tests pin the
// share flow around it: when the picture is attached, and the whole fallback chain --
// picture + text, then text alone, then the clipboard -- with AbortError silent at
// every step.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { shareImageFile } = vi.hoisted(() => ({
  shareImageFile: vi.fn<(load: unknown, setLabel: string) => Promise<File | null>>(),
}));
vi.mock('./shareimage.ts', () => ({ shareImageFile }));

import './share.ts';
import { ELEIKO_KG } from '../lib/plates.ts';
import type { LoadSummary } from '../lib/summary.ts';
import { loadingSummary } from '../lib/summary.ts';

type Share = HTMLElement & {
  load: LoadSummary;
  plateSet: string;
  open(): void;
  close(): void;
};

const eleiko = (kg: number) => ELEIKO_KG.find((x) => x.kg === kg)!;

const LOADED: LoadSummary = {
  side: [eleiko(25), eleiko(25), eleiko(10), eleiko(1)],
  barKg: 20,
  collarKg: 0,
  unit: 'kg',
};
const TEXT = loadingSummary(LOADED);
const PNG = new File([new Uint8Array([137, 80, 78, 71])], 'rack-bar-142-kg.png', {
  type: 'image/png',
});

const abort = () => new DOMException('cancelled', 'AbortError');
const denied = () => new DOMException('denied', 'NotAllowedError');

async function flush(n = 8): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

interface Nav {
  share?: ReturnType<typeof vi.fn>;
  canShare?: unknown;
  clipboard?: { writeText: ReturnType<typeof vi.fn> };
}

// Mount + open the card with `nav` as the navigator, then let the picture draw.
async function openReady(nav: Nav, load: LoadSummary = LOADED) {
  vi.stubGlobal('navigator', nav);
  const el = document.createElement('rack-share') as Share;
  el.load = load;
  document.body.append(el);
  el.open();
  await flush();
  const btn = el.shadowRoot!.querySelector('[data-copy]') as HTMLButtonElement;
  return { el, btn };
}

beforeEach(() => {
  shareImageFile.mockReset();
  shareImageFile.mockResolvedValue(PNG);
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('<rack-share> attaches the loadout picture (RBAR-70)', () => {
  it('draws the picture when the card opens, for its load and plate set name', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { share });
    const el = document.createElement('rack-share') as Share;
    el.load = LOADED;
    el.plateSet = 'training';
    document.body.append(el);
    expect(shareImageFile).not.toHaveBeenCalled(); // nothing drawn for a closed card
    el.open();
    expect(shareImageFile).toHaveBeenCalledTimes(1);
    expect(shareImageFile).toHaveBeenCalledWith(LOADED, 'Training');
  });

  it('shares the picture and the text together when canShare allows the file', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(true);
    const writeText = vi.fn().mockResolvedValue(undefined);
    const { btn } = await openReady({ share, canShare, clipboard: { writeText } });
    btn.click();
    // Synchronous with the tap: share() runs inside its user activation.
    expect(share).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledWith({ files: [PNG], text: TEXT });
    expect(canShare).toHaveBeenCalledWith({ files: [PNG], text: TEXT });
    await flush();
    expect(share).toHaveBeenCalledTimes(1);
    expect(writeText).not.toHaveBeenCalled();
    expect(btn.textContent).toBe('Share');
  });

  it('shares the text alone when canShare refuses the file', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const { btn } = await openReady({ share, canShare: () => false });
    btn.click();
    expect(share).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledWith({ text: TEXT });
  });

  it('shares the text alone when the browser has no canShare', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const { btn } = await openReady({ share });
    btn.click();
    expect(share).toHaveBeenCalledWith({ text: TEXT });
  });

  it('shares the text alone when canShare throws', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = () => {
      throw new TypeError('bad data');
    };
    const { btn } = await openReady({ share, canShare });
    btn.click();
    expect(share).toHaveBeenCalledWith({ text: TEXT });
  });

  it('shares the text alone when the picture could not be drawn', async () => {
    shareImageFile.mockResolvedValue(null);
    const share = vi.fn().mockResolvedValue(undefined);
    const { btn } = await openReady({ share, canShare: () => true });
    btn.click();
    expect(share).toHaveBeenCalledWith({ text: TEXT });
  });

  it('shares the text alone when the draw rejects', async () => {
    shareImageFile.mockRejectedValue(new Error('canvas blew up'));
    const share = vi.fn().mockResolvedValue(undefined);
    const { btn } = await openReady({ share, canShare: () => true });
    btn.click();
    expect(share).toHaveBeenCalledWith({ text: TEXT });
  });

  it('a tap before the picture is ready shares the text at once (never waits)', async () => {
    shareImageFile.mockReturnValue(new Promise(() => {})); // still drawing
    const share = vi.fn().mockResolvedValue(undefined);
    const { btn } = await openReady({ share, canShare: () => true });
    btn.click();
    expect(share).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledWith({ text: TEXT });
  });

  it('does not draw a picture when there is no Web Share (clipboard only)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const { btn } = await openReady({ clipboard: { writeText } });
    expect(shareImageFile).not.toHaveBeenCalled();
    btn.click();
    await flush();
    expect(writeText).toHaveBeenCalledWith(TEXT);
  });

  describe('the fallback chain', () => {
    it('a failed picture share falls back to the text alone', async () => {
      const share = vi
        .fn()
        .mockRejectedValueOnce(denied())
        .mockResolvedValueOnce(undefined);
      const writeText = vi.fn().mockResolvedValue(undefined);
      const { btn } = await openReady({ share, canShare: () => true, clipboard: { writeText } });
      btn.click();
      await flush();
      expect(share).toHaveBeenCalledTimes(2);
      expect(share.mock.calls[1]![0]).toEqual({ text: TEXT });
      expect(writeText).not.toHaveBeenCalled();
      expect(btn.textContent).toBe('Share');
    });

    it('then a failed text share falls back to the clipboard and confirms', async () => {
      const share = vi.fn().mockRejectedValue(denied());
      const writeText = vi.fn().mockResolvedValue(undefined);
      const { btn } = await openReady({ share, canShare: () => true, clipboard: { writeText } });
      btn.click();
      await flush();
      expect(share).toHaveBeenCalledTimes(2);
      expect(writeText).toHaveBeenCalledWith(TEXT);
      expect(btn.textContent).toBe('Copied');
    });

    it('cancelling the picture share stops the chain: no text share, no clipboard', async () => {
      const share = vi.fn().mockRejectedValue(abort());
      const writeText = vi.fn().mockResolvedValue(undefined);
      const { btn } = await openReady({ share, canShare: () => true, clipboard: { writeText } });
      btn.click();
      await flush();
      expect(share).toHaveBeenCalledTimes(1);
      expect(writeText).not.toHaveBeenCalled();
      expect(btn.textContent).toBe('Share');
    });

    it('cancelling the fallback text share is silent too', async () => {
      const share = vi.fn().mockRejectedValueOnce(denied()).mockRejectedValueOnce(abort());
      const writeText = vi.fn().mockResolvedValue(undefined);
      const { btn } = await openReady({ share, canShare: () => true, clipboard: { writeText } });
      btn.click();
      await flush();
      expect(share).toHaveBeenCalledTimes(2);
      expect(writeText).not.toHaveBeenCalled();
      expect(btn.textContent).toBe('Share');
    });

    it('a failed text-only share (no picture) goes straight to the clipboard, once', async () => {
      shareImageFile.mockResolvedValue(null);
      const share = vi.fn().mockRejectedValue(denied());
      const writeText = vi.fn().mockResolvedValue(undefined);
      const { btn } = await openReady({ share, canShare: () => true, clipboard: { writeText } });
      btn.click();
      await flush();
      expect(share).toHaveBeenCalledTimes(1); // no second text share of the same text
      expect(writeText).toHaveBeenCalledTimes(1);
    });

    it('a picture share that fails after the card closed goes no further', async () => {
      let fail!: (e: unknown) => void;
      const share = vi.fn(() => new Promise<void>((_, rej) => (fail = rej)));
      const writeText = vi.fn().mockResolvedValue(undefined);
      const { el, btn } = await openReady({ share, canShare: () => true, clipboard: { writeText } });
      btn.click();
      el.close();
      fail(denied());
      await flush();
      expect(share).toHaveBeenCalledTimes(1);
      expect(writeText).not.toHaveBeenCalled();
    });

    it('ignores a re-tap while the picture sheet is open', async () => {
      let settle!: () => void;
      const share = vi.fn(() => new Promise<void>((r) => (settle = r)));
      const { btn } = await openReady({ share, canShare: () => true });
      btn.click();
      btn.click();
      expect(share).toHaveBeenCalledTimes(1);
      settle();
      await flush();
      btn.click();
      expect(share).toHaveBeenCalledTimes(2);
    });
  });

  describe('a stale picture is never sent', () => {
    it('redraws when the load changes while open, and shares the new picture', async () => {
      const next = new File([new Uint8Array([1])], 'next.png', { type: 'image/png' });
      const share = vi.fn().mockResolvedValue(undefined);
      const { el, btn } = await openReady({ share, canShare: () => true });
      shareImageFile.mockResolvedValue(next);
      const lighter = { ...LOADED, side: [eleiko(25)] };
      el.load = lighter;
      expect(shareImageFile).toHaveBeenLastCalledWith(lighter, 'Competition');
      // Until the new picture lands, a tap shares the new text alone, not the old picture.
      btn.click();
      expect(share).toHaveBeenLastCalledWith({ text: loadingSummary(lighter) });
      await flush();
      btn.click();
      expect(share).toHaveBeenLastCalledWith({ files: [next], text: loadingSummary(lighter) });
    });

    it('redraws when the plate set changes while open', async () => {
      const share = vi.fn().mockResolvedValue(undefined);
      const { el } = await openReady({ share, canShare: () => true });
      el.plateSet = 'training';
      expect(shareImageFile).toHaveBeenLastCalledWith(LOADED, 'Training');
    });

    it('drops a slow draw that finishes after a newer one started', async () => {
      let finishOld!: (f: File) => void;
      shareImageFile.mockReturnValueOnce(new Promise((r) => (finishOld = r)));
      const share = vi.fn().mockResolvedValue(undefined);
      const { el, btn } = await openReady({ share, canShare: () => true });
      const fresh = new File([new Uint8Array([2])], 'fresh.png', { type: 'image/png' });
      shareImageFile.mockResolvedValue(fresh);
      el.load = { ...LOADED, side: [eleiko(20)] };
      await flush();
      finishOld(PNG); // the old draw lands late
      await flush();
      btn.click();
      expect((share.mock.calls[0]![0] as ShareData).files).toEqual([fresh]);
    });

    it('drops the picture on close and draws afresh on the next open', async () => {
      let finish!: (f: File) => void;
      const share = vi.fn().mockResolvedValue(undefined);
      const { el, btn } = await openReady({ share, canShare: () => true });
      el.close();
      shareImageFile.mockReturnValueOnce(new Promise((r) => (finish = r)));
      el.open();
      btn.click(); // the new draw is still running: text alone, not the old picture
      expect(share).toHaveBeenLastCalledWith({ text: TEXT });
      finish(PNG);
      await flush();
      btn.click();
      expect(share).toHaveBeenLastCalledWith({ files: [PNG], text: TEXT });
    });

    it('a draw that finishes after close is not kept for the next open', async () => {
      let finish!: (f: File) => void;
      shareImageFile.mockReturnValueOnce(new Promise((r) => (finish = r)));
      const share = vi.fn().mockResolvedValue(undefined);
      const { el, btn } = await openReady({ share, canShare: () => true });
      el.close();
      finish(PNG); // lands while closed
      await flush();
      shareImageFile.mockReturnValueOnce(new Promise(() => {})); // reopen: still drawing
      el.open();
      btn.click();
      expect(share).toHaveBeenLastCalledWith({ text: TEXT });
    });
  });
});
