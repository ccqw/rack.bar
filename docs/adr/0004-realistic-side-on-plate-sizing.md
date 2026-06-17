# Plates are sized realistically, side-on: same-diameter bumpers, width by weight

The sleeve renders a Side Load the way you see the end of a loaded bar from the
side: each Plate is a disc whose height tracks its real diameter and whose width
tracks its real thickness, colored by the Eleiko scheme, heaviest nearest the
collar. The whole sleeve scales to fit the screen width, so a heavily loaded bar
zooms out rather than overflowing or being scrolled off-screen.

The obvious reading of "bigger plates read as bigger" (PRD story 6) is to scale
each disc by its weight. For real plates that is wrong, and we reject it: the
competition bumpers from 10 to 25 kg are all 450 mm in diameter and differ only in
thickness -- a 25 is the same height as a 10, just fatter. Faking a per-weight
diameter would draw a bar that no lifter could match against the real thing, which
is the entire point of the picture (a glance-test against the physical sleeve). So
within the bumper tier, color is the primary signal and width (thickness) is the
real size cue; diameter only drops for the genuinely smaller plates -- the 5 kg
disc and the change plates -- which really do nest down. "Bigger reads as bigger"
is honored where it is physically true (the small plates) and carried by width
where it is not (the bumpers).

This means the Plate model carries two render dimensions, not one. The existing
`Plate` (kg + color, ADR-0002 reference data) gains a real `diameterMm` and
`widthMm` keyed off its kg. The sleeve element stays purely presentational: given
a Side Load it maps each Plate's real mm to on-screen units under a single scale
factor chosen to fit the current load, and holds no solver logic (ADR-0001).

Reference dimensions (Eleiko, the v1 default Inventory) -- the table the sleeve and
the Plate model build against:

| kg  | color  | diameter mm | thickness mm | tier   |
| --- | ------ | ----------- | ------------ | ------ |
| 25  | red    | 450         | 58           | bumper |
| 20  | blue   | 450         | 50           | bumper |
| 15  | yellow | 450         | 39           | bumper |
| 10  | green  | 450         | 35           | bumper |
| 5   | white  | 228         | 20           | disc   |
| 2.5 | red    | 207 *       | 15           | change |
| 2   | blue   | 193         | 22           | change |
| 1.5 | yellow | 170         | 20           | change |
| 1   | green  | 148         | 19           | change |
| 0.5 | white  | 127         | 16           | change |

\* The 2.5 kg diameter is interpolated between the 2 kg (193 mm) and 5 kg (228 mm)
plates; confirm against the Eleiko 2.5 kg disc spec before treating it as exact.
The precise millimetres are not load-bearing -- the sleeve scales them all under
one fit-to-width factor -- but the ladder is: four identical 450 mm bumpers, then a
real step down through the smaller plates.

The aesthetic execution of this model -- palette, proportions, shadows, motion,
how the bar and collar are drawn -- is the Claude Design pass (RBAR-10), not this
record. This ADR fixes only what physical dimension carries what information, so
the Plate model and the sleeve can be built against a stable answer.
