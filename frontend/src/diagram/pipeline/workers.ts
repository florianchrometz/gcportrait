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
export const createBrowserWorkers: DiagramWorkersFactory = () => {
  const dataWorker = new DiagramWorker({ name: WORKER_ROLES.data });
  const data = createDataClient((request) => {
    dataWorker.postMessage(request);
  });
  dataWorker.addEventListener('message', (event: MessageEvent) => {
    data.receive(decodeMessage(event.data));
  });
  dataWorker.addEventListener('error', (event: ErrorEvent) => {
    data.fail(event.message || 'The data worker failed.');
  });
  const layoutWorker = new DiagramWorker({ name: WORKER_ROLES.layout });
  const layout = layoutClient(decodingWorker(layoutWorker));
  layoutWorker.addEventListener('error', (event: ErrorEvent) => {
    layout.fail(event.message || 'The layout worker failed.');
  });
  return {
    data,
    layout,
    dispose() {
      data.dispose();
      layout.dispose();
      dataWorker.terminate();
      layoutWorker.terminate();
    },
  };
};

/**
 * One pair for everyone who asks (main.tsx: the diagram session): the first call creates it, later calls return it,
 * and once it is disposed (the diagram session unmounted, as React's strict mode does once in development) the next
 * call creates a new one.
 */
export function sharedWorkers(factory: DiagramWorkersFactory): DiagramWorkersFactory {
  let live: DiagramWorkers | null = null;
  return () => {
    if (live !== null) return live;
    const created = factory();
    const pair: DiagramWorkers = {
      data: created.data,
      layout: created.layout,
      dispose() {
        if (live === pair) live = null;
        created.dispose();
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
  const worker = new DiagramWorker({ name: WORKER_ROLES.demo });
  const client = createDataClient((request) => {
    worker.postMessage(request);
  });
  worker.addEventListener('message', (event: MessageEvent) => {
    client.receive(event.data);
  });
  worker.addEventListener('error', (event: ErrorEvent) => {
    client.fail(event.message || 'The demo worker failed.');
  });
  const done = (): void => {
    client.dispose();
    worker.terminate();
  };
  const job = client.demo(size, onProgress);
  job.then(done, done);
  return job;
}
