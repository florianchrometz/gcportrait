// SPDX-License-Identifier: MIT
/**
 * The coverage gate: every package whose vitest.config.ts sets coverage thresholds is run by the root
 * `test:coverage` script, and CI runs that script in a blocking leg, so a threshold never holds only when
 * someone runs it by hand (docs/contributing.md, "Fixing a failing step").
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');

function read(file: string): string {
  return readFileSync(path.join(root, file), 'utf8');
}

/** The workspace names of the packages whose own Vitest config declares coverage thresholds. */
function packagesWithThresholds(): string[] {
  return readdirSync(path.join(root, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => {
      try {
        return /\bthresholds\s*:/.test(read(`packages/${entry.name}/vitest.config.ts`));
      } catch {
        return false;
      }
    })
    .map((entry) => (JSON.parse(read(`packages/${entry.name}/package.json`)) as { name: string }).name)
    .sort();
}

describe('the coverage gate', () => {
  const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts;
  const script = scripts['test:coverage'] ?? '';

  it('finds the packages that declare thresholds', () => {
    expect(packagesWithThresholds()).toEqual([
      '@gcportrait/graph',
      '@gcportrait/ingest',
      '@gcportrait/layout',
      '@gcportrait/model',
    ]);
  });

  it('runs every package with thresholds under --coverage in test:coverage', () => {
    const filtered = [...script.matchAll(/--filter\s+(\S+)/g)].map((match) => match[1]).sort();
    expect(filtered).toEqual(packagesWithThresholds());
    expect(script).toMatch(/\bvitest run --coverage\b/);
  });

  it('runs test:coverage in a leg of the blocking unit job of CI', () => {
    const workflow = read('.github/workflows/pr.yml');
    const unitJob = /\n {2}unit:\n([\s\S]*?)\n {2}\S/.exec(workflow)?.[1] ?? '';
    expect(unitJob).toMatch(/- leg: coverage\n/);
    expect(unitJob).toMatch(/run: pnpm run test:coverage\n/);
    const required = /\n {2}required:\n([\s\S]*?)\n {4}runs-on:/.exec(workflow)?.[1] ?? '';
    expect(required).toMatch(/\n {6}- unit\n/);
  });
});
