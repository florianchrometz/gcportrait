// SPDX-License-Identifier: MIT
/**
 * The page side of the data worker (protocol.ts): one promise per request. A Scene request supersedes the one
 * before it (the older promise rejects at once with a `DataCancelledError`), and so does a search or a locate
 * request the one of its kind before it; an aborted signal rejects it too. Lens requests are independent.
 */
import type { DemoSize, SnapshotRef, ViewSpec } from '@gcportrait/model';

import type { NodeChanges, NodeDetails, RevealAnswer } from '../../drawer/types';
import type { LocateAnswer, LocateQuery, SearchAnswer, SearchQuery } from '../../search/protocol';
import type { JobProgress, PreparedSnapshot } from '../../snapshots/worker/protocol';
import type { ViewChoices } from '../../views/choices';
import type { DiffFrom } from '../diff/types';
import type {
  DataErrorInfo,
  DataRequest,
  DataStage,
  DayRef,
  LensInfo,
  SceneAnswer,
  Viewport,
} from './protocol';

export class DataCancelledError extends Error {
  constructor(id: number) {
    super(`data request ${String(id)} was cancelled`);
    this.name = 'DataCancelledError';
  }
}

export function isDataCancelled(error: unknown): error is DataCancelledError {
  return error instanceof DataCancelledError;
}

export class DataWorkerError extends Error {
  readonly code: DataErrorInfo['code'];

  constructor(info: DataErrorInfo) {
    super(info.message);
    this.name = 'DataWorkerError';
    this.code = info.code;
  }
}

interface Pending {
  readonly kind:
    'lenses' | 'scene' | 'choices' | 'details' | 'changes' | 'reveal' | 'search' | 'locate' | 'demo';
  /** Resolves with the answer's payload (typed by the request that created it). */
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly onProgress?: ((stage: DataStage) => void) | undefined;
  readonly onJobProgress?: ((progress: JobProgress) => void) | undefined;
  readonly detach: () => void;
}

export interface SceneRequestOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (stage: DataStage) => void;
  /** The day to compare the drawn day with (diff/base.ts); absent, the answer carries no diff. */
  readonly diffFrom?: DiffFrom;
}

export interface DataClient {
  lenses(): Promise<readonly LensInfo[]>;
  scene(spec: ViewSpec, viewport: Viewport, options?: SceneRequestOptions): Promise<SceneAnswer>;
  /**
   * What the view controls offer for a snapshot on a day (`day`, the day on screen); independent
   * of Scene requests.
   */
  choices(snapshot: SnapshotRef, day: DayRef): Promise<ViewChoices>;
  /** The details drawer's facts about a node on a day; null when that day's Graph has no such node. */
  details(
    snapshot: SnapshotRef,
    node: string,
    day: DayRef,
    options?: { readonly signal?: AbortSignal },
  ): Promise<NodeDetails | null>;
  /**
   * What changed about a node from day `since` to day `day` of a snapshot; null when neither day has it or
   * the timeline no longer has one of the days.
   */
  changes(
    snapshot: SnapshotRef,
    node: string,
    days: { readonly since: DiffFrom; readonly day: DiffFrom },
    options?: { readonly signal?: AbortSignal },
  ): Promise<NodeChanges | null>;
  /** The flips that draw a node of the view on a day hidden in a collapsed zone. */
  reveal(
    spec: ViewSpec,
    viewport: Viewport,
    node: string,
    day: DayRef,
    options?: { readonly signal?: AbortSignal },
  ): Promise<RevealAnswer>;
  /** The nodes that match a text; a newer search supersedes the one before it. */
  search(query: SearchQuery, options?: { readonly signal?: AbortSignal }): Promise<SearchAnswer>;
  /** Where a node is in a view and what would show it; a newer one supersedes the one before it. */
  locate(query: LocateQuery, options?: { readonly signal?: AbortSignal }): Promise<LocateAnswer>;
  /** Demo organisation `size` with its history, ready to store ("Try the demo"; the generator is the worker's). */
  demo(size: DemoSize, onProgress?: (progress: JobProgress) => void): Promise<PreparedSnapshot>;
  /** Feeds a message from the worker. */
  receive(message: unknown): void;
  /** Rejects everything pending (the worker failed). */
  fail(message: string): void;
  dispose(): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function createDataClient(post: (request: DataRequest) => void): DataClient {
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let disposed = false;

  const settle = (id: number): Pending | undefined => {
    const entry = pending.get(id);
    if (entry === undefined) return undefined;
    pending.delete(id);
    entry.detach();
    return entry;
  };

  const request = <T>(
    build: (id: number) => DataRequest,
    kind: Pending['kind'],
    options: SceneRequestOptions & { readonly onJobProgress?: (progress: JobProgress) => void } = {},
  ): Promise<T> => {
    const id = nextId;
    nextId += 1;
    if (disposed || options.signal?.aborted === true) return Promise.reject(new DataCancelledError(id));
    if (kind === 'scene' || kind === 'search' || kind === 'locate') {
      for (const [older, entry] of [...pending]) {
        if (entry.kind === kind) settle(older)?.reject(new DataCancelledError(older));
      }
    }
    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => {
        settle(id)?.reject(new DataCancelledError(id));
      };
      options.signal?.addEventListener('abort', onAbort, { once: true });
      pending.set(id, {
        kind,
        resolve: (value) => {
          resolve(value as T);
        },
        reject,
        onProgress: options.onProgress,
        onJobProgress: options.onJobProgress,
        detach: () => options.signal?.removeEventListener('abort', onAbort),
      });
      try {
        post(build(id));
      } catch (error) {
        settle(id)?.reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  };

  return {
    lenses: () => request<readonly LensInfo[]>((id) => ({ type: 'lenses', id }), 'lenses'),
    scene: (spec, viewport, options) =>
      request<SceneAnswer>(
        (id) => ({
          type: 'scene',
          id,
          spec,
          viewport,
          ...(options?.diffFrom === undefined ? {} : { diffFrom: options.diffFrom }),
        }),
        'scene',
        options,
      ),
    choices: (snapshot, day) =>
      request<ViewChoices>((id) => ({ type: 'choices', id, snapshot, day }), 'choices'),
    details: (snapshot, node, day, options) =>
      request<NodeDetails | null>((id) => ({ type: 'details', id, snapshot, node, day }), 'details', options),
    changes: (snapshot, node, days, options) =>
      request<NodeChanges | null>(
        (id) => ({ type: 'changes', id, snapshot, node, since: days.since, day: days.day }),
        'changes',
        options,
      ),
    reveal: (spec, viewport, node, day, options) =>
      request<RevealAnswer>((id) => ({ type: 'reveal', id, spec, viewport, node, day }), 'reveal', options),
    search: (query, options) =>
      request<SearchAnswer>((id) => ({ type: 'search', id, query }), 'search', options),
    locate: (query, options) =>
      request<LocateAnswer>((id) => ({ type: 'locate', id, query }), 'locate', options),
    demo: (size, onProgress) =>
      request<PreparedSnapshot>(
        (id) => ({ type: 'demo', id, size }),
        'demo',
        onProgress === undefined ? {} : { onJobProgress: onProgress },
      ),
    receive(message) {
      if (!isRecord(message) || typeof message['id'] !== 'number') return;
      const id = message['id'];
      const entry = pending.get(id);
      if (entry === undefined) return;
      switch (message['type']) {
        case 'progress':
          entry.onProgress?.(message['stage'] as DataStage);
          return;
        case 'job-progress':
          entry.onJobProgress?.(message['progress'] as JobProgress);
          return;
        case 'demo':
          settle(id);
          entry.resolve(message['prepared']);
          return;
        case 'lenses':
          settle(id);
          entry.resolve(message['lenses']);
          return;
        case 'scene':
          settle(id);
          entry.resolve(message['answer']);
          return;
        case 'choices':
          settle(id);
          entry.resolve(message['choices']);
          return;
        case 'details':
          settle(id);
          entry.resolve(message['details']);
          return;
        case 'changes':
          settle(id);
          entry.resolve(message['changes']);
          return;
        case 'reveal':
          settle(id);
          entry.resolve(message['reveal']);
          return;
        case 'search':
        case 'locate':
          settle(id);
          entry.resolve(message['answer']);
          return;
        case 'error':
          settle(id);
          entry.reject(new DataWorkerError(message['error'] as DataErrorInfo));
          return;
        default:
          return;
      }
    },
    fail(message) {
      for (const id of [...pending.keys()])
        settle(id)?.reject(new DataWorkerError({ code: 'internal', message }));
    },
    dispose() {
      disposed = true;
      for (const id of [...pending.keys()]) settle(id)?.reject(new DataCancelledError(id));
    },
  };
}
