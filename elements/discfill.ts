// The disc-fill recipe (RBAR-42). Handoff "Plate palette": a plate-colored surface is
// not a flat fill but a soft top-lit gradient over its plate hex, read from the --disc
// custom property the site sets per color. One recipe for every gradient surface --
// the sleeve discs, the palette keys, the loaded chips -- so the fill cannot drift
// per-site (pre-RBAR-42, only the sleeve had it; the others rendered flat).
//
// A declaration block, not a full rule: interpolate it INSIDE each surface's rule,
// same idiom as BOX_SIZING/BUTTON_FX/SECTION_LABEL. The shadow is the site's own
// business (the sleeve lifts with --rack-shadow-disc, the chips/keys with their
// prototype-spec'd shadows) and stays local. NOT for the share card's chips -- the
// prototype (L889) deliberately fills those flat and ring-lights them instead.
export const DISC_FILL = `
  background: linear-gradient(180deg, color-mix(in srgb, var(--disc) 95%, #fff), var(--disc));
`;
