// Guard for the Vitest project split (RBAR-90): every test file in the repo runs in
// exactly one project. A narrower glob would otherwise drop a new test file silently --
// `npm test` stays green while a failing test sits unrun.
import { describe, it, expect } from 'vitest';
import { globSync, readdirSync } from 'node:fs';
import { join, matchesGlob, relative } from 'node:path';
import config from '../vite.config.ts';

const root = join(import.meta.dirname, '..');
// Never collected: dependencies, git, agent worktrees, the build, and the design
// handoff (its prototype test is excluded on purpose, see vite.config.ts).
const SKIP = new Set(['node_modules', '.git', '.claude', 'dist', 'docs']);
const TEST_NAME = /\.(test|spec)\.(c|m)?[jt]sx?$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (TEST_NAME.test(e.name)) out.push(relative(root, p));
  }
  return out;
}

type Project = { test: { name: string; include: string[]; exclude?: string[] } };
const projects = (config as { test: { projects: Project[] } }).test.projects;

function collected(p: Project): Set<string> {
  const files = p.test.include.flatMap((g) =>
    globSync(g, { cwd: root, exclude: (f) => SKIP.has(String(f).split(/[\\/]/).pop()!) }),
  );
  const exclude = p.test.exclude ?? [];
  return new Set(files.filter((f) => !exclude.some((g) => matchesGlob(f, g))));
}

describe('Vitest projects (RBAR-90)', () => {
  it('runs every test file in exactly one project', () => {
    const sets = projects.map(collected);
    const misses = walk(root)
      .map((f) => [f, projects.filter((_, i) => sets[i]!.has(f)).map((p) => p.test.name)] as const)
      .filter(([, in_]) => in_.length !== 1)
      .map(([f, in_]) => `${f}: ${in_.length === 0 ? 'no project' : in_.join(' + ')}`);
    expect(misses).toEqual([]);
  });

  it('keeps lib/ and scripts/ in the core project', () => {
    const core = collected(projects.find((p) => p.test.name === 'core')!);
    expect([...core].filter((f) => !/^(lib|scripts)\//.test(f))).toEqual([]);
    expect(core.has('lib/properties.test.ts')).toBe(true);
  });
});
