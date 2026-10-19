// SPDX-License-Identifier: Apache-2.0
/**
 * The page side of the layout worker protocol (worker.ts): one promise per layout request.
 *
 *     const client = layoutClient(new LayoutWorker()); // a Web Worker running createLayoutWorkerHandler
 *     const { layout, cached } = await client.layout(scene, {}, { signal, onProgress });
 *
 * Every new request supersedes the one before it, on both sides: the client rejects the older promise at once
 * with a {@link LayoutCancelledError} (`reason` `superseded`), and the worker drops the older layout at its
 * next step. An aborted `signal` rejects the request (`aborted`) and tells the worker to stop. A cancelled
 * request never resolves, even if its result was already on its way. Use one client per worker: the worker
 * supersedes by arrival, whoever sent the request.
 */
import type { LayoutCancelledReason, LayoutResult, Scene } from '@gcportrait/model';
import type { Layout, LayoutProgress, LayoutWorkerOptions } from './types.js';
import type { LayoutWorkerErrorCode, LayoutWorkerErrorInfo, LayoutWorkerRequest } from './worker.js';

export type { LayoutCancelledReason, LayoutResult } from '@gcportrait/model';

/** An `AbortSignal`, typed structurally (the package compiles without DOM types). */
export interface AbortSignalLike {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void, options?: { readonly once?: boolean }): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

export interface LayoutRequestOptions {
  /** Aborting it rejects the request with a `LayoutCancelledError` (`aborted`) and cancels it in the worker. */
  readonly signal?: AbortSignalLike;
  /** Called with each progress message of the request (stages, routing passes). */
  readonly onProgress?: (progress: LayoutProgress) => void;
}

/** The rejection of a request that was cancelled; never a failure, so a caller usually ignores it. */
export class LayoutCancelledError extends Error {
  readonly id: number;
  readonly reason: LayoutCancelledReason;

  constructor(id: number, reason: LayoutCancelledReason) {
    super(`layout request ${String(id)} was ${reason}`);
    this.name = 'LayoutCancelledError';
    this.id = id;
    this.reason = reason;
  }
}

/** Whether an error is a {@link LayoutCancelledError}. */
export function isLayoutCancelled(error: unknown): error is LayoutCancelledError {
  return error instanceof LayoutCancelledError;
}

/**
 * The rejection of a request the worker answered with an error: a refused Scene or option (`code` is the
 * `LayoutInputError` code and `ids` names the offending nodes or options), a protocol error, or an internal
 * one (also when the worker itself failed).
 */
export class LayoutWorkerError extends Error {
  readonly id: number;
  readonly code: LayoutWorkerErrorCode;
  readonly ids: readonly string[];

  constructor(id: number, info: LayoutWorkerErrorInfo) {
    super(info.message);
    this.name = 'LayoutWorkerError';
    this.id = id;
    this.code = info.code;
    this.ids = info.ids;
  }
}

interface Pending {
  readonly resolve: (result: LayoutResult) => void;
  readonly reject: (error: Error) => void;
  readonly onProgress: ((progress: LayoutProgress) => void) | undefined;
  /** Removes the abort listener. */
  readonly detach: () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The page side of one layout worker. Create it with {@link createLayoutClient} or {@link layoutClient}. */
export class LayoutClient {
  readonly #post: (request: LayoutWorkerRequest) => void;
  readonly #onDispose: () => void;
  readonly #pending = new Map<number, Pending>();
  #nextId = 1;
  #disposed = false;

  constructor(post: (request: LayoutWorkerRequest) => void, onDispose: () => void = () => undefined) {
    this.#post = post;
    this.#onDispose = onDispose;
  }

  /** Requests still waiting for an answer (0 or 1: each request supersedes the one before it). */
  get pending(): number {
    return this.#pending.size;
  }

  /**
   * Lays out a Scene in the worker. Resolves with the Layout; rejects with a {@link LayoutCancelledError} when
   * a newer request, `cancel()`, `dispose()` or the signal cancels it, or with a {@link LayoutWorkerError}.
   */
  layout(
    scene: Scene,
    options?: LayoutWorkerOptions,
    request: LayoutRequestOptions = {},
  ): Promise<LayoutResult> {
    const { signal, onProgress } = request;
    const id = this.#nextId;
    this.#nextId += 1;
    if (this.#disposed) return Promise.reject(new LayoutCancelledError(id, 'cancelled'));
    if (signal?.aborted === true) return Promise.reject(new LayoutCancelledError(id, 'aborted'));
    for (const older of [...this.#pending.keys()])
      this.#settle(older)?.reject(new LayoutCancelledError(older, 'superseded'));
    return new Promise<LayoutResult>((resolve, reject) => {
      const onAbort = (): void => {
        const pending = this.#settle(id);
        if (pending === undefined) return;
        pending.reject(new LayoutCancelledError(id, 'aborted'));
        this.#send({ type: 'cancel', id });
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.#pending.set(id, {
        resolve,
        reject,
        onProgress,
        detach: () => signal?.removeEventListener('abort', onAbort),
      });
      try {
        this.#post({ type: 'layout', id, scene, ...(options === undefined ? {} : { options }) });
      } catch (error) {
        // The host could not post the request (a Scene that is not structured-cloneable, a closed worker).
        this.#settle(id)?.reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /** Handles a message from the worker (`event.data`); anything that is not an answer to a pending request is ignored. */
  readonly receive = (message: unknown): void => {
    if (!isRecord(message) || typeof message['id'] !== 'number') return;
    const id = message['id'];
    const pending = this.#pending.get(id);
    if (pending === undefined) return;
    switch (message['type']) {
      case 'progress':
        pending.onProgress?.(message['progress'] as LayoutProgress);
        return;
      case 'result':
        this.#settle(id);
        pending.resolve({
          id,
          key: message['key'] as string | null,
          cached: message['cached'] === true,
          layout: message['layout'] as Layout,
        });
        return;
      case 'cancelled':
        this.#settle(id);
        pending.reject(
          new LayoutCancelledError(id, message['reason'] === 'cancelled' ? 'cancelled' : 'superseded'),
        );
        return;
      case 'error':
        this.#settle(id);
        pending.reject(new LayoutWorkerError(id, message['error'] as LayoutWorkerErrorInfo));
        return;
      default:
        return;
    }
  };

  /** Cancels the pending request, if any (it rejects with `cancelled`). */
  cancel(): void {
    for (const id of [...this.#pending.keys()]) {
      this.#settle(id)?.reject(new LayoutCancelledError(id, 'cancelled'));
      this.#send({ type: 'cancel', id });
    }
  }

  /** Rejects every pending request with an internal `LayoutWorkerError` (the worker failed or was terminated). */
  fail(message: string): void {
    for (const id of [...this.#pending.keys()]) {
      this.#settle(id)?.reject(new LayoutWorkerError(id, { code: 'internal', message, ids: [] }));
    }
  }

  /** Cancels the pending request and detaches from the worker; later requests reject at once. */
  dispose(): void {
    if (this.#disposed) return;
    this.cancel();
    this.#disposed = true;
    this.#onDispose();
  }

  /** Removes a pending request and its abort listener; returns it (undefined if it was not pending). */
  #settle(id: number): Pending | undefined {
    const pending = this.#pending.get(id);
    if (pending === undefined) return undefined;
    this.#pending.delete(id);
    pending.detach();
    return pending;
  }

  /** Posts a message that needs no answer; a host that cannot post any more has nothing left to cancel. */
  #send(request: LayoutWorkerRequest): void {
    try {
      this.#post(request);
    } catch {
      // Nothing to do: the request is already settled on this side.
    }
  }
}

/** A client that posts its requests through `post` and is fed the worker's messages through `receive`. */
export function createLayoutClient(post: (request: LayoutWorkerRequest) => void): LayoutClient {
  return new LayoutClient(post);
}

/** A message event, typed structurally. */
export interface MessageEventLike {
  readonly data: unknown;
}

/** A Web Worker (or anything with its `postMessage` and message events), typed structurally. */
export interface LayoutWorkerLike {
  postMessage(message: LayoutWorkerRequest): void;
  addEventListener(type: 'message', listener: (event: MessageEventLike) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEventLike) => void): void;
}

/**
 * A client connected to a Web Worker that runs `createLayoutWorkerHandler`: posts through the worker and
 * listens to its messages; `dispose()` cancels the pending request and removes the listener (the worker is the
 * caller's to terminate).
 */
export function layoutClient(worker: LayoutWorkerLike): LayoutClient {
  const listener = (event: MessageEventLike): void => {
    client.receive(event.data);
  };
  const client = new LayoutClient(
    (request) => {
      worker.postMessage(request);
    },
    () => {
      worker.removeEventListener('message', listener);
    },
  );
  worker.addEventListener('message', listener);
  return client;
}
