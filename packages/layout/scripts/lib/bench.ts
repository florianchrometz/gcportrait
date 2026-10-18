// SPDX-License-Identifier: Apache-2.0
/**
 * The layout's performance harness, shared by `pnpm --filter @gcportrait/layout bench`
 * (scripts/bench.ts) and the budget tests (test/performance.test.ts in-process, test/worker.test.ts through a
 * worker): the cases, the budgets of skill gcp-diagram-layout §7, and the measurements.
 *
 * - **Cases.** S, M and L × the overview, networking and load-balancing lenses at detail `auto` (what the app
 *   opens at 1280×800) and `all` (every zone open; skill §7 exempts only XL from laying out everything), L
 *   overview at `projects` (skill §8's check view, three passes), and XL × the same lenses at `folders`
 *   (skill §7: "XL … collapsed defaults"; `auto` picks `folders` for XL too).
 * - **Through the worker.** A request is timed from `client.layout()` to its promise resolving on the page's
 *   thread: posting (structured clone of the Scene), the memo key, the layout's steps with a yield to the host
 *   between each, its progress messages, and the clone of the Layout back. The worker measures with its memo
 *   off, so every run lays out; its clock gives the layout's own time (`report.timings.total`) as well.
 * - **Medians** of `runs` (10) after `warmUp` (3) runs.
 * - **The budget tests' measurement and overload handling** use `measureBatches`, `measureRuns` and
 *   `skipIfOverloaded` from `@gcportrait/model/testing` (packages/model/README.md, "Testing export").
 */
import { cpus, loadavg } from 'node:os';
import { performance } from 'node:perf_hooks';
import type { DetailLevel, LensId, Scene } from '@gcportrait/model';
import { BATCHES, measureRuns, type BudgetPlan } from '@gcportrait/model/testing';
import { layoutScene, type Layout, type StageTimings } from '../../src/index.js';
import type { NodeLayoutWorker } from './node-worker.js';
import type { Fixture } from './scenes.js';

/** The budgets of skill gcp-diagram-layout §7: S < 10 ms, M < 60 ms, L < 400 ms, XL (collapsed) < 2 s. */
export const BUDGET_MS: Readonly<Record<Fixture, number>> = { S: 10, M: 60, L: 400, XL: 2000 };

/**
 * The regression ceiling `pnpm test` asserts (2 × the budget): the parallel test run on a shared CI runner is
 * no place for a wall-clock budget, but an order-of-magnitude slowdown still fails it. The strict budget runs
 * alone in `test:budget` (GCPORTRAIT_LAYOUT_BUDGET=strict).
 */
export const CEILING_FACTOR = 2;

/** Whether the budget tests assert the budget itself (`test:budget`) rather than the 2 × ceiling. */
export function strictBudget(): boolean {
  return process.env['GCPORTRAIT_LAYOUT_BUDGET'] === 'strict';
}

/** What a measurement must stay under: the budget when strict, else the ceiling. */
export function limitOf(fixture: Fixture, strict: boolean): number {
  return strict ? BUDGET_MS[fixture] : CEILING_FACTOR * BUDGET_MS[fixture];
}

export const RUNS = 10;
export const WARM_UP = 3;

export const LENSES: readonly LensId[] = ['overview', 'networking', 'load-balancing'];

/** Whether the run is instrumented for coverage (`LAYOUT_COVERAGE`: vitest.config.ts sets it under `--coverage`). */
export function instrumented(): boolean {
  return process.env['LAYOUT_COVERAGE'] === '1';
}

/**
 * The budget tests' plan: up to `BATCHES` batches of `RUNS` layouts after `WARM_UP` (`measureBatches`
 * measures a case again while its median is over the limit: under `pnpm test` the budget tests start while
 * every other test file runs, and a small layout then reads up to four times its quiet figure); under
 * coverage instrumentation, which slows a layout several times over and under which no time limit is
 * checked, one layout per case, so the coverage run still lays every case out without spending minutes on
 * figures nobody checks. The bench measures once.
 */
export function budgetPlan(): BudgetPlan {
  return instrumented()
    ? { batches: 1, runs: 1, warmUp: 0 }
    : { batches: BATCHES, runs: RUNS, warmUp: WARM_UP };
}

export interface BenchCase {
  readonly fixture: Fixture;
  readonly lens: LensId;
  readonly detail: DetailLevel;
}

/**
 * S, M and L at `auto` and `all`; L overview at `projects` (skill §8's check view, which routes in three
 * passes); XL collapsed (`folders`).
 */
export const BENCH_CASES: readonly BenchCase[] = [
  ...(['S', 'M', 'L'] as const).flatMap((fixture) =>
    LENSES.flatMap((lens) => (['auto', 'all'] as const).map((detail) => ({ fixture, lens, detail }))),
  ),
  { fixture: 'L', lens: 'overview', detail: 'projects' },
  ...LENSES.map((lens) => ({ fixture: 'XL' as const, lens, detail: 'folders' as const })),
];

export function caseName({ fixture, lens, detail }: BenchCase): string {
  return `${fixture} ${lens} ${detail}`;
}

/** The upper median (the middle value of an odd count, the higher middle one of an even count). */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/** What a layout of the case looks like (from its last run). */
export interface CaseShape {
  readonly rects: number;
  readonly edges: number;
  readonly mode: string;
  readonly passes: number;
}

function shapeOf(layout: Layout): CaseShape {
  const { counts, routing } = layout.report;
  return { rects: counts.rects, edges: routing.edges, mode: routing.mode, passes: routing.passes };
}

export interface WorkerFigures extends CaseShape {
  /** Median ms from `client.layout()` to the resolved promise on the page's thread. */
  readonly roundTrip: number;
  /** Median of the layout's own time in the worker (`report.timings.total`, yields included). */
  readonly layout: number;
  readonly runs: readonly number[];
  /**
   * The batch stopped at its deadline before every run was laid out: the medians are those of the runs that
   * were (`runs`), or of the warm-up runs when none was.
   */
  readonly cut: boolean;
}

/**
 * Lays a Scene out `runs` times through the worker (after `warmUp` runs) and takes the medians. With a
 * `deadline` (a `performance.now()` time, as `measureBatches` hands it), no layout starts after the first
 * that would end past it if it took as long as the longest one so far (`measureRuns`): the batch then stops
 * short (`cut`), so that a budget test reports its figures before its timeout fires.
 */
export async function measureInWorker(
  worker: NodeLayoutWorker,
  scene: Scene,
  runs = RUNS,
  warmUp = WARM_UP,
  deadline = Number.POSITIVE_INFINITY,
): Promise<WorkerFigures> {
  const made = await measureRuns(
    () =>
      worker.client.layout(scene).then(({ layout }) => ({
        shape: shapeOf(layout),
        own: layout.report.timings?.total ?? Number.NaN,
      })),
    runs,
    warmUp,
    deadline,
  );
  return {
    ...made.last.shape,
    roundTrip: median(made.counted.map(({ ms }) => ms)),
    layout: median(made.counted.map(({ value }) => value.own)),
    runs: made.runs.map(({ ms }) => ms),
    cut: made.cut,
  };
}

export interface InProcessFigures extends CaseShape {
  /** Median stage timings of `layoutScene` on this thread. */
  readonly timings: StageTimings;
  readonly totals: readonly number[];
  /**
   * The batch stopped at its deadline before every run was laid out: the medians are those of the runs that
   * were (`totals`), or of the warm-up runs when none was.
   */
  readonly cut: boolean;
}

/**
 * Lays a Scene out `runs` times on this thread (after `warmUp` runs) and takes the median stage timings,
 * stopping at a `deadline` as `measureInWorker` does (`measureRuns`).
 */
export async function measureInProcess(
  scene: Scene,
  runs = RUNS,
  warmUp = WARM_UP,
  deadline = Number.POSITIVE_INFINITY,
): Promise<InProcessFigures> {
  const clock = (): number => performance.now();
  const made = await measureRuns(
    () => {
      const layout = layoutScene(scene, { clock });
      const { timings } = layout.report;
      if (timings === undefined) throw new Error('no timings');
      return { shape: shapeOf(layout), timings };
    },
    runs,
    warmUp,
    deadline,
  );
  const of = (stage: keyof StageTimings): number =>
    median(made.counted.map(({ value }) => value.timings[stage]));
  return {
    ...made.last.shape,
    timings: {
      normalise: of('normalise'),
      size: of('size'),
      pack: of('pack'),
      route: of('route'),
      total: of('total'),
    },
    totals: made.runs.map(({ value }) => value.timings.total),
    cut: made.cut,
  };
}

export interface MemoFigures {
  /** Median ms of a memo hit through the client (request to resolved promise). */
  readonly hit: number;
  /** The first (laid out) request's round trip. */
  readonly miss: number;
  /** Every hit returned a Layout byte-identical (JSON) to the first result. */
  readonly identical: boolean;
  readonly hits: number;
}

/** One miss, then `hits` identical requests answered from the memo; the worker must keep its memo on. */
export async function measureMemo(worker: NodeLayoutWorker, scene: Scene, hits = 20): Promise<MemoFigures> {
  let started = performance.now();
  const first = await worker.client.layout(scene);
  const miss = performance.now() - started;
  const expected = JSON.stringify(first.layout);
  const times: number[] = [];
  let identical = !first.cached;
  for (let i = 0; i < hits; i += 1) {
    started = performance.now();
    const again = await worker.client.layout(scene);
    times.push(performance.now() - started);
    identical &&= again.cached && JSON.stringify(again.layout) === expected;
  }
  return { hit: median(times), miss, identical, hits };
}

export interface CancelFigures {
  /** Ms from posting the newer request to its result. */
  readonly latency: number;
  /** The superseded request was rejected as superseded (never resolved). */
  readonly superseded: boolean;
  /** The worker posted no result, and no progress after its `cancelled`, for the superseded request. */
  readonly quiet: boolean;
  /** Progress steps the superseded request had posted before the newer one arrived. */
  readonly stepsBefore: number;
}

/**
 * Starts a long layout, waits for its first routing step, then posts a short one: the long one must be
 * cancelled (its promise rejects, the worker posts nothing more for it) and the short one answered quickly.
 */
export async function measureCancellation(
  worker: NodeLayoutWorker,
  long: Scene,
  short: Scene,
): Promise<CancelFigures> {
  let steps = 0;
  let routing: () => void = () => undefined;
  const routed = new Promise<void>((resolve) => {
    routing = resolve;
  });
  const first = worker.client.layout(long, undefined, {
    onProgress: (progress) => {
      steps += 1;
      if (progress.stage === 'route') routing();
    },
  });
  const outcome = first.then(
    () => 'resolved' as const,
    (error: unknown) =>
      typeof error === 'object' && error !== null && (error as { reason?: unknown }).reason === 'superseded'
        ? ('superseded' as const)
        : ('failed' as const),
  );
  await routed;
  const stepsBefore = steps;
  const started = performance.now();
  const { id } = await worker.client.layout(short);
  const latency = performance.now() - started;
  // Give a late answer for the first request every chance to arrive before looking.
  await worker.client.layout(short);
  const firstId = id - 1;
  const answers = worker.messages.filter((message) => message.id === firstId);
  const cancelledAt = answers.findIndex((message) => message.type === 'cancelled');
  const quiet =
    cancelledAt >= 0 &&
    cancelledAt === answers.length - 1 &&
    !answers.some((message) => message.type === 'result');
  return { latency, superseded: (await outcome) === 'superseded', quiet, stepsBefore };
}

export interface MemoryFigures {
  readonly layouts: number;
  /** Bytes of the worker's heap after a full collection, before and after the layouts. */
  readonly before: number;
  readonly after: number;
}

/** Heap growth (MiB) the memory check tolerates over its layouts: a retained XL Layout is several MiB. */
export const MEMORY_GROWTH_LIMIT_MIB = 16;

/**
 * The worker's heap before and after `layouts` layouts of one Scene, each with its first top-level node labelled
 * a little differently, so each is a memo miss that evicts an older entry (the timeline's scrubbing through days whose
 * Scenes differ does this; days whose Scenes differ only in their read time share one Layout, as the memo
 * key leaves the metadata out). The suffixes are digits of one width, so every layout does the same work. The memo
 * (8) is filled first, so both measurements hold a full memo.
 */
export async function measureMemory(
  worker: NodeLayoutWorker,
  scene: Scene,
  layouts: number,
): Promise<MemoryFigures> {
  const [first, ...rest] = scene.children;
  if (first === undefined) throw new Error('the memory check needs a Scene with a top-level node');
  const at = (i: number): Scene => ({
    ...scene,
    children: [{ ...first, label: `${first.label} ${String(i).padStart(4, '0')}` }, ...rest],
  });
  let n = 0;
  for (let i = 0; i < 10; i += 1, n += 1) await worker.client.layout(at(n));
  const before = await worker.heapUsed();
  for (let i = 0; i < layouts; i += 1, n += 1) {
    const result = await worker.client.layout(at(n));
    if (result.cached) throw new Error('the memory check needs memo misses');
  }
  const after = await worker.heapUsed();
  return { layouts, before, after };
}

export function mib(bytes: number): string {
  return `${(bytes / 2 ** 20).toFixed(1)} MiB`;
}

export function ms(value: number): string {
  return value < 10 ? `${value.toFixed(2)} ms` : `${value.toFixed(1)} ms`;
}

/** The machine the figures come from. */
export function machine(): string {
  const cores = cpus();
  const load = loadavg()
    .map((value) => value.toFixed(1))
    .join(' ');
  return `Node ${process.version} · ${process.platform} ${process.arch} · ${cores[0]?.model ?? 'unknown CPU'} (${String(cores.length)} cores) · load average ${load}`;
}
