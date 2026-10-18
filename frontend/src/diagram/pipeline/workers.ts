// SPDX-License-Identifier: Apache-2.0
/**
 * The two workers the diagram uses (AGENTS.md, Architecture and code): the data worker (ingest, graph and Scene;
 * it draws the demo organisations too) and the layout worker, two dedicated instances of one worker script
 * (diagram.worker.ts), each named after its role. The app creates them lazily, once, the first time a diagram
 * needs them (`sharedWorkers`); tests pass an in-process pair (inProcess.ts) through the same interface. "Try the
 * demo" runs in a third instance of the script, started for its job and ended with it (`createBrowserDemoJob`).
 */
import {
  layoutClient,
  type LayoutClient,
  type LayoutWorkerLike,
  type MessageEventLike,
} from '@gcportrait/layout';
import type { DemoSize } from '@gcportrait/model';

import type { JobProgress, PreparedSnapshot } from '../../snapshots/worker/protocol';
import { createDataClient, type DataClient } from './dataClient';
import DiagramWorker from './diagram.worker?worker';
import { WORKER_ROLES } from './roles';
import { decodeMessage } from './transfer';

export interface DiagramWorkers {
  readonly data: DataClient;
  readonly layout: LayoutClient;
  dispose(): void;
}

export type DiagramWorkersFactory = () => DiagramWorkers;

/**
 * The layout worker as the layout client sees it, with every message decoded first (transfer.ts; a large
 * Layout arrives as transferred JSON bytes).
 */
function decodingWorker(worker: Worker): LayoutWorkerLike {
  const wrapped = new Map<(event: MessageEventLike) => void, (event: MessageEvent) => void>();
  return {
    postMessage(message) {
      worker.postMessage(message);
    },
    addEventListener(type, listener) {
      const decoding = (event: MessageEvent): void => {
        listener({ data: decodeMessage(event.data) });
      };
      wrapped.set(listener, decoding);
      worker.addEventListener(type, decoding);
    },
    removeEventListener(type, listener) {
      const decoding = wrapped.get(listener);
      if (decoding === undefined) return;
      wrapped.delete(listener);
      worker.removeEventListener(type, decoding);
    },
  };
}

/** The real Web Workers, bundled by Vite. */
export interface RoleClient {
  receive(message: unknown): void;
  fail(message: string): void;
  dispose(): void;
}

export interface StartedRole<C extends RoleClient> {
  readonly client: C;
  dispose(): void;
}

/**
 * Starts one role of the worker script (`DiagramWorker`), connects a client to its `postMessage`, `message`,
 * and `error` events, and returns the client and a `dispose` method that cleans up both.
 */
export function startRole<C extends RoleClient>(
  role: string,
  createClient: (post: (request: unknown, transfer?: Transferable[]) => void) => C,
  label: string,
  decode?: (data: unknown) => unknown,
): StartedRole<C> {
  const worker = new DiagramWorker({ name: role });
  const post = (request: unknown, transfer?: Transferable[]): void => {
    if (transfer !== undefined) {
      worker.postMessage(request, transfer);
    } else {
      worker.postMessage(request);
    }
  };
  const client = createClient(post);
  worker.addEventListener('message', (event: MessageEvent) => {
    client.receive(decode !== undefined ? decode(event.data) : event.data);
  });
  worker.addEventListener('error', (event: ErrorEvent) => {
    client.fail(event.message || `The ${label} worker failed.`);
  });
  return {
    client,
    dispose() {
      client.dispose();
      worker.terminate();
    },
  };
}

export const createBrowserWorkers: DiagramWorkersFactory = () => {
  const data = startRole(WORKER_ROLES.data, createDataClient, 'data', decodeMessage);
  const layoutWorker = new DiagramWorker({ name: WORKER_ROLES.layout });
  const layout = layoutClient(decodingWorker(layoutWorker));
  layoutWorker.addEventListener('error', (event: ErrorEvent) => {
    layout.fail(event.message || 'The layout worker failed.');
  });
  return {
    data: data.client,
    layout,
    dispose() {
      data.dispose();
      layout.dispose();
      layoutWorker.terminate();
    },
  };
};

/**
 * One pair for everyone who asks (main.tsx: the diagram session): the first call creates it, later calls return it,
 * and once it is disposed (the diagram session unmounted) the next call creates a new one. Under React's StrictMode
 * in development, synchronous unmount/remount leaves disposal pending on a microtask so the workers are not restarted twice.
 */
export function sharedWorkers(factory: DiagramWorkersFactory): DiagramWorkersFactory {
  let live: DiagramWorkers | null = null;
  let cancelDisposal: (() => void) | null = null;

  return () => {
    if (cancelDisposal !== null) {
      cancelDisposal();
      cancelDisposal = null;
    }
    if (live !== null) return live;
    const created = factory();
    const pair: DiagramWorkers = {
      data: created.data,
      layout: created.layout,
      dispose() {
        if (live !== pair || cancelDisposal !== null) return;
        let cancelled = false;
        cancelDisposal = () => {
          cancelled = true;
        };
        queueMicrotask(() => {
          if (cancelled) return;
          cancelDisposal = null;
          if (live === pair) live = null;
          created.dispose();
        });
      },
    };
    live = pair;
    return pair;
  };
}

/**
 * "Try the demo": demo organisation `size` prepared for storage in a worker of its own (demoRole.ts), started
 * for this job and terminated when it settles, so the data worker goes on answering the diagram's requests meanwhile
 * and keeps none of the job's memory.
 */
export function createBrowserDemoJob(
  size: DemoSize,
  onProgress?: (progress: JobProgress) => void,
): Promise<PreparedSnapshot> {
  const role = startRole(WORKER_ROLES.demo, createDataClient, 'demo');
  const done = (): void => {
    role.dispose();
  };
  const job = role.client.demo(size, onProgress);
  job.then(done, done);
  return job;
}
