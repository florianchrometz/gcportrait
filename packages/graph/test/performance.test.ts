// SPDX-License-Identifier: MIT
/**
 * Build-time budget: the M demo organisation builds in under 150 ms (median of 10 builds, after a
 * warm-up). L is measured for information, and so is a day of L's history built after the next day with the
 * builder's memo (the app's timeline step). `pnpm --filter @gcportrait/graph test:budget` runs this file
 * alone and prints the figures; the normal run checks the same budget, without the two L figures (GRAPH_BUDGET=1,
 * which the budget script sets, adds them): the memo's results are the property tests' concern
 * (build.property.test.ts, memo.test.ts), and the L builds took most of the package's run.
 */
import { generateOrganization, historyFor, snapshotAt, toSnapshot } from '@gcportrait/demo-data';
import { GraphBuildSchema, type Catalog, type Snapshot } from '@gcportrait/model';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { buildGraphWithReport } from '../src/build.js';
import { BuildMemo } from '../src/memo.js';
import { REAL_CATALOG } from '../src/testing/fixtures.js';
import { demoSnapshot } from './views/fixtures.js';

const M_BUDGET_MS = 150;
/** The L figures, for information: under `test:budget` only. */
const BUDGET_RUN = process.env['GRAPH_BUDGET'] === '1';
/**
 * A wall-clock budget fails when other processes take the machine's cores (a median of 157 ms has been seen at a
 * load average of 30, against 16-18 ms on a quiet machine): a retry measures again instead of failing the run.
 */
const RETRY = { retry: 2 };

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function measure(
  snapshot: Snapshot,
  catalog: Catalog,
  runs: number,
): { median: number; min: number; max: number } {
  buildGraphWithReport(snapshot, catalog);
  buildGraphWithReport(snapshot, catalog);
  const times: number[] = [];
  for (let run = 0; run < runs; run += 1) {
    const start = performance.now();
    buildGraphWithReport(snapshot, catalog);
    times.push(performance.now() - start);
  }
  return { median: median(times), min: Math.min(...times), max: Math.max(...times) };
}

const format = (ms: number): string => `${ms.toFixed(1)} ms`;

describe('build time', () => {
  it(`builds the M organisation in under ${String(M_BUDGET_MS)} ms (median of 10)`, RETRY, () => {
    const snapshot = demoSnapshot('M');
    const stats = measure(snapshot, REAL_CATALOG, 10);
    console.log(
      `graph build, M (${String(snapshot.assets.length)} assets): median ${format(stats.median)} ` +
        `(min ${format(stats.min)}, max ${format(stats.max)}) with the real catalog`,
    );
    expect(stats.median, `median ${format(stats.median)}`).toBeLessThan(M_BUDGET_MS);
  });

  it.runIf(BUDGET_RUN)('reports the L organisation for information', () => {
    const snapshot = toSnapshot(generateOrganization({ size: 'L' }));
    const stats = measure(snapshot, REAL_CATALOG, 5);
    const build = GraphBuildSchema.parse(buildGraphWithReport(snapshot, REAL_CATALOG));
    console.log(
      `graph build, L (${String(snapshot.assets.length)} assets): median ${format(stats.median)} ` +
        `(min ${format(stats.min)}, max ${format(stats.max)}) over 5 builds; ` +
        `${String(build.graph.edges.length)} edges, ${String(build.graph.dangling.length)} dangling, ` +
        `${String(build.report.sharedVpc.length)} Shared VPC pairs`,
    );
    expect(Object.keys(build.graph.nodes)).toHaveLength(snapshot.assets.length);
  });

  it.runIf(BUDGET_RUN)(
    'reports a day of the L history built after the next day with the builder’s memo, for information',
    () => {
      // As the app's data worker steps back from the history's last day: the days share their unchanged assets.
      const history = historyFor('L');
      const last = { assets: snapshotAt(history, history.ticks.length - 1).assets };
      const before = { assets: snapshotAt(history, history.ticks.length - 2).assets };
      const plain: number[] = [];
      const memoised: number[] = [];
      for (let run = 0; run < 7; run += 1) {
        let start = performance.now();
        buildGraphWithReport(before, REAL_CATALOG);
        plain.push(performance.now() - start);
        const memo = new BuildMemo();
        buildGraphWithReport(last, REAL_CATALOG, { memo });
        start = performance.now();
        buildGraphWithReport(before, REAL_CATALOG, { memo });
        memoised.push(performance.now() - start);
      }
      console.log(
        `graph build, a day of L (${String(before.assets.length)} assets) after the next day: median ` +
          `${format(median(memoised.slice(2)))} with the memo, ${format(median(plain.slice(2)))} without ` +
          '(5 builds each, after 2)',
      );
      const memo = new BuildMemo();
      buildGraphWithReport(last, REAL_CATALOG, { memo });
      expect(buildGraphWithReport(before, REAL_CATALOG, { memo })).toEqual(
        buildGraphWithReport(before, REAL_CATALOG),
      );
    },
  );
});
