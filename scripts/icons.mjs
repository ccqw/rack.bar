// icons.mjs -- RBAR-71: rasterise the icon masters into public/ (one source per icon).
//
//   node scripts/icons.mjs
//
// Sources (the only files to redraw):
//   assets/icons/rack-bar-icon-dark.svg  -- the Home Screen art ("A"), 200x200, opaque
//   assets/icons/rack-bar-favicon.svg    -- the small-size cut ("C"), 16x16, switches
//                                           light/dark with prefers-color-scheme
// Outputs (committed, so the build never depends on running this):
//   public/apple-touch-icon.png       180  iOS Home Screen icon
//   public/icons/icon-192.png         192  manifest, purpose "any"
//   public/icons/icon-512.png         512  manifest, purpose "any"
//   public/icons/icon-maskable-512.png 512 manifest, purpose "maskable"
//   public/favicon.svg                     verbatim copy of the favicon source
//   public/favicon.ico                16+32 the dark cut, for browsers without SVG favicons
//
// The rasteriser is @resvg/resvg-js: prebuilt binaries per platform, no native build
// step, no browser. Vite copies public/ verbatim into dist/.
import { Resvg } from '@resvg/resvg-js';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const src = (p) => resolve(root, 'assets/icons', p);
const out = (p) => resolve(root, 'public', p);

const APP_MASTER = src('rack-bar-icon-dark.svg');
const FAVICON = src('rack-bar-favicon.svg');

// The maskable safe zone is a centred circle of radius 40% of the icon (W3C manifest,
// "icon masks"). The art is drawn edge to edge in its 200 frame, so it is scaled into
// the central MASKABLE_ART fraction; its farthest corner then sits at about 33%.
const MASKABLE_ART = 0.8;

/** Render an SVG string to a PNG buffer `size` px wide (the sources are square). */
function render(svg, size) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render();
}

function write(path, buf) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buf);
  console.log(`wrote ${path.slice(root.length + 1)} (${buf.length} bytes)`);
}

/** The root <svg>'s inner markup and its xmlns:* attributes, for nesting a master. */
function unwrap(svg) {
  const open = svg.match(/<svg\b[^>]*>/);
  const close = svg.lastIndexOf('</svg>');
  if (!open || close < 0) throw new Error('icons: master is not an <svg> document');
  const ns = [...open[0].matchAll(/\sxmlns(?::\w+)?="[^"]*"/g)].map((m) => m[0]).join('');
  return { ns, inner: svg.slice(open.index + open[0].length, close) };
}

/** The master's ground colour, sampled from a corner pixel (no markup assumptions). */
function groundOf(svg) {
  const img = render(svg, 64);
  const [r, g, b] = img.pixels.subarray(0, 3); // top-left pixel, RGBA
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** A full-bleed square on the master's ground with the art shrunk into the safe zone. */
function maskable(svg) {
  const { ns, inner } = unwrap(svg);
  const inset = (200 * (1 - MASKABLE_ART)) / 2;
  return (
    `<svg${ns} viewBox="0 0 200 200" width="200" height="200">` +
    `<rect width="200" height="200" fill="${groundOf(svg)}"/>` +
    `<g transform="translate(${inset} ${inset}) scale(${MASKABLE_ART})">${inner}</g>` +
    `</svg>`
  );
}

/** The favicon with its dark media query applied unconditionally (later rules win). */
function darkCut(svg) {
  const media = /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/;
  const m = svg.match(media);
  if (!m) throw new Error('icons: favicon has no @media (prefers-color-scheme: dark) block');
  return svg.replace(media, m[1]);
}

/** An ICO container holding PNG-encoded images (supported by every current browser). */
function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type 1 = icon
  header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const entries = pngs.map(({ size, png }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size % 256, 0); // width (0 means 256)
    e.writeUInt8(size % 256, 1); // height
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.png)]);
}

const app = readFileSync(APP_MASTER, 'utf8');
write(out('apple-touch-icon.png'), render(app, 180).asPng());
write(out('icons/icon-192.png'), render(app, 192).asPng());
write(out('icons/icon-512.png'), render(app, 512).asPng());
write(out('icons/icon-maskable-512.png'), render(maskable(app), 512).asPng());

const fav = readFileSync(FAVICON, 'utf8');
copyFileSync(FAVICON, out('favicon.svg'));
console.log('wrote public/favicon.svg (copy)');
const dark = darkCut(fav);
write(out('favicon.ico'), ico([16, 32].map((size) => ({ size, png: render(dark, size).asPng() }))));
