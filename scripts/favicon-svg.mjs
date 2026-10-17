// favicon-svg.mjs -- build public/favicon.svg from the two jumbo favicon masters.
//
// Pure string work (no rasteriser), so pwa.test.ts can check the committed file is
// exactly what the masters produce. Used by scripts/icons.mjs.
//
// The masters are editor exports (Sketch): an XML prolog, a <title>, ids, and a
// <use xlink:href> that paints the ground from a <defs> path. clean() inlines each
// <use> as the element it points at and drops the rest, so the two cuts can share
// one document without id clashes or the xlink namespace.

/** One master reduced to its drawing: no prolog, title, defs, ids or xlink. */
export function clean(svg) {
  const open = svg.match(/<svg\b[^>]*>/);
  const close = svg.lastIndexOf('</svg>');
  if (!open || close < 0) throw new Error('favicon: master is not an <svg> document');
  let inner = svg.slice(open.index + open[0].length, close);

  // Collect <defs> children by id, then remove <defs>.
  const defs = new Map();
  inner = inner.replace(/<defs>([\s\S]*?)<\/defs>/g, (_, body) => {
    for (const m of body.matchAll(/<(\w+)\b([^>]*?)\bid="([^"]+)"([^>]*?)\s*\/?>(?:\s*<\/\1>)?/g)) {
      defs.set(m[3], { tag: m[1], attrs: `${m[2]}${m[4]}`.replace(/\s+/g, ' ').trim() });
    }
    return '';
  });

  // <use ... xlink:href="#id"> becomes the referenced element with the use's attributes.
  inner = inner.replace(
    /<use\b([^>]*?)\s*(?:\/>|>\s*<\/use>)/g,
    (whole, attrs) => {
      const ref = attrs.match(/(?:xlink:)?href="#([^"]+)"/);
      const def = ref && defs.get(ref[1]);
      if (!def) throw new Error(`favicon: <use> points at no <defs> element: ${whole}`);
      const own = attrs.replace(/\s(?:xlink:)?href="[^"]*"/, '').trim();
      return `<${def.tag} ${def.attrs}${own ? ` ${own}` : ''}/>`;
    },
  );

  return inner
    .replace(/<title>[\s\S]*?<\/title>/g, '')
    .replace(/\s(?:id|xlink:href)="[^"]*"/g, '')
    .replace(/<(\w+)\b([^>]*?)>\s*<\/\1>/g, '<$1$2/>') // empty element -> self-closing
    .replace(/>\s+</g, '><')
    .trim();
}

/**
 * One SVG holding both cuts: dark by default (the app is dark-only), light when the
 * browser chrome is light. Each cut is its own group, toggled by a media query.
 */
export function faviconSvg(darkMaster, lightMaster) {
  const box = (svg) => svg.match(/\bviewBox="([^"]+)"/)?.[1];
  const viewBox = box(darkMaster);
  if (!viewBox || viewBox !== box(lightMaster)) {
    throw new Error('favicon: the jumbo masters must share one viewBox');
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">` +
    `<title>rack.bar</title>` +
    `<style>.l{display:none}@media (prefers-color-scheme: light){.d{display:none}.l{display:inline}}</style>` +
    `<g class="d">${clean(darkMaster)}</g>` +
    `<g class="l">${clean(lightMaster)}</g>` +
    `</svg>\n`
  );
}
