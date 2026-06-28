/**
 * rack.bar — plate-loading engine
 * ============================================================================
 * Framework-agnostic domain logic, lifted VERBATIM from the prototype's logic
 * class. No React, no DOM, no DC-runtime. Pure functions + plain data — drop
 * this into any codebase (browser, Node, React Native, a web worker) unchanged.
 *
 * This is the part of the prototype worth keeping. The UI should be rebuilt in
 * your framework, but this math is the product: given a target weight, a bar,
 * collars and an available plate set, it computes the plates to rack PER SIDE,
 * respecting the physical sleeve-width limit, and tells you whether the result
 * is exact / over / under.
 *
 * INVARIANTS (don't break these on a rewrite):
 *  - Plates are loaded heaviest-first, greedily, never exceeding SLEEVE_MM of
 *    sleeve width (a real bar runs out of room before it runs out of plates).
 *  - `decode` returns the largest loadable total that does NOT exceed target
 *    (`primary`), plus an optional `over` candidate one step heavier — so the
 *    UI can offer "round up". When the bar is at the sleeve cap, no `over`.
 *  - All comparisons use an EPS tolerance; never compare floats with ==.
 *  - kg is the canonical unit internally. lb is a display/entry convenience.
 *
 * UNITS: every weight in this module is KILOGRAMS unless a name says lb.
 * ============================================================================
 */

// ── physical + numeric constants ───────────────────────────────────────────
export const EPS = 1e-9;              // float comparison tolerance
export const LB = 2.2046226218;       // kg → lb factor
export const SLEEVE_MM = 415;         // usable sleeve length per side (mm)

// ── plate sets (domain data) ────────────────────────────────────────────────
// Eleiko competition plates — colour-coded, kg. diameter/width drive rendering.
export const ELEIKO = [
  { kg: 25,  color: 'red',    diameterMm: 450, widthMm: 58 },
  { kg: 20,  color: 'blue',   diameterMm: 450, widthMm: 50 },
  { kg: 15,  color: 'yellow', diameterMm: 450, widthMm: 39 },
  { kg: 10,  color: 'green',  diameterMm: 450, widthMm: 35 },
  { kg: 5,   color: 'white',  diameterMm: 228, widthMm: 20 },
  { kg: 2.5, color: 'red',    diameterMm: 207, widthMm: 15 },
  { kg: 2,   color: 'blue',   diameterMm: 193, widthMm: 22 },
  { kg: 1.5, color: 'yellow', diameterMm: 170, widthMm: 20 },
  { kg: 1,   color: 'green',  diameterMm: 148, widthMm: 19 },
  { kg: 0.5, color: 'white',  diameterMm: 127, widthMm: 16 },
];

// Plain-iron training plates — labelled in lb, mass stored in kg. `label` is
// the number engraved on the plate (the lb value); `kg` is its true mass.
export const IRON = [
  { kg: 20.41166, label: '45',  color: 'iron', diameterMm: 450, widthMm: 50 },
  { kg: 15.87573, label: '35',  color: 'iron', diameterMm: 400, widthMm: 44 },
  { kg: 11.33981, label: '25',  color: 'iron', diameterMm: 330, widthMm: 34 },
  { kg: 4.53592,  label: '10',  color: 'iron', diameterMm: 230, widthMm: 24 },
  { kg: 2.26796,  label: '5',   color: 'iron', diameterMm: 195, widthMm: 20 },
  { kg: 1.13398,  label: '2.5', color: 'iron', diameterMm: 160, widthMm: 17 },
];

// Bar + collar options surfaced in Setup.
export const BARS    = [{ kg: 20, sub: "Men's" }, { kg: 15, sub: "Women's" }, { kg: 5, sub: 'Tech' }];
export const COLLARS = [{ kg: 0, sub: 'None' }, { kg: 2.5, sub: 'Standard' }];

// Plate colour → hex (domain data, NOT a UI token; see Design system).
export const PAL = { red: '#e0263a', blue: '#2563c9', yellow: '#f5c518', green: '#25a45a', white: '#eef0f2', iron: '#34383e' };

/** Resolve which plate set is active from a setup key. */
export function activePlates(key) { return key === 'training' ? IRON : ELEIKO; }

// ── side / total math ───────────────────────────────────────────────────────
/** Sum of plate mass on one side (kg). */
export function sideKg(side)    { return side.reduce((s, p) => s + p.kg, 0); }
/** Sum of plate width on one side (mm) — used for the sleeve-cap check. */
export function sideWidth(side) { return side.reduce((w, p) => w + p.widthMm, 0); }
/** Narrowest plate in a set (mm) — the smallest increment that still fits. */
export function minPlateWidth(plates) { return Math.min(...plates.map((p) => p.widthMm)); }
/** Full barbell total: bar + both collars + both sides of plates (kg). */
export function total(side, barKg, collarKg) { return barKg + 2 * collarKg + 2 * sideKg(side); }

/**
 * Greedily fill ONE side up to `perSide` kg, heaviest plate first, never
 * exceeding the sleeve width. Returns the chosen plates (descending kg).
 */
export function fillSide(perSide, plates = ELEIKO) {
  let rem = perSide;
  const out = [];
  let width = 0;
  for (const p of plates) {
    while (rem >= p.kg - EPS && width + p.widthMm <= SLEEVE_MM + EPS) {
      out.push(p);
      rem -= p.kg;
      width += p.widthMm;
    }
  }
  return out;
}

/**
 * Core: given a TARGET total, return what's actually loadable.
 *  → { primary: { side, total, delta },        // largest total ≤ target
 *      over?:   { side, total, delta } }        // one step heavier (round-up)
 * `delta` is (achieved total − target); negative = short of target.
 * `over` is omitted when primary already hits target, or the sleeve is full.
 */
export function decode(target, barKg, collarKg, plates = ELEIKO) {
  if (!Number.isFinite(target)) return { primary: { side: [], total: barKg + 2 * collarKg, delta: 0 } };
  const perHalf = Math.max(0, (target - barKg - 2 * collarKg) / 2);
  const side = fillSide(perHalf, plates);
  const t = total(side, barKg, collarKg);
  const primary = { side, total: t, delta: t - target };
  if (primary.delta < -EPS) {
    const step = Math.min(...plates.map((p) => p.kg));
    const overSide = fillSide(sideKg(side) + step, plates);
    const overTotal = total(overSide, barKg, collarKg);
    return { primary, over: { side: overSide, total: overTotal, delta: overTotal - target } };
  }
  return { primary };
}

// ── manual loading (the "Add plates" mode) ──────────────────────────────────
/** Add a plate to a side and keep it sorted heaviest-first. Pure (returns new array). */
export function addPlate(side, plate) { return [...side, plate].sort((a, b) => b.kg - a.kg); }
/** Remove the plate at index i. Pure. */
export function removeAt(side, i) { return [...side.slice(0, i), ...side.slice(i + 1)]; }

/** Collapse a side into display groups: [{ kg, color, label, count }]. */
export function groupSide(side) {
  const m = [];
  side.forEach((p) => {
    const last = m[m.length - 1];
    if (last && Math.abs(last.kg - p.kg) < EPS) last.count++;
    else m.push({ kg: p.kg, color: p.color, label: p.label, count: 1 });
  });
  return m;
}

// ── unit helpers ─────────────────────────────────────────────────────────────
/** kg → whole lb (rounded). */
export function toLbWhole(kg) { return Math.round(kg * LB); }
/** Parse a text entry (in the given unit) to kg, or null if blank/invalid. */
export function draftToKg(draft, unit) {
  if (draft == null) return null;
  const s = String(draft).trim();
  if (s === '') return null;
  const n = Number(s);
  if (Number.isNaN(n)) return null;
  return unit === 'lb' ? n / LB : n;
}
/** Format a kg value as a short "NN.N kg" string (trailing-zero trimmed). */
export function kgSec(kg) { return fmt(Number(kg.toFixed(1))) + ' kg'; }
/** Format a kg value as a whole "NNN lb" string. */
export function lbSec(kg) { return toLbWhole(kg) + ' lb'; }
/** Stepper increment for the +/- buttons: 5 lb or 1 kg. */
export function stepFor(unit) { return unit === 'lb' ? 5 : 1; }
/** Plate face label from kg (e.g. 0.5 → ".5"). Iron plates carry their own `label`. */
export function plateLabel(kg) { return kg < 1 ? String(kg).replace(/^0/, '') : String(kg); }
/** Trim a kg number to at most 2 decimals, no trailing zeros. */
export function fmt(kg) { return String(Number(kg.toFixed(2))); }

/* ============================================================================
 * RENDER-GEOMETRY HELPERS  (optional — tied to the prototype's pixel canvas)
 * ----------------------------------------------------------------------------
 * These compute a scale factor so a loaded side fits the prototype's fixed
 * 384px phone frame / fullscreen view. They are NOT product logic — when you
 * rebuild the bar visual with your own layout system you'll likely replace
 * them. Kept here only so the reference renders identically. The numeric
 * constants are px measurements of the prototype's specific frame.
 * ========================================================================== */
const GAP = 1.5, BARSTUB = 92, MIN_DISC = 9, AVAIL = 296, MAX_SCALE = 168 / 450;

/** Scale (mm→px) that fits a side inside the inline bar strip. */
export function fitScale(side) {
  if (!side.length) return MAX_SCALE;
  const avail = AVAIL - BARSTUB - GAP * side.length;
  const rowAt = (s) => side.reduce((px, p) => px + Math.max(p.widthMm * s, MIN_DISC), 0);
  if (rowAt(MAX_SCALE) <= avail) return MAX_SCALE;
  let lo = 0, hi = MAX_SCALE;
  for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (rowAt(m) <= avail) lo = m; else hi = m; }
  return lo;
}

/** Per-plate {w,h} px dims for the large landscape fullscreen view. */
export function fsLayout(side) {
  const FS_AVAIL = 360, FS_GAP = 2, FS_MIN = 17, FS_MAX = 280 / 450;
  if (!side.length) return { dims: [], scale: FS_MAX };
  const availPx = FS_AVAIL - FS_GAP * side.length;
  const rowAt = (s) => side.reduce((px, p) => px + Math.max(p.widthMm * s, FS_MIN), 0);
  let scale = FS_MAX;
  if (rowAt(FS_MAX) > availPx) {
    let lo = 0, hi = FS_MAX;
    for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (rowAt(m) <= availPx) lo = m; else hi = m; }
    scale = lo;
  }
  let dims = side.map((p) => ({ w: Math.max(FS_MIN, p.widthMm * scale), h: p.diameterMm * scale }));
  const sumW = dims.reduce((acc, d) => acc + d.w, 0);
  if (sumW > availPx && sumW > 0) { const k = availPx / sumW; dims = dims.map((d) => ({ w: d.w * k, h: d.h * k })); }
  return { dims, scale };
}
