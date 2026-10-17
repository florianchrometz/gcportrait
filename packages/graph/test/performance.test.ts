// SPDX-License-Identifier: MIT
/**
 * Build-time budget: the M demo organisation builds in under 150 ms, the median of 10 builds after two
 * warm-up builds. L is measured for information, and so is a day of L's history built after the next day with
 * the builder's memo (the app's timeline step).
 *
 * Two limits, as in `@gcportrait/ingest` and `@gcportrait/layout`: `pnpm test` runs this file in parallel with
 * every other test file, on CI on a shared runner, and asserts a regression ceiling of 2 × the budget;
 * `pnpm --filter @gcportrait/graph test:budget` (GCPORTRAIT_GRAPH_BUDGET=strict) runs this file alone, asserts
 * the budget itself whatever the load and adds the two L figures (the memo's results are the property tests'
 * concern, build.property.test.ts and memo.test.ts, and the L builds would take most of the package's run).
 * Both measure by the rule of `@gcportrait/model/testing` that every package timing its work applies: a batch
 * whose median is over the limit is measured again after a pause, at most `BATCHES` times and only while
 * another batch fits in the test's timeout, and the best batch's median counts (`measureBatches`); a batch
 * that would run past 95 % of the timeout stops there and counts as a miss (`measureRuns`), so that a build on
 * a machine getting busier reports its figures instead of timing out; under a local `pnpm test`, never on CI
 * (where the ceiling is the check that blocks) and never strictly, a case still over its ceiling while the
 * machine's load average is above 1.5 per core is skipped with the load and the figures as its reason
 * (`skipIfOverloaded`). Every batch's median is printed (`--silent=false`).
 */
import { generateOrganization, historyFor, snapshotAt, toSnapshot } from '@gcportrait/demo-data';
import { GraphBuildSchema, type Catalog, type Snapshot } from '@gcportrait/model';
import { BATCHES, cutNote, measureBatches, measureRuns, skipIfOverloaded } from '@gcportrait/model/testing';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { buildGraphWithReport } from '../src/build.js';
import { BuildMemo } from '../src/memo.js';
import { REAL_CATALOG } from '../src/testing/fixtures.js';
import { demoSnapshot } from './views/fixtures.js';

const M_BUDGET_MS = 150;
const STRICT = process.env['GCPORTRAIT_GRAPH_BUDGET'] === 'strict';
/** What the best batch's median must stay under: the budget itself when strict, else a regression ceiling. */
const LIMIT_MS = STRICT ? M_BUDGET_MS : 2 * M_BUDGET_MS;
/** Batches of 10 builds, the first after two warm-up builds. */
const PLAN = { batches: BATCHES, runs: 10, warmUp: 2 };

interface Stats {
  readonly median: number;
  readonly min: number;
  readonly max: number;
  /** The timed builds made. */
  readonly runs: number;
  /**
   * The batch stopped at its deadline before every build was made (`measureRuns`): the figures are those of
   * the builds that were, or of the warm-up builds when none was.
   */
  readonly cut: boolean;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

/**
 * `warmUp` builds, then `runs` timed ones; with a `deadline` (a `performance.now()` time, as `measureBatches`
 * hands it), no build starts after the first that would end past it if it took as long as the longest so far
 * (`measureRuns`), so that the test reports its figures before its timeout fires.
 */
async function measure(
  snapshot: Snapshot,
  catalog: Catalog,
  runs: number,
  warmUp: number,
  deadline?: number,
): Promise<Stats> {
  const made = await measureRuns(
    () => {
      buildGraphWithReport(snapshot, catalog);
    },
    runs,
    warmUp,
    deadline,
  );
  const times = made.counted.map(({ ms }) => ms);
  return {
    median: median(times),
    min: Math.min(...times),
    max: Math.max(...times),
    runs: made.runs.length,
    cut: made.cut,
  };
}

const format = (ms: number): string => `${ms.toFixed(1)} ms`;

describe('build time', () => {
  it(`builds the M organisation in under ${String(LIMIT_MS)} ms (median of 10, ${STRICT ? 'strict budget' : '2 × budget'})`, async ({
    skip,
    task,
  }) => {
    const started = performance.now();
    const snapshot = demoSnapshot('M');
    const { best, medians, outOfTime } = await measureBatches(
      (runs, warmUp, deadline) => measure(snapshot, REAL_CATALOG, runs, warmUp, deadline),
      (stats) => stats.median,
      {
        plan: PLAN,
        limit: LIMIT_MS,
        timeoutMs: task.timeout - (performance.now() - started),
        laterWarmUp: 0,
      },
    );
    const short = cutNote({ cut: best.cut, made: best.runs, planned: PLAN.runs });
    console.log(
      `graph build, M (${String(snapshot.assets.length)} assets): median ${format(best.median)} ` +
        `(min ${format(best.min)}, max ${format(best.max)}) with the real catalog · budget ${String(M_BUDGET_MS)} ms, asserted < ${String(LIMIT_MS)} ms` +
        (medians.length > 1 ? ` · batch medians ${medians.map((ms) => ms.toFixed(1)).join(', ')}` : '') +
        (outOfTime ? ' · no further batch fits in the timeout' : '') +
        short,
    );
    const figures = `median ${format(best.median)} of batch medians ${medians.map((ms) => ms.toFixed(1)).join(', ')} ms${short}`;
    skipIfOverloaded({
      value: best.median,
      limit: LIMIT_MS,
      cut: best.cut,
      strict: STRICT,
      what: `the M graph build over its ${String(LIMIT_MS)} ms ceiling`,
      figures,
      skip,
    });
    expect(best.cut, `no whole batch within the test's timeout (${figures})`).toBe(false);
    expect(best.median, `median ${format(best.median)}`).toBeLessThan(LIMIT_MS);
  });

  it('stops a batch at its deadline after the first build, and says it was cut short', async () => {
    const snapshot = demoSnapshot('S');
    const whole = await measure(snapshot, REAL_CATALOG, 3, 1, performance.now() + 60_000);
    expect(whole).toMatchObject({ runs: 3, cut: false });
    // A deadline already past: the first build (a warm-up) runs, and no other; its time is the figure.
    const cut = await measure(snapshot, REAL_CATALOG, 3, 1, performance.now());
    expect(cut).toMatchObject({ runs: 0, cut: true });
    expect(cut.median).toBeGreaterThan(0);
    expect(cut.min).toBe(cut.max);
  });

  it.runIf(STRICT)('reports the L organisation for information', async () => {
    const snapshot = toSnapshot(generateOrganization({ size: 'L' }));
    const stats = await measure(snapshot, REAL_CATALOG, 5, 2);
    const build = GraphBuildSchema.parse(buildGraphWithReport(snapshot, REAL_CATALOG));
    console.log(
      `graph build, L (${String(snapshot.assets.length)} assets): median ${format(stats.median)} ` +
        `(min ${format(stats.min)}, max ${format(stats.max)}) over 5 builds; ` +
        `${String(build.graph.edges.length)} edges, ${String(build.graph.dangling.length)} dangling, ` +
        `${String(build.report.sharedVpc.length)} Shared VPC pairs`,
    );
    expect(Object.keys(build.graph.nodes)).toHaveLength(snapshot.assets.length);
  });

  it.runIf(STRICT)(
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
