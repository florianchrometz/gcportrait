// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
/**
 * Which ticks are read, and when (skill cai-ingestion §5): the order (the view's day, then its neighbours, the one in
 * the direction of travel first), at most two reads in flight, the next wanted one starting when one ends, and a
 * read the view moved away from cancelled, its late answer ignored.
 */
import { describe, expect, it } from 'vitest';

import { createFetchScheduler, fetchOrder, type FetchJob, type JobOutcome } from './scheduler';
import { settled } from './testing/fixtures';
import { timelineTicks } from './ticks';

const TICKS = timelineTicks('2026-10-10');
const all = (): boolean => true;
const days = (order: readonly { readonly day: string }[]): string[] => order.map((tick) => tick.day);

describe('fetchOrder', () => {
  it('is the day, then the older neighbour, then the newer one, when the view has not moved', () => {
    expect(days(fetchOrder(TICKS, 20, 0, all))).toEqual(['2026-09-26', '2026-09-25', '2026-09-27']);
  });

  it('puts the neighbour in the direction of travel first', () => {
    expect(days(fetchOrder(TICKS, 20, 1, all))).toEqual(['2026-09-26', '2026-09-27', '2026-09-25']);
    expect(days(fetchOrder(TICKS, 20, -1, all))).toEqual(['2026-09-26', '2026-09-25', '2026-09-27']);
  });

  it('keeps inside the timeline and leaves out what needs no read', () => {
    expect(days(fetchOrder(TICKS, 0, -1, all))).toEqual(['2026-09-06', '2026-09-07']);
    expect(days(fetchOrder(TICKS, 34, 1, all))).toEqual(['2026-10-10', '2026-10-09']);
    expect(days(fetchOrder(TICKS, 20, 1, (tick) => tick.day !== '2026-09-26'))).toEqual([
      '2026-09-27',
      '2026-09-25',
    ]);
    expect(days(fetchOrder(TICKS, 20, 1, all, false))).toEqual(['2026-09-26']);
  });

  it('never orders more than the day and its two neighbours: never all 35', () => {
    for (let index = 0; index < TICKS.length; index += 1)
      expect(fetchOrder(TICKS, index, 0, all).length).toBeLessThanOrEqual(3);
  });
});

interface Job extends FetchJob {
  readonly name: string;
}

/** A scheduler whose jobs are promises the test settles, with what started and how each ended. */
function harness(limit?: number) {
  const runs = new Map<
    string,
    { resolve: () => void; reject: (error: Error) => void; signal: AbortSignal }
  >();
  const started: string[] = [];
  const ended: [string, JobOutcome][] = [];
  const scheduler = createFetchScheduler<Job>({
    ...(limit === undefined ? {} : { limit }),
    run: (job, signal) =>
      new Promise<void>((resolve, reject) => {
        runs.set(job.key, { resolve, reject, signal });
      }),
    onStart: (job) => started.push(job.key),
    onEnd: (job, outcome) => ended.push([job.key, outcome]),
  });
  const job = (key: string): Job => ({ key, name: key });
  const settle = async (key: string, outcome: 'done' | 'failed' = 'done'): Promise<void> => {
    const run = runs.get(key);
    if (run === undefined) throw new Error(`${key} never ran`);
    if (outcome === 'done') run.resolve();
    else run.reject(new Error(`${key} failed`));
    // However many steps the scheduler takes to hear of it, they are done after a turn of the event loop.
    await settled();
  };
  return { scheduler, runs, started, ended, job, settle };
}

describe('createFetchScheduler', () => {
  it('runs at most two at once, most wanted first, and starts the next when one ends', async () => {
    const { scheduler, started, ended, job, settle } = harness();
    scheduler.want([job('a'), job('b'), job('c'), job('a')]);
    expect(started).toEqual(['a', 'b']);
    expect(scheduler.running()).toEqual(['a', 'b']);
    expect(scheduler.queued()).toEqual(['c']);
    await settle('b');
    expect(ended).toEqual([['b', 'done']]);
    expect(started).toEqual(['a', 'b', 'c']);
    expect(scheduler.running()).toEqual(['a', 'c']);
    await settle('a', 'failed');
    await settle('c');
    expect(ended).toEqual([
      ['b', 'done'],
      ['a', 'failed'],
      ['c', 'done'],
    ]);
    expect(scheduler.running()).toEqual([]);
  });

  it('cancels a running read that is no longer wanted, and ignores its late answer', async () => {
    const { scheduler, runs, started, ended, job, settle } = harness();
    scheduler.want([job('a'), job('b')]);
    scheduler.want([job('c'), job('b')]);
    expect(runs.get('a')?.signal.aborted).toBe(true);
    expect(runs.get('b')?.signal.aborted).toBe(false);
    expect(ended).toEqual([['a', 'cancelled']]);
    expect(started).toEqual(['a', 'b', 'c']);
    await settle('a');
    expect(ended).toEqual([['a', 'cancelled']]);
    expect(scheduler.running()).toEqual(['b', 'c']);
  });

  it('keeps only what `retain` keeps, and runs a failed job again only when wanted again', async () => {
    const { scheduler, runs, started, job, settle } = harness();
    scheduler.want([job('a'), job('b'), job('c')]);
    scheduler.retain((key) => key !== 'a');
    expect(runs.get('a')?.signal.aborted).toBe(true);
    expect(scheduler.running()).toEqual(['b', 'c']);
    await settle('b', 'failed');
    expect(scheduler.running()).toEqual(['c']);
    expect(started).toEqual(['a', 'b', 'c']);
    scheduler.want([job('c'), job('b')]);
    expect(started).toEqual(['a', 'b', 'c', 'b']);
  });

  it('honours its own limit, turns a throwing runner into a failure, and runs nothing once disposed', async () => {
    const ended: [string, JobOutcome][] = [];
    const scheduler = createFetchScheduler<Job>({
      limit: 1,
      run: (job) => {
        if (job.key === 'x') throw new Error('broken');
        return new Promise<void>(() => undefined);
      },
      onEnd: (job, outcome) => ended.push([job.key, outcome]),
    });
    scheduler.want([
      { key: 'x', name: 'x' },
      { key: 'y', name: 'y' },
    ]);
    await settled();
    expect(ended).toEqual([['x', 'failed']]);
    expect(scheduler.running()).toEqual(['y']);
    scheduler.dispose();
    expect(ended).toEqual([
      ['x', 'failed'],
      ['y', 'cancelled'],
    ]);
    scheduler.want([{ key: 'z', name: 'z' }]);
    expect(scheduler.running()).toEqual([]);
  });
});
