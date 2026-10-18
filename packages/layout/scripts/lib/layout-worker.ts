// SPDX-License-Identifier: Apache-2.0
/**
 * The layout worker for Node: mounts the package's `createLayoutWorkerHandler` on a `worker_threads` port the
 * way the app's Web Worker mounts it on `self` (README, "Worker"), with the worker's own clock for
 * `report.timings`. Started through tsx by the bench (scripts/bench.ts) and the worker tests
 * (test/worker.test.ts); `workerData.memoCapacity` sets the memo (the bench measures with 0, so every run lays
 * out).
 *
 * One message outside the protocol, used only by the memory check: `{ type: 'heap' }` is answered with
 * `{ type: 'heap', used }`, the worker's V8 heap in bytes after a full garbage collection.
 */
import { performance } from 'node:perf_hooks';
import v8 from 'node:v8';
import vm from 'node:vm';
import { parentPort, workerData } from 'node:worker_threads';
import { createLayoutWorkerHandler } from '../../src/index.js';

const port = parentPort;
if (port === null) throw new Error('layout-worker.ts must run in a worker thread.');

const data = (workerData ?? {}) as { readonly memoCapacity?: number };

/** A full collection: `--expose-gc` is refused in a worker's execArgv, so the flag is set from inside. */
function collectGarbage(): void {
  v8.setFlagsFromString('--expose-gc');
  const gc = vm.runInNewContext('gc') as () => void;
  gc();
}

const handle = createLayoutWorkerHandler(
  (message) => {
    port.postMessage(message);
  },
  {
    clock: () => performance.now(),
    ...(data.memoCapacity === undefined ? {} : { memoCapacity: data.memoCapacity }),
  },
);

port.on('message', (message: unknown) => {
  if (typeof message === 'object' && message !== null && (message as { type?: unknown }).type === 'heap') {
    collectGarbage();
    port.postMessage({ type: 'heap', used: v8.getHeapStatistics().used_heap_size });
    return;
  }
  handle(message);
});
