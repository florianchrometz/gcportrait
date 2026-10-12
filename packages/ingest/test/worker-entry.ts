// SPDX-License-Identifier: MIT
/**
 * The ingest worker for Node: mounts the package's worker handler on a `worker_threads` port, exactly as a
 * Web Worker would mount it on `self`. Used by the budget test; started through tsx, so it runs the TypeScript
 * sources directly.
 */
import { parentPort } from 'node:worker_threads';
import { createIngestWorkerHandler } from '../src/index.js';

const port = parentPort;
if (port === null) throw new Error('worker-entry.ts must run in a worker thread.');
const handle = createIngestWorkerHandler((message) => {
  port.postMessage(message);
});
port.on('message', handle);
