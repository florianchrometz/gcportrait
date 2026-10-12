// SPDX-License-Identifier: MIT
/**
 * The worker protocol. The page posts `start`, then `chunk`s, then `end` (or `cancel`) for a job; the worker
 * answers with `progress` events and exactly one `done` (the IngestResult) or one `error` for every job it
 * started. {@link createIngestWorkerHandler} is
 * the worker side: it holds no globals and takes the `postMessage` function, so the same code runs in a Web
 * Worker, in a Node `worker_threads` worker, or directly in a test. {@link postIngestJob} is the page side.
 *
 * This module is the package's only side-effect boundary: unless the caller passes its own, the handler
 * reads the clock (`Date.now`) and the platform's `crypto.getRandomValues` for snapshot ids.
 *
 * Mounting it in a Web Worker:
 *
 *     const handle = createIngestWorkerHandler((message) => self.postMessage(message));
 *     self.onmessage = (event) => handle(event.data);
 */
import { IngestError, type IngestErrorCode, type IngestProblem, type UpstreamFailure } from './errors.js';
import { isRecord } from './normalise.js';
import { isBlobLike, isByteStream } from './platform.js';
import {
  createIngestSession,
  type IngestEvent,
  type IngestResult,
  type IngestSession,
  type IngestSettings,
} from './session.js';
import { chunksOf, sourcesOf, type IngestChunk, type IngestInput } from './sources.js';

/** Page → worker. `job` identifies the job in every message; one handler can run several jobs at once. */
export type IngestWorkerRequest =
  /** Starts a job. */
  | { readonly type: 'start'; readonly job: string; readonly settings: IngestSettings }
  /**
   * The next chunk of input. `part` is the index of the file it belongs to (default: the current part);
   * parts arrive in order, and a higher index ends the parts before it.
   */
  | { readonly type: 'chunk'; readonly job: string; readonly part?: number; readonly data: IngestChunk }
  /**
   * No more input: the worker answers with `done` or `error`. `parts` is the number of parts (files) the
   * input had; it counts trailing empty parts, which sent no chunk (default: up to the last part that did).
   */
  | { readonly type: 'end'; readonly job: string; readonly parts?: number }
  /** Abandons a job: the worker drops it and answers with an `error` whose code is `cancelled`. */
  | { readonly type: 'cancel'; readonly job: string };

/** An error as posted by the worker. `internal` marks an unexpected exception (a bug). */
export interface IngestErrorInfo {
  readonly code: IngestErrorCode | 'internal';
  readonly message: string;
  readonly problem?: IngestProblem;
  readonly upstream?: UpstreamFailure;
}

/** Worker → page. After `done` or `error` the job is gone and further messages for it are ignored. */
export type IngestWorkerResponse =
  | { readonly type: 'progress'; readonly job: string; readonly event: IngestEvent }
  | { readonly type: 'done'; readonly job: string; readonly result: IngestResult }
  | { readonly type: 'error'; readonly job: string; readonly error: IngestErrorInfo };

/** Overrides for the handler's clock and entropy source (tests pass fixed ones). */
export interface IngestWorkerEnvironment {
  /** Milliseconds since the Unix epoch. Default `Date.now`. */
  readonly clock?: () => number;
  /** Numbers in [0, 1). Default: `crypto.getRandomValues`. */
  readonly entropy?: () => number;
}

interface Job {
  readonly session: IngestSession;
  /** The index of the current part: the part of the last chunk, 0 before any chunk. */
  part: number;
  /** Whether any chunk arrived; if so, parts 0 to `part` exist. */
  received: boolean;
}

/**
 * The worker side of the protocol. Returns the function to call with each incoming message (`event.data`).
 * Every request is handled synchronously; replies go out through `postMessage`.
 */
export function createIngestWorkerHandler(
  postMessage: (message: IngestWorkerResponse) => void,
  environment: IngestWorkerEnvironment = {},
): (message: unknown) => void {
  const clock = environment.clock ?? (() => Date.now());
  const entropy = environment.entropy ?? cryptoEntropy();
  const jobs = new Map<string, Job>();
  /** Jobs that ended or failed: late chunks for them (posted before the page saw the error) are dropped. */
  const closed = new Set<string>();

  const fail = (job: string, error: unknown): void => {
    jobs.delete(job);
    if (job !== '') closed.add(job);
    postMessage({ type: 'error', job, error: errorInfo(error) });
  };

  return (message: unknown): void => {
    const job = isRecord(message) && typeof message['job'] === 'string' ? message['job'] : '';
    try {
      const request = readRequest(message);
      switch (request.type) {
        case 'start': {
          if (jobs.has(job) || closed.has(job)) throw protocolError(`Job "${job}" was already started.`);
          const session = createIngestSession({
            ...request.settings,
            clock,
            entropy,
            onEvent: (event) => {
              postMessage({ type: 'progress', job, event });
            },
          });
          jobs.set(job, { session, part: 0, received: false });
          return;
        }
        case 'chunk': {
          const state = jobs.get(job);
          if (state === undefined) {
            if (closed.has(job)) return;
            throw protocolError(`Job "${job}" was not started.`);
          }
          const part = request.part ?? state.part;
          if (part < state.part)
            throw protocolError(`Part ${String(part)} arrived after part ${String(state.part)}.`);
          for (; state.part < part; state.part += 1) state.session.endPart();
          state.received = true;
          state.session.push(request.data);
          return;
        }
        case 'end': {
          const state = jobs.get(job);
          if (state === undefined) {
            if (closed.has(job)) return;
            throw protocolError(`Job "${job}" was not started.`);
          }
          if (request.parts !== undefined) {
            const seen = state.received ? state.part + 1 : 0;
            if (request.parts < seen) {
              throw protocolError(
                `The end message says ${String(request.parts)} parts, but part ${String(seen - 1)} arrived.`,
              );
            }
            for (; state.part < request.parts; state.part += 1) state.session.endPart();
          }
          jobs.delete(job);
          closed.add(job);
          postMessage({ type: 'done', job, result: state.session.finish() });
          return;
        }
        case 'cancel': {
          if (!jobs.has(job)) {
            if (closed.has(job)) return;
            throw protocolError(`Job "${job}" was not started.`);
          }
          fail(job, new IngestError('cancelled', 'The ingest job was cancelled.'));
          return;
        }
      }
    } catch (error) {
      fail(job, error);
    }
  };
}

/** Validates the envelope of a request; the settings are validated by the session. */
function readRequest(message: unknown): IngestWorkerRequest {
  if (!isRecord(message)) throw protocolError('A request must be an object.');
  const { type, job } = message;
  if (typeof job !== 'string' || job === '') throw protocolError('A request needs a non-empty "job" id.');
  switch (type) {
    case 'start':
      if (!isRecord(message['settings'])) throw protocolError('A start request needs "settings".');
      // Every field is checked at runtime by createIngestSession.
      return { type, job, settings: message['settings'] as unknown as IngestSettings };
    case 'chunk': {
      const { data, part } = message;
      if (typeof data !== 'string' && !(data instanceof Uint8Array)) {
        throw protocolError('A chunk request needs "data": a Uint8Array or a string.');
      }
      if (part === undefined) return { type, job, data };
      if (typeof part !== 'number' || !Number.isSafeInteger(part) || part < 0) {
        throw protocolError('A chunk\'s "part" must be a non-negative integer.');
      }
      return { type, job, part, data };
    }
    case 'end': {
      const { parts } = message;
      if (parts === undefined) return { type, job };
      if (typeof parts !== 'number' || !Number.isSafeInteger(parts) || parts < 0) {
        throw protocolError('An end\'s "parts" must be a non-negative integer.');
      }
      return { type, job, parts };
    }
    case 'cancel':
      return { type, job };
    default:
      throw protocolError('A request\'s "type" must be "start", "chunk", "end" or "cancel".');
  }
}

function protocolError(message: string): IngestError {
  return new IngestError('protocol', message);
}

function errorInfo(error: unknown): IngestErrorInfo {
  if (error instanceof IngestError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.problem === undefined ? {} : { problem: error.problem }),
      ...(error.upstream === undefined ? {} : { upstream: error.upstream }),
    };
  }
  return { code: 'internal', message: error instanceof Error ? error.message : String(error) };
}

interface RandomSource {
  getRandomValues(array: Uint32Array): Uint32Array;
}

/** Numbers in [0, 1) from the platform's cryptographic random source. */
function cryptoEntropy(): () => number {
  const crypto = (globalThis as unknown as { crypto?: RandomSource }).crypto;
  if (typeof crypto?.getRandomValues !== 'function') {
    throw new IngestError(
      'unsupported-platform',
      'crypto.getRandomValues is not available; pass an entropy function to createIngestWorkerHandler.',
    );
  }
  const buffer = new Uint32Array(64);
  let next = buffer.length;
  return () => {
    if (next === buffer.length) {
      crypto.getRandomValues(buffer);
      next = 0;
    }
    const value = buffer[next] ?? 0;
    next += 1;
    return value / 2 ** 32;
  };
}

/** Sends a request to the worker; `transfer` lists buffers whose ownership moves to the worker. */
export type IngestRequestPoster = (message: IngestWorkerRequest, transfer: ArrayBuffer[]) => void;

/**
 * The page side: reads the input and posts `start`, one `chunk` per chunk with its part index, and `end` with
 * the number of parts. Chunks read from Blobs and streams are transferred (moved, not copied) when they own
 * their whole buffer; caller-owned strings, byte arrays and iterables are copied by `postMessage`. Resolves
 * once everything is posted; the answer arrives as worker messages. If reading a source fails (or the input
 * is not a valid list of sources), it posts `cancel`, so that the worker drops the job and answers with a
 * `cancelled` error, and rejects with the original error.
 */
export async function postIngestJob(
  post: IngestRequestPoster,
  job: string,
  input: IngestInput,
  settings: IngestSettings,
): Promise<void> {
  post({ type: 'start', job, settings }, []);
  let part = 0;
  try {
    for (const source of sourcesOf(input)) {
      const owned = isByteStream(source) || isBlobLike(source);
      for await (const data of chunksOf(source)) {
        post({ type: 'chunk', job, part, data }, owned ? transferable(data) : []);
      }
      part += 1;
    }
  } catch (error) {
    post({ type: 'cancel', job }, []);
    throw error;
  }
  post({ type: 'end', job, parts: part }, []);
}

function transferable(data: IngestChunk): ArrayBuffer[] {
  if (typeof data === 'string') return [];
  const { buffer } = data;
  return buffer instanceof ArrayBuffer && data.byteOffset === 0 && data.byteLength === buffer.byteLength
    ? [buffer]
    : [];
}
