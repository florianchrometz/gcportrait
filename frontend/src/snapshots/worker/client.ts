// SPDX-License-Identifier: Apache-2.0
/**
 * The page side of the snapshot protocol (protocol.ts): one promise per job, with its progress reported as it
 * comes. An import's signal cancels it: the promise rejects at once with {@link SnapshotJobCancelled}, the worker
 * is told to stop (`cancel`), and whatever it still answers for the job is dropped. The transport is a function
 * (a Web Worker's `postMessage`, browser.ts, or the in-process handler of tests, inProcess.ts); answers come back
 * through `receive`.
 */
import {
  CANCELLED_JOB,
  type JobProgress,
  type PreparedSnapshot,
  type SnapshotRequest,
  type SnapshotResponse,
} from './protocol';

export interface JobResult {
  readonly snapshots: readonly PreparedSnapshot[];
  readonly warnings: readonly string[];
}

/** A job the worker could not finish; `problems` lists the first things it found wrong. */
export class SnapshotJobError extends Error {
  readonly problems: readonly string[];

  constructor(message: string, problems: readonly string[] = []) {
    super(message);
    this.name = 'SnapshotJobError';
    this.problems = problems;
  }
}

/** A job the person cancelled (or left the page during): nothing of it is stored. */
export class SnapshotJobCancelled extends Error {
  override readonly name = 'SnapshotJobCancelled';
  constructor() {
    super(CANCELLED_JOB);
  }
}

export type OnProgress = (progress: JobProgress) => void;

export interface SnapshotClient {
  /**
   * Imports `files`, each snapshot under a new id that is not in `taken` (the ids already stored); an export's read
   * time is `readTime` (typed by the person) unless its operation.json names one. An aborted `signal` rejects
   * with {@link SnapshotJobCancelled} and stops the worker's job.
   */
  importFiles(
    files: readonly File[],
    onProgress?: OnProgress,
    taken?: readonly string[],
    readTime?: string,
    signal?: AbortSignal,
  ): Promise<JobResult>;
  /** Reads a stored record's plain documents in full; fails (with the reason) when they are damaged. */
  check(snapshot: Blob, history?: Blob, onProgress?: OnProgress): Promise<void>;
  /** An answer from the worker. */
  receive(message: unknown): void;
  /** The worker failed: every pending job fails with `message`. */
  fail(message: string): void;
  dispose(): void;
}

/** A started worker: its client and how to stop it. */
export interface SnapshotWorker {
  readonly client: SnapshotClient;
  dispose(): void;
}

export type SnapshotWorkerFactory = () => SnapshotWorker;

interface Pending {
  readonly resolve: (result: JobResult) => void;
  readonly reject: (error: Error) => void;
  readonly onProgress: OnProgress | undefined;
}

function isResponse(message: unknown): message is SnapshotResponse {
  return typeof message === 'object' && message !== null && 'type' in message && 'job' in message;
}

export function createSnapshotClient(post: (request: SnapshotRequest) => void): SnapshotClient {
  const pending = new Map<number, Pending>();
  let jobs = 0;

  const fail = (message: string): void => {
    for (const job of pending.values()) job.reject(new SnapshotJobError(message));
    pending.clear();
  };

  const start = (
    request: (job: number) => SnapshotRequest,
    onProgress?: OnProgress,
    signal?: AbortSignal,
  ): Promise<JobResult> =>
    new Promise<JobResult>((resolve, reject) => {
      if (signal?.aborted === true) {
        reject(new SnapshotJobCancelled());
        return;
      }
      jobs += 1;
      const job = jobs;
      const cancel = (): void => {
        if (!pending.delete(job)) return;
        post({ type: 'cancel', job });
        reject(new SnapshotJobCancelled());
      };
      const settled = (): void => {
        signal?.removeEventListener('abort', cancel);
      };
      pending.set(job, {
        resolve: (result) => {
          settled();
          resolve(result);
        },
        reject: (error) => {
          settled();
          reject(error);
        },
        onProgress,
      });
      signal?.addEventListener('abort', cancel, { once: true });
      post(request(job));
    });

  return {
    importFiles: (files, onProgress, taken = [], readTime, signal) =>
      start(
        (job) => ({
          type: 'import',
          job,
          files,
          now: Date.now(),
          taken,
          ...(readTime === undefined ? {} : { readTime }),
        }),
        onProgress,
        signal,
      ),
    check: async (snapshot, history, onProgress) => {
      await start(
        (job) =>
          history === undefined
            ? { type: 'check', job, snapshot }
            : { type: 'check', job, snapshot, history },
        onProgress,
      );
    },
    receive(message) {
      if (!isResponse(message)) return;
      const job = pending.get(message.job);
      if (job === undefined) return;
      if (message.type === 'progress') {
        job.onProgress?.(message.progress);
        return;
      }
      pending.delete(message.job);
      if (message.type === 'done') job.resolve({ snapshots: message.snapshots, warnings: message.warnings });
      else job.reject(new SnapshotJobError(message.message, message.problems));
    },
    fail,
    dispose() {
      fail('The snapshot worker was stopped.');
    },
  };
}
