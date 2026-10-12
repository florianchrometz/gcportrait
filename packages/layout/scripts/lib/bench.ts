// SPDX-License-Identifier: MIT
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
 */
import { cpus, loadavg } from 'node:os';
import { performance } from 'node:perf_hooks';
import type { DetailLevel, LensId, Scene } from '@gcportrait/model';
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

/**
 * The budget tests measure a case again while its median is over the limit, at most `BATCHES` batches of
 * `RUNS` with a `PAUSE_MS` pause between them, and the best batch's median counts: under `pnpm test` they start
 * while every other test file runs and compete with them for the cores (a small layout then reads up to four
 * times its quiet figure). The bench measures once.
 */
export const BATCHES = 5;
export const PAUSE_MS = 250;
export const LENSES: readonly LensId[] = ['overview', 'networking', 'load-balancing'];

/** How a budget test measures one case: `batches` batches of `runs` layouts, the first after `warmUp` more. */
export interface BudgetPlan {
  readonly batches: number;
  readonly runs: number;
  readonly warmUp: number;
}

/** Whether the run is instrumented for coverage (`LAYOUT_COVERAGE`: vitest.config.ts sets it under `--coverage`). */
export function instrumented(): boolean {
  return process.env['LAYOUT_COVERAGE'] === '1';
}

/**
 * The budget tests' plan: up to `BATCHES` batches of `RUNS` after `WARM_UP`; under coverage instrumentation,
 * which slows a layout several times over and under which no time limit is checked, one layout per case, so the
 * coverage run still lays every case out without spending minutes on figures nobody checks.
 */
export function budgetPlan(): BudgetPlan {
  return instrumented()
    ? { batches: 1, runs: 1, warmUp: 0 }
    : { batches: BATCHES, runs: RUNS, warmUp: WARM_UP };
}

/** The share of a budget test's timeout its batches may take (`anotherBatchFits`). */
export const BATCH_TIMEOUT_SHARE = 0.95;

/**
 * Whether another batch of `batchMs` fits, after a `PAUSE_MS` pause, in what is left of a test's timeout once
 * `elapsedMs` have passed. Under heavy load five batches of an L case outlast the timeout, and a timed-out test
 * reports no figure at all.
 */
export function anotherBatchFits(elapsedMs: number, batchMs: number, timeoutMs: number): boolean {
  return elapsedMs + PAUSE_MS + batchMs < BATCH_TIMEOUT_SHARE * timeoutMs;
}

/** What `measureBatches` measured: the best batch, every batch's median, and why it stopped early if it did. */
export interface Batches<F> {
  readonly best: F;
  readonly medians: readonly number[];
  /** Another batch would not have fitted in the test's timeout (`anotherBatchFits`). */
  readonly outOfTime: boolean;
}

/** How `measureBatches` runs: the budget plan, the limit a batch's median stays under, the test's timeout. */
export interface BatchOptions {
  readonly plan: BudgetPlan;
  readonly limit: number;
  readonly timeoutMs: number;
  /** Warm-up layouts before each batch after the first (the first has `plan.warmUp`). */
  readonly laterWarmUp: number;
}

/**
 * Measures a budget case in batches: `measure(runs, warmUp)` once, then again after a `PAUSE_MS` pause while
 * every median so far is over the limit, at most `plan.batches` times, and only while another batch, as long
 * per layout as the last one, fits in the test's timeout. The batch with the lowest median is the best.
 * Stopping early only leaves fewer batches to choose from, so it can fail or skip a case but never pass one
 * that more batches would have failed.
 */
export async function measureBatches<F>(
  measure: (runs: number, warmUp: number) => F | Promise<F>,
  medianOf: (figures: F) => number,
  { plan, limit, timeoutMs, laterWarmUp }: BatchOptions,
): Promise<Batches<F>> {
  const started = performance.now();
  const medians: number[] = [];
  let best: { figures: F; median: number } | undefined;
  let perLayout = 0;
  let outOfTime = false;
  for (let batch = 0; batch < plan.batches; batch += 1) {
    if (batch > 0) {
      const next = perLayout * (plan.runs + laterWarmUp);
      if (!anotherBatchFits(performance.now() - started, next, timeoutMs)) {
        outOfTime = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
    }
    const warmUp = batch === 0 ? plan.warmUp : laterWarmUp;
    const batchStarted = performance.now();
    const figures = await measure(plan.runs, warmUp);
    perLayout = (performance.now() - batchStarted) / Math.max(1, plan.runs + warmUp);
    const value = medianOf(figures);
    medians.push(value);
    if (best === undefined || value < best.median) best = { figures, median: value };
    if (value < limit) break;
  }
  if (best === undefined) throw new Error('a budget plan needs at least one batch');
  return { best: best.figures, medians, outOfTime };
}

/** The one-minute load average per core above which `pnpm test` skips a missed 2 × ceiling (`overloadReason`). */
export const OVERLOAD_PER_CORE = 1.5;

/**
 * Whether the run is on CI (`CI` set and not `false` or `0`, as GitHub Actions sets it). There the 2 × ceiling
 * under `pnpm test` is the budget check that blocks a pull request (the strict `layout-budget` job is
 * `continue-on-error`), so it never skips.
 */
export function onCi(): boolean {
  const value = process.env['CI'];
  return value !== undefined && value !== '' && value !== 'false' && value !== '0';
}

/** What a missed limit is judged against (`overloadReason`); each field defaults to the running machine. */
export interface OverloadContext {
  /** `test:budget` (`strictBudget()`): the budget itself is asserted, whatever the load. */
  readonly strict: boolean;
  /** On CI (`onCi()`): the 2 × ceiling is the blocking budget guard. */
  readonly ci: boolean;
  /** The one-minute load average. */
  readonly load: number;
  readonly cores: number;
}

/**
 * Why a case over its limit is skipped rather than failed, or `undefined` when it must fail. The strict run
 * (`test:budget`) and every run on CI always fail. Under a local `pnpm test` the 2 × ceiling is a regression
 * guard for a machine with cores to spare: when the one-minute load average is above `OVERLOAD_PER_CORE` per
 * core (other suites running beside this one; four times oversubscribed, a small layout reads several times its
 * quiet figure even at its best of five batches), the figure says more about the machine than about the layout.
 */
export function overloadReason({
  strict = strictBudget(),
  ci = onCi(),
  load = loadavg()[0] ?? 0,
  cores = cpus().length,
}: Partial<OverloadContext> = {}): string | undefined {
  if (strict || ci) return undefined;
  const perCore = load / Math.max(1, cores);
  if (perCore <= OVERLOAD_PER_CORE) return undefined;
  return `machine overloaded: load average ${load.toFixed(1)} on ${String(cores)} cores (${perCore.toFixed(1)} per core, over ${String(OVERLOAD_PER_CORE)}); the 2 × ceiling is not held against the layout`;
}

/**
 * Prints a budget case skipped by `overloadReason` on standard error. The default reporter counts a skipped case
 * without naming it and shows the console output of failed tests only; a direct write still reaches the
 * terminal.
 */
export function noteSkipped(what: string, note: string): void {
  process.stderr.write(`skipped: ${what}; ${note}\n`);
}

export interface BenchCase {
  readonly fixture: Fixture;
  readonly lens: LensId;
  readonly detail: DetailLevel;
}

/**
 * S, M and L at `auto` and `all`; L overview at `projects` (skill §8's check view, which routes in three
 * passes: ADR 0027); XL collapsed (`folders`).
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
}

/** Lays a Scene out `runs` times through the worker (after `warmUp` runs) and takes the medians. */
export async function measureInWorker(
  worker: NodeLayoutWorker,
  scene: Scene,
  runs = RUNS,
  warmUp = WARM_UP,
): Promise<WorkerFigures> {
  for (let i = 0; i < warmUp; i += 1) await worker.client.layout(scene);
  const trips: number[] = [];
  const own: number[] = [];
  let last: Layout | undefined;
  for (let i = 0; i < runs; i += 1) {
    const started = performance.now();
    const { layout } = await worker.client.layout(scene);
    trips.push(performance.now() - started);
    own.push(layout.report.timings?.total ?? Number.NaN);
    last = layout;
  }
  if (last === undefined) throw new Error('no runs');
  return { ...shapeOf(last), roundTrip: median(trips), layout: median(own), runs: trips };
}

export interface InProcessFigures extends CaseShape {
  /** Median stage timings of `layoutScene` on this thread. */
  readonly timings: StageTimings;
  readonly totals: readonly number[];
}

/** Lays a Scene out `runs` times on this thread (after `warmUp` runs) and takes the median stage timings. */
export function measureInProcess(scene: Scene, runs = RUNS, warmUp = WARM_UP): InProcessFigures {
  const clock = (): number => performance.now();
  for (let i = 0; i < warmUp; i += 1) layoutScene(scene, { clock });
  const timings: StageTimings[] = [];
  let last: Layout | undefined;
  for (let i = 0; i < runs; i += 1) {
    last = layoutScene(scene, { clock });
    if (last.report.timings === undefined) throw new Error('no timings');
    timings.push(last.report.timings);
  }
  if (last === undefined) throw new Error('no runs');
  const of = (stage: keyof StageTimings): number => median(timings.map((t) => t[stage]));
  return {
    ...shapeOf(last),
    timings: {
      normalise: of('normalise'),
      size: of('size'),
      pack: of('pack'),
      route: of('route'),
      total: of('total'),
    },
    totals: timings.map((t) => t.total),
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
