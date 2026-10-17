# Share links carry the load in a versioned URL fragment

RBAR-50 lets a lifter send the specific loadout, not just a text summary: a link that,
opened, shows the same load on the recipient's screen. rack.bar has no backend
(ADR-0001), so the load rides the URL itself. Links live in chat history forever, so
the format is a public contract and gets its own ADR. Slice 1 (this ADR's first
landing) ships only the pure core, `lib/link.ts`; opening a link (slice 2) and the
Copy link action (slice 3) build on it.

## Decision: a fragment, not a query string or a path

`https://rack.bar/#v=1&s=comp&b=20kg&m=w&c=0&u=kg&p=2x25,10&t=140`

- **A path** (`/l/...`) would 404 on GitHub Pages without a `404.html` redirect hack,
  and would collide with the MPA entries (ADR-0001; a future `game.html`).
- **A query string** works (Pages serves index.html for `/?...`) but rides into
  server/CDN logs and Referer headers.
- **A fragment** never leaves the browser, needs no Pages config, and leaves every
  entry point untouched. Messengers keep the fragment in the tapped URL. The preview
  card is the home page's either way: a static host cannot vary preview tags per URL.

## Decision: the Side Load is the payload; the Target rides along

The share card shows the load (ADR-0011), so the link reproduces exactly that. A
Target-only link would re-solve on open and could disagree with the sender's screen
(an over-Target opt-in, ADR-0003; or a solver change between versions). So the Plate
list is the source of truth, and a By Weight link adds the Target so the recipient's
entry and status read the same. **Plates win over a re-solve** when the two disagree.

## The v1 grammar

`key=value` pairs joined by `&`. The encoder writes them in this fixed order:

| key | meaning | values | when |
|---|---|---|---|
| `v` | format version | `1` | required |
| `s` | Plate set | `comp`, `training` | required |
| `b` | Bar, by its stamp | `20kg` `15kg` `5kg` (comp); `45lb` `20kg` (training) | required; one the set offers |
| `m` | mode | `w` (By Weight / Decode), `p` (By Plates / Encode) | required |
| `c` | Collar per Side, kg | `0`, `2.5` | optional, default 0 |
| `u` | display Unit | `kg`, `lb` | optional, default the recipient's own Unit |
| `p` | Side Load, heaviest first, by face stamp, `Nx` prefix when N > 1 | e.g. `2x25,15,2.5`; empty = bare Bar | optional, default bare Bar |
| `t` | Target, kg, 2 dp (the Recents precision, ADR-0009) | plain decimal, > 0, <= 1000 | only with `m=w`, optional there |

- **Canonical form.** The encoder always writes `c`, `u` and `p` (even when default
  or empty), and `t` only for a By Weight load that has a Target. Counts fold via the
  same `groupSide` the share card renders, so a link and the card cannot disagree.
- **Stamps, not kg, for Bars and Plates.** The iron masses are irrational in kg
  (45 lb = 20.41165665 kg); the stamp is exact, short, and readable, and the Plate set
  disambiguates `25` (a red Eleiko 25 kg) from `25` (an iron 25 lb). The Target and
  Collar stay kg-canonical, where kg is exact.
- **Readable on purpose.** No base64; a lifter can read or hand-edit `t=100&p=2x25`.
  Every value is an allowlisted token or a bounded decimal, so nothing needs
  percent-encoding. The worst realistic link (a Sleeve full of 0.5s) is well under 150
  characters.

## Decision: all-or-nothing parse, unknown keys ignored

`parseLink(fragment, defaultUnit)` returns a fully valid load or null; it never throws
and never returns a half-valid load. A mangled link degrades to a normal boot, the
same validate-at-the-boundary posture as the persisted rig (ADR-0007/0010). It rejects
the whole link on:

- a fragment over 512 characters (checked before any splitting), or malformed
  percent-encoding;
- `v` missing or not exactly `1`; any duplicate key (known or not);
- `s` not an offered Plate set; `b` not one of that set's Bars by stamp; `c` not an
  offered Collar; `u` not `kg`/`lb`; `m` not `w`/`p`; a known key with no `=`;
- a `p` face not in that set's Inventory; a count not an integer 1..99 (no leading
  zero); an empty token; a Side Load past the Sleeve (the ADR-0012 `plateFitsMm`
  comparison, walked heaviest-first);
- `t` present with `m=p`; `t` not a plain decimal (no sign, exponent, hex or blank);
  `t` <= 0 or over 1000 kg after rounding to 2 dp.

Tolerated, and canonicalized: keys in any order, missing optional keys, an explicit
`1x`, repeated or unsorted faces (re-sorted heaviest-first), empty `&` segments, a
leading `#`, and percent-encoded separators (a messenger may turn `,` into `%2C`).
**Unknown keys are ignored**, so a later additive v1 field does not break an older
client.

## Decision: the link applies transiently

Opening a link is a glance, not a settings import. The linked set, Bar, Collar and
Unit override the recipient's persisted rig for that view and write none of the
`rackbar.*` keys (ADR-0007/0010); a later explicit change in Setup or the unit toggle
persists that one key as today. The shell clears the fragment after applying it, so a
reload returns to the recipient's own rig. (Built in slice 2.)

**Opening a link adds its Target to Recents** (Caitlin, 2026-10-16, reversing the
planning draft's recommendation). The trade is that removing a Recent becomes easy
without an x on every chip: long-press a chip to remove it, with undo (RBAR-73).

## Decision: breaking changes bump `v`; older versions stay parseable

Any change an older client would misread bumps `v`. The app keeps parsing every older
`v` it ever wrote, so a link in someone's chat history keeps opening. An additive,
safely ignorable field stays in v1.

## Ownership

`lib/link.ts` is pure (ADR-0001): `serializeLink`, `parseLink`, and `linkUrl` (the one
site origin, `SHARE_LINK` from RBAR-64's summary, + `/#` + fragment). It validates
against the core's own reference data: `platesets.ts`, the Collar options (moved from
`<rack-setup>` into `lib/plates.ts` so the core can validate without importing a
shell), and the ADR-0012 fit helper. The rig half of an opened link is `<rack-app>`'s
to apply and the load half the console's, keeping the ADR-0007/0009/0011 split.

Invariants are property-tested in `lib/properties.test.ts` ("Share link properties"):
the round trip over every showable load, canonical form as a fixed point, idempotent
canonicalization of non-canonical links, never-throw fuzzing, and Sleeve/Bar validity
of everything accepted.
