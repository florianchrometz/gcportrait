// SPDX-License-Identifier: MIT
/**
 * A real layout worker for the bench and the worker tests: a Node `worker_threads` worker running
 * scripts/lib/layout-worker.ts (through tsx, so it runs the TypeScript sources), with the package's page-side
 * client wired to it exactly as the app wires a Web Worker (`createLayoutClient` + `receive`). It also records
 * every message the worker posts, so a test can check what a cancelled request was (not) answered.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { createLayoutClient, type LayoutClient, type LayoutWorkerResponse } from '../../src/index.js';

export interface NodeLayoutWorker {
  readonly client: LayoutClient;
  /** Every protocol message the worker posted, in order. */
  readonly messages: LayoutWorkerResponse[];
  /** The worker's V8 heap in bytes after a full garbage collection. */
  heapUsed(): Promise<number>;
  terminate(): Promise<void>;
}

export interface NodeLayoutWorkerOptions {
  /** The worker's memo capacity (default: the package default, 8). */
  readonly memoCapacity?: number;
}

/** Starts a layout worker thread and returns its client. */
export function startLayoutWorker(options: NodeLayoutWorkerOptions = {}): NodeLayoutWorker {
  const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
  const worker = new Worker(new URL('./layout-worker.ts', import.meta.url), {
    execArgv: ['--import', tsx],
    workerData: options,
  });
  const client = createLayoutClient((request) => {
    worker.postMessage(request);
  });
  const messages: LayoutWorkerResponse[] = [];
  const heapWaiters: ((used: number) => void)[] = [];
  worker.on('message', (message: LayoutWorkerResponse | { type: 'heap'; used: number }) => {
    if (message.type === 'heap') {
      heapWaiters.shift()?.(message.used);
      return;
    }
    messages.push(message);
    client.receive(message);
  });
  worker.on('error', (error: Error) => {
    client.fail(`the layout worker failed: ${error.message}`);
  });
  return {
    client,
    messages,
    heapUsed: () =>
      new Promise<number>((resolve) => {
        heapWaiters.push(resolve);
        worker.postMessage({ type: 'heap' });
      }),
    terminate: async () => {
      client.dispose();
      await worker.terminate();
    },
  };
}
