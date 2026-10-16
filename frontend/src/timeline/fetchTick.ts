// SPDX-License-Identifier: MIT
/**
 * Reads one day of a live scope from Cloud Asset Inventory into the tick cache (skill cai-ingestion §5): the live
 * pull of import/run.ts (`POST /api/assets/stream` with the day's `readTime`, or none for the latest tick, which
 * reads "now"; the import worker reads the frames as they arrive), stored not as a snapshot but as a tick under its
 * cache key (storage/tickCache.ts). Its progress is the pull's (import/progress.ts), its failure the pull's words
 * (import/errors.ts: Google's message verbatim). The token stays in memory: the pull asks the session for it.
 *
 * A read the timeline cancels (the view moved away from its day, or the page was left) keeps nothing, its write to
 * the cache included: the write takes the read's signal (storage/tickCache.ts: nothing is written once it is
 * aborted, and a day whose abort lands while it is written is taken back), the pull ends as cancelled, and the read
 * rejects instead of resolving. The scheduler counts the day as not read the moment it cancels the read and ignores
 * the read's late answer (scheduler.ts), so a day kept anyway would sit in the cache while the bar marks it not read
 * yet, and the view coming back to it would read it again in full: keeping it would save no read. The cache holds
 * only the days the timeline counts as read.
 */
import type { SnapshotScope } from '@gcportrait/model';

import type { AuthControls } from '../auth';
import {
  IDLE_PROGRESS,
  importProgressReducer,
  type ImportFailure,
  type ImportProgress,
} from '../import/progress';
import { runLivePull, type ImportDependencies, type PullTarget } from '../import/run';
import type { ImportClient } from '../import/worker/client';
import { SnapshotJobCancelled } from '../snapshots/worker/client';
import type { PreparedSnapshot } from '../snapshots/worker/protocol';
import { TickWriteCancelled, type StoredTick, type TickCacheStore } from '../storage/tickCache';
import { TICK_CONTENT_TYPE } from './cacheKey';
import { dayReadTime } from './ticks';

/** One day to read. */
export interface TickJob {
  /** Its cache key (timeline/cacheKey.ts). */
  readonly key: string;
  readonly day: string;
  /** The read time to ask for; null: now (the latest tick). */
  readonly readTime: string | null;
  /** `organizations/123`. */
  readonly scopePath: string;
  readonly scope: SnapshotScope;
  /** How the scope is read (mode, quota project), from the permission check (import/target.ts). */
  readonly target: Omit<PullTarget, 'scope' | 'readTime' | 'assetTypes'>;
  /** The app's day: the cache drops the scope's days before its window. */
  readonly today: string;
}

/** The read failed; `failure` says why, in the pull's words. */
export class TickReadFailed extends Error {
  override readonly name = 'TickReadFailed';
  readonly failure: ImportFailure;

  constructor(failure: ImportFailure) {
    super(failure.title);
    this.failure = failure;
  }
}

/**
 * Reads a day into the cache; resolves once it is stored, rejects with {@link TickReadFailed} or, cancelled (the
 * write included), with an `AbortError`.
 */
export type TickFetcher = (
  job: TickJob,
  signal: AbortSignal,
  onProgress: (progress: ImportProgress) => void,
) => Promise<void>;

export interface TickFetcherDependencies {
  readonly auth: AuthControls;
  readonly worker: () => Promise<ImportClient>;
  readonly cache: TickCacheStore;
  readonly clock?: () => number;
}

/** The cache record of a day read. */
export function tickRecord(job: TickJob, prepared: PreparedSnapshot, fetchedAt: number): StoredTick {
  return {
    key: job.key,
    scope: job.scopePath,
    readTime: dayReadTime(job.day),
    day: job.day,
    contentType: TICK_CONTENT_TYPE,
    now: job.readTime === null,
    actualReadTime: prepared.meta.readTime,
    fetchedAt: new Date(fetchedAt).toISOString(),
    assetCount: prepared.meta.assetCount,
    bytes: prepared.blob.size,
    blob: prepared.blob,
  };
}

export function createTickFetcher(dependencies: TickFetcherDependencies): TickFetcher {
  const clock = dependencies.clock ?? (() => Date.now());
  return async (job, signal, onProgress) => {
    let progress: ImportProgress = IDLE_PROGRESS;
    const library: ImportDependencies['library'] = {
      async storePrepared(prepared, options) {
        try {
          await dependencies.cache.put(tickRecord(job, prepared, clock()), job.today, options);
        } catch (error) {
          // Cancelled before or while the day was written: nothing of it is kept, and the pull ends as cancelled.
          if (error instanceof TickWriteCancelled) throw new SnapshotJobCancelled();
          throw error;
        }
        return job.key;
      },
    };
    const imported = await runLivePull(
      { auth: dependencies.auth, library, worker: dependencies.worker, now: clock },
      {
        ...job.target,
        scope: job.scope,
        ...(job.readTime === null ? {} : { readTime: job.readTime }),
      },
      (action) => {
        progress = importProgressReducer(progress, action);
        onProgress(progress);
      },
      signal,
    );
    if (imported !== null) return;
    if (signal.aborted) throw new DOMException('The read was cancelled.', 'AbortError');
    throw new TickReadFailed(
      progress.failure ?? {
        title: `${job.day} could not be read.`,
        message: 'The read ended without an answer.',
      },
    );
  };
}
