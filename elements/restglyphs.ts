// The Rest timer's glyphs (RBAR-94), drawn from the picked prototype (timer2 "Picked"):
// one 16-unit grid, currentColor strokes, aria-hidden. Shared by the console's stopwatch
// button, the dock and the timer screen so the three can never drift apart.

const svg = (size: number, body: string, width = 1.7): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor"
    stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true">${body}</svg>`;

/** The narrow tier (the 320px phone): the dock and the screen tighten their gaps. */
export const NARROW_SCREEN = '(max-width: 359px)';

export const STOPWATCH_GLYPH = svg(
  15,
  '<circle cx="8" cy="9.3" r="5.3"></circle><path d="M8 9.3V6.6M6.2 1.6h3.6M8 1.6v2.4M12.5 4.7l1.1-1.1"></path>',
  1.6,
);
export const CHEVRON_GLYPH = svg(18, '<path d="M3.5 6l4.5 4.5L12.5 6" stroke-width="2"></path>');
export const RESET_GLYPH = svg(
  17,
  '<path d="M3.2 8a4.8 4.8 0 1 0 1.4-3.4"></path><path d="M4.4 1.8v3h3"></path>',
  1.8,
);
export const RESTART_GLYPH = (size: number): string =>
  svg(size, '<path d="M3.2 8a4.8 4.8 0 1 0 1.4-3.4"></path><path d="M4.4 1.8v3h3"></path>', 2);
export const SLIDERS_LINE_GLYPH = svg(
  16,
  '<path d="M2 4.5h12M2 11.5h12"></path><circle cx="5.5" cy="4.5" r="1.9" fill="var(--rack-raised)"></circle><circle cx="10.5" cy="11.5" r="1.9" fill="var(--rack-raised)"></circle>',
  1.6,
);
export const X_GLYPH = svg(14, '<path d="M4 4l8 8M12 4l-8 8" stroke-width="2"></path>');
export const BELL_GLYPH = svg(
  17,
  '<path d="M4 11.5V7.2a4 4 0 0 1 8 0v4.3l1.2 1.3H2.8z"></path><path d="M6.6 14.3a1.5 1.5 0 0 0 2.8 0"></path>',
  1.5,
);
export const NEXT_GLYPH = svg(
  17,
  '<path d="M2.5 8h9M8.5 4.5L12 8l-3.5 3.5M14 3.5v9"></path>',
  1.6,
);
export const SPEAKER_GLYPH = svg(
  16,
  '<path d="M2.5 6.2h2.6L8.6 3v10L5.1 9.8H2.5z"></path><path d="M11 5.6a3.4 3.4 0 0 1 0 4.8M12.8 3.8a6 6 0 0 1 0 8.4"></path>',
  1.5,
);
export const PAUSE_GLYPH = (size: number): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="2.5" width="3.2" height="11" rx="1.1" fill="currentColor"></rect><rect x="9.3" y="2.5" width="3.2" height="11" rx="1.1" fill="currentColor"></rect></svg>`;
export const PLAY_GLYPH = (size: number): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.6v10.8c0 .6.6.9 1.1.6l8.2-5.4c.4-.3.4-.9 0-1.2L5.6 2c-.5-.3-1.1 0-1.1.6z" fill="currentColor"></path></svg>`;
export const CHECK_GLYPH = (size: number): string =>
  svg(size, '<path d="M3.5 8.5l3 3 6-7" stroke-width="2.2"></path>');
export const CHEVRON_LEFT_GLYPH = svg(16, '<path d="M10 3.5L5.5 8l4.5 4.5" stroke-width="2"></path>');
export const DOTS_GLYPH = `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="3.5" cy="8" r="1.5" fill="currentColor"></circle><circle cx="8" cy="8" r="1.5" fill="currentColor"></circle><circle cx="12.5" cy="8" r="1.5" fill="currentColor"></circle></svg>`;
