// SPDX-License-Identifier: Apache-2.0
/**
 * Which ticks of a live scope are read from Cloud Asset Inventory, and when (skill cai-ingestion §5):
 * never all 35, only the tick the person stops on and, at idle, its two neighbours; at most two reads in flight;
 * a read the person has moved away from is cancelled.
 *
 * `fetchOrder` is the order (pure); `createFetchScheduler` runs a wanted list with the in-flight limit, starting the
 * most wanted jobs first, cancelling running jobs that are no longer wanted, and starting the next wanted job when one
 * ends. The scheduler knows nothing about ticks or the network: the job runner is injected (timeline/controller.ts
 * passes the live pull of import/run.ts; the tests pass promises they settle themselves).
 */
import type { TimelineTick } from './ticks';

/** Reads in flight at most (skill cai-ingestion §5). */
export const MAX_IN_FLIGHT = 2;

/**
 * The ticks to read, most wanted first: the one at `position`, then its neighbours, the one in the direction the
 * person last moved first (older first when they have not moved), each only when `needs` says it must be read.
 * With `neighbours: false` only the position (the debounced read when the person stops; neighbours come at idle).
 */
export function fetchOrder(
  ticks: readonly TimelineTick[],
  position: number,
  direction: -1 | 0 | 1,
  needs: (tick: TimelineTick) => boolean,
  neighbours = true,
): TimelineTick[] {
  const first = direction === 0 ? -1 : direction;
  const indexes = neighbours ? [position, position + first, position - first] : [position];
  const order: TimelineTick[] = [];
  for (const index of indexes) {
    const tick = ticks[index];
    if (tick !== undefined && needs(tick)) order.push(tick);
  }
  return order;
}

export interface FetchJob {
  /** Identifies the job: the tick's cache key. */
  readonly key: string;
}

export type JobOutcome = 'done' | 'failed' | 'cancelled';

export interface FetchSchedulerOptions<J extends FetchJob> {
  /** Jobs in flight at most (default {@link MAX_IN_FLIGHT}). */
  readonly limit?: number;
  /** Runs a job; resolves when it is done, rejects when it failed. The signal aborts when it is cancelled. */
  readonly run: (job: J, signal: AbortSignal) => Promise<void>;
  readonly onStart?: (job: J) => void;
  /** A job ended: done, failed (with its error) or cancelled (no longer wanted, or the scheduler disposed). */
  readonly onEnd?: (job: J, outcome: JobOutcome, error?: unknown) => void;
}

export interface FetchScheduler<J extends FetchJob> {
  /**
   * The jobs wanted now, most wanted first (repeats ignored). Running jobs that are not among them are cancelled;
   * then wanted jobs start in order while fewer than the limit run. A job that ends leaves the list, so a failed
   * one runs again only when a later `want` names it again.
   */
  want(jobs: readonly J[]): void;
  /** Cancels the running jobs and drops the wanted ones whose keys `keep` leaves out (the person moved on). */
  retain(keep: (key: string) => boolean): void;
  /** The keys of the running jobs, in the order they started. */
  running(): readonly string[];
  /** The keys of the wanted jobs not yet started. */
  queued(): readonly string[];
  /** Cancels everything; nothing runs after it. */
  dispose(): void;
}

interface Running<J> {
  readonly job: J;
  readonly controller: AbortController;
}

export function createFetchScheduler<J extends FetchJob>(
  options: FetchSchedulerOptions<J>,
): FetchScheduler<J> {
  const limit = Math.max(1, options.limit ?? MAX_IN_FLIGHT);
  const running = new Map<string, Running<J>>();
  let wanted: J[] = [];
  let disposed = false;

  const cancel = (key: string): void => {
    const entry = running.get(key);
    if (entry === undefined) return;
    running.delete(key);
    entry.controller.abort();
    options.onEnd?.(entry.job, 'cancelled');
  };

  const settle = (key: string, entry: Running<J>, outcome: 'done' | 'failed', error?: unknown): void => {
    // A cancelled job was taken out when it was cancelled: its late answer changes nothing.
    if (running.get(key) !== entry) return;
    running.delete(key);
    wanted = wanted.filter((job) => job.key !== key);
    options.onEnd?.(entry.job, outcome, error);
    pump();
  };

  const start = (job: J): void => {
    const entry: Running<J> = { job, controller: new AbortController() };
    running.set(job.key, entry);
    options.onStart?.(job);
    let promise: Promise<void>;
    try {
      promise = options.run(job, entry.controller.signal);
    } catch (error) {
      promise = Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    promise.then(
      () => {
        settle(job.key, entry, 'done');
      },
      (error: unknown) => {
        settle(job.key, entry, 'failed', error);
      },
    );
  };

  function pump(): void {
    if (disposed) return;
    for (const job of wanted) {
      if (running.size >= limit) return;
      if (!running.has(job.key)) start(job);
    }
  }

  return {
    want(jobs) {
      if (disposed) return;
      const seen = new Set<string>();
      wanted = jobs.filter((job) => {
        if (seen.has(job.key)) return false;
        seen.add(job.key);
        return true;
      });
      for (const key of [...running.keys()]) if (!seen.has(key)) cancel(key);
      pump();
    },
    retain(keep) {
      wanted = wanted.filter((job) => keep(job.key));
      for (const key of [...running.keys()]) if (!keep(key)) cancel(key);
      pump();
    },
    running: () => [...running.keys()],
    queued: () => wanted.filter((job) => !running.has(job.key)).map((job) => job.key),
    dispose() {
      disposed = true;
      wanted = [];
      for (const key of [...running.keys()]) cancel(key);
    },
  };
}
