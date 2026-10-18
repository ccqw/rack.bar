// The Loadout quiz's glyphs (RBAR-92), from the design prototype. Inner SVG markup only:
// each site wraps it in its own <svg> (size, stroke, aria-hidden).
//
// The graduation cap is the quiz's door in the main header (viewBox 0 0 14 14, 1.4
// stroke, round caps). Not a stopwatch: that glyph is reserved for the rest timer.
export const GRAD_CAP_GLYPH =
  '<path d="M1 5.2L7 2.4l6 2.8L7 8z"></path>' +
  '<path d="M3.6 6.5v3c1 .9 2.1 1.3 3.4 1.3s2.4-.4 3.4-1.3v-3M13 5.2v3.4"></path>';

// The quiz settings gear: two tracks with a knob each, in currentColor (viewBox 0 0 14 14).
export const GEAR_GLYPH =
  '<path d="M1.5 4h11M1.5 10h11"></path>' +
  '<circle cx="5" cy="4" r="1.6" fill="var(--rack-raised)"></circle>' +
  '<circle cx="9" cy="10" r="1.6" fill="var(--rack-raised)"></circle>';

// Back to the calculator: a left chevron (viewBox 0 0 16 16).
export const BACK_GLYPH = '<path d="M10 3L5 8l5 5"></path>';
