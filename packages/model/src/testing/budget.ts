// SPDX-License-Identifier: Apache-2.0
/**
 * The wall-clock limits of the tests, one rule for every package that times its own work (the layout's
 * budgets, the ingest budget, the graph build's budget, the demo organisations' generation):
 *
 * - **Measured again while over.** A case over its limit is measured again after a `PAUSE_MS` pause, at most
 *   `plan.batches` times and only while another batch fits in the test's timeout, and its best batch counts
 *   (`measureBatches`): under `pnpm test` a budget test starts while every other test file runs and competes
 *   with them for the cores. A batch stops its runs at the deadline it is handed (`BATCH_TIMEOUT_SHARE` of
 *   the timeout; `measureRuns`), so that its test reports a figure before it times out, and a batch cut short
 *   there is a miss (`MissedLimit.cut`).
 * - **Skipped on an overloaded machine, never on CI.** Under a local `pnpm test`, a case still over its limit
 *   while the one-minute load average is above `OVERLOAD_PER_CORE` per core is skipped with the load and
 *   its figures as the reason (`overloadReason`, `skipIfOverloaded`): four times oversubscribed, work reads
 *   several times its quiet figure even at its best of five batches, so the limit would measure the machine.
 *   On CI (`onCi`) the limit is the check that blocks a pull request, and a strict budget run (a package's
 *   `test:budget`) asserts the budget itself; neither ever skips.
 *
 * The helpers run in the tests' Node process. This package has no Node types (a pure core), so they reach the
 * process, its clock and its timers through `globalThis`, as the packages' other testing helpers reach the
 * host, and `node:os` through `process.getBuiltinModule`; loaded anywhere else, they find no load and never
 * skip.
 */

/** At most this many batches of a case (`measureBatches`). */
export const BATCHES = 5;

/** The pause before each batch after the first. */
export const PAUSE_MS = 250;

/** The share of a test's timeout its batches may take (`anotherBatchFits`). */
export const BATCH_TIMEOUT_SHARE = 0.95;

/** The one-minute load average per core above which a local run skips a missed limit (`overloadReason`). */
export const OVERLOAD_PER_CORE = 1.5;

/** The parts of `node:os` the overload rule reads. */
interface OsView {
  loadavg(): readonly number[];
  cpus(): readonly unknown[];
}

/** The parts of the Node process, its clock and its timers these helpers use. */
interface HostView {
  readonly process?: {
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly stderr: { write(text: string): unknown };
    getBuiltinModule?(id: 'node:os'): OsView;
  };
  readonly performance: { now(): number };
  setTimeout(callback: () => void, ms: number): unknown;
}

function host(): HostView {
  return globalThis as unknown as HostView;
}

/** How a budget test measures one case: `batches` batches of `runs`, the first after `warmUp` more. */
export interface BudgetPlan {
  readonly batches: number;
  readonly runs: number;
  readonly warmUp: number;
}

/**
 * Whether another batch of `batchMs` fits, after a `PAUSE_MS` pause, in what is left of a test's timeout once
 * `elapsedMs` have passed. Under heavy load five batches of a long case outlast the timeout, and a timed-out
 * test reports no figure at all.
 */
export function anotherBatchFits(elapsedMs: number, batchMs: number, timeoutMs: number): boolean {
  return elapsedMs + PAUSE_MS + batchMs < BATCH_TIMEOUT_SHARE * timeoutMs;
}

/** What `measureBatches` measured: the best batch, every batch's median, and whether it stopped early. */
export interface Batches<F> {
  readonly best: F;
  readonly medians: readonly number[];
  /** Another batch would not have fitted in the test's timeout (`anotherBatchFits`). */
  readonly outOfTime: boolean;
}

/** How `measureBatches` runs: the plan, the limit a batch's median stays under, the time it may take. */
export interface BatchOptions {
  readonly plan: BudgetPlan;
  readonly limit: number;
  /** What is left of the test's timeout when the measuring starts. */
  readonly timeoutMs: number;
  /** Warm-up runs before each batch after the first (the first has `plan.warmUp`). */
  readonly laterWarmUp: number;
}

/**
 * Measures a budget case in batches: `measure(runs, warmUp, deadline)` once, then again after a `PAUSE_MS`
 * pause while every median so far is over the limit, at most `plan.batches` times, and only while another
 * batch, as long per run as the last one, fits in the test's timeout. The batch with the lowest median is the
 * best. Stopping early only leaves fewer batches to choose from, so it can fail or skip a case but never pass
 * one that more batches would have failed.
 *
 * `deadline` is the `performance.now()` time at `BATCH_TIMEOUT_SHARE` of the test's timeout, the same for
 * every batch. A measurement makes its runs with `measureRuns`, which starts no run that would end past it: a
 * batch that runs slower than the one before it (the machine got busier), or a first batch that slow, then
 * ends before the test times out, and its figures say so (`Runs.cut`), for the test to count the case as
 * missed.
 */
export async function measureBatches<F>(
  measure: (runs: number, warmUp: number, deadline: number) => F | Promise<F>,
  medianOf: (figures: F) => number,
  { plan, limit, timeoutMs, laterWarmUp }: BatchOptions,
): Promise<Batches<F>> {
  const { performance } = host();
  const started = performance.now();
  const deadline = started + BATCH_TIMEOUT_SHARE * timeoutMs;
  const medians: number[] = [];
  let best: { figures: F; median: number } | undefined;
  let perRun = 0;
  let outOfTime = false;
  for (let batch = 0; batch < plan.batches; batch += 1) {
    if (batch > 0) {
      const next = perRun * (plan.runs + laterWarmUp);
      if (!anotherBatchFits(performance.now() - started, next, timeoutMs)) {
        outOfTime = true;
        break;
      }
      await new Promise<void>((resolve) => {
        host().setTimeout(resolve, PAUSE_MS);
      });
    }
    const warmUp = batch === 0 ? plan.warmUp : laterWarmUp;
    const batchStarted = performance.now();
    const figures = await measure(plan.runs, warmUp, deadline);
    perRun = (performance.now() - batchStarted) / Math.max(1, plan.runs + warmUp);
    const value = medianOf(figures);
    medians.push(value);
    if (best === undefined || value < best.median) best = { figures, median: value };
    if (value < limit) break;
  }
  if (best === undefined) throw new Error('a budget plan needs at least one batch');
  return { best: best.figures, medians, outOfTime };
}

/** One run of a batch (`measureRuns`): what it returned, and how long it took on the wall clock. */
export interface TimedRun<R> {
  readonly ms: number;
  readonly value: R;
}

/** What `measureRuns` made of a batch. */
export interface Runs<R> {
  /** The warm-up runs made, in order. */
  readonly warmUp: readonly TimedRun<R>[];
  /** The timed runs made after them, in order: fewer than planned when the batch was `cut`. */
  readonly runs: readonly TimedRun<R>[];
  /**
   * The runs the batch's figures come from: the timed runs, or the warm-up runs when the deadline left no
   * timed run. Never empty.
   */
  readonly counted: readonly TimedRun<R>[];
  /** The value of the last run made. */
  readonly last: R;
  /** The batch stopped at its deadline before every run was made. */
  readonly cut: boolean;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function'
  );
}

/**
 * Makes one batch of a budget case: `warmUp` runs of `run`, then `runs` timed ones, each timed on the wall
 * clock. With a `deadline` (a `performance.now()` time, as `measureBatches` hands it), no run but the first
 * starts once it would end past the deadline if it took as long as the longest run so far: the batch then
 * stops short (`cut`), so that its test reports its figures before its timeout fires, and counts the case as
 * missed. A run that returns a promise is awaited; runs that do not follow each other without a yield.
 * Every run's value is kept, so a run returns only what its figures need.
 */
export async function measureRuns<R>(
  run: () => R | Promise<R>,
  runs: number,
  warmUp: number,
  deadline = Number.POSITIVE_INFINITY,
): Promise<Runs<R>> {
  if (runs < 1) throw new Error('a batch needs at least one run');
  const { performance } = host();
  const warm: TimedRun<R>[] = [];
  const timed: TimedRun<R>[] = [];
  let longest = 0;
  let cut = false;
  for (let index = 0; index < warmUp + runs; index += 1) {
    if (index > 0 && performance.now() + longest > deadline) {
      cut = true;
      break;
    }
    const started = performance.now();
    const pending = run();
    const value = isPromiseLike(pending) ? await pending : pending;
    const ms = performance.now() - started;
    longest = Math.max(longest, ms);
    (index < warmUp ? warm : timed).push({ ms, value });
  }
  const counted = timed.length > 0 ? timed : warm;
  const last = counted[counted.length - 1];
  if (last === undefined) throw new Error('a batch needs at least one run');
  return { warmUp: warm, runs: timed, counted, last: last.value, cut };
}

/**
 * What a test adds to its figures when its batch stopped at the deadline (`Runs.cut`): `; the batch stopped
 * at the deadline after 4 of 10 runs`, or nothing.
 */
export function cutNote({ cut, made, planned }: { cut: boolean; made: number; planned: number }): string {
  return cut ? `; the batch stopped at the deadline after ${String(made)} of ${String(planned)} runs` : '';
}

/**
 * Whether the run is on CI (`CI` set and not `false` or `0`, as GitHub Actions sets it). There a wall-clock
 * limit under `pnpm test` is the check that blocks a pull request, so it never skips.
 */
export function onCi(): boolean {
  const value = host().process?.env['CI'];
  return value !== undefined && value !== '' && value !== 'false' && value !== '0';
}

/** What a missed limit is judged against (`overloadReason`). */
export interface OverloadContext {
  /** A strict budget run (a package's `test:budget`): the budget itself is asserted, whatever the load. */
  readonly strict: boolean;
  /** On CI (`onCi()`): the limit is the check that blocks. */
  readonly ci: boolean;
  /** The one-minute load average. */
  readonly load: number;
  readonly cores: number;
}

/**
 * Why a case over its limit is skipped rather than failed, or `undefined` when it must fail: a strict run and
 * every run on CI always fail; a local run fails unless the machine's one-minute load average is above
 * `OVERLOAD_PER_CORE` per core. `ci`, `load` and `cores` default to the running machine.
 */
export function overloadReason(
  context: Pick<OverloadContext, 'strict'> & Partial<OverloadContext>,
): string | undefined {
  if (context.strict || (context.ci ?? onCi())) return undefined;
  const { load, cores } = { ...machineLoad(), ...context };
  const perCore = load / Math.max(1, cores);
  if (perCore <= OVERLOAD_PER_CORE) return undefined;
  return `machine overloaded: load average ${load.toFixed(1)} on ${String(cores)} cores (${perCore.toFixed(1)} per core, over ${String(OVERLOAD_PER_CORE)}); the limit would measure the machine, not the code`;
}

/** The running machine's one-minute load average and its cores (no load where `node:os` is not reachable). */
function machineLoad(): { load: number; cores: number } {
  const os = host().process?.getBuiltinModule?.('node:os');
  if (os === undefined) return { load: 0, cores: 1 };
  return { load: os.loadavg()[0] ?? 0, cores: os.cpus().length };
}

/**
 * Prints a case skipped by `overloadReason` on standard error. The default reporter counts a skipped case
 * without naming it and shows the console output of failed tests only; a direct write still reaches the
 * terminal.
 */
export function noteSkipped(what: string, note: string): void {
  host().process?.stderr.write(`skipped: ${what}; ${note}\n`);
}

/** A figure measured against its limit, and how its test is skipped (`skipIfOverloaded`). */
export interface MissedLimit {
  /** The figure, in the limit's unit. */
  readonly value: number;
  readonly limit: number;
  /**
   * The batch stopped at its deadline (`Runs.cut`): a miss whatever its figure reads, since only a whole
   * batch passes a case.
   */
  readonly cut?: boolean;
  /** A strict budget run (`OverloadContext.strict`). */
  readonly strict: boolean;
  /** What missed which limit, for the `skipped:` line: `layout S overview auto over its 20 ms ceiling`. */
  readonly what: string;
  /** The figures the reason quotes: `median 31.2 ms`. */
  readonly figures: string;
  /** The test context's `skip`, which ends the test. */
  readonly skip: (note: string) => void;
}

/**
 * Skips the test when its figure is at or over the limit, or its batch was cut short at the deadline, and
 * `overloadReason` gives a reason, after a `skipped:` line (`noteSkipped`); otherwise returns, and the test
 * asserts the limit itself (and, for a batch cut short, that it was not).
 */
export function skipIfOverloaded({
  value,
  limit,
  cut = false,
  strict,
  what,
  figures,
  skip,
}: MissedLimit): void {
  if (value < limit && !cut) return;
  const reason = overloadReason({ strict });
  if (reason === undefined) return;
  const note = `${reason} (${figures})`;
  noteSkipped(what, note);
  skip(note);
}
