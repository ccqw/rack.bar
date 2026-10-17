// The shared overflow nudge-arrow pattern (RBAR-37, extracted from <rack-loaded>,
// RBAR-27 / handoff 4b): a fade-gradient chevron button on each side of a horizontally
// scrolling chip rail, shown only while the rail can actually scroll that way, and
// tap-scrolling it by most of a viewport (prototype rack.bar.dc.html: the nudge
// buttons at L163-170, the measure/nudge logic at L980-988). <rack-loaded> and
// <rack-recents> interpolate the same three pieces -- one CSS string, one markup
// string, one wiring call -- so the two rails cannot drift.
//
// The strings follow the BOX_SIZING/BUTTON_FX idiom (one source, interpolated into
// each element's own <style>/markup; adoptedStyleSheets declined in RBAR-21). The
// host supplies a position:relative viewport wrapping the rail and the buttons, and
// calls the returned measure() after each re-render (content changes the geometry).

/** The nudge-arrow rules. Interpolate into a style block whose markup nests
 * NUDGE_BUTTONS inside a position:relative viewport around the rail. */
export const NUDGE_STYLE = `
  .nudge {
    position: absolute; top: 0; bottom: 0; width: 42px; padding: 0;
    display: none; align-items: center; border: none; cursor: pointer; z-index: 1;
    color: var(--rack-text-secondary); /* the chevron stroke, prototype L164 (RBAR-74) */
  }
  .nudge.show { display: flex; }
  .nudge.left {
    left: 0; justify-content: flex-start; padding-left: 3px;
    background: linear-gradient(90deg, var(--rack-bg) 34%, transparent);
  }
  .nudge.right {
    right: 0; justify-content: flex-end; padding-right: 3px;
    background: linear-gradient(270deg, var(--rack-bg) 34%, transparent);
  }
  .nudge:focus-visible { outline: 2px solid var(--rack-accent); }
`;

/** The two chevron buttons. Place them after the rail, inside its viewport. */
export const NUDGE_BUTTONS = `
  <button type="button" class="nudge left" data-nudge="left" aria-label="Scroll left">
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M11.5 3L7 8l4.5 5M7 3L2.5 8 7 13" stroke="currentColor"
            stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>
  </button>
  <button type="button" class="nudge right" data-nudge="right" aria-label="Scroll right">
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4.5 3L9 8l-4.5 5M9 3l4.5 5L9 13" stroke="currentColor"
            stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>
  </button>
`;

/** The live half of the pattern, handed back by wireNudges. */
export interface NudgeRail {
  /** Re-measure the overflow and show/hide the arrows. Call after each re-render. */
  measure(): void;
  /** Disconnect the ResizeObserver (the host's disconnectedCallback). */
  disconnect(): void;
}

/**
 * Wire the nudge arrows to `rail`: taps scroll it by most of a viewport (a generous
 * minimum on a narrow column), and the arrows show only while the rail can scroll
 * that way -- re-measured on scroll and on resize (ResizeObserver, not
 * requestAnimationFrame, so it keeps working in a backgrounded tab). In a
 * non-overflowing rail (or a zero-width test DOM) both stay hidden.
 * `scope` is the shadow root (or any ancestor) holding the NUDGE_BUTTONS pair.
 */
export function wireNudges(rail: HTMLElement, scope: ParentNode): NudgeRail {
  const left = scope.querySelector<HTMLButtonElement>('[data-nudge="left"]')!;
  const right = scope.querySelector<HTMLButtonElement>('[data-nudge="right"]')!;

  const measure = (): void => {
    const max = rail.scrollWidth - rail.clientWidth;
    const x = rail.scrollLeft;
    left.classList.toggle('show', x > 1);
    right.classList.toggle('show', x < max - 1);
  };
  const nudge = (dir: number): void => {
    rail.scrollBy({
      left: dir * Math.max(120, rail.clientWidth * 0.6),
      behavior: 'smooth',
    });
  };

  left.addEventListener('click', () => nudge(-1));
  right.addEventListener('click', () => nudge(1));
  rail.addEventListener('scroll', measure);
  const resize = new ResizeObserver(measure);
  resize.observe(rail);

  return { measure, disconnect: () => resize.disconnect() };
}
