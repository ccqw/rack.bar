// fit-check.js -- the RBAR-67 phone-fit check: no vertical scroll in any default state.
//
// happy-dom cannot measure layout, so this is the layout check the Vitest suite can't
// be. It is a Playwright snippet (one `async (page) => ...` function), run against a
// live dev server -- e.g. through the Playwright MCP's run-code tool with this file as
// its `filename`, after `npm run dev -- --port 5198` (ORIGIN below). It opens its own
// tab, so nothing else driving the shared browser can navigate it mid-run.
// It walks every Must state from the ticket at each VISIBLE Safari viewport (toolbars
// showing -- never the full screen height, which hides the overflow) and returns one
// line per viewport + state (the worst across both plate sets and both units): the
// document's scrollHeight against the viewport's innerHeight, `over` = how far the page
// would scroll (0 = it fits), and the sleeve's flexed height.
//
//   393x659 -- iPhone 15/16 in Safari (the Must)
//   375x548 -- iPhone SE in Safari (the Nice)
//   430x739 -- Pro Max in Safari (the Should)
//   320x548 -- the narrowest supported width (horizontal-scroll guard)
async (shared) => {
  const ORIGIN = 'http://localhost:5198';
  const page = await shared.context().newPage();
  const SIZES = [
    [393, 659],
    [375, 548],
    [430, 739],
    [320, 548],
  ];
  // Recent Targets, canonical kg: a round-up Target (100.3 -> 100 short, "Round up ->
  // 101"), an exact one on Comp (142), and an over-capacity one
  // ("Bar at capacity").
  const RECENTS = [100.3, 142, 1000, 60, 185, 225];

  // Reach into <rack-app> -> <rack-console> -> (child) shadow roots.
  const inConsole = (fn, arg) =>
    page.evaluate(
      ([src, a]) => {
        const con = document.querySelector('rack-app').shadowRoot.querySelector('rack-console');
        return new Function('con', 'a', src)(con.shadowRoot, a);
      },
      [fn, arg],
    );
  const measure = () =>
    page.evaluate(() => {
      const d = document.documentElement;
      return {
        scrollH: d.scrollHeight,
        innerH: window.innerHeight,
        over: Math.max(0, d.scrollHeight - window.innerHeight),
        hscroll: Math.max(0, d.scrollWidth - window.innerWidth),
        sleeve: document
          .querySelector('rack-app')
          .shadowRoot.querySelector('rack-console')
          .shadowRoot.querySelector('rack-sleeve').clientHeight,
      };
    });

  const rows = [];
  for (const [w, h] of SIZES) {
    await page.setViewportSize({ width: w, height: h });
    for (const plateSet of ['comp', 'training']) {
      for (const unit of ['kg', 'lb']) {
        const reset = async (recents) => {
          await page.goto(ORIGIN + '/');
          await page.evaluate(
            ([set, u, r]) => {
              localStorage.clear();
              localStorage.setItem('rackbar.plateSet', set);
              localStorage.setItem('rackbar.unit', u);
              if (r) localStorage.setItem('rackbar.recents', JSON.stringify(r));
            },
            [plateSet, unit, recents],
          );
          await page.reload();
          await page.waitForFunction(() => !!document.querySelector('rack-app')?.shadowRoot);
        };
        const record = async (state) =>
          rows.push({ size: `${w}x${h}`, plateSet, unit, state, ...(await measure()) });
        // Tap the Recent chip holding this kg Target (chips carry their canonical kg).
        const chip = (kg) =>
          inConsole(
            `con.querySelector('rack-recents').shadowRoot.querySelector('[data-target="' + a + '"]').click()`,
            kg,
          );

        await reset(null);
        await record('weight: fresh');
        await reset(RECENTS);
        await record('weight: recents, no Target');
        await chip(142);
        await record('weight: recents + loaded');
        await chip(100.3);
        await record('weight: round-up offered');
        await chip(1000);
        await record('weight: at capacity');
        await inConsole(`con.querySelector('[data-mode="encode"]').click()`);
        await record('plates: empty');
        await inConsole(
          `const k=[...con.querySelector('rack-palette').shadowRoot.querySelectorAll('.key')];` +
            `for (const i of [0,0,1,2,3,4,k.length-1]) k[Math.min(i,k.length-1)].click()`,
        );
        await record('plates: loaded');
      }
    }
  }
  await page.close();
  // One line per viewport + state, worst case across the plate sets and units:
  // "393x659 weight: fresh -- scroll 659/659 over 0, sleeve 150px" (over 0 = it fits).
  const worst = new Map();
  for (const r of rows) {
    const key = `${r.size} ${r.state}`;
    const prev = worst.get(key);
    if (!prev || r.over > prev.over || (r.over === prev.over && r.sleeve < prev.sleeve)) {
      worst.set(key, r);
    }
  }
  return [...worst.entries()].map(
    ([key, r]) =>
      `${key} -- scroll ${r.scrollH}/${r.innerH} over ${r.over}` +
      `${r.hscroll ? ` HSCROLL ${r.hscroll}` : ''}, sleeve ${r.sleeve}px`,
  );
}
