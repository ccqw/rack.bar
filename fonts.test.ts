import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

// RBAR-23: the handoff sets the whole UI in two self-hosted typefaces -- Hanken
// Grotesk (--rack-font: UI text + number readouts) and JetBrains Mono
// (--rack-font-num: labels, plate numerals, unit toggles). These assert the
// asset + token wiring so a revert to the system stack, a dropped @font-face, a
// missing woff2, or a lost FOIT guard fails the suite. Conforms to ADR-0001
// (tokens.css is the single source of design truth).

const root = import.meta.dirname;
const tokens = readFileSync(resolve(root, 'tokens.css'), 'utf8');
const indexHtml = readFileSync(resolve(root, 'index.html'), 'utf8');

describe('font tokens (tokens.css)', () => {
  it('points --rack-font at Hanken Grotesk', () => {
    const line = tokens.match(/--rack-font:\s*([^;]+);/)?.[1] ?? '';
    expect(line).toContain('Hanken Grotesk');
    // keeps a system fallback so text renders before/without the woff2
    expect(line).toMatch(/system-ui|sans-serif/);
  });

  it('points --rack-font-num at JetBrains Mono with a monospace fallback', () => {
    const line = tokens.match(/--rack-font-num:\s*([^;]+);/)?.[1] ?? '';
    expect(line).toContain('JetBrains Mono');
    expect(line).toContain('monospace');
  });

  it('declares an @font-face for each family that loads the self-hosted woff2', () => {
    for (const family of ['Hanken Grotesk', 'JetBrains Mono']) {
      const face = tokens.match(
        new RegExp(`@font-face\\s*\\{[^}]*?${family}[^}]*?\\}`, 's'),
      )?.[0];
      expect(face, `@font-face for ${family}`).toBeTruthy();
      expect(face).toMatch(/format\(["']?woff2/);
      // no FOIT: text paints in the fallback, then swaps (handoff AC: no layout shift)
      expect(face).toContain('font-display: swap');
      // variable file covers the whole 400..800 axis the AC requires
      expect(face).toMatch(/font-weight:\s*400\s+800/);
    }
  });
});

describe('self-hosted font files (offline-capable, public/fonts)', () => {
  const files = [
    'public/fonts/hanken-grotesk-latin-var.woff2',
    'public/fonts/jetbrains-mono-latin-var.woff2',
  ];
  for (const rel of files) {
    it(`${rel} exists, is non-trivial, and is real woff2`, () => {
      const buf = readFileSync(resolve(root, rel));
      expect(buf.byteLength).toBeGreaterThan(1024);
      // woff2 magic number: ASCII "wOF2"
      expect(buf.subarray(0, 4).toString('latin1')).toBe('wOF2');
    });

    it(`${rel} is referenced by an @font-face src`, () => {
      const name = rel.replace(/^public/, '');
      expect(tokens).toContain(name);
    });
  }
});

describe('index.html font loading', () => {
  it('preloads both woff2 as fonts with crossorigin (avoid FOIT/layout shift)', () => {
    for (const file of ['hanken-grotesk-latin-var.woff2', 'jetbrains-mono-latin-var.woff2']) {
      const link = indexHtml.match(
        new RegExp(`<link[^>]*${file}[^>]*>`),
      )?.[0];
      expect(link, `preload for ${file}`).toBeTruthy();
      expect(link).toContain('rel="preload"');
      expect(link).toContain('as="font"');
      expect(link).toContain('crossorigin');
    }
  });
});
