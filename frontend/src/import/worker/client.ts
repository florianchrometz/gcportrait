// SPDX-License-Identifier: MIT
/**
 * The page side of the import protocol (protocol.ts): reads a response body from the backend and hands each chunk
 * to the worker as it arrives (moved, not copied, when the chunk owns its buffer), reporting the bytes received;
 * the worker's counts and its answer come back through `receive`. Cancelling (the signal) stops the read, tells
 * the worker to drop the job, and rejects with {@link ImportCancelled}. The transport is a function: a Web Worker's
 * `postMessage` (browser.ts) or the in-process handler of tests (inProcess.ts).
 */
import type { PreparedSnapshot } from '../../snapshots/worker/protocol';
import type { ImportRequest, ImportResponse, StreamCounts, StreamFailure, StreamSettings } from './protocol';

export class ImportCancelled extends Error {
  override readonly name = 'ImportCancelled';
  constructor() {
    super('The import was cancelled.');
  }
}

/** The connection broke while the body was read. */
export class StreamBroken extends Error {
  override readonly name = 'StreamBroken';
}

/** The worker could not finish the job. */
export class ImportJobFailed extends Error {
  override readonly name = 'ImportJobFailed';
  readonly failure: StreamFailure;

  constructor(failure: StreamFailure) {
    super(failure.message);
    this.failure = failure;
  }
}

export interface StreamJobOptions {
  readonly signal: AbortSignal;
  /** The running total of bytes handed to the worker. */
  readonly onBytes?: (bytes: number) => void;
  readonly onCounts?: (counts: StreamCounts) => void;
  /** Reading is done; the worker compresses the snapshot. */
  readonly onEncoding?: () => void;
}

export interface StreamJobResult {
  readonly snapshot: PreparedSnapshot;
  readonly warnings: readonly string[];
}

export interface ImportClient {
  /** Streams `body` through the worker into a snapshot ready to store. */
  run(
    settings: StreamSettings,
    body: ReadableStream<Uint8Array>,
    options: StreamJobOptions,
  ): Promise<StreamJobResult>;
  receive(message: unknown): void;
  /** The worker failed: every running job fails with `message`. */
  fail(message: string): void;
  dispose(): void;
}

export interface ImportWorker {
  readonly client: ImportClient;
  dispose(): void;
}

export type ImportWorkerFactory = () => ImportWorker;

interface Pending {
  readonly resolve: (result: StreamJobResult) => void;
  readonly reject: (error: Error) => void;
  readonly options: StreamJobOptions;
}

function isResponse(message: unknown): message is ImportResponse {
  return typeof message === 'object' && message !== null && 'type' in message && 'job' in message;
}

/** A chunk whose bytes fill its whole buffer can be moved to the worker; any other is copied. */
function transferable(chunk: Uint8Array): ArrayBuffer[] {
  return chunk.byteOffset === 0 &&
    chunk.byteLength === chunk.buffer.byteLength &&
    chunk.buffer instanceof ArrayBuffer
    ? [chunk.buffer]
    : [];
}

export function createImportClient(
  post: (request: ImportRequest, transfer: ArrayBuffer[]) => void,
): ImportClient {
  const pending = new Map<number, Pending>();
  let jobs = 0;

  const fail = (message: string): void => {
    for (const job of pending.values()) job.reject(new ImportJobFailed({ kind: 'internal', message }));
    pending.clear();
  };

  return {
    async run(settings, body, options) {
      jobs += 1;
      const job = jobs;
      const answer = new Promise<StreamJobResult>((resolve, reject) => {
        pending.set(job, { resolve, reject, options });
      });
      // A rejection that arrives while the body is still being read is handled below.
      answer.catch(() => undefined);
      post({ type: 'start', job, settings }, []);
      const reader = body.getReader();
      const cancel = (): void => {
        pending.delete(job);
        post({ type: 'cancel', job }, []);
        reader.cancel().catch(() => undefined);
      };
      let bytes = 0;
      // A function, not the property: the signal can abort during any await below.
      const aborted = (): boolean => options.signal.aborted;
      // Cancelling ends a read that is waiting for the network.
      const stopReading = (): void => {
        reader.cancel().catch(() => undefined);
      };
      options.signal.addEventListener('abort', stopReading, { once: true });
      try {
        for (;;) {
          if (aborted()) throw new ImportCancelled();
          let result: ReadableStreamReadResult<Uint8Array>;
          try {
            result = await reader.read();
          } catch {
            if (aborted()) throw new ImportCancelled();
            throw new StreamBroken('The connection to the backend broke.');
          }
          if (result.done) break;
          if (!pending.has(job)) {
            // The worker has already answered (an error frame ended the job): stop reading.
            reader.cancel().catch(() => undefined);
            break;
          }
          bytes += result.value.byteLength;
          options.onBytes?.(bytes);
          post({ type: 'chunk', job, data: result.value }, transferable(result.value));
        }
        if (aborted()) throw new ImportCancelled();
      } catch (error) {
        if (pending.has(job)) cancel();
        throw error;
      } finally {
        options.signal.removeEventListener('abort', stopReading);
      }
      if (pending.has(job)) post({ type: 'end', job }, []);
      const onAbort = (): void => {
        const waiting = pending.get(job);
        if (waiting === undefined) return;
        cancel();
        waiting.reject(new ImportCancelled());
      };
      options.signal.addEventListener('abort', onAbort, { once: true });
      try {
        return await answer;
      } finally {
        options.signal.removeEventListener('abort', onAbort);
      }
    },
    receive(message) {
      if (!isResponse(message)) return;
      const job = pending.get(message.job);
      if (job === undefined) return;
      switch (message.type) {
        case 'progress':
          job.options.onCounts?.(message.counts);
          return;
        case 'encoding':
          job.options.onEncoding?.();
          return;
        case 'done':
          pending.delete(message.job);
          job.resolve({ snapshot: message.snapshot, warnings: message.warnings });
          return;
        case 'error':
          pending.delete(message.job);
          job.reject(
            message.failure.kind === 'cancelled'
              ? new ImportCancelled()
              : new ImportJobFailed(message.failure),
          );
          return;
      }
    },
    fail,
    dispose() {
      fail('The import worker was stopped.');
    },
  };
}
