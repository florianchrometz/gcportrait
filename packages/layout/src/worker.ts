// SPDX-License-Identifier: MIT
/**
 * The layout worker protocol (ingest, graph build and layout each run off the UI thread: AGENTS.md,
 * Architecture and code; skill gcp-diagram-layout §7: "memoise by Scene hash; cancel superseded requests;
 * never block the UI thread").
 *
 * The page posts `layout` requests (a Scene, options and an id of its choosing) and `cancel`s; the worker
 * answers every request with any number of `progress` messages and then exactly one of `result`, `cancelled`
 * or `error`. A `layout` request supersedes every request that arrived before it: the older one is answered
 * `cancelled` at once and its layout is dropped at its next step (between stages, and every `ROUTE_STEP`
 * edges of a routing pass), so it never posts a result. Requests are memoised by key (hash.ts: a structural
 * hash of the Scene and the options): a request whose key is in the memo (the last `MEMO_CAPACITY` Layouts)
 * is answered at once, with the stored Layout; a request whose key is the one still being laid out takes the
 * running layout over instead of starting again.
 *
 * {@link createLayoutWorkerHandler} is the worker side. It holds no globals and takes the `postMessage`
 * function, so the same code runs in a Web Worker, in a Node `worker_threads` worker, or directly in a test:
 *
 *     const handle = createLayoutWorkerHandler((message) => self.postMessage(message));
 *     self.addEventListener('message', (event) => handle(event.data));
 *
 * The page side is `createLayoutClient` / `layoutClient` (client.ts). Inside the handler the layout stays
 * pure: the only host APIs it touches are the task-queue yield between steps (host.ts) and, if the mount
 * passes one, a clock for `report.timings`.
 */
import type { LayoutWorkerErrorInfo, Scene } from '@gcportrait/model';
import { LayoutInputError } from './errors.js';
import { layoutKey } from './hash.js';
import { createHostYield } from './host.js';
import { layoutSteps } from './layout.js';
import { LayoutMemo, MEMO_CAPACITY } from './memo.js';
import type { Layout, LayoutProgress, LayoutWorkerOptions } from './types.js';

/** Page → worker. Ids are the page's own (`createLayoutClient` counts up from 1); they only pair answers. */
export type LayoutWorkerRequest =
  /** Lays out a Scene; supersedes every earlier request. */
  | {
      readonly type: 'layout';
      readonly id: number;
      readonly scene: Scene;
      readonly options?: LayoutWorkerOptions;
    }
  /** Abandons a request: the worker answers `cancelled` (nothing, if it was already answered). */
  | { readonly type: 'cancel'; readonly id: number };

/** Why a request was cancelled: a later request arrived, or the page cancelled it. */
export type LayoutCancelReason = 'superseded' | 'cancelled';

export type { LayoutWorkerErrorCode, LayoutWorkerErrorInfo } from '@gcportrait/model';

/** Worker → page. After `result`, `cancelled` or `error` the request is over. */
export type LayoutWorkerResponse =
  | { readonly type: 'progress'; readonly id: number; readonly progress: LayoutProgress }
  | {
      readonly type: 'result';
      readonly id: number;
      /** The request's memo key (null: the request had none and was not memoised). */
      readonly key: string | null;
      /** Answered from the memo, without laying out. */
      readonly cached: boolean;
      readonly layout: Layout;
    }
  | { readonly type: 'cancelled'; readonly id: number; readonly reason: LayoutCancelReason }
  /** `id` is null when the message did not carry a usable id. */
  | { readonly type: 'error'; readonly id: number | null; readonly error: LayoutWorkerErrorInfo };

/** What the mount may give the handler; everything is optional. */
export interface LayoutWorkerEnvironment {
  /**
   * Resolves once the host has run its pending tasks (messages); awaited before a layout's first step and
   * between steps. Default: host.ts (`setImmediate`, a `MessageChannel`, or `setTimeout(0)`).
   */
  readonly yieldToHost?: () => Promise<void>;
  /** A millisecond clock (e.g. `performance.now`) for `report.timings`; without one there are none. */
  readonly clock?: () => number;
  /** How many Layouts the memo keeps (default `MEMO_CAPACITY`, 8; 0 turns memoisation off). */
  readonly memoCapacity?: number;
}

/** The request being laid out. Its `id` changes when a request with the same key takes it over. */
interface Job {
  id: number;
  readonly key: string | null;
  /** Cancelled by the page; a request with the same key may still take the job over before its next step. */
  cancelled: boolean;
  readonly steps: Generator<LayoutProgress, Layout, undefined>;
}

/**
 * The worker side of the protocol. Returns the function to call with each incoming message (`event.data`).
 * Memo hits, cancellations and errors in a request are answered synchronously; a layout runs in steps with a
 * yield to the host before each.
 */
export function createLayoutWorkerHandler(
  postMessage: (message: LayoutWorkerResponse) => void,
  environment: LayoutWorkerEnvironment = {},
): (message: unknown) => void {
  const yieldToHost = environment.yieldToHost ?? createHostYield().yieldToHost;
  const { clock } = environment;
  const memo = new LayoutMemo(environment.memoCapacity ?? MEMO_CAPACITY);
  /** The one request still running, if any: every newer request supersedes it. */
  let active: Job | null = null;

  /** Ends the running request (answering `cancelled` unless it was already) so that a newer one can start. */
  const supersede = (): void => {
    if (active === null) return;
    if (!active.cancelled) postMessage({ type: 'cancelled', id: active.id, reason: 'superseded' });
    active = null;
  };

  const run = async (job: Job): Promise<void> => {
    try {
      for (;;) {
        await yieldToHost();
        // A newer request replaced this one, or the page cancelled it and nothing took it over.
        if (active !== job) return;
        if (job.cancelled) {
          active = null;
          return;
        }
        let next: IteratorResult<LayoutProgress, Layout>;
        try {
          next = job.steps.next();
        } catch (error) {
          active = null;
          postMessage({ type: 'error', id: job.id, error: errorInfo(error) });
          return;
        }
        if (next.done === true) {
          active = null;
          if (job.key !== null) memo.set(job.key, next.value);
          postMessage({ type: 'result', id: job.id, key: job.key, cached: false, layout: next.value });
          return;
        }
        postMessage({ type: 'progress', id: job.id, progress: next.value });
      }
    } catch (error) {
      // Only postMessage itself can throw here (a host that cannot clone the message); report it once.
      if (active === job) active = null;
      postMessage({ type: 'error', id: job.id, error: errorInfo(error) });
    }
  };

  const start = (id: number, scene: Scene, options: LayoutWorkerOptions | undefined): void => {
    const key = layoutKey(scene, options);
    const stored = key === null ? undefined : memo.get(key);
    if (stored !== undefined) {
      supersede();
      postMessage({ type: 'result', id, key, cached: true, layout: stored });
      return;
    }
    if (active !== null && key !== null && active.key === key) {
      // The same Scene and options are being laid out already (a repeated request, or one cancelled and
      // asked for again before its next step): the new request takes the running layout over.
      if (!active.cancelled) postMessage({ type: 'cancelled', id: active.id, reason: 'superseded' });
      active.id = id;
      active.cancelled = false;
      return;
    }
    supersede();
    const job: Job = {
      id,
      key,
      cancelled: false,
      steps: layoutSteps(scene, clock === undefined ? (options ?? {}) : { ...options, clock }),
    };
    active = job;
    void run(job);
  };

  return (message: unknown): void => {
    let request: LayoutWorkerRequest;
    try {
      request = readRequest(message);
    } catch (error) {
      postMessage({ type: 'error', id: idOf(message), error: errorInfo(error) });
      return;
    }
    if (request.type === 'cancel') {
      if (active?.id === request.id && !active.cancelled) {
        active.cancelled = true;
        postMessage({ type: 'cancelled', id: request.id, reason: 'cancelled' });
      }
      return;
    }
    try {
      start(request.id, request.scene, request.options);
    } catch (error) {
      // Hashing reads every field of the request; only a host object with a throwing getter gets here.
      postMessage({ type: 'error', id: request.id, error: errorInfo(error) });
    }
  };
}

/** A protocol violation: the message is not a request this worker understands. */
class ProtocolError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function idOf(message: unknown): number | null {
  return isRecord(message) && isId(message['id']) ? message['id'] : null;
}

/** Validates a request's envelope; the Scene's tree and the options are checked by the layout itself. */
function readRequest(message: unknown): LayoutWorkerRequest {
  if (!isRecord(message)) throw new ProtocolError('A layout worker request must be an object.');
  const { type, id } = message;
  if (!isId(id)) throw new ProtocolError('A layout worker request needs an "id": a non-negative integer.');
  if (type === 'cancel') return { type, id };
  if (type !== 'layout')
    throw new ProtocolError('A layout worker request\'s "type" must be "layout" or "cancel".');
  const { scene, options } = message;
  if (
    !isRecord(scene) ||
    !Array.isArray(scene['children']) ||
    !Array.isArray(scene['edges']) ||
    !isRecord(scene['metadata'])
  ) {
    throw new ProtocolError('A layout request needs a "scene" with "children", "edges" and "metadata".');
  }
  if (options !== undefined && !isRecord(options)) {
    throw new ProtocolError('A layout request\'s "options", when present, must be an object.');
  }
  // The Scene's nodes and edges are checked by the layout's first stage (LayoutInputError with the ids), the
  // options by its option resolution.
  return {
    type,
    id,
    scene: scene as unknown as Scene,
    ...(options === undefined ? {} : { options }),
  };
}

function errorInfo(error: unknown): LayoutWorkerErrorInfo {
  if (error instanceof LayoutInputError)
    return { code: error.code, message: error.message, ids: [...error.ids] };
  if (error instanceof ProtocolError) return { code: 'protocol', message: error.message, ids: [] };
  return { code: 'internal', message: error instanceof Error ? error.message : String(error), ids: [] };
}
