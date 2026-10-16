// Shared button micro-interactions (RBAR-30, handoff "Interactions & behaviour" >
// "Animations"): a press-scale to .955 on :active (.09s) plus .16s colour transitions,
// applied to every <button> across the app.
//
// Each element's Shadow DOM is style-isolated, so a single document-level rule cannot
// reach into the shadow roots. Rather than copy the same CSS into eleven <style> blocks
// (which would drift), every element interpolates this one string into its own block --
// one source of truth, no per-element divergence. This matches the codebase's
// innerHTML + <style> idiom (adoptedStyleSheets was weighed and declined in RBAR-21).
//
// Interpolate it FIRST in a style block so an element's own class-specific button rules
// (higher specificity, or simply later) still win for the properties they set. The
// colour/opacity transitions apply to everyone; the transform press-scale and its
// transition are gated behind prefers-reduced-motion so a reduced-motion lifter gets the
// colour feedback without the scale jump.
//
// The mobile tap rule (RBAR-59, the prototype's base button rule, rack.bar.dc.html L26)
// rides along: touch-action: manipulation stops iOS reading two quick taps as
// double-tap-to-zoom (pinch zoom survives), and the tap-highlight flash and
// long-press text selection are suppressed. Safari still needs the -webkit- prefix
// on user-select. index.html sets touch-action on html as well, so the gaps between
// controls are covered app-wide.
export const BUTTON_FX = `
  button {
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    -webkit-user-select: none;
    user-select: none;
    transition: background-color .16s ease, border-color .16s ease,
                color .16s ease, opacity .16s ease;
  }
  @media (prefers-reduced-motion: no-preference) {
    button {
      transition: transform .09s ease, background-color .16s ease,
                  border-color .16s ease, color .16s ease, opacity .16s ease;
    }
    button:active { transform: scale(.955); }
  }
`;
