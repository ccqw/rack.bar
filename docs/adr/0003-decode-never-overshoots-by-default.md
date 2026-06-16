# Decode never overshoots the Target by default

When a Target is not exactly achievable, Decode's primary suggestion is always the
nearest achievable Total **at or under** the Target — never a heavier bar than the
lifter typed. When a closer Total exists *above* the Target, it is offered as an
explicit opt-in alternative, never auto-selected.

The naive rule is "snap to the genuinely nearest Total," but for a lifting tool an
unannounced heavier bar is the dangerous surprise, so we bias downward on purpose
and make any overshoot a deliberate choice. This asymmetry (closest-below by
default, closest-above on request) is non-obvious from the code alone, hence this
record. Among loadouts reaching the same Total, the canonical pick is the fewest
plates, loaded biggest-first.
