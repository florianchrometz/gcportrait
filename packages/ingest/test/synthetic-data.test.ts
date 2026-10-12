// SPDX-License-Identifier: MIT
/**
 * No real organisation data (agents.md rule 6, skill cai-ingestion §7): every fixture, the generated synthetic
 * export behind the budget test, and the package's own source and test files pass the one "synthetic only"
 * guard of `@gcportrait/model/testing` (example.com / example.org addresses, platform hosts, organisation
 * 30000000001, folder and project numbers below 100000000000, `demo-…` project ids, private and documentation
 * address ranges). The guard's own tests live with it in packages/model.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { findNonSyntheticData, formatSyntheticFindings } from '@gcportrait/model/testing';
import { describe, expect, it } from 'vitest';
import { syntheticExport } from './synthetic-org.js';

function findings(text: string): string[] {
  return formatSyntheticFindings(findNonSyntheticData(text));
}

describe('synthetic data only', () => {
  const directory = new URL('../fixtures/', import.meta.url);
  const files = readdirSync(directory).filter((file) => file.endsWith('.ndjson'));

  it('finds the fixtures', () => {
    expect(files.length).toBeGreaterThanOrEqual(9);
  });

  it.each(files)('fixtures/%s', (file) => {
    expect(findings(readFileSync(new URL(file, directory), 'utf8'))).toEqual([]);
  });

  // About 3 s on an idle machine and over 6 s under parallel load, so it gets its own timeout. Keep the
  // 10 000 assets: a value that only grows with the count would slip past a smaller export.
  it(
    'the generated export (10 000 assets: every asset kind, thousands of times)',
    { timeout: 30_000 },
    () => {
      expect(findings(syntheticExport(10_000))).toEqual([]);
    },
  );

  it('the source and test files', () => {
    const roots = [new URL('../src/', import.meta.url), new URL('./', import.meta.url)];
    for (const root of roots) {
      for (const file of readdirSync(root, { recursive: true, encoding: 'utf8' })) {
        if (!file.endsWith('.ts')) continue;
        expect([file, findings(readFileSync(new URL(file, root), 'utf8'))]).toEqual([file, []]);
      }
    }
  });

  it('runs a guard that bites', () => {
    // Assembled from parts so that this file passes its own check.
    const real = ['projects', ['1234', '5678', '9012'].join('')].join('/');
    expect(findings(`{"parent":"${real}"}`)).toEqual([`line 1: project-number ${real}`]);
  });
});
