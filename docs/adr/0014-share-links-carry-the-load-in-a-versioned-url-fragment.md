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
| `u` | the sender's Primary unit | `kg`, `lb` | optional, default the recipient's own Primary unit |
| `p` | Side Load, heaviest first, by face stamp, `Nx` prefix when N > 1 | e.g. `2x25,15,2.5`; empty = bare Bar | optional, default bare Bar |
| `t` | Target, kg, 2 dp (the Recents precision, ADR-0009) | plain decimal, > 0, <= 1000 | only with `m=w`, optional there |
| `d` | the Target field's text, in `u` (additive, slice 3) | decimal, <= 4 + 2 digits, fits `t` | only with `t`, optional there |

- **Canonical form.** The encoder always writes `c`, `u` and `p` (even when default
  or empty), and `t` only for a By Weight load that has a Target. Counts fold via the
  same `groupSide` the share card renders, so a link and the card cannot disagree.
- **Stamps, not kg, for Bars and Plates.** The iron masses are irrational in kg
  (45 lb = 20.41165665 kg); the stamp is exact, short, and readable, and the Plate set
  disambiguates `25` (a red Eleiko 25 kg) from `25` (an iron 25 lb). The Target and
  Collar stay kg-canonical, where kg is exact.
- **Readable on purpose.** No base64; a lifter can read or hand-edit `t=100&p=2x25`.
  Every value is an allowlisted token or a bounded decimal, so nothing needs
  percent-encoding. Counts fold to one `Nx` token per face, so even the longest
  canonical link (a mixed descent of every face plus a Target) is under ~100
  characters; the 512-character cap only bounds hostile input.

## Decision: all-or-nothing parse, unknown keys ignored

`parseLink(fragment, primaryUnit)` returns a fully valid load or null; it never throws
and never returns a half-valid load. A mangled link degrades to a normal boot, the
same validate-at-the-boundary posture as the persisted rig (ADR-0007/0010). It rejects
the whole link on:

- a fragment over 512 characters (checked before any splitting);
- `v` missing or not exactly `1`; a duplicate known key; a known key with no `=` or
  with malformed percent-encoding in its value;
- `s` not an offered Plate set; `b` not one of that set's Bars by stamp; `c` not an
  offered Collar; `u` not `kg`/`lb`; `m` not `w`/`p`;
- a `p` face not in that set's Inventory; a count not an integer 1..99 (no leading
  zero); an empty token; a Side Load past the Sleeve (the ADR-0012 `plateFitsMm`
  comparison, walked heaviest-first);
- `t` present with `m=p`; `t` not a plain decimal (no sign, exponent, hex or blank);
  `t` <= 0 or over 1000 kg after rounding to 2 dp.
- `d` without `t` (so also with `m=p`); `d` not a decimal of at most 4 + 2 digits; `d`
  that does not fit `t` in the load's unit (`readingFits`: in kg it rounds to `t`; in
  lb it is within half a whole-lb readout plus the 2 dp kg rounding, 0.5111 lb).

Tolerated, and canonicalized: keys in any order, missing optional keys, an explicit
`1x`, repeated or unsorted faces (re-sorted heaviest-first), leading or trailing zeros in a
decimal, empty `&` segments, a leading `#`, and percent-encoded values (a messenger
may turn `,` into `%2C`). The fragment is split on `&` and `=` BEFORE each value is
decoded, so an encoded `%26` / `%3D` can never become a separator and smuggle in a
key. **Unknown keys are ignored** -- even duplicated, valueless or badly escaped -- so
a later additive v1 field does not break an older client.

The serializer holds the same line from the other side: `serializeLink` returns null
for a load it cannot represent exactly (a Bar or Collar the set does not offer, a
Plate from the other set, a Side out of order or past the Sleeve, a Target that is not
finite, rounds to <= 0, or is over the cap). Refusing beats a link that opens to a
different load -- an off-menu 20.4 kg Bar would round onto the `45lb` stamp, and a red
Eleiko `25` on a Training load would open as an iron 25 lb. Every link it does write
parses back to the same load (with the Target at 2 dp). A missing `u` takes the recipient's Primary unit, which the
shell must pass (`parseLink`'s second argument is required).

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
canonicalization of non-canonical links, never-throw fuzzing, Sleeve/Bar validity
of everything accepted, whole-lb Target read-back, and the serializer refusing exactly
the unrepresentable loads.

`LinkState` is a union split on `mode`, so only a decode-mode load can carry a
Target (an encode load with a stale Target does not type-check).

## Amendment 2026-10-17: opening a link (RBAR-50 slice 2)

Built as decided above; these are the details settled during the build.

- **Where.** `<rack-app>` reads the fragment first thing in `connectedCallback`, parses
  it against the recipient's persisted Primary unit (`persistedPrimaryUnit()`, the
  console's own validated read of `rackbar.unit`), and clears it with
  `history.replaceState(null, '', pathname + search)` whether or not it parsed. The
  persisted rig then loads and seeds as on any boot, and a parsed link overrides it: the
  app pushes the rig (Bar, then set, then Collar -- `adoptPlateSet`'s Bar-before-set
  order) without any save, then hands the load to `console.applyLink({ mode, side,
  targetKg?, unit })`. A `hashchange` listener (removed on disconnect) runs the same path
  for a link pasted into an open tab; `replaceState` fires no `hashchange`, so it cannot
  loop. An empty fragment is left alone.
- **Plates win, three ways.** A By Weight link with a Target decodes it. If the linked
  Plates are the solver's primary, that is the screen (status, round-up offer, Recents
  chip highlight all live). If they are the round-up, the round-up is shown, as if the
  recipient had tapped it (its control offers the way back down). If they are neither
  (the solver changed since the link was made, or a hand-edited link), the console falls
  back to the ADR-0005 carry: the linked Plates, their Total in the entry, no live
  decode -- never a status that disagrees with the Plates on the Bar. A By Weight link
  without a Target, and every By Plates link, is that same carry in its mode.
- **Recents.** A By Weight link with a Target pushes the Target through the normal
  `rememberTarget` path (also in the drift fallback: it is the sender's Target).
  Nothing else is pushed on open; a By Plates link remembers nothing until the
  recipient shares, as today.
- **Unit.** The link's unit is applied for the view and not persisted. The Target
  travels as kg at 2 dp. With a `d` reading, the entry shows `d` as is and the console
  solves from `draftToKg(d, u)`; without one, the entry shows the readout of `t` and
  solves from `t`. See "The Target reading `d`" below for why `t` alone is not enough.
- **A Bar tap after a cross-set link saves the set too.** "A later change persists that
  one key" holds for the Collar, the unit and the set; but a Bar only exists within its
  set (ADR-0010), so saving the Bar alone under a different saved set would be rejected
  on the next boot and silently replaced by that set's default. Picking a Bar therefore
  also saves the on-screen set when it differs from the saved one (review finding,
  2026-10-17).
- **Malformed links** are a silent normal boot: nothing applied, nothing written, no
  console output, the fragment cleared.

Property-tested in `elements/link.properties.test.ts`: opening any link over any
persisted rig shows exactly its Side, Bar, Collar, unit and mode (Setup included) and
changes no rig key; a By Weight link built
from a sender's screen opens to the same Total, Target and status.

**Slice 3 (Copy link, 2026-10-17)** adds the sending side; see the ADR-0011 amendment
of the same date. The round trip is property-tested end to end in
`elements/link.properties.test.ts`: from any sender screen (a typed Target, the
round-up, a unit switch after typing, x.5 lb readings, Plates tapped on, or a carry
across a mode switch), Copy link's URL boots a fresh app showing the same rig, mode,
unit, Plates, Total, Target and status.

### The Target reading `d` (slice 3, 2026-10-17): an additive v1 key

**Why.** The console solves the window of the *displayed* Target: `displayCeilingKg`
rounds the Target to its reading (whole lb, or kg at 2 dp) and solves at or under the
top of that reading (ADR-0003, ADR-0010). The Target's 2 dp kg does not always recover
that reading in lb. A typed 52.5 lb is 23.8136 kg and reads 53. Its 2 dp kg, 23.81,
reads 52. So a recipient solving from `t` worked in a lower window. The review of
PR #111 measured 91 of 210 x.5 lb Targets opening to another status, or to a carry
with no Target. Going the other way, recovering a 1 dp lb text from `t` broke a kg
Target shown in lb: 100 kg reads 220, but its 1 dp lb is 220.5.

**Decision.** The sender's link also carries `d`, the text the sender's Target field
shows, in `u`. The recipient shows `d` and solves from `draftToKg(d, u)`. That
reproduces the reading and, from it, the window, the Plates and the status, whatever
set the Target: typed in either unit at up to 2 dp, a kg Target shown in lb (whole), or
a Recent chip. `t` stays the canonical kg Target, and it is what Recents remember.
`readingFits` checks that `d` fits `t` in both directions, so a hand-edited `d` cannot
open a load far from its Target.

**Format.** `d` is additive: written after `t`, ignored by a client that predates it
(unknown keys are ignored), and optional for this one. No link from before `d` exists in
the wild (slice 3 is the first sender), and a `d`-less link still opens: the readout of
`t`, solved from `t`. `v` stays `1`.

**Remaining limit.** A link without `d` (hand-written, or from a client older than
slice 3, of which there are none) can still re-solve a different window for an lb
Target near a half-pound boundary. That is the old behaviour, and the Plates still win
through the drift carry.

**Over the cap.** The entry takes Targets over MAX_TARGET_KG (1000 kg). Those load a
full Sleeve, but the link cannot carry the Target, so the card shows its disabled "No
link" state. It does not send a link without `t`, which would open to a carry with no
status. Raising the cap or capping the entry is an open question for Caitlin.


## Amendment 2026-10-17: sharing from Warm up (RBAR-78)

**The rule.** A link describes exactly what the share card shows: the same set, Bar,
Collar, Plates and Total. Before this, a Warm up share broke it twice. The link always
sent the rig's Collar, but the card draws none on the bare-Bar Ramp row (ADR-0015 Q5),
so a card reading 20 kg opened to 25 kg. And entering Warm up clears the By Weight
decode, so the link went out as By Weight with no Target.

**Decision.** A Warm up share opens in By Weight on the selected row's load. The link
carries the row's Collar as the card draws it (`c=0` on the bare-Bar row, the rig's
Collar on every other row), its Plates, and its Total as the Target `t`, with the
readout of that Total as `d`. The recipient opens By Weight under the usual "Plates win"
rule: the row's Plates with a live decode when they are a way to that Total, else the
carry. The carry is common, not an edge case: a Ramp stack is often not one of the
solver's ways to its Total (a carried-over Plate, a big Plate outside a lighter one),
and the review tallied about 1 Warm up share in 7 opening as a carry with no status
line. Either way they see the card's Total, Plates and Collars. The Target joins
Recents, as with any By Weight link. This is the simplest correct behaviour. A link
that opens the whole Ramp in Warm up is RBAR-93.

**Plate order.** The link carries a Side heaviest-first; that is its one order, and the
parser re-sorts. A Warm-up stack can put a big Plate outside a lighter one (ADR-0015 as
amended), and such a Side used to fail `serializeLink`, so its card showed "No link".
The console now restacks the Side heaviest-first before it builds the link. The same
Plates and the same Total travel, and the recipient's By Weight screen shows them as a
heaviest-first stack. The restack matches each Plate to the set's own Inventory entry
by value (face and kg), not identity: a Plates on Hand limit (RBAR-72, ADR-0016) loads
a `withLimits` copy of its size, and an identity match dropped those, so any limit on a
size on the Bar used to give "No link" in By Weight as well as Warm up (review finding,
2026-10-17). Only a Plate the set does not have (not expected) is left out of the
restack; then the Side goes as is and the serializer refuses it.

Property-tested in `elements/link.properties.test.ts`: sharing from any Ramp row on any
rig opens By Weight on the same set and Bar, the card's Collar (none on the bare-Bar
row), the same Plates and the same Total, with the row's Total as the Target (in the
URL, the field and Recents), and the recipient's own card reads the same Total and
caption as the sender's. A second property shares from By Weight and Warm up under
random Plates on Hand limits and checks the link exists and opens to the same Plates,
Total and Collars.

## Amendment 2026-10-17: an opened link sets the lifter's Target (RBAR-87)

RBAR-87 gives the console one stored Target, `rackbar.target`, shared by By Weight and
Warm up (ADR-0015 as amended). Opening a link now writes that key. "The link applies
transiently" above still holds for the rig: the linked set, Bar, Collar and unit write
no `rackbar.*` key. The load half is different. A By Weight link's Target becomes the
lifter's stored Target, as its Recents chip already does, so a reload opens on it. That
reload is on the lifter's own rig. A drifted link (the Plates win, no live decode) stores
its Plates' Total, the bare-Bar Total included. A By Plates link stores nothing on
opening. Its load is a built load, so leaving By Plates makes its Total the Target, even
when it matches the Side the visit began with.

Whether opening a friend's link should replace the saved working weight is open with
Caitlin. This records the behaviour as built.
