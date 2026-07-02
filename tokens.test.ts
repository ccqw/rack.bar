import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// RBAR-26: tokens.css predates the authoritative Claude Design handoff
// (docs/design-handoff/README.md "Design tokens") and diverged from its exact
// palette while collapsing the named surface/border/text ramp into single
// --rack-line / --rack-muted stand-ins. These assert the reconcile: every token
// with a handoff counterpart matches the README hex 1:1, the full tier scale
// exists so the visual slices can reference the right layer, and the legacy
// collapsed names survive only as thin var() aliases onto that scale (so the
// 48 existing call sites inherit the corrected palette without churn).
// Conforms to ADR-0001 (tokens.css is the single source of design truth).

const root = import.meta.dirname;
const tokens = readFileSync(resolve(root, 'tokens.css'), 'utf8');
const indexHtml = readFileSync(resolve(root, 'index.html'), 'utf8');

// Read a declared custom property's value. The trailing `:` in the pattern means
// `--rack-text:` never matches `--rack-text-secondary:` etc.
function val(name: string): string {
  return tokens.match(new RegExp(`${name}:\\s*([^;]+);`))?.[1]?.trim() ?? '';
}
const squash = (s: string) => s.replace(/\s+/g, '');

describe('handoff palette is reconciled 1:1 (tokens.css)', () => {
  // name -> exact handoff README hex / value
  const exact: Record<string, string> = {
    // Brand
    '--rack-accent': '#f5c518',
    '--rack-accent-ink': '#0d0e10',
    // Surfaces (deepest -> most raised)
    '--rack-surface': '#0d0e10',
    '--rack-sunken': '#101216',
    '--rack-raised': '#15171a',
    '--rack-overlay': '#16191d',
    '--rack-active': '#1b1f24',
    '--rack-selected': '#272b30',
    // Borders
    '--rack-border': '#20242a',
    '--rack-border-strong': '#23272c',
    '--rack-border-muted': '#2a2f35',
    '--rack-border-active': '#3a4047',
    '--rack-divider': '#1b1e22',
    // Text (on dark)
    '--rack-text': '#f4f4f5',
    '--rack-text-secondary': '#aab0b7',
    '--rack-text-muted': '#9aa1a9',
    '--rack-text-dim': '#8b929a',
    '--rack-text-disabled': '#41464c',
    // Semantic
    '--rack-danger': '#e0263a',
    '--rack-success': '#4caf6a',
    // Shell (light device wallpaper)
    '--rack-page-bg': '#e7e5df',
    '--rack-page-ink': '#15181c',
    '--rack-page-faint': '#9b958b',
    // Plate palette (domain data)
    '--rack-plate-red': '#e0263a',
    '--rack-plate-blue': '#2563c9',
    '--rack-plate-yellow': '#f5c518',
    '--rack-plate-green': '#25a45a',
    '--rack-plate-white': '#eef0f2',
    '--rack-plate-iron': '#34383e',
    // Setup plate-row swatch greys (RBAR-29, prototype PLATESETS training cols)
    '--rack-swatch-iron': '#3a3f45',
    '--rack-swatch-iron-deep': '#2c3036',
    // Radii
    '--rack-radius-pill': '999px',
    '--rack-radius-card': '14px',
    '--rack-radius-sheet-control': '13px',
    '--rack-radius-tile': '11px',
  };
  for (const [name, want] of Object.entries(exact)) {
    it(`${name} === ${want}`, () => {
      expect(val(name).toLowerCase()).toBe(want.toLowerCase());
    });
  }
});

describe('the full tier scale exists (no single token standing in for a ramp)', () => {
  it('exposes all six surface tiers', () => {
    for (const t of ['surface', 'sunken', 'raised', 'overlay', 'active', 'selected']) {
      expect(val(`--rack-${t}`), `--rack-${t}`).not.toBe('');
    }
  });
  it('exposes all five border tiers', () => {
    for (const t of ['border', 'border-strong', 'border-muted', 'border-active', 'divider']) {
      expect(val(`--rack-${t}`), `--rack-${t}`).not.toBe('');
    }
  });
  it('exposes all five text tiers', () => {
    for (const t of ['text', 'text-secondary', 'text-muted', 'text-dim', 'text-disabled']) {
      expect(val(`--rack-${t}`), `--rack-${t}`).not.toBe('');
    }
  });
});

describe('legacy collapsed names survive only as aliases onto the scale', () => {
  // The 48 pre-existing call sites keep working but now resolve to handoff hex
  // through the scale; the visual slices re-point each surface to its real tier.
  const aliases: Record<string, string> = {
    '--rack-bg': 'var(--rack-surface)',
    '--rack-fg': 'var(--rack-text)',
    '--rack-muted': 'var(--rack-text-dim)',
    '--rack-line': 'var(--rack-border)',
    // RBAR-34: line-strong meant "prominent border" (#23272c border-strong) at
    // every call site, not the border-active selected-ring it aliased. All call
    // sites now reference their explicit tier; the alias stays corrected here
    // until the legacy block retires.
    '--rack-line-strong': 'var(--rack-border-strong)',
    '--rack-radius': 'var(--rack-radius-card)',
  };
  for (const [name, want] of Object.entries(aliases)) {
    it(`${name} aliases ${want}`, () => {
      expect(squash(val(name))).toBe(squash(want));
    });
  }
});

describe('RBAR-34: prototype-inline hexes are captured as tokens', () => {
  // These three live inline in docs/design-handoff/rack.bar.dc.html only (the
  // README --rb-* list never named them), so the RBAR-26 reconcile missed them.
  const captured: Record<string, string> = {
    '--rack-popover-border': '#262b31',      // prototype L84
    '--rack-popover-ink': '#c2c7cd',         // prototype L86-87 (body tier; strong stays --rack-text)
    '--rack-sleeve-empty-glyph': '#3f454c',  // prototype L106 (the empty-box + glyph)
  };
  for (const [name, want] of Object.entries(captured)) {
    it(`${name} === ${want}`, () => {
      expect(val(name).toLowerCase()).toBe(want.toLowerCase());
    });
  }
});

describe('scrims and shadows are tokenised at the handoff values', () => {
  it('setup scrim is the .55 dim, share modal scrim the .72', () => {
    expect(squash(val('--rack-scrim'))).toBe(squash('rgba(5, 6, 7, 0.55)'));
    expect(squash(val('--rack-scrim-modal'))).toBe(squash('rgba(5, 6, 7, 0.72)'));
  });
  it('carries the disc / sheet / modal shadow recipes', () => {
    expect(squash(val('--rack-shadow-disc'))).toContain(squash('inset 0 0 0 1px rgba(255,255,255,.1)'));
    expect(squash(val('--rack-shadow-disc'))).toContain(squash('0 2px 6px rgba(0,0,0,.25)'));
    expect(squash(val('--rack-shadow-sheet'))).toBe(squash('0 -18px 44px -18px rgba(0,0,0,.7)'));
    expect(squash(val('--rack-shadow-modal'))).toBe(squash('0 30px 60px -20px rgba(0,0,0,.7)'));
  });
  it('documents the top-lit disc-fill gradient recipe for the bar renderer', () => {
    // RBAR-24 consumes this; captured here as the disc-fill convention.
    expect(squash(tokens)).toContain(squash('linear-gradient(180deg, color-mix(in srgb,'));
  });
});

describe('the browser chrome follows the new surface', () => {
  it('theme-color meta matches the handoff surface', () => {
    const meta = indexHtml.match(/<meta name="theme-color"[^>]*content="([^"]+)"/)?.[1];
    expect(meta?.toLowerCase()).toBe('#0d0e10');
  });
});
