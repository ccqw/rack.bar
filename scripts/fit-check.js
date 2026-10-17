// fit-check.js -- the RBAR-67 phone-fit check: no vertical scroll in any default state.
//
// happy-dom cannot measure layout, so this is the layout check the Vitest suite can't
// be. It is a Playwright snippet (one `async (page) => ...` function), run against a
// live dev server -- e.g. through the Playwright MCP's run-code tool with this file as
// its `filename`, after `npm run dev -- --port 5198` (ORIGIN below). It opens its own
// tab, so nothing else driving the shared browser can navigate it mid-run.
// It walks every Must state from the ticket (and, since RBAR-65, the Warm up states) at
// each VISIBLE Safari viewport (toolbars showing -- never the full screen height, which
// hides the overflow) and returns one line per viewport + state (the worst across both
// plate sets and both units): the document's scrollHeight against the viewport's
// innerHeight, `over` = how far the page would scroll (0 = it fits), and the sleeve's
// flexed height. Since RBAR-75 the Share and fullscreen buttons overlap the sleeve's
// top-right, so each state also hit-tests them over its loadout (bare Bar through a full
// sleeve, both plate sets): the centre and the bottom edge of each drawn 30px box must
// land on that button, or the line reads ICONS BLOCKED (ICONS MISSING if the selector no
// longer finds exactly two). The Setup states (RBAR-76) add the sheet's height, how far
// it runs above the viewport (`over`, 0 = it fits), and how far its Bar row scrolls
// sideways inside the sheet. Since RBAR-72 the sheet may scroll inside itself (the Pairs
// of Plates on Hand section), never the page: the Setup lines also give how far the
// sheet scrolls inside (`scrolls inside`, the most across both sets and units -- a
// report, not an assertion), and the RBAR-72 states open a size's None..All row with
// limits stored.
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
      const con = document.querySelector('rack-app').shadowRoot.querySelector('rack-console')
        .shadowRoot;
      // Exactly Share + fullscreen: an empty match must not pass the hit-test vacuously.
      const btns = [...con.querySelectorAll('.icons .iconbtn')];
      const iconsMissing = btns.length !== 2;
      const iconsHit = btns.every((b) => {
        const r = b.getBoundingClientRect();
        const x = r.left + r.width / 2;
        return [r.top + r.height / 2, r.bottom - 2].every(
          (y) => con.elementFromPoint(x, y)?.closest('button') === b,
        );
      });
      // The Setup sheet (RBAR-76): when open, how far its panel runs above the viewport
      // top (0 = the whole sheet shows) and how far its Bar row scrolls sideways (the
      // custom Bars scroll inside the row, never the page).
      const setup = document.querySelector('rack-app').shadowRoot.querySelector('rack-setup');
      const panel = setup.hidden ? null : setup.shadowRoot.querySelector('[data-panel]');
      const row = setup.shadowRoot.querySelector('[data-bar-tiles]');
      return {
        iconsMissing,
        iconsHit,
        sheetOver: panel ? Math.max(0, -Math.floor(panel.getBoundingClientRect().top)) : 0,
        sheetH: panel ? Math.round(panel.getBoundingClientRect().height) : 0,
        rowScroll: panel ? row.scrollWidth - row.clientWidth : 0,
        sheetScroll: panel ? panel.scrollHeight - panel.clientHeight : 0,
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
        // Warm up (RBAR-65 slice 2): the working-weight row + stairs + Next, keypad
        // closed. With no Working set yet (the prompt), then a saved one (rackbar.working,
        // 140 kg -- 309 lb) on the bare-Bar row, the 90% row (a swap on Comp kg) and the Working set.
        await reset(null);
        await inConsole(`con.querySelector('[data-mode="warmup"]').click()`);
        await record('warmup: no working weight');
        await page.evaluate(() => localStorage.setItem('rackbar.working', '140'));
        await page.reload();
        await page.waitForFunction(() => !!document.querySelector('rack-app')?.shadowRoot);
        await inConsole(`con.querySelector('[data-mode="warmup"]').click()`);
        const stair = (i) =>
          inConsole(
            `con.querySelector('rack-warmup').shadowRoot.querySelectorAll('.st')[a].click()`,
            i,
          );
        await record('warmup: Bar row');
        await stair(3);
        await record('warmup: 90% row');
        await stair(4);
        await record('warmup: Working set');

        // The Setup sheet (RBAR-76, ADR-0017): bare, with the "+" entry open, and with
        // the three custom Bars the cap allows (one selected).
        const inApp = (src) =>
          page.evaluate((s) => {
            const sh = document.querySelector('rack-app').shadowRoot;
            return new Function('app', 'setup', s)(sh, sh.querySelector('rack-setup').shadowRoot);
          }, src);
        await reset(null);
        await inApp(`app.querySelector('[data-setup-pill]').click()`);
        await record('setup: open');
        await inApp(`setup.querySelector('[data-bar-add]').click()`);
        await record('setup: + entry');
        await page.evaluate(() => {
          localStorage.setItem(
            'rackbar.customBars',
            JSON.stringify([
              { value: 35, unit: 'lb' },
              { value: 15.9, unit: 'kg' },
              { value: 110, unit: 'lb' },
            ]),
          );
          localStorage.setItem('rackbar.barKg', String(110 * 0.45359237));
        });
        await page.reload();
        await page.waitForFunction(() => !!document.querySelector('rack-app')?.shadowRoot);
        await inApp(`app.querySelector('[data-setup-pill]').click()`);
        await record('setup: 3 custom Bars');
        // Pairs of Plates on Hand (RBAR-72): limits stored on both sets and the sheet
        // open; then the first size's None..All row opened.
        await page.evaluate(() =>
          localStorage.setItem(
            'rackbar.platesOnHand',
            JSON.stringify({ comp: { 25: 1, 15: 0, 0.5: 2 }, training: { 45: 1, 2.5: 0 } }),
          ),
        );
        await page.reload();
        await page.waitForFunction(() => !!document.querySelector('rack-app')?.shadowRoot);
        await inApp(`app.querySelector('[data-setup-pill]').click()`);
        await record('setup: limits stored');
        // Opening a row scrolls it into view inside the sheet (RBAR-72 review).
        await inApp(`setup.querySelector('[data-face]').click()`);
        await record('setup: size row open');
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
    const worse = (a, b) => a.over + a.sheetOver - (b.over + b.sheetOver);
    if (!prev || worse(r, prev) > 0 || (worse(r, prev) === 0 && r.sleeve < prev.sleeve)) {
      worst.set(key, {
        ...r,
        iconsHit: r.iconsHit && (prev?.iconsHit ?? true),
        iconsMissing: r.iconsMissing || (prev?.iconsMissing ?? false),
        sheetScroll: Math.max(r.sheetScroll, prev?.sheetScroll ?? 0),
      });
    } else {
      if (!r.iconsHit) prev.iconsHit = false;
      if (r.iconsMissing) prev.iconsMissing = true;
      prev.sheetScroll = Math.max(prev.sheetScroll, r.sheetScroll);
    }
  }
  return [...worst.entries()].map(
    ([key, r]) =>
      `${key} -- scroll ${r.scrollH}/${r.innerH} over ${r.over}` +
      `${r.hscroll ? ` HSCROLL ${r.hscroll}` : ''}, sleeve ${r.sleeve}px` +
      `${r.iconsMissing ? ' ICONS MISSING' : r.iconsHit ? '' : ' ICONS BLOCKED'}` +
      (r.sheetH
        ? `, sheet ${r.sheetH}px over ${r.sheetOver}, Bar row scrolls ${r.rowScroll}px,` +
          ` scrolls inside ${r.sheetScroll}px`
        : ''),
  );
}
