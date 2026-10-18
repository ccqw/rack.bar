// The keypad delete key's face (RBAR-46, RBAR-102): one backspace glyph for both keypads,
// the calculator's (rack-entry) and the Loadout quiz's. A tag shape -- a rectangular body
// with a point on its left -- with an X inside it. Drawn as an inline SVG so the source
// stays ASCII; decorative, since each key's aria-label ("Delete") is the announcement.
//
// RBAR-102: the X is centred on the rectangular BODY, not on the whole shape's bounding
// box (which includes the point and would pull the X left). The path is built from the
// geometry below so that centring holds by construction; delglyph.test.ts measures it
// back out of the drawn path.

// viewBox 0 0 22 16, 1.6 stroke: every edge sits 1.25 in, so the stroke never clips.
const TOP = 1.25;
const BOTTOM = 14.75;
const RIGHT = 20.75;
// Where the slanted edges meet the top and bottom edges: the body's left side.
const BODY_LEFT = 7;
// The point's tip, on the vertical centre line.
const TIP = 1.25;
// Corner rounding: the body's corners, and the tip.
const CORNER = 2.25;
const TIP_ROUND = 1.2;
// Half the X's width and height (a square X).
const X_HALF = 2.25;

const MID_Y = (TOP + BOTTOM) / 2;
const BODY_MID_X = (BODY_LEFT + RIGHT) / 2;

const n = (v: number): string => String(Math.round(v * 100) / 100);
const pt = (x: number, y: number): string => `${n(x)} ${n(y)}`;

// The point `d` along the straight line from (x0, y0) toward (x1, y1).
const along = (x0: number, y0: number, x1: number, y1: number, d: number): [number, number] => {
  const len = Math.hypot(x1 - x0, y1 - y0);
  return [x0 + ((x1 - x0) * d) / len, y0 + ((y1 - y0) * d) / len];
};

// The outline, clockwise from the top edge. Each corner is a quadratic curve whose control
// point is the sharp corner, so the rounding is symmetric about it.
const outline = [
  `M${pt(BODY_LEFT + CORNER, TOP)}`,
  `H${n(RIGHT - CORNER)}`,
  `Q${pt(RIGHT, TOP)} ${pt(RIGHT, TOP + CORNER)}`,
  `V${n(BOTTOM - CORNER)}`,
  `Q${pt(RIGHT, BOTTOM)} ${pt(RIGHT - CORNER, BOTTOM)}`,
  `H${n(BODY_LEFT + CORNER)}`,
  `Q${pt(BODY_LEFT, BOTTOM)} ${pt(...along(BODY_LEFT, BOTTOM, TIP, MID_Y, CORNER))}`,
  `L${pt(...along(TIP, MID_Y, BODY_LEFT, BOTTOM, TIP_ROUND))}`,
  `Q${pt(TIP, MID_Y)} ${pt(...along(TIP, MID_Y, BODY_LEFT, TOP, TIP_ROUND))}`,
  `L${pt(...along(BODY_LEFT, TOP, TIP, MID_Y, CORNER))}`,
  `Q${pt(BODY_LEFT, TOP)} ${pt(BODY_LEFT + CORNER, TOP)}`,
  'Z',
].join('');

const cross =
  `M${pt(BODY_MID_X - X_HALF, MID_Y - X_HALF)}L${pt(BODY_MID_X + X_HALF, MID_Y + X_HALF)}` +
  `M${pt(BODY_MID_X + X_HALF, MID_Y - X_HALF)}L${pt(BODY_MID_X - X_HALF, MID_Y + X_HALF)}`;

// The whole glyph, ready to drop into a key.
export const DEL_ICON =
  '<svg width="22" height="16" viewBox="0 0 22 16" fill="none" stroke="currentColor" ' +
  'stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">' +
  `<path d="${outline}"></path><path d="${cross}"></path></svg>`;
