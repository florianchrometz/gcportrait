// SPDX-License-Identifier: MIT
/**
 * `pnpm --filter @gcportrait/layout metrics`: regenerates `metrics/roboto.json`, the per-code-point advance
 * widths of Roboto 400/500/700 and Roboto Mono 400 that the layout measures text with (skill
 * gcp-diagram-layout §3). Read from the font files the frontend self-hosts; run it after upgrading
 * `@fontsource/roboto` or `@fontsource/roboto-mono` (the staleness test in test/metrics.test.ts fails until
 * you do), and commit the result.
 *
 *   pnpm --filter @gcportrait/layout metrics           write metrics/roboto.json
 *   pnpm --filter @gcportrait/layout metrics --check   exit 1 if the committed file is stale
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT, METRICS_PATH, buildMetricsTable, formatMetricsTable } from './lib/fonts.js';

export async function run(argv: readonly string[]): Promise<number> {
  const check = argv.includes('--check');
  const table = buildMetricsTable();
  const text = await formatMetricsTable(table);
  const relative = path.relative(REPO_ROOT, METRICS_PATH);
  const faces = Object.entries(table.faces)
    .map(([key, face]) => `${key} ${String(face.runs.reduce((n, run) => n + run.length - 1, 0))} code points`)
    .join(', ');
  process.stdout.write('gcportrait layout metrics\n');
  if (check) {
    let committed: string;
    try {
      committed = readFileSync(METRICS_PATH, 'utf8');
    } catch {
      committed = '';
    }
    if (committed !== text) {
      process.stdout.write(`${relative} is stale: run pnpm --filter @gcportrait/layout metrics\n`);
      return 1;
    }
    process.stdout.write(`${relative} is up to date (${faces}).\n`);
    return 0;
  }
  writeFileSync(METRICS_PATH, text);
  process.stdout.write(`wrote ${relative}: ${faces}; sources ${JSON.stringify(table.sources)}\n`);
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await run(process.argv.slice(2));
}
