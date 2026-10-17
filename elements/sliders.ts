// The Setup sliders glyph (two tracks, two knobs, in the accent): the header Setup
// pill wears it, and so does every other door into Setup -- the Another way sheet's
// "Set Plate Inventory" button (RBAR-66) -- so the lifter reads them as one place.
// The inner SVG markup only: each site wraps it in its own <svg> (size, class, data-*)
// with viewBox="0 0 16 16", fill="none", aria-hidden="true".
export const SLIDERS_GLYPH = `
  <line x1="2.5" y1="5" x2="13.5" y2="5" stroke="var(--rack-accent)"
        stroke-width="1.6" stroke-linecap="round"></line>
  <line x1="2.5" y1="11" x2="13.5" y2="11" stroke="var(--rack-accent)"
        stroke-width="1.6" stroke-linecap="round"></line>
  <circle cx="10" cy="5" r="2.3" fill="var(--rack-raised)"
          stroke="var(--rack-accent)" stroke-width="1.6"></circle>
  <circle cx="6" cy="11" r="2.3" fill="var(--rack-raised)"
          stroke="var(--rack-accent)" stroke-width="1.6"></circle>`;
