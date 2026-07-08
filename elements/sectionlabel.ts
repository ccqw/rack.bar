// The section-label recipe (RBAR-40). Handoff "Typography": 'section label 11px/600
// mono, .14em, uppercase', in the text-muted ink tier (RBAR-34). One recipe for every
// section label -- console Total, entry Target, loaded On the bar, recents Recent,
// setup Bar/Collars/Plates, share Loading card, help How it works -- so the tracking
// cannot drift per-site again (the pre-RBAR-40 copies had slid to .12em).
//
// A declaration block, not a full rule: interpolate it INSIDE each label's rule, same
// idiom as BOX_SIZING/BUTTON_FX strings. Layout (display, margins, alignment) is the
// site's own business and stays local. NOT for mono pill controls -- the Clear pill and
// the fullscreen config caption are spec'd .12em (prototype L184/L323) and keep it.
export const SECTION_LABEL = `
  font-family: var(--rack-font-num); font-size: 11px; font-weight: 600;
  letter-spacing: .14em; text-transform: uppercase; color: var(--rack-text-muted);
`;
