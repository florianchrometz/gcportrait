// SPDX-License-Identifier: MIT
/**
 * The committed metrics table is what the generator builds from the installed font files today (staleness) and
 * names the font package versions it came from. That the file is byte for byte what the generator writes is
 * `pnpm --filter @gcportrait/layout metrics --check` (scripts/generate-metrics.test.ts); the generator's font
 * helpers are scripts/lib/fonts.test.ts.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultFontMetrics } from '../src/index.js';
import { METRICS_PATH, buildMetricsTable, fontPackageDir } from '../scripts/lib/fonts.js';

describe('metrics/roboto.json', () => {
  const table = buildMetricsTable();

  it('is up to date with the installed Roboto and Roboto Mono font files', () => {
    expect(JSON.parse(readFileSync(METRICS_PATH, 'utf8'))).toEqual(table);
    expect(defaultFontMetrics()).toEqual(table);
  });

  it('names the font package versions it was generated from', () => {
    for (const pkg of ['@fontsource/roboto', '@fontsource/roboto-mono']) {
      const json = JSON.parse(readFileSync(path.join(fontPackageDir(pkg), 'package.json'), 'utf8')) as {
        version: string;
      };
      expect(table.sources[pkg]).toBe(json.version);
    }
  });
});
