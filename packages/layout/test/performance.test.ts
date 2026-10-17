// SPDX-License-Identifier: MIT
/**
 * Performance budgets in-process (skill gcp-diagram-layout §7), end to end (all
 * stages: normalise, size, pack, gutters, routing with its widening passes): the demo S fixture < 10 ms,
 * M < 60 ms, L < 400 ms. Measured as the median of the layout's own timings over 10 runs after 3 warm-up runs,
 * for the overview, networking and load-balancing lenses at detail `auto` (what the app opens at 1280×800) and
 * at `all` (every zone open: the skill exempts only XL, "collapsed defaults", from laying out everything). The
 * same budgets through a real worker, XL included, are test/worker.test.ts; `pnpm --filter
 * @gcportrait/layout bench` prints both kinds of figure.
 *
 * Two limits (scripts/lib/bench.ts, the split ingest uses): `pnpm test` runs this file in parallel with every
 * other test file, on CI on a shared runner, and asserts a regression ceiling of 2 × the budget;
 * `pnpm --filter @gcportrait/layout test:budget` (GCPORTRAIT_LAYOUT_BUDGET=strict) runs the budget files alone
 * and asserts the budget itself, whatever the load. By the rule of `@gcportrait/model/testing` that every
 * package timing its work applies, a batch whose median is over the limit is measured again after a pause, at
 * most `BATCHES` times and only while another batch fits in the test's timeout, and the best batch's median
 * counts (`measureBatches`); a batch that would run past 95 % of the timeout stops there and counts as a
 * miss (`measureInProcess`'s deadline, `measureRuns`), so that a case on a machine getting busier reports its
 * figures instead of timing out. Locally, never on CI (where this is the budget check that blocks) and never
 * strictly, a case still over its ceiling while the machine's load average is above 1.5 per core is skipped
 * with the load and the figures as its reason (`skipIfOverloaded`). Every batch's median is printed
 * (`--silent=false`). Under coverage each case is laid out once and no limit is checked (`budgetPlan`).
 */
import { performance } from 'node:perf_hooks';
import { cutNote, measureBatches, skipIfOverloaded } from '@gcportrait/model/testing';
import { describe, expect, it } from 'vitest';
import {
  BENCH_CASES,
  BUDGET_MS,
  budgetPlan,
  instrumented,
  limitOf,
  measureInProcess,
  strictBudget,
  type BenchCase,
} from '../scripts/lib/bench.js';
import { demoScene } from '../scripts/lib/scenes.js';

const INSTRUMENTED = instrumented();
const PLAN = budgetPlan();
const STRICT = strictBudget();

const CASES = BENCH_CASES.filter((entry) => entry.fixture !== 'XL');

describe.each(CASES)('demo $fixture, lens $lens, detail $detail', ({ fixture, lens, detail }: BenchCase) => {
  const limit = limitOf(fixture, STRICT);
  it(`lays out and routes in under ${String(limit)} ms (${STRICT ? 'strict budget' : '2 × budget'})`, async ({
    skip,
    task,
  }) => {
    const scene = demoScene(fixture, lens, detail);
    const { best, medians, outOfTime } = await measureBatches(
      (runs, warmUp, deadline) => measureInProcess(scene, runs, warmUp, deadline),
      (figures) => figures.timings.total,
      { plan: PLAN, limit, timeoutMs: task.timeout, laterWarmUp: 0 },
    );
    const { timings } = best;
    const short = cutNote({ cut: best.cut, made: best.totals.length, planned: PLAN.runs });
    console.log(
      `layout ${fixture} ${lens} ${detail}: ${String(best.rects)} rects, ${String(best.edges)} edges (${best.mode}, ${String(best.passes)} pass(es)); median ${timings.total.toFixed(1)} ms ` +
        `(normalise ${timings.normalise.toFixed(1)}, size ${timings.size.toFixed(1)}, pack ${timings.pack.toFixed(1)}, route ${timings.route.toFixed(1)}) · budget ${String(BUDGET_MS[fixture])} ms, asserted < ${String(limit)} ms` +
        (medians.length > 1 ? ` · batch medians ${medians.map((m) => m.toFixed(1)).join(', ')}` : '') +
        (outOfTime ? ' · no further batch fits in the timeout' : '') +
        short,
    );
    if (INSTRUMENTED) return;
    const figures = `median ${timings.total.toFixed(1)} ms${short}`;
    skipIfOverloaded({
      value: timings.total,
      limit,
      cut: best.cut,
      strict: STRICT,
      what: `layout ${fixture} ${lens} ${detail} over its ${String(limit)} ms ceiling`,
      figures,
      skip,
    });
    expect(best.cut, `no whole batch within the test's timeout (${figures})`).toBe(false);
    expect(timings.total).toBeLessThan(limit);
  });
});

describe('a batch at its deadline', () => {
  it('stops after the first layout, and says it was cut short', async () => {
    const scene = demoScene('S', 'overview');
    const whole = await measureInProcess(scene, 3, 1, performance.now() + 60_000);
    expect(whole.cut).toBe(false);
    expect(whole.totals).toHaveLength(3);
    // A deadline already past: the first layout (a warm-up) runs, and no other; its timings are the figures.
    const cut = await measureInProcess(scene, 3, 1, performance.now());
    expect(cut.cut).toBe(true);
    expect(cut.totals).toEqual([]);
    expect(cut.timings.total).toBeGreaterThan(0);
    expect(cut.rects).toBe(whole.rects);
  });
});
