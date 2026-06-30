// numRoll -- the handoff's "display numbers roll up on change" micro-animation
// (RBAR-30, handoff "Animations": numRoll .26s ease-out). A big number readout
// (the Total, the Target entry value) lifts and fades in whenever its value changes.
//
// A CSS animation declared on a persistent element runs once, on mount -- setting
// `.textContent` does NOT restart it. So `rollText` sets the text and, only when the
// rendered string actually changed, restarts the animation by removing the marker class,
// forcing a reflow, and re-adding it. The change guard means a re-render that leaves the
// number untouched (a keystroke that does not move it, a mode flip that lands on the same
// Total) does not re-arm -- a real change still rolls, including across a mode flip.
//
// The keyframe + the `.roll` rule live in each element's own <style> via ROLL_CSS (a
// shadow root scopes its @keyframes), gated behind prefers-reduced-motion. In a non-
// layout test environment (happy-dom) offsetWidth is 0 and the animation never paints,
// but the text still lands -- so the contract under test is unaffected.

/** The marker class ROLL_CSS animates; `rollText` toggles it to restart the roll. */
export const ROLL_CLASS = 'roll';

/**
 * The keyframe + class each element interpolates into its <style> to opt a readout into
 * the roll. Motion-gated: a reduced-motion lifter gets the value with no movement.
 */
export const ROLL_CSS = `
  @keyframes rack-num-roll {
    from { opacity: 0; transform: translateY(.32em); }
    to { opacity: 1; transform: translateY(0); }
  }
  @media (prefers-reduced-motion: no-preference) {
    .${ROLL_CLASS} { animation: rack-num-roll .26s ease-out; }
  }
`;

/**
 * Set `host`'s text and roll it up if (and only if) the text changed. A no-op when the
 * value is unchanged, so callers can fire it on every render without causing flicker.
 */
export function rollText(host: HTMLElement, text: string): void {
  if (host.textContent === text) return;
  host.textContent = text;
  host.classList.remove(ROLL_CLASS);
  void host.offsetWidth; // force reflow so the re-added class restarts the animation
  host.classList.add(ROLL_CLASS);
}
