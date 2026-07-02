// Shared border-box reset (RBAR-33). index.html's `* { box-sizing: border-box }` is a
// light-DOM rule that does not cross the Shadow DOM boundary, so every shadow root was
// silently computing content-box -- visible where <rack-entry>'s keypad sheet
// (width: 100% + 32px horizontal padding) rendered 416px on a 384px viewport. The
// handoff prototype styles everything under one global border-box reset, so this IS
// the design's sizing model, restated per root.
//
// Interpolated FIRST into every element's <style> block, same idiom as BUTTON_FX
// (one string, eleven roots, no drift; adoptedStyleSheets declined in RBAR-21).
// `*` never matches pseudo-elements, so ::before/::after are named explicitly
// (index.html's light-DOM reset omits them; this deliberately goes further).
export const BOX_SIZING = `
  *, *::before, *::after { box-sizing: border-box; }
`;
